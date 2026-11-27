import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

export interface SchemaParser<T> {
  parse(input: unknown): T;
}

export interface KeyedJsonStoreOptions<K extends string, V> {
  readonly dir: string;
  readonly keySchema: SchemaParser<K>;
  readonly valueSchema: SchemaParser<V>;
}

export interface KeyedJsonStore<K extends string, V> {
  read(key: K): Promise<V | undefined>;
  write(key: K, value: V): Promise<void>;
  delete(key: K): Promise<void>;
  keys(): Promise<K[]>;
  entries(): Promise<Array<{ key: K; value: V }>>;
}

/**
 * One JSON file per key in a 0700 directory, written atomically with mode 0600 so only the
 * daemon's OS user can read it.
 */
export function createKeyedJsonStore<K extends string, V>({
  dir,
  keySchema,
  valueSchema,
}: KeyedJsonStoreOptions<K, V>): KeyedJsonStore<K, V> {
  const fileFor = (key: K) => join(dir, `${key}.json`);

  const read = async (key: K): Promise<V | undefined> => {
    try {
      return valueSchema.parse(JSON.parse(await readFile(fileFor(key), "utf8")));
    } catch (error) {
      if (isMissing(error)) {
        return undefined;
      }

      const message = error instanceof Error ? error.message : String(error);

      throw new Error(`could not read ${fileFor(key)}: ${message}`, { cause: error });
    }
  };

  const keys = async (): Promise<K[]> => {
    try {
      const files = await readdir(dir);

      return files
        .filter((file) => file.endsWith(".json"))
        .map((file) => keySchema.parse(file.slice(0, -".json".length)))
        .toSorted((a, b) => a.localeCompare(b));
    } catch (error) {
      if (isMissing(error)) {
        return [];
      }

      throw error;
    }
  };

  return {
    read,
    async write(key, value) {
      await mkdir(dir, { recursive: true, mode: 0o700 });

      const target = fileFor(key);
      const tmpPath = `${target}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;

      try {
        await writeFile(tmpPath, JSON.stringify(value), { mode: 0o600 });
        await rename(tmpPath, target);
      } catch (error) {
        await rm(tmpPath, { force: true });
        throw error;
      }
    },
    async delete(key) {
      await rm(fileFor(key), { force: true });
    },
    keys,
    async entries() {
      const items: Array<{ key: K; value: V }> = [];

      for (const key of await keys()) {
        try {
          const value = await read(key);

          if (value !== undefined) {
            items.push({ key, value });
          }
        } catch (error) {
          console.error(`skipping unreadable entry ${key} in ${dir}`, error);
        }
      }

      return items;
    },
  };
}

export interface KeyedLock<K extends string> {
  withLock<T>(key: K, task: () => Promise<T>): Promise<T>;
}

/**
 * Serializes async operations per key so concurrent token refreshes or writes never race.
 */
export function createKeyedLock<K extends string>(): KeyedLock<K> {
  const locks = new Map<K, Promise<unknown>>();

  return {
    withLock<T>(key: K, task: () => Promise<T>): Promise<T> {
      const next = (locks.get(key) ?? Promise.resolve()).catch(() => undefined).then(task);

      locks.set(key, next);

      return next;
    },
  };
}
