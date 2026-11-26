import { join } from "node:path";
import {
  RpcError,
  secretBindingSchema,
  secretKeySchema,
  type LlmProvider,
  type SecretBinding,
  type SecretKey,
} from "@tetherbox/core";
import { z } from "zod";
import { createKeyedJsonStore } from "./file-store.ts";

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

/**
 * One JSON file per secret, readable only by the daemon's OS user.
 * TODO: Encrypt values at rest with a key outside the data dir (systemd-creds or a TPM-backed key).
 */
export function createFileSecretStore(dataDir: string): SecretStore {
  const files = createKeyedJsonStore<SecretKey, StoredSecret>({
    dir: join(dataDir, "secrets"),
    keySchema: secretKeySchema,
    valueSchema: storedSecretSchema,
  });

  const list = async (): Promise<SecretSummary[]> =>
    (await files.entries()).map(({ key, value }) => ({ key, binding: value.binding }));

  return {
    get: files.read,
    async getLlm(provider) {
      for (const { key, value } of await files.entries()) {
        if (value.binding.kind === "llm" && value.binding.provider === provider) {
          return { key, value: value.value, provider: value.binding.provider };
        }
      }

      return undefined;
    },
    has: async (key) => (await files.read(key)) !== undefined,
    async set(key, secret) {
      if (secret.binding.kind === "llm") {
        const { provider } = secret.binding;

        for (const existing of await list()) {
          if (
            existing.key !== key &&
            existing.binding.kind === "llm" &&
            existing.binding.provider === provider
          ) {
            throw new RpcError(
              409,
              `LLM provider "${provider}" is already bound to ${existing.key}; update or delete ${existing.key} first`,
            );
          }
        }
      }

      await files.write(key, secret);
    },
    delete: files.delete,
    list,
  };
}
