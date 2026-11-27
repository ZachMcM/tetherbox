import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  starterConfigFieldSchemas,
  type OAuthPresetId,
  type OAuthPresetSummary,
  type OAuthStatusEntry,
  type SecretListEntry,
  type StarterCategory,
  type StarterCliStatusEntry,
  type StarterConfig,
  type StarterSecret,
  type StarterSummary,
} from "@tetherbox/core/app";
import { CheckCircle2Icon, ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { Badge } from "@tetherbox/ui/components/badge";
import { Checkbox } from "@tetherbox/ui/components/checkbox";
import { Field, FieldError, FieldLabel } from "@tetherbox/ui/components/field";
import { Input } from "@tetherbox/ui/components/input";
import {
  cliStatusQueryOptions,
  oauthStatusQueryOptions,
  secretsQueryOptions,
  startersQueryOptions,
} from "../lib/queries.ts";
import { OAuthPresetInlineCard, StarterSecretInlineCard } from "./auth-setup/inline-cards.tsx";
import { findPresetLogin } from "../lib/auth-status.ts";
import { CliAuthFlowPanel } from "./cli-setup/cli-auth-flow-panel.tsx";
import { useCliInstallRunner, type CliInstallRunner } from "./cli-setup/use-cli-install-runner.ts";
import { StarterIcon } from "./starter-icons.tsx";

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

export function StarterBadges({ starter }: { starter: StarterSummary }) {
  return (
    <>
      <Badge variant="outline" className="shrink-0 px-1.5 text-[10px]">
        {starterKindLabel(starter)}
      </Badge>
      {starter.source === "library" && (
        <Badge variant="secondary" className="shrink-0 px-1.5 text-[10px]">
          Library
        </Badge>
      )}
    </>
  );
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

export function useStarterSetupState() {
  const startersQuery = useQuery(startersQueryOptions);
  const secretsQuery = useQuery(secretsQueryOptions);
  const oauthStatusQuery = useQuery({ ...oauthStatusQueryOptions, refetchOnWindowFocus: "always" });
  const cliStatusQuery = useQuery({ ...cliStatusQueryOptions, refetchOnWindowFocus: "always" });
  const installRunner = useCliInstallRunner();

  const starters = startersQuery.data?.starters ?? [];
  const oauthPresets = oauthStatusQuery.data?.presets ?? [];
  const oauthLogins = oauthStatusQuery.data?.logins ?? [];
  const cliStatuses = cliStatusQuery.data?.clis;

  const readinessById = useMemo(() => {
    const map = new Map<string, StarterReadiness>();

    for (const starter of starters) {
      map.set(
        starter.id,
        getStarterReadiness(starter, {
          secrets: secretsQuery.data?.secrets,
          oauthLogins: oauthStatusQuery.data?.logins,
          cliStatuses,
        }),
      );
    }

    return map;
  }, [starters, secretsQuery.data?.secrets, oauthStatusQuery.data?.logins, cliStatuses]);

  const refreshStatus = () => {
    void cliStatusQuery.refetch();
    void oauthStatusQuery.refetch();
    void secretsQuery.refetch();
  };

  const isRefreshing =
    cliStatusQuery.isFetching || oauthStatusQuery.isFetching || secretsQuery.isFetching;
  const statusPending =
    cliStatusQuery.isPending || oauthStatusQuery.isPending || secretsQuery.isPending;
  const statusError = cliStatusQuery.error ?? oauthStatusQuery.error ?? secretsQuery.error ?? null;

  return {
    starters,
    startersQuery,
    oauthPresets,
    oauthLogins,
    readinessById,
    installRunner,
    isRefreshing,
    statusPending,
    statusError,
    refreshStatus,
  };
}

export function selectInstallEntries(
  starters: readonly StarterSummary[],
  readinessById: ReadonlyMap<string, StarterReadiness>,
  installRunner: CliInstallRunner,
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

export function StarterConfigFields({
  idPrefix,
  starter,
  values,
  fieldErrors,
  onChange,
}: {
  idPrefix: string;
  starter: StarterSummary;
  values: Readonly<Record<string, string>>;
  fieldErrors: Readonly<Record<string, string>>;
  onChange: (fieldKey: string, value: string) => void;
}) {
  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold">Profile settings</span>
        <Badge variant="outline" className="text-[10px] font-normal">
          This profile only
        </Badge>
      </div>
      {starter.configFields.map((field) => {
        const key = starterFieldKey(starter.id, field.key);
        const inputId = `${idPrefix}-cfg-${starter.id}-${field.key}`;
        const error = fieldErrors[key];

        return (
          <Field key={key}>
            <FieldLabel htmlFor={inputId} className="text-xs font-normal text-muted-foreground">
              {field.prompt}
            </FieldLabel>
            <Input
              id={inputId}
              value={values[field.key] ?? ""}
              placeholder={field.placeholder}
              onChange={(event) => onChange(field.key, event.target.value)}
              aria-invalid={error !== undefined}
            />
            {error !== undefined && <FieldError>{error}</FieldError>}
          </Field>
        );
      })}
    </div>
  );
}

export function StarterVmSetupPanels({
  starter,
  readiness,
  starterConfig,
  oauthPresets,
  oauthLogins,
  installRunner,
  showAllClis = false,
}: {
  starter: StarterSummary;
  readiness: StarterReadiness | undefined;
  starterConfig: StarterConfig;
  oauthPresets: readonly OAuthPresetSummary[];
  oauthLogins: readonly OAuthStatusEntry[];
  installRunner: CliInstallRunner;
  showAllClis?: boolean;
}) {
  const missingSecretKeys = new Set(readiness?.missingSecrets.map((secret) => secret.key));
  const oauthPreset =
    starter.oauthPreset !== undefined
      ? oauthPresets.find((entry) => entry.id === starter.oauthPreset)
      : undefined;
  const oauthLogin =
    starter.oauthPreset !== undefined
      ? findPresetLogin(oauthLogins, starter.oauthPreset)
      : undefined;
  const showCliPanel =
    readiness?.cliEntry !== undefined &&
    (showAllClis || starter.cli?.hasAuth === true || readiness.cliEntry.status.kind === "error");

  return (
    <>
      {starter.secrets.map((secret) => (
        <StarterSecretInlineCard
          key={secret.key}
          secret={secret}
          starterConfig={starterConfig}
          isConfigured={readiness?.isStatusLoaded === true && !missingSecretKeys.has(secret.key)}
        />
      ))}

      {oauthPreset !== undefined && (
        <OAuthPresetInlineCard preset={oauthPreset} activeLogin={oauthLogin} />
      )}

      {showCliPanel && readiness?.cliEntry !== undefined && (
        <CliAuthFlowPanel entry={readiness.cliEntry} installRunner={installRunner} />
      )}

      {starter.setupNote !== undefined && (
        <p className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          {starter.setupNote}
        </p>
      )}
    </>
  );
}

export function StarterSelectionFields({
  idPrefix,
  starters,
  selectedStarters,
  starterConfig,
  readinessById,
  onChange,
}: {
  idPrefix: string;
  starters: readonly StarterSummary[];
  selectedStarters: readonly string[];
  starterConfig: StarterConfig;
  readinessById: ReadonlyMap<string, StarterReadiness>;
  onChange: (next: { starters: string[]; starterConfig: StarterConfig }) => void;
}) {
  const selectedSet = new Set(selectedStarters);

  const toggleStarter = (starterId: string, checked: boolean) => {
    const nextSet = new Set(selectedStarters);

    if (checked) {
      nextSet.add(starterId);
    } else {
      nextSet.delete(starterId);
    }

    const nextStarters = starters
      .filter((starter) => nextSet.has(starter.id))
      .map((starter) => starter.id);
    const nextConfig: Record<string, Record<string, string>> = {};

    for (const [id, values] of Object.entries(starterConfig)) {
      if (nextSet.has(id)) {
        nextConfig[id] = values;
      }
    }

    onChange({ starters: nextStarters, starterConfig: nextConfig });
  };

  return (
    <div className="space-y-3">
      {STARTER_CATEGORY_ORDER.map(({ category, label }) => {
        const group = starters.filter((starter) => starter.category === category);

        if (group.length === 0) {
          return null;
        }

        return (
          <div key={category} className="space-y-1.5">
            <div className="text-xs font-medium text-muted-foreground">{label}</div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {group.map((starter) => {
                const checked = selectedSet.has(starter.id);
                const checkboxId = `${idPrefix}-starter-${starter.id}`;
                const readiness = readinessById.get(starter.id);
                const vmReady =
                  readiness !== undefined && readiness.hasVmRequirements && readiness.isVmReady;

                return (
                  <FieldLabel key={starter.id} htmlFor={checkboxId} className="cursor-pointer">
                    <Field orientation="horizontal">
                      <Checkbox
                        id={checkboxId}
                        checked={checked}
                        onCheckedChange={(value) => toggleStarter(starter.id, value)}
                      />
                      <StarterIcon starter={starter} />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">
                        {starter.name}
                      </span>
                      {vmReady && (
                        <CheckCircle2Icon
                          className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400"
                          aria-label="Ready on this VM"
                        />
                      )}
                      <StarterBadges starter={starter} />
                    </Field>
                  </FieldLabel>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function StarterSetupCard({
  idPrefix,
  starter,
  readiness,
  starterConfig,
  fieldErrors,
  oauthPresets,
  oauthLogins,
  installRunner,
  onConfigChange,
}: {
  idPrefix: string;
  starter: StarterSummary;
  readiness: StarterReadiness;
  starterConfig: StarterConfig;
  fieldErrors: Readonly<Record<string, string>>;
  oauthPresets: readonly OAuthPresetSummary[];
  oauthLogins: readonly OAuthStatusEntry[];
  installRunner: CliInstallRunner;
  onConfigChange: (starterId: string, fieldKey: string, value: string) => void;
}) {
  const configReady = isStarterConfigValid(starter, starterConfig);
  const allReady = readiness.isVmReady && configReady;
  const hasConfigFields = starter.configFields.length > 0;
  const [userExpanded, setUserExpanded] = useState<boolean | null>(null);
  const expanded = userExpanded ?? (!allReady || hasConfigFields);

  return (
    <div className="rounded-xl border border-border bg-card">
      <button
        type="button"
        onClick={() => setUserExpanded(!expanded)}
        className="flex w-full cursor-pointer items-center justify-between gap-3 px-3.5 py-2.5 text-left"
      >
        <div className="flex min-w-0 items-center gap-2">
          {expanded ? (
            <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          <StarterIcon starter={starter} />
          <span className="truncate text-sm font-semibold">{starter.name}</span>
          <StarterBadges starter={starter} />
        </div>

        {allReady ? (
          <Badge variant="secondary" className="gap-1">
            <CheckCircle2Icon className="size-3 text-emerald-600 dark:text-emerald-400" />
            <span>Ready</span>
          </Badge>
        ) : readiness.cliEntry?.status.kind === "error" ? (
          <Badge variant="destructive">Error</Badge>
        ) : (
          <Badge variant="outline">Needs setup</Badge>
        )}
      </button>

      {expanded && (
        <div className="space-y-4 border-t border-border px-3.5 py-3">
          {hasConfigFields && (
            <StarterConfigFields
              idPrefix={idPrefix}
              starter={starter}
              values={starterConfig[starter.id] ?? {}}
              fieldErrors={fieldErrors}
              onChange={(fieldKey, value) => onConfigChange(starter.id, fieldKey, value)}
            />
          )}

          <StarterVmSetupPanels
            starter={starter}
            readiness={readiness}
            starterConfig={starterConfig}
            oauthPresets={oauthPresets}
            oauthLogins={oauthLogins}
            installRunner={installRunner}
          />
        </div>
      )}
    </div>
  );
}
