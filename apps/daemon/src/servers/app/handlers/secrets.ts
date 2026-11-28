import type { SecretHandlers } from "@tetherbox/core";
import type { SecretStore } from "../../../credentials/secret-store.ts";

export function createSecretHandlers({ secrets }: { secrets: SecretStore }): SecretHandlers {
  return {
    list: () => secrets.list(),
    async set(key, input) {
      await secrets.set(key, { value: input.value, binding: input.binding });

      return { key, binding: input.binding };
    },
    delete: (key) => secrets.delete(key),
  };
}
