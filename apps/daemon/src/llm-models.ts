import type { Provider } from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { githubCopilotProvider } from "@earendil-works/pi-ai/providers/github-copilot";
import { googleProvider } from "@earendil-works/pi-ai/providers/google";
import { metaProvider } from "@earendil-works/pi-ai/providers/meta";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { opencodeProvider } from "@earendil-works/pi-ai/providers/opencode";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import { xaiProvider } from "@earendil-works/pi-ai/providers/xai";
import {
  llmProviderIds,
  resolveWebSearchMode,
  supportedLlmAuthKinds,
  type LlmAuthKind,
  type LlmModelOption,
  type LlmProvider,
} from "@tetherbox/core";
import type { LlmOAuth } from "./llm-oauth.ts";
import type { SecretStore, SecretSummary } from "./secret-store.ts";

const PROVIDER_FACTORIES: Readonly<Record<LlmProvider, () => Provider>> = {
  anthropic: anthropicProvider,
  openai: openaiProvider,
  "openai-codex": openaiCodexProvider,
  google: googleProvider,
  openrouter: openrouterProvider,
  opencode: opencodeProvider,
  xai: xaiProvider,
  meta: metaProvider,
  "github-copilot": githubCopilotProvider,
};

async function modelsForTarget(
  deps: { llmOAuth: LlmOAuth },
  provider: LlmProvider,
  auth: LlmAuthKind,
): Promise<LlmModelOption[]> {
  const credential = auth === "oauth" ? await deps.llmOAuth.credential(provider) : undefined;
  const catalog = PROVIDER_FACTORIES[provider]();
  const models =
    credential !== undefined && catalog.filterModels !== undefined
      ? catalog.filterModels(catalog.getModels(), credential)
      : catalog.getModels();

  return models
    .filter((model) => resolveWebSearchMode(provider, model.api) !== undefined)
    .map((model) => ({
      provider,
      auth,
      id: model.id,
      name: model.name,
      reasoning: model.reasoning,
      contextWindow: model.contextWindow,
    }));
}

export function llmApiKeyProviders(secrets: readonly SecretSummary[]): Set<LlmProvider> {
  return new Set(
    secrets.flatMap((entry) => (entry.binding.kind === "llm" ? [entry.binding.provider] : [])),
  );
}

export async function listAvailableLlmModels(deps: {
  secrets: SecretStore;
  llmOAuth: LlmOAuth;
}): Promise<LlmModelOption[]> {
  const [storedSecrets, oauthLogins] = await Promise.all([
    deps.secrets.list(),
    deps.llmOAuth.list(),
  ]);
  const apiKeyProviders = llmApiKeyProviders(storedSecrets);
  const oauthProviders = new Set(oauthLogins.map((entry) => entry.provider));

  const targets: { provider: LlmProvider; auth: LlmAuthKind }[] = [];

  for (const provider of llmProviderIds) {
    const supported = supportedLlmAuthKinds(provider);

    if (supported.includes("oauth") && oauthProviders.has(provider)) {
      targets.push({ provider, auth: "oauth" });
    }

    if (supported.includes("api-key") && apiKeyProviders.has(provider)) {
      targets.push({ provider, auth: "api-key" });
    }
  }

  const groups = await Promise.all(
    targets.map(async ({ provider, auth }) => {
      try {
        return await modelsForTarget(deps, provider, auth);
      } catch (error) {
        console.error(`could not list ${provider} (${auth}) models`, error);

        return [];
      }
    }),
  );

  return groups.flat();
}
