import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  cronJobSchema,
  entryNameSchema,
  profileChannelIds,
  profileConfigSchema,
  profileIdSchema,
  profileLayout,
  resolveProfileChannel,
  webhookSchema,
  type CronJob,
  type EntryName,
  type ProfileConfig,
  type ProfileId,
  type ProfileIssue,
  type Webhook,
} from "@tetherbox/core";
import { z } from "zod";

export interface LoadedProfile {
  id: ProfileId;
  dir: string;
  config: ProfileConfig;
  cron: ReadonlyMap<EntryName, CronJob>;
  webhooks: ReadonlyMap<EntryName, Webhook>;
}

export type ProfileLoad =
  | { kind: "loaded"; profile: LoadedProfile; issues: ProfileIssue[] }
  | { kind: "invalid"; issues: [ProfileIssue, ...ProfileIssue[]] };

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

async function loadEntries<T>(
  dir: string,
  schema: z.ZodType<T>,
  issues: ProfileIssue[],
): Promise<Map<EntryName, T>> {
  const entries = new Map<EntryName, T>();
  let files: string[];

  try {
    files = await readdir(dir);
  } catch (error) {
    if (isMissing(error)) {
      return entries;
    }

    throw error;
  }

  for (const file of files.filter((name) => name.endsWith(".json"))) {
    const path = join(dir, file);
    const name = entryNameSchema.safeParse(file.slice(0, -".json".length));

    if (!name.success) {
      issues.push({ file: path, message: "file name must be a lowercase slug" });
      continue;
    }

    try {
      const parsed = schema.safeParse(await readJson(path));

      if (parsed.success) {
        entries.set(name.data, parsed.data);
      } else {
        issues.push({ file: path, message: z.prettifyError(parsed.error) });
      }
    } catch (error) {
      issues.push({ file: path, message: describe(error) });
    }
  }

  return entries;
}

function dropUnknownChannels<T extends { channel?: EntryName | undefined }>(
  entries: Map<EntryName, T>,
  dir: string,
  config: ProfileConfig,
  issues: ProfileIssue[],
): void {
  for (const [name, entry] of entries) {
    if (entry.channel !== undefined && resolveProfileChannel(config, entry.channel) === undefined) {
      issues.push({
        file: join(dir, `${name}.json`),
        message: `unknown channel "${entry.channel}" (not defined in profile.json channels)`,
      });
      entries.delete(name);
    }
  }
}

export async function loadProfile(id: ProfileId, dir: string): Promise<ProfileLoad> {
  const configPath = join(dir, profileLayout.config);
  let config: ProfileConfig;

  try {
    const parsed = profileConfigSchema.safeParse(await readJson(configPath));

    if (!parsed.success) {
      return {
        kind: "invalid",
        issues: [{ file: configPath, message: z.prettifyError(parsed.error) }],
      };
    }

    config = parsed.data;
  } catch (error) {
    return { kind: "invalid", issues: [{ file: configPath, message: describe(error) }] };
  }

  const issues: ProfileIssue[] = [];
  const cronDir = join(dir, profileLayout.cronDir);
  const webhooksDir = join(dir, profileLayout.webhooksDir);
  const cron = await loadEntries(cronDir, cronJobSchema, issues);
  const webhooks = await loadEntries(webhooksDir, webhookSchema, issues);

  dropUnknownChannels(cron, cronDir, config, issues);
  dropUnknownChannels(webhooks, webhooksDir, config, issues);

  const profile: LoadedProfile = {
    id,
    dir,
    config,
    cron,
    webhooks,
  };

  return { kind: "loaded", profile, issues };
}

/**
 * Profiles live on disk as `<profilesDir>/<id>/`. The registry is a cache of the last valid load
 * of each one; the files stay the source of truth.
 */
export class ProfileRegistry {
  readonly #profilesDir: string;
  #profiles = new Map<ProfileId, LoadedProfile>();
  #queue: Promise<void> = Promise.resolve();

  constructor(profilesDir: string) {
    this.#profilesDir = profilesDir;
  }

