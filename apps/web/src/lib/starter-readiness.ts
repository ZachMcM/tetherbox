import {
  starterConfigFieldSchemas,
  type OAuthPresetId,
  type OAuthStatusEntry,
  type SecretListEntry,
  type StarterCategory,
  type StarterCliStatusEntry,
  type StarterConfig,
  type StarterSecret,
  type StarterSummary,
} from "@tetherbox/core/app";
import type { CliInstallJobState } from "@tetherbox/core/app";

export const STARTER_CATEGORY_ORDER: readonly { category: StarterCategory; label: string }[] = [
  { category: "integration", label: "Integrations" },
  { category: "harness", label: "Coding harnesses" },
  { category: "cli", label: "CLIs" },
];

export function starterKindLabel(starter: StarterSummary): string {
  if (starter.kind === "module") {
    return "Module";
  }

  return starter.cli !== undefined ? "Skill + CLI" : "Skill";
}

export function starterFieldKey(starterId: string, fieldKey: string): string {
  return `${starterId}.${fieldKey}`;
}

export interface StarterReadinessInput {
  readonly secrets: readonly SecretListEntry[] | undefined;
  readonly oauthLogins: readonly OAuthStatusEntry[] | undefined;
  readonly cliStatuses: readonly StarterCliStatusEntry[] | undefined;
}

export interface StarterReadiness {
  readonly missingSecrets: readonly StarterSecret[];
  readonly missingOAuthPreset: OAuthPresetId | undefined;
  readonly cliEntry: StarterCliStatusEntry | undefined;
  readonly needsBinaryInstall: boolean;
  readonly needsCliAuth: boolean;
  readonly hasUnverifiedCliAuth: boolean;
  readonly hasVmRequirements: boolean;
  readonly isStatusLoaded: boolean;
  readonly isVmReady: boolean;
}

export function getStarterReadiness(
  starter: StarterSummary,
  input: StarterReadinessInput,
): StarterReadiness {
  const secretsLoaded = starter.secrets.length === 0 || input.secrets !== undefined;
  const oauthLoaded = starter.oauthPreset === undefined || input.oauthLogins !== undefined;
  const cliLoaded = starter.cli === undefined || input.cliStatuses !== undefined;
  const isStatusLoaded = secretsLoaded && oauthLoaded && cliLoaded;

  const storedSecretKeys = new Set(input.secrets?.map((entry) => entry.key));
  const connectedPresets = new Set(
    input.oauthLogins?.flatMap((entry) => (entry.kind === "preset" ? [entry.preset] : [])),
  );
  const missingSecrets =
    input.secrets === undefined
      ? []
      : starter.secrets.filter((secret) => !storedSecretKeys.has(secret.key));
  const missingOAuthPreset =
    input.oauthLogins !== undefined &&
    starter.oauthPreset !== undefined &&
    !connectedPresets.has(starter.oauthPreset)
      ? starter.oauthPreset
      : undefined;
  const cliEntry = input.cliStatuses?.find((entry) => entry.starterId === starter.id);
  const needsBinaryInstall = cliEntry?.status.kind === "missing";
  const needsCliAuth =
    starter.cli?.hasAuth === true &&
    cliEntry !== undefined &&
    (cliEntry.status.kind === "missing" ||
      (cliEntry.status.kind === "installed" && cliEntry.status.auth === "unauthenticated"));
  const hasUnverifiedCliAuth =
    starter.cli?.hasAuth === true &&
    cliEntry?.status.kind === "installed" &&
    cliEntry.status.auth === "unknown";
  const hasVmRequirements =
    starter.secrets.length > 0 || starter.oauthPreset !== undefined || starter.cli !== undefined;
  const isVmReady =
    isStatusLoaded &&
    missingSecrets.length === 0 &&
    missingOAuthPreset === undefined &&
    !needsBinaryInstall &&
    !needsCliAuth &&
    cliEntry?.status.kind !== "error";

  return {
    missingSecrets,
    missingOAuthPreset,
    cliEntry,
    needsBinaryInstall,
    needsCliAuth,
    hasUnverifiedCliAuth,
    hasVmRequirements,
    isStatusLoaded,
    isVmReady,
  };
}

