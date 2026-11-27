import type { ProxyHandlers } from "@tetherbox/core";
import type { LlmOAuth } from "../../../credentials/llm-oauth.ts";
import type { OAuthStore } from "../../../credentials/oauth-store.ts";
import type { SecretStore } from "../../../credentials/secret-store.ts";
import { proxyLlm } from "../../../proxy/llm-proxy.ts";
import { proxyWithSecret } from "../../../proxy/secret-proxy.ts";
import type { TurnRunner } from "../../../sessions/turns.ts";

export function createProxyHandlers({
  secrets,
  oauth,
  llmOAuth,
  turns,
}: {
  secrets: SecretStore;
  oauth: OAuthStore;
  llmOAuth: LlmOAuth;
  turns: TurnRunner;
}): ProxyHandlers {
  return {
    withSecret: (_run, request) => proxyWithSecret({ secrets, oauth }, request),
    llm(run, provider, request) {
      const model = turns.resolveRunModel(run.runId);
      const authKind = model?.provider === provider ? model.auth : "api-key";

      return proxyLlm({ secrets, oauth: llmOAuth }, { provider, authKind, request });
    },
  };
}
