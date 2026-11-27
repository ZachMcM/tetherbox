import {
  formatSecretInjection,
  type LlmProvider,
  type LlmProviderStatus,
  type OAuthPresetId,
  type OAuthPresetSummary,
  type OAuthStatusEntry,
  type SecretBinding,
  type SecretKey,
  type SecretListEntry,
} from "@tetherbox/core/app";

export function findProviderApiKey(
  secrets: readonly SecretListEntry[],
  provider: LlmProvider,
): SecretKey | undefined {
  return secrets.find(
    (entry) => entry.binding.kind === "llm" && entry.binding.provider === provider,
  )?.key;
}

export function isProviderConnected(provider: LlmProviderStatus): boolean {
  return provider.hasApiKey || provider.oauthExpires !== undefined;
}

export type PresetLogin = Extract<OAuthStatusEntry, { kind: "preset" }>;

export function findPresetLogin(
  logins: readonly OAuthStatusEntry[],
  presetId: OAuthPresetId,
): PresetLogin | undefined {
  return logins.find(
    (entry): entry is PresetLogin => entry.kind === "preset" && entry.preset === presetId,
  );
}

export function describePresetLogin(
  preset: OAuthPresetSummary,
  login: PresetLogin | undefined,
): string {
  return login !== undefined
    ? `${preset.secretKey} · ${login.scopeMode} · expires ${login.expires}`
    : `${preset.secretKey} · ${preset.domains.join(", ")}`;
}

export function describeSecretBinding(binding: SecretBinding): string {
  switch (binding.kind) {
    case "daemon":
      return "Daemon-only";
    case "llm":
      return `LLM provider: ${binding.provider}`;
    case "proxy":
      return `${binding.domains.join(", ")} (${formatSecretInjection(binding.inject)})`;
    default: {
      const exhaustive: never = binding;

      return exhaustive;
    }
  }
}
