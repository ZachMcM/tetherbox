import { createHash, type Hash } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  readdir,
  readFile,
  readlink,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import {
  RpcError,
  starterPath,
  type ProfileIssue,
  type Starter,
  type StarterCli,
  type StarterCliAuth,
  type StarterSource,
  type StarterSummary,
} from "@tetherbox/core";
import { getStarter, starters as builtinStarters, templatesDir } from "@tetherbox/starters";
import { z } from "zod";
import { isMissing } from "./file-store.ts";
import { commitAll, initRepo } from "./git-repo.ts";
import { describe, loadStarterDirs, type LoadedProfile } from "./profiles.ts";

const SKIPPED_NAMES = new Set([".git", "node_modules"]);

const syncStateSchema = z.record(z.string(), z.record(z.string(), z.string()));

type SyncState = z.infer<typeof syncStateSchema>;

type CatalogStarter = Starter & { readonly source: StarterSource };

interface CliAuthStarter {
  readonly starterId: string;
  readonly cli: StarterCli & { readonly auth: StarterCliAuth };
}

async function isCopied(path: string): Promise<boolean> {
  if (SKIPPED_NAMES.has(basename(path))) {
    return false;
  }

  const stats = await lstat(path);

  return stats.isFile() || stats.isDirectory() || stats.isSymbolicLink();
}

