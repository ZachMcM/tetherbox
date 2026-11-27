import type { SecretCheckHandlers } from "@tetherbox/core";
import type { OAuthStore } from "../../../credentials/oauth-store.ts";
import type { SecretStore } from "../../../credentials/secret-store.ts";

export function createSecretCheckHandlers({
  secrets,
  oauth,
}: {
  secrets: SecretStore;
  oauth: OAuthStore;
}): SecretCheckHandlers {
  return {
    async check(key) {
      const secret = await secrets.get(key);

      if (secret !== undefined) {
        return { exists: true, kind: secret.binding.kind };
      }

      return (await oauth.has(key)) ? { exists: true, kind: "oauth" } : { exists: false };
    },
  };
}
