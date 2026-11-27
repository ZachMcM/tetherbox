import {
  getLlmOAuthProvider,
  llmProviderIds,
  supportedLlmAuthKinds,
  type LlmHandlers,
} from "@tetherbox/core";
import type { FavoriteModelTable } from "../../../db/favorite-models.ts";
import { listAvailableLlmModels, llmApiKeyProviders } from "../../../credentials/llm-models.ts";
import type { LlmOAuth } from "../../../credentials/llm-oauth.ts";
import type { LlmWebAuthManager } from "../../../credentials/llm-web-auth.ts";
import { formatExpiry } from "../../../credentials/oauth-store.ts";
import type { SecretStore } from "../../../credentials/secret-store.ts";

export interface LlmHandlerDeps {
  favoriteModels: FavoriteModelTable;
  secrets: SecretStore;
  llmOAuth: LlmOAuth;
  llmWebAuth: LlmWebAuthManager;
}

export function createLlmHandlers({
  favoriteModels,
  secrets,
  llmOAuth,
  llmWebAuth,
}: LlmHandlerDeps): LlmHandlers {
  return {
    async getStatus() {
      const [storedSecrets, oauthLoginsRaw] = await Promise.all([secrets.list(), llmOAuth.list()]);
      const apiKeyProviders = llmApiKeyProviders(storedSecrets);
      const oauthLogins = oauthLoginsRaw.map((login) => ({
        provider: login.provider,
        expires: formatExpiry(login.expires),
      }));
      const oauthByProvider = new Map(oauthLogins.map((login) => [login.provider, login.expires]));
      const providers = llmProviderIds.map((provider) => {
        const oauthProvider = getLlmOAuthProvider(provider);
        const oauthExpires = oauthByProvider.get(provider);

        return {
          provider,
          supportedAuth: supportedLlmAuthKinds(provider),
          hasApiKey: apiKeyProviders.has(provider),
          ...(oauthProvider !== undefined ? { oauthLabel: oauthProvider.label } : {}),
          ...(oauthExpires !== undefined ? { oauthExpires } : {}),
        };
      });

      return { providers, oauthLogins };
    },
    async listModels() {
      return {
        models: await listAvailableLlmModels({
          secrets,
          llmOAuth,
          favorites: favoriteModels.list(),
        }),
      };
    },
    startOAuth: (provider, origin) => llmWebAuth.start(provider, origin),
    getOAuthFlow: (flowId) => llmWebAuth.get(flowId),
    respondOAuthFlow: (flowId, value) => llmWebAuth.respond(flowId, value),
    cancelOAuthFlow: (flowId) => llmWebAuth.cancel(flowId),
    logoutOAuth: (provider) => llmOAuth.logout(provider),
    addFavoriteModel: (model) => favoriteModels.add(model),
    removeFavoriteModel: (model) => favoriteModels.remove(model),
  };
}