export function selectInstallEntries(
  starters: readonly StarterSummary[],
  readinessById: ReadonlyMap<string, StarterReadiness>,
  installRunner: { readonly jobs: Readonly<Record<string, CliInstallJobState>> },
): StarterCliStatusEntry[] {
  return starters.flatMap((starter) => {
    const entry = readinessById.get(starter.id)?.cliEntry;

    if (entry === undefined) {
      return [];
    }

    const job = installRunner.jobs[starter.id];

    return entry.status.kind === "missing" || job !== undefined ? [entry] : [];
  });
}

export function isStarterConfigValid(starter: StarterSummary, draftConfig: StarterConfig): boolean {
  for (const field of starter.configFields) {
    const rawValue = draftConfig[starter.id]?.[field.key] ?? "";

    if (!starterConfigFieldSchemas[field.kind].safeParse(rawValue).success) {
      return false;
    }
  }

  return true;
}

export function validateStarterFields(
  starter: StarterSummary,
  draftConfig: StarterConfig,
):
  | { ok: true; values: Record<string, string> | undefined }
  | { ok: false; errors: Record<string, string> } {
  if (starter.configFields.length === 0) {
    return { ok: true, values: undefined };
  }

  const errors: Record<string, string> = {};
  const values: Record<string, string> = {};

  for (const field of starter.configFields) {
    const rawValue = draftConfig[starter.id]?.[field.key] ?? "";
    const parsed = starterConfigFieldSchemas[field.kind].safeParse(rawValue);

    if (!parsed.success) {
      errors[starterFieldKey(starter.id, field.key)] =
        parsed.error.issues[0]?.message ?? "Invalid value";
      continue;
    }

    values[field.key] = parsed.data;
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, values };
}

export function validateSelectedStarterConfig(
  starters: readonly StarterSummary[],
  selectedIds: readonly string[],
  draftConfig: StarterConfig,
): { ok: true; config: StarterConfig } | { ok: false; errors: Record<string, string> } {
  const selectedSet = new Set(selectedIds);
  const errors: Record<string, string> = {};
  const cleaned: Record<string, Record<string, string>> = {};

  for (const starter of starters) {
    if (!selectedSet.has(starter.id)) {
      continue;
    }

    const validation = validateStarterFields(starter, draftConfig);

    if (!validation.ok) {
      Object.assign(errors, validation.errors);
      continue;
    }

    if (validation.values !== undefined) {
      cleaned[starter.id] = validation.values;
    }
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, config: cleaned };
}

export function starterNeedsSetupStep(
  starter: StarterSummary,
  readiness: StarterReadiness,
): boolean {
  return (
    !readiness.isVmReady ||
    starter.configFields.length > 0 ||
    readiness.hasUnverifiedCliAuth ||
    starter.setupNote !== undefined
  );
}

export function countIncompleteVmItems(
  starters: readonly StarterSummary[],
  readinessById: ReadonlyMap<string, StarterReadiness>,
): number {
  let count = 0;

  for (const starter of starters) {
    const readiness = readinessById.get(starter.id);

    if (readiness === undefined) {
      continue;
    }

    if (readiness.needsBinaryInstall || readiness.cliEntry?.status.kind === "error") {
      count += 1;
    }

    if (readiness.needsCliAuth) {
      count += 1;
    }

    count += readiness.missingSecrets.length;

    if (readiness.missingOAuthPreset !== undefined) {
      count += 1;
    }
  }

  return count;
}

export function describeStarterAdditions(starters: readonly StarterSummary[]): string | null {
  if (starters.length === 0) {
    return null;
  }

  let modules = 0;
  let skills = 0;

  for (const starter of starters) {
    if (starter.kind === "module") {
      modules += 1;
    } else {
      skills += 1;
    }
  }

  const parts: string[] = [];

  if (modules > 0) {
    parts.push(`${modules} ${modules === 1 ? "module" : "modules"}`);
  }

  if (skills > 0) {
    parts.push(`${skills} ${skills === 1 ? "skill" : "skills"}`);
  }

  return `Copies ${parts.join(" and ")} into this profile.`;
}
