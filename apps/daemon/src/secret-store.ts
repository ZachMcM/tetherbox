import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { secretBindingSchema, secretKeySchema, type SecretKey } from "@tetherbox/core";
import { z } from "zod";

const storedSecretSchema = z.object({
  value: z.string().min(1),
  binding: secretBindingSchema,
});
export type StoredSecret = z.infer<typeof storedSecretSchema>;

export interface SecretStore {
  get(key: SecretKey): Promise<StoredSecret | undefined>;
  has(key: SecretKey): Promise<boolean>;
  set(key: SecretKey, secret: StoredSecret): Promise<void>;
  delete(key: SecretKey): Promise<void>;
  list(): Promise<SecretKey[]>;
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/**
 * One JSON file per secret, readable only by the daemon's OS user.
 * TODO: Encrypt values at rest with a key outside the data dir (systemd-creds or a TPM-backed key).
 */
export function createFileSecretStore(dataDir: string): SecretStore {
  const dir = join(dataDir, "secrets");
  const fileFor = (key: SecretKey) => join(dir, `${key}.json`);

  const get = async (key: SecretKey) => {
    try {
      return storedSecretSchema.parse(JSON.parse(await readFile(fileFor(key), "utf8")));
    } catch (error) {
      if (isMissing(error)) {
        return undefined;
      }

      throw error;
    }
  };

  return {
    get,
    has: async (key) => (await get(key)) !== undefined,
    async set(key, secret) {
      await mkdir(dir, { recursive: true, mode: 0o700 });
      await writeFile(fileFor(key), JSON.stringify(secret), { mode: 0o600 });
    },
    async delete(key) {
      await rm(fileFor(key), { force: true });
    },
    async list() {
      try {
        const files = await readdir(dir);

        return files
          .filter((file) => file.endsWith(".json"))
          .map((file) => secretKeySchema.parse(file.slice(0, -".json".length)));
      } catch (error) {
        if (isMissing(error)) {
          return [];
        }

        throw error;
      }
    },
  };
}
