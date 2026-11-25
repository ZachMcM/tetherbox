import { z } from "zod";
import { llmProviderSchema, type LlmProvider } from "./ids.ts";

export const llmAuthKindSchema = z.enum(["api-key", "oauth"]);
export type LlmAuthKind = z.infer<typeof llmAuthKindSchema>;

export interface LlmOAuthProvider {
  readonly provider: LlmProvider;
  readonly label: string;
  readonly acceptsApiKey: boolean;
  readonly callbackPort?: number;
}

/**
 * Providers whose OAuth login the daemon can run. `callbackPort` is the fixed loopback port the
 * provider's browser redirect lands on, which the CLI forwards over SSH during login. Device-code
 * logins and logins with a paste fallback need no port.
 */
export const llmOAuthProviders: readonly LlmOAuthProvider[] = [
  {
    provider: llmProviderSchema.parse("anthropic"),
    label: "Claude Pro/Max",
    acceptsApiKey: true,
    callbackPort: 53692,
  },
  {
    provider: llmProviderSchema.parse("openai-codex"),
    label: "ChatGPT Plus/Pro (Codex)",
    acceptsApiKey: false,
    callbackPort: 1455,
  },
  {
    provider: llmProviderSchema.parse("github-copilot"),
    label: "GitHub Copilot",
    acceptsApiKey: true,
  },
  {
    provider: llmProviderSchema.parse("xai"),
    label: "SuperGrok or X Premium",
    acceptsApiKey: true,
  },
  {
    provider: llmProviderSchema.parse("kimi-coding"),
    label: "Kimi Code membership",
    acceptsApiKey: true,
  },
  {
    provider: llmProviderSchema.parse("meta"),
    label: "Meta Muse subscription",
    acceptsApiKey: true,
  },
  {
    provider: llmProviderSchema.parse("openrouter"),
    label: "OpenRouter sign-in (pay per token)",
    acceptsApiKey: true,
  },
];

export function getLlmOAuthProvider(provider: string): LlmOAuthProvider | undefined {
  return llmOAuthProviders.find((entry) => entry.provider === provider);
}

export function supportedLlmAuthKinds(provider: string): readonly LlmAuthKind[] {
  const entry = getLlmOAuthProvider(provider);

  if (entry === undefined) {
    return ["api-key"];
  }

  return entry.acceptsApiKey ? ["oauth", "api-key"] : ["oauth"];
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
