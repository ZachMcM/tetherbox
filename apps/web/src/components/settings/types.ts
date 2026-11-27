export type SettingsTab =
  | "general"
  | "appearance"
  | "providers"
  | "secrets"
  | "integrations"
  | "tools"
  | "library"
  | "profiles"
  | `profile:${string}`;

export const SETTINGS_NAV = [
  { tab: "general", label: "General" },
  { tab: "appearance", label: "Appearance" },
  { tab: "providers", label: "Models & Providers" },
  { tab: "secrets", label: "Secrets" },
  { tab: "integrations", label: "Integrations" },
  { tab: "tools", label: "CLI tools" },
  { tab: "library", label: "Starter library" },
  { tab: "profiles", label: "Profiles" },
] as const;

export function parseSettingsTab(value: unknown): SettingsTab | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const staticTab = SETTINGS_NAV.find((item) => item.tab === value)?.tab;

  if (staticTab !== undefined) {
    return staticTab;
  }

  if (value.startsWith("profile:") && value.length > "profile:".length) {
    return `profile:${value.slice("profile:".length)}`;
  }

  return undefined;
}
