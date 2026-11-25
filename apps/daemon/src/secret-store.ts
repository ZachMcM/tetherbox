import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  secretBindingSchema,
  secretKeySchema,
  type LlmProvider,
  type SecretBinding,
  type SecretKey,
} from "@tetherbox/core";
import { z } from "zod";

const storedSecretSchema = z.object({
  value: z.string().min(1),
  binding: secretBindingSchema,
});
export type StoredSecret = z.infer<typeof storedSecretSchema>;

export interface SecretSummary {
  key: SecretKey;
  binding: SecretBinding;
}

export interface LlmSecret {
  key: SecretKey;
  value: string;
  provider: LlmProvider;
}

export interface SecretStore {
  get(key: SecretKey): Promise<StoredSecret | undefined>;
  getLlm(provider: LlmProvider): Promise<LlmSecret | undefined>;
  has(key: SecretKey): Promise<boolean>;
  set(key: SecretKey, secret: StoredSecret): Promise<void>;
  delete(key: SecretKey): Promise<void>;
  list(): Promise<SecretSummary[]>;
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

  const readKeys = async (): Promise<SecretKey[]> => {
    try {
      const files = await readdir(dir);

      return files
        .filter((file) => file.endsWith(".json"))
        .map((file) => secretKeySchema.parse(file.slice(0, -".json".length)))
        .toSorted((a, b) => a.localeCompare(b));
    } catch (error) {
      if (isMissing(error)) {
        return [];
      }

      throw error;
    }
  };

  const list = async (): Promise<SecretSummary[]> => {
    const entries: SecretSummary[] = [];

    for (const key of await readKeys()) {
      const secret = await get(key);

      if (secret !== undefined) {
        entries.push({ key, binding: secret.binding });
      }
    }

    return entries;
  };

  return {
    get,
    async getLlm(provider) {
      for (const key of await readKeys()) {
        const secret = await get(key);

        if (secret?.binding.kind === "llm" && secret.binding.provider === provider) {
          return { key, value: secret.value, provider: secret.binding.provider };
        }
      }

      return undefined;
    },
    has: async (key) => (await get(key)) !== undefined,
    async set(key, secret) {
      if (secret.binding.kind === "llm") {
        const { provider } = secret.binding;

        for (const existing of await list()) {
          if (
            existing.key !== key &&
            existing.binding.kind === "llm" &&
            existing.binding.provider === provider
          ) {
            throw new Error(
              `LLM provider "${provider}" is already bound to ${existing.key}; update or delete ${existing.key} first`,
            );
          }
        }
      }

      await mkdir(dir, { recursive: true, mode: 0o700 });

      const tmpPath = `${fileFor(key)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;

      try {
        await writeFile(tmpPath, JSON.stringify(secret), { mode: 0o600 });
        await rename(tmpPath, fileFor(key));
      } catch (error) {
        await rm(tmpPath, { force: true });
        throw error;
      }
    },
    async delete(key) {
      await rm(fileFor(key), { force: true });
    },
    list,
  };
}
