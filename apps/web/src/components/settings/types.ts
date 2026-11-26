export type SettingsTab =
  | "general"
  | "appearance"
  | "providers"
  | "secrets"
  | "integrations"
  | `profile:${string}`;

export const SETTINGS_NAV = [
  { tab: "general", label: "General" },
  { tab: "appearance", label: "Appearance" },
  { tab: "providers", label: "Models & Providers" },
  { tab: "secrets", label: "Secrets" },
  { tab: "integrations", label: "Integrations" },
] as const;

const STATIC_TABS: ReadonlySet<string> = new Set(SETTINGS_NAV.map((item) => item.tab));

export function parseSettingsTab(value: unknown): SettingsTab | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  if (STATIC_TABS.has(value)) {
    return SETTINGS_NAV.find((item) => item.tab === value)?.tab;
  }

  if (value.startsWith("profile:") && value.length > "profile:".length) {
    return `profile:${value.slice("profile:".length)}`;
  }

  return undefined;
}
