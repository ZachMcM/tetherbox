import { getOAuthProvider, oauthPresets, type OAuthHandlers } from "@tetherbox/core";
import { toOAuthStatusEntry, type OAuthStore } from "../oauth.ts";
import type { SecretStore } from "../secret-store.ts";

export function createOAuthHandlers({
  oauth,
  secrets,
}: {
  oauth: OAuthStore;
  secrets: SecretStore;
}): OAuthHandlers {
  return {
    async getStatus() {
      const [loginsRaw, storedSecrets] = await Promise.all([oauth.list(), secrets.list()]);
      const secretKeys = new Set(storedSecrets.map((entry) => entry.key));
      const presets = oauthPresets.map((preset) => {
        const provider = getOAuthProvider(preset.provider);

        return {
          id: preset.id,
          provider: preset.provider,
          label: preset.label,
          secretKey: preset.secretKey,
          domains: preset.domains,
          defaultScopeMode: preset.defaultScopeMode,
          clientIdSecretKey: provider.clientIdSecretKey,
          clientSecretSecretKey: provider.clientSecretSecretKey,
          hasClientCredentials:
            secretKeys.has(provider.clientIdSecretKey) &&
            secretKeys.has(provider.clientSecretSecretKey),
        };
      });

      return { presets, logins: loginsRaw.map(toOAuthStatusEntry) };
    },
    startPreset(preset, input, origin) {
      return oauth.startWebPresetLogin(preset, {
        redirectUri: `${origin}/api/oauth/callback`,
        scopeMode: input.scopeMode,
      });
    },
    startCustom(input, origin) {
      return oauth.startWebCustomLogin(input, `${origin}/api/oauth/callback`);
    },
    async logout(target) {
      await oauth.logout(target);
    },
  };
}
