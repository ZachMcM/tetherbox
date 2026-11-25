import { z } from "zod";

export const llmProviderIds = [
  "anthropic",
  "openai",
  "openai-codex",
  "google",
  "openrouter",
  "opencode",
  "opencode-go",
  "xai",
  "deepseek",
  "groq",
  "mistral",
  "together",
  "cerebras",
  "fireworks",
  "minimax",
  "minimax-cn",
  "moonshotai",
  "moonshotai-cn",
  "baseten",
  "huggingface",
  "nvidia",
  "kimi-coding",
  "meta",
  "vercel-ai-gateway",
  "github-copilot",
  "zai",
  "zai-coding-cn",
] as const;

export const llmProviderSchema = z.enum(llmProviderIds);
export type LlmProvider = z.infer<typeof llmProviderSchema>;

export const llmAuthKindSchema = z.enum(["api-key", "oauth"]);
export type LlmAuthKind = z.infer<typeof llmAuthKindSchema>;

type LlmProviderAuthConfig =
  | { readonly kind: "api-key" }
  | { readonly kind: "oauth"; readonly label: string; readonly callbackPort?: number }
  | { readonly kind: "both"; readonly label: string; readonly callbackPort?: number };

/**
 * Auth capabilities for every LLM provider the daemon can proxy. `callbackPort` is the fixed
 * loopback port the provider's browser redirect lands on, which the CLI forwards over SSH during
 * OAuth login. Device-code logins and logins with a paste fallback need no port.
 */
const llmProviderCatalog = {
  anthropic: {
    kind: "both",
    label: "Claude Pro/Max",
    callbackPort: 53692,
  },
  openai: { kind: "api-key" },
  "openai-codex": {
    kind: "oauth",
    label: "ChatGPT Plus/Pro (Codex)",
    callbackPort: 1455,
  },
  google: { kind: "api-key" },
  openrouter: {
    kind: "both",
    label: "OpenRouter sign-in (pay per token)",
  },
  opencode: { kind: "api-key" },
  "opencode-go": { kind: "api-key" },
  xai: {
    kind: "both",
    label: "SuperGrok or X Premium",
  },
  deepseek: { kind: "api-key" },
  groq: { kind: "api-key" },
  mistral: { kind: "api-key" },
  together: { kind: "api-key" },
  cerebras: { kind: "api-key" },
  fireworks: { kind: "api-key" },
  minimax: { kind: "api-key" },
  "minimax-cn": { kind: "api-key" },
  moonshotai: { kind: "api-key" },
  "moonshotai-cn": { kind: "api-key" },
  baseten: { kind: "api-key" },
  huggingface: { kind: "api-key" },
  nvidia: { kind: "api-key" },
  "kimi-coding": {
    kind: "both",
    label: "Kimi Code membership",
  },
  meta: {
    kind: "both",
    label: "Meta Muse subscription",
  },
  "vercel-ai-gateway": { kind: "api-key" },
  "github-copilot": {
    kind: "both",
    label: "GitHub Copilot",
  },
  zai: { kind: "api-key" },
  "zai-coding-cn": { kind: "api-key" },
} as const satisfies Record<LlmProvider, LlmProviderAuthConfig>;

export type LlmOAuthProviderId = {
  [K in LlmProvider]: (typeof llmProviderCatalog)[K]["kind"] extends "api-key" ? never : K;
}[LlmProvider];

export interface LlmOAuthProvider {
  readonly provider: LlmOAuthProviderId;
  readonly label: string;
  readonly callbackPort?: number;
}

function isLlmOAuthProvider(provider: LlmProvider): provider is LlmOAuthProviderId {
  return llmProviderCatalog[provider].kind !== "api-key";
}

export const llmOAuthProviders: readonly LlmOAuthProvider[] = llmProviderIds.flatMap((provider) => {
  if (!isLlmOAuthProvider(provider)) {
    return [];
  }

  const config = llmProviderCatalog[provider];

  return [
    {
      provider,
      label: config.label,
      ...("callbackPort" in config ? { callbackPort: config.callbackPort } : {}),
    },
  ];
});

export function getLlmOAuthProvider(provider: LlmProvider): LlmOAuthProvider | undefined {
  return llmOAuthProviders.find((entry) => entry.provider === provider);
}

export function supportedLlmAuthKinds(provider: LlmProvider): readonly LlmAuthKind[] {
  const config: LlmProviderAuthConfig = llmProviderCatalog[provider];

  switch (config.kind) {
    case "api-key":
      return ["api-key"];
    case "oauth":
      return ["oauth"];
    case "both":
      return ["oauth", "api-key"];
    default: {
      const exhaustive: never = config;

      return exhaustive;
    }
  }
}

/**
 * How an agent run sets up Pi's credential for its model. `run-token-key` passes the run token as
 * Pi's API key. `placeholder-oauth` stores a non-expiring OAuth credential whose access token is
 * shaped like the real one, so Pi formats requests for the subscription API. Either way the
 * daemon swaps in the real credential.
 */
export const turnModelAuthSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("run-token-key") }),
  z.object({ kind: z.literal("placeholder-oauth"), access: z.string().min(1) }),
]);
export type TurnModelAuth = z.infer<typeof turnModelAuthSchema>;

export const llmOAuthStatusEntrySchema = z.object({
  provider: llmProviderSchema,
  expires: z.string().min(1),
});
export const llmOAuthStatusListSchema = z.array(llmOAuthStatusEntrySchema);
export type LlmOAuthStatusEntry = z.infer<typeof llmOAuthStatusEntrySchema>;