  #serialize<T>(task: () => Promise<T>): Promise<T> {
    const next = this.#queue.then(task, task);

    this.#queue = next.then(
      () => undefined,
      () => undefined,
    );

    return next;
  }

  loadAll(): Promise<ProfileIssue[]> {
    return this.#serialize(() => this.#loadAll());
  }

  reload(id: ProfileId): Promise<ProfileLoad> {
    return this.#serialize(() => this.#reload(id));
  }

  async #loadAll(): Promise<ProfileIssue[]> {
    const issues: ProfileIssue[] = [];
    let dirs;

    try {
      dirs = await readdir(this.#profilesDir, { withFileTypes: true });
    } catch (error) {
      if (isMissing(error)) {
        this.#profiles = new Map();

        return issues;
      }

      throw error;
    }

    const candidates: { id: ProfileId; load: ProfileLoad }[] = [];

    for (const entry of dirs
      .filter((dirent) => dirent.isDirectory())
      .toSorted((a, b) => a.name.localeCompare(b.name))) {
      const id = profileIdSchema.safeParse(entry.name);

      if (!id.success) {
        issues.push({ file: join(this.#profilesDir, entry.name), message: "invalid profile id" });
        continue;
      }

      const load = await loadProfile(id.data, join(this.#profilesDir, id.data));

      candidates.push({ id: id.data, load });
    }

    const next = new Map<ProfileId, LoadedProfile>();
    const channels = new Map<string, ProfileId>();
    const failedIds: ProfileId[] = [];

    for (const { id, load } of candidates) {
      if (load.kind === "invalid") {
        issues.push(...load.issues);
        failedIds.push(id);
        continue;
      }

      const profileChannels = profileChannelIds(load.profile.config);
      const conflictIssues: ProfileIssue[] = [];

      for (const channelId of profileChannels) {
        const owner = channels.get(channelId);

        if (owner !== undefined) {
          conflictIssues.push({
            file: join(load.profile.dir, profileLayout.config),
            message: `Slack channel ${channelId} already belongs to profile ${owner}`,
          });
        }
      }

      if (conflictIssues.length > 0) {
        issues.push(...conflictIssues, ...load.issues);
        failedIds.push(id);
        continue;
      }

      issues.push(...load.issues);
      next.set(id, load.profile);

      for (const channelId of profileChannels) {
        channels.set(channelId, id);
      }
    }

    for (const id of failedIds) {
      const previous = this.#profiles.get(id);

      if (previous !== undefined) {
        const previousChannels = profileChannelIds(previous.config);

        if (previousChannels.every((channelId) => !channels.has(channelId))) {
          next.set(id, previous);

          for (const channelId of previousChannels) {
            channels.set(channelId, id);
          }
        }
      }
    }

    this.#profiles = next;

    return issues;
  }

  async #reload(id: ProfileId): Promise<ProfileLoad> {
    const load = await loadProfile(id, join(this.#profilesDir, id));

    if (load.kind === "invalid") {
      return load;
    }

    const conflictIssues: ProfileIssue[] = [];

    for (const channelId of profileChannelIds(load.profile.config)) {
      const owner = this.byChannel(channelId);

      if (owner !== undefined && owner.id !== id) {
        conflictIssues.push({
          file: join(load.profile.dir, profileLayout.config),
          message: `Slack channel ${channelId} already belongs to profile ${owner.id}`,
        });
      }
    }

    const [firstConflict, ...restConflicts] = conflictIssues;

    if (firstConflict !== undefined) {
      return { kind: "invalid", issues: [firstConflict, ...restConflicts, ...load.issues] };
    }

    this.#profiles.set(id, load.profile);

    return load;
  }

  get(id: ProfileId): LoadedProfile | undefined {
    return this.#profiles.get(id);
  }

  byChannel(channelId: string): LoadedProfile | undefined {
    for (const profile of this.#profiles.values()) {
      if (profileChannelIds(profile.config).includes(channelId)) {
        return profile;
      }
    }

    return undefined;
  }

  all(): LoadedProfile[] {
    return [...this.#profiles.values()];
  }
}