async function addDirToHash(hash: Hash, dir: string, prefix: string): Promise<void> {
  const entries = (await readdir(dir, { withFileTypes: true }))
    .filter((entry) => !SKIPPED_NAMES.has(entry.name))
    .toSorted((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    const path = join(dir, entry.name);
    const name = `${prefix}${entry.name}`;

    if (entry.isDirectory()) {
      await addDirToHash(hash, path, `${name}/`);
    } else if (entry.isSymbolicLink()) {
      hash.update(`link\0${name}\0${await readlink(path)}\0`);
    } else if (entry.isFile()) {
      hash
        .update(`file\0${name}\0`)
        .update(await readFile(path))
        .update("\0");
    }
  }
}

async function hashDir(dir: string): Promise<string> {
  const hash = createHash("sha256");

  await addDirToHash(hash, dir, "");

  return hash.digest("hex");
}

export class StarterCatalog {
  readonly #libraryDir: string;
  readonly #stagingDir: string;
  readonly #syncStatePath: string;
  #library = new Map<string, Starter>();
  #syncState: SyncState = {};
  #queue: Promise<void> = Promise.resolve();

  constructor(dataDir: string) {
    this.#libraryDir = join(dataDir, "library");
    this.#stagingDir = join(dataDir, "library-staging");
    this.#syncStatePath = join(dataDir, "library-sync.json");
  }

  static async open(dataDir: string): Promise<StarterCatalog> {
    const catalog = new StarterCatalog(dataDir);

    await catalog.load();

    return catalog;
  }

  #serialize<T>(task: () => Promise<T>): Promise<T> {
    const next = this.#queue.then(task, task);

    this.#queue = next.then(
      () => undefined,
      () => undefined,
    );

    return next;
  }

  async #readSyncState(): Promise<SyncState> {
    try {
      return syncStateSchema.parse(JSON.parse(await readFile(this.#syncStatePath, "utf8")));
    } catch (error) {
      if (isMissing(error)) {
        return {};
      }

      throw error;
    }
  }

  async #recordSeen(profileId: string, seen: Readonly<Record<string, string>>): Promise<void> {
    const onDisk: SyncState = await this.#readSyncState().catch(() => ({}));
    const merged: SyncState = { ...onDisk, [profileId]: { ...onDisk[profileId], ...seen } };
    const tempPath = `${this.#syncStatePath}.${process.pid}.tmp`;

    await writeFile(tempPath, `${JSON.stringify(merged, null, 2)}\n`);
    await rename(tempPath, this.#syncStatePath);
    this.#syncState = merged;
  }

  load(): Promise<ProfileIssue[]> {
    return this.#serialize(async () => {
      await mkdir(this.#libraryDir, { recursive: true });
      await initRepo(this.#libraryDir);

      const issues: ProfileIssue[] = [];
      const loaded = await loadStarterDirs({
        root: this.#libraryDir,
        issues,
        skip: (id) => getStarter(id) !== undefined,
      });

      this.#library = new Map(loaded.map((starter) => [starter.id, starter]));

      try {
        this.#syncState = await this.#readSyncState();
      } catch (error) {
        this.#syncState = {};
        issues.push({
          file: this.#syncStatePath,
          message: `resetting library sync state: ${describe(error)}`,
        });
      }

      return issues;
    });
  }

  async #copyToLibrary(source: string, starter: Starter): Promise<void> {
    const staging = join(this.#stagingDir, starterPath(starter));
    const destination = join(this.#libraryDir, starterPath(starter));

    try {
      await rm(staging, { recursive: true, force: true });
      await cp(source, staging, { recursive: true, verbatimSymlinks: true, filter: isCopied });
      await rm(destination, { recursive: true, force: true });
      await mkdir(dirname(destination), { recursive: true });
      await rename(staging, destination);
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }

  sync(profile: LoadedProfile): Promise<ProfileIssue[]> {
    return this.#serialize(async () => {
      const issues: ProfileIssue[] = [];
      const seen: Record<string, string> = {};

      for (const starter of profile.authoredStarters) {
        const source = join(profile.dir, starterPath(starter));

        if (getStarter(starter.id) !== undefined) {
          issues.push({
            file: source,
            message: `"${starter.id}" is a built-in starter id; rename this ${starter.kind} to share it with other profiles`,
          });
          continue;
        }

        const existing = this.#library.get(starter.id);

        if (existing !== undefined && existing.kind !== starter.kind) {
          issues.push({
            file: source,
            message: `the library already has a ${existing.kind} named "${starter.id}"; rename this ${starter.kind} to share it with other profiles`,
          });
          continue;
        }

        try {
          const contentHash = await hashDir(source);

          if (existing !== undefined && this.#syncState[profile.id]?.[starter.id] === contentHash) {
            continue;
          }

          await this.#copyToLibrary(source, starter);
          this.#library.set(starter.id, starter);
          seen[starter.id] = contentHash;
        } catch (error) {
          issues.push({
            file: source,
            message: `could not copy into the starter library: ${describe(error)}`,
          });
        }
      }

      if (Object.keys(seen).length === 0) {
        return issues;
      }

      try {
        await commitAll(this.#libraryDir, `Sync from profile ${profile.id}`);
        await this.#recordSeen(profile.id, seen);
      } catch (error) {
        issues.push({
          file: this.#libraryDir,
          message: `could not record the starter library sync: ${describe(error)}`,
        });
      }

      return issues;
    });
  }

  all(): CatalogStarter[] {
    return [
      ...builtinStarters.map((starter) => ({ ...starter, source: "builtin" as const })),
      ...[...this.#library.values()]
        .toSorted((a, b) => a.name.localeCompare(b.name))
        .map((starter) => ({ ...starter, source: "library" as const })),
    ];
  }

  get(id: string): CatalogStarter | undefined {
    const builtin = getStarter(id);

    if (builtin !== undefined) {
      return { ...builtin, source: "builtin" };
    }

    const library = this.#library.get(id);

    return library === undefined ? undefined : { ...library, source: "library" };
  }

  resolve(ids: readonly string[]): CatalogStarter[] {
    return [...new Set(ids)].map((id) => {
      const starter = this.get(id);

      if (starter === undefined) {
        throw new RpcError(400, `unknown starter "${id}"`);
      }

      return starter;
    });
  }

  enabledIds(profile: LoadedProfile): string[] {
    const sharedAuthoredIds = profile.authoredStarters
      .filter((starter) => this.#library.get(starter.id)?.kind === starter.kind)
      .map((starter) => starter.id);

    return [...new Set([...profile.config.starters, ...sharedAuthoredIds])].filter(
      (id) => this.get(id) !== undefined,
    );
  }

  getCliAuth(id: string): CliAuthStarter | undefined {
    const cli = this.get(id)?.cli;

    return cli?.auth === undefined ? undefined : { starterId: id, cli: { ...cli, auth: cli.auth } };
  }

  copyInto({
    profileId,
    profileDir,
    starter,
  }: {
    profileId: string;
    profileDir: string;
    starter: CatalogStarter;
  }): Promise<void> {
    const path = starterPath(starter);
    const destination = join(profileDir, path);

    if (starter.source === "builtin") {
      return cp(join(templatesDir, path), destination, { recursive: true });
    }

    return this.#serialize(async () => {
      await cp(join(this.#libraryDir, path), destination, {
        recursive: true,
        verbatimSymlinks: true,
      });
      await this.#recordSeen(profileId, { [starter.id]: await hashDir(destination) });
    });
  }

  summaries(): StarterSummary[] {
    return this.all().map(({ cli, ...starter }) => ({
      ...starter,
      ...(cli !== undefined
        ? { cli: { binary: cli.binary, hasAuth: cli.auth !== undefined } }
        : {}),
    }));
  }
}
