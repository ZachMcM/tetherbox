import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  cronJobSchema,
  entryNameSchema,
  profileConfigSchema,
  profileIdSchema,
  profileLayout,
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
  const profile: LoadedProfile = {
    id,
    dir,
    config,
    cron: await loadEntries(join(dir, profileLayout.cronDir), cronJobSchema, issues),
    webhooks: await loadEntries(join(dir, profileLayout.webhooksDir), webhookSchema, issues),
  };

  return { kind: "loaded", profile, issues };
}

/**
 * Profiles live on disk as `<profilesDir>/<id>/`. The registry is a cache of the last valid load
 * of each one; the files stay the source of truth.
 */
export class ProfileRegistry {
  readonly #profilesDir: string;
  readonly #profiles = new Map<ProfileId, LoadedProfile>();

  constructor(profilesDir: string) {
    this.#profilesDir = profilesDir;
  }

  async loadAll(): Promise<ProfileIssue[]> {
    const issues: ProfileIssue[] = [];
    let dirs;

    try {
      dirs = await readdir(this.#profilesDir, { withFileTypes: true });
    } catch (error) {
      if (isMissing(error)) {
        this.#profiles.clear();

        return issues;
      }

      throw error;
    }

    this.#profiles.clear();

    for (const entry of dirs.filter((dirent) => dirent.isDirectory())) {
      const id = profileIdSchema.safeParse(entry.name);

      if (!id.success) {
        issues.push({ file: join(this.#profilesDir, entry.name), message: "invalid profile id" });
        continue;
      }

      const load = await this.reload(id.data);

      issues.push(...load.issues);
    }

    return issues;
  }

  async reload(id: ProfileId): Promise<ProfileLoad> {
    const load = await loadProfile(id, join(this.#profilesDir, id));

    if (load.kind === "invalid") {
      return load;
    }

    const owner = this.byChannel(load.profile.config.slackChannelId);

    if (owner !== undefined && owner.id !== id) {
      const issue = {
        file: join(load.profile.dir, profileLayout.config),
        message: `Slack channel ${load.profile.config.slackChannelId} already belongs to profile ${owner.id}`,
      };

      return { kind: "invalid", issues: [issue, ...load.issues] };
    }

    this.#profiles.set(id, load.profile);

    return load;
  }

  get(id: ProfileId): LoadedProfile | undefined {
    return this.#profiles.get(id);
  }

  byChannel(channelId: string): LoadedProfile | undefined {
    for (const profile of this.#profiles.values()) {
      if (profile.config.slackChannelId === channelId) {
        return profile;
      }
    }

    return undefined;
  }

  all(): LoadedProfile[] {
    return [...this.#profiles.values()];
  }
}
