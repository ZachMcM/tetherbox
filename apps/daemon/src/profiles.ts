import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  cronJobSchema,
  entryNameSchema,
  profileConfigSchema,
  profileIdSchema,
  profileLayout,
  starterFromManifestSchema,
  starterKindDirs,
  starterKindSchema,
  starterPath,
  webhookSchema,
  type CronJob,
  type EntryName,
  type ProfileConfig,
  type ProfileId,
  type ProfileIssue,
  type Starter,
  type StarterKind,
  type Webhook,
} from "@tetherbox/core";
import { getStarter } from "@tetherbox/starters";
import { z } from "zod";
import { isMissing } from "./file-store.ts";

export interface LoadedProfile {
  id: ProfileId;
  dir: string;
  config: ProfileConfig;
  cron: ReadonlyMap<EntryName, CronJob>;
  webhooks: ReadonlyMap<EntryName, Webhook>;
  authoredStarters: readonly Starter[];
}

export type ProfileLoad =
  | { kind: "loaded"; profile: LoadedProfile; issues: ProfileIssue[] }
  | { kind: "invalid"; issues: [ProfileIssue, ...ProfileIssue[]] };

export function describe(error: unknown): string {
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

export async function loadStarterDirs({
  root,
  issues,
  skip,
}: {
  root: string;
  issues: ProfileIssue[];
  skip: (id: string, kind: StarterKind) => boolean;
}): Promise<Starter[]> {
  const loaded: Starter[] = [];

  for (const kind of starterKindSchema.options) {
    let entries;

    try {
      entries = await readdir(join(root, starterKindDirs[kind]), { withFileTypes: true });
    } catch (error) {
      if (isMissing(error)) {
        continue;
      }

      throw error;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || skip(entry.name, kind)) {
        continue;
      }

      const manifestPath = join(
        root,
        starterPath({ id: entry.name, kind }),
        profileLayout.starterManifest,
      );
      const missingMessage = `missing ${profileLayout.starterManifest}; describe this ${kind} so other profiles can enable it`;

      try {
        const parsed = starterFromManifestSchema(entry.name, kind).safeParse(
          await readJson(manifestPath),
        );

        if (parsed.success) {
          loaded.push(parsed.data);
        } else {
          issues.push({ file: manifestPath, message: z.prettifyError(parsed.error) });
        }
      } catch (error) {
        issues.push({
          file: manifestPath,
          message: isMissing(error) ? missingMessage : describe(error),
        });
      }
    }
  }

  return loaded;
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
  const authoredStarters = await loadStarterDirs({
    root: dir,
    issues,
    skip: (starterId, kind) =>
      config.starters.includes(starterId) && getStarter(starterId)?.kind === kind,
  });
  const profile: LoadedProfile = {
    id,
    dir,
    config,
    cron,
    webhooks,
    authoredStarters,
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

    const next = new Map<ProfileId, LoadedProfile>();

    for (const entry of dirs
      .filter((dirent) => dirent.isDirectory())
      .toSorted((a, b) => a.name.localeCompare(b.name))) {
      const id = profileIdSchema.safeParse(entry.name);

      if (!id.success) {
        issues.push({ file: join(this.#profilesDir, entry.name), message: "invalid profile id" });
        continue;
      }

      const load = await loadProfile(id.data, join(this.#profilesDir, id.data));

      if (load.kind === "invalid") {
        issues.push(...load.issues);

        const previous = this.#profiles.get(id.data);

        if (previous !== undefined) {
          next.set(id.data, previous);
        }

        continue;
      }

      issues.push(...load.issues);
      next.set(id.data, load.profile);
    }

    this.#profiles = next;

    return issues;
  }

  async #reload(id: ProfileId): Promise<ProfileLoad> {
    const load = await loadProfile(id, join(this.#profilesDir, id));

    if (load.kind === "invalid") {
      return load;
    }

    this.#profiles.set(id, load.profile);

    return load;
  }

  get(id: ProfileId): LoadedProfile | undefined {
    return this.#profiles.get(id);
  }

  remove(id: ProfileId): Promise<boolean> {
    return this.#serialize(async () => this.#profiles.delete(id));
  }

  all(): LoadedProfile[] {
    return [...this.#profiles.values()];
  }
}
