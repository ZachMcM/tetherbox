import {
  starterConfigFieldSchemas,
  type OAuthPresetId,
  type OAuthStatusEntry,
  type SecretListEntry,
  type StarterCategory,
  type StarterConfig,
  type StarterSecret,
  type StarterSummary,
} from "@tetherbox/core/app";
import { Badge } from "@tetherbox/ui/components/badge";
import { Button } from "@tetherbox/ui/components/button";
import { Checkbox } from "@tetherbox/ui/components/checkbox";
import { Field, FieldError, FieldLabel } from "@tetherbox/ui/components/field";
import { Input } from "@tetherbox/ui/components/input";
import { StarterIcon } from "./starter-icons.tsx";

const CATEGORY_ORDER: readonly { category: StarterCategory; label: string }[] = [
  { category: "integration", label: "Integrations" },
  { category: "harness", label: "Coding harnesses" },
  { category: "cli", label: "CLIs" },
];

function starterKindLabel(starter: StarterSummary): string {
  if (starter.kind === "module") {
    return "Module";
  }

  return starter.cli !== undefined ? "Skill + CLI" : "Skill";
}

function starterFieldKey(starterId: string, fieldKey: string): string {
  return `${starterId}.${fieldKey}`;
}

export interface MissingStarterAuth {
  readonly secrets: readonly { starter: StarterSummary; secret: StarterSecret }[];
  readonly presets: readonly OAuthPresetId[];
}

export function collectMissingStarterAuth({
  starters,
  secrets,
  oauthLogins,
}: {
  starters: readonly StarterSummary[];
  secrets: readonly SecretListEntry[] | undefined;
  oauthLogins: readonly OAuthStatusEntry[] | undefined;
}): MissingStarterAuth {
  const storedSecretKeys = new Set(secrets?.map((entry) => entry.key));
  const connectedPresets = new Set(
    oauthLogins?.flatMap((entry) => (entry.kind === "preset" ? [entry.preset] : [])),
  );
  const missingSecrets = new Map<string, { starter: StarterSummary; secret: StarterSecret }>();
  const missingPresets = new Set<OAuthPresetId>();

  for (const starter of starters) {
    if (secrets !== undefined) {
      for (const secret of starter.secrets) {
        if (!storedSecretKeys.has(secret.key) && !missingSecrets.has(secret.key)) {
          missingSecrets.set(secret.key, { starter, secret });
        }
      }
    }

    if (
      oauthLogins !== undefined &&
      starter.oauthPreset !== undefined &&
      !connectedPresets.has(starter.oauthPreset)
    ) {
      missingPresets.add(starter.oauthPreset);
    }
  }

  return { secrets: [...missingSecrets.values()], presets: [...missingPresets] };
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

    for (const field of starter.configFields) {
      const rawValue = draftConfig[starter.id]?.[field.key] ?? "";
      const parsed = starterConfigFieldSchemas[field.kind].safeParse(rawValue);

      if (!parsed.success) {
        errors[starterFieldKey(starter.id, field.key)] =
          parsed.error.issues[0]?.message ?? "Invalid value";
        continue;
      }

      const entry = (cleaned[starter.id] ??= {});

      entry[field.key] = parsed.data;
    }
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, config: cleaned };
}

export function needsSetupNote(starter: StarterSummary): boolean {
  return starter.cli !== undefined || starter.setupNote !== undefined;
}

export function StarterSetupNotes({ starters }: { starters: readonly StarterSummary[] }) {
  return starters.filter(needsSetupNote).map((starter) => (
    <div key={starter.id} className="space-y-1">
      {starter.cli !== undefined && (
        <div>
          <span className="font-medium text-foreground">{starter.name}</span>:{" "}
          {starter.cli.hasAuth ? (
            <>
              Run <code>tetherbox auth {starter.id}</code> on your machine to authenticate on the
              VM.
            </>
          ) : (
            <>
              Requires <code>{starter.cli.binary}</code> installed on the VM.
            </>
          )}
        </div>
      )}
      {starter.setupNote !== undefined && (
        <div>
          <span className="font-medium text-foreground">{starter.name}</span>: {starter.setupNote}
        </div>
      )}
    </div>
  ));
}

export function StarterSelectionFields({
  idPrefix,
  starters,
  selectedStarters,
  starterConfig,
  fieldErrors,
  existingSecrets,
  oauthLogins,
  onChange,
  onOpenSettingsTab,
}: {
  idPrefix: string;
  starters: readonly StarterSummary[];
  selectedStarters: readonly string[];
  starterConfig: StarterConfig;
  fieldErrors: Readonly<Record<string, string>>;
  existingSecrets: readonly SecretListEntry[] | undefined;
  oauthLogins: readonly OAuthStatusEntry[] | undefined;
  onChange: (next: { starters: string[]; starterConfig: StarterConfig }) => void;
  onOpenSettingsTab?: ((tab: "secrets" | "integrations") => void) | undefined;
}) {
  const selectedSet = new Set(selectedStarters);
  const selectedSummaries = starters.filter((starter) => selectedSet.has(starter.id));

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

  const updateFieldValue = (starterId: string, fieldKey: string, value: string) => {
    const existing = starterConfig[starterId] ?? {};

    onChange({
      starters: [...selectedStarters],
      starterConfig: {
        ...starterConfig,
        [starterId]: {
          ...existing,
          [fieldKey]: value,
        },
      },
    });
  };

  const missing = collectMissingStarterAuth({
    starters: selectedSummaries,
    secrets: existingSecrets,
    oauthLogins,
  });
  const hasRequirements =
    missing.secrets.length > 0 ||
    missing.presets.length > 0 ||
    selectedSummaries.some(needsSetupNote);

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {CATEGORY_ORDER.map(({ category, label }) => {
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
                        <Badge variant="outline" className="shrink-0 px-1.5 text-[10px]">
                          {starterKindLabel(starter)}
                        </Badge>
                      </Field>
                    </FieldLabel>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {selectedSummaries.some((starter) => starter.configFields.length > 0) && (
        <div className="space-y-3 rounded-xl border border-border bg-muted/30 p-3">
          <div className="text-sm font-semibold">Starter configuration</div>
          {selectedSummaries.map((starter) =>
            starter.configFields.map((field) => {
              const key = starterFieldKey(starter.id, field.key);
              const inputId = `${idPrefix}-cfg-${starter.id}-${field.key}`;
              const error = fieldErrors[key];

              return (
                <Field key={key}>
                  <FieldLabel
                    htmlFor={inputId}
                    className="text-xs font-normal text-muted-foreground"
                  >
                    <span className="text-xs text-foreground/80">{starter.name}</span>
                    <span>{field.prompt}</span>
                  </FieldLabel>
                  <Input
                    id={inputId}
                    value={starterConfig[starter.id]?.[field.key] ?? ""}
                    placeholder={field.placeholder}
                    onChange={(event) =>
                      updateFieldValue(starter.id, field.key, event.target.value)
                    }
                    aria-invalid={error !== undefined}
                  />
                  {error !== undefined && <FieldError>{error}</FieldError>}
                </Field>
              );
            }),
          )}
        </div>
      )}

      {hasRequirements && (
        <div className="space-y-2 rounded-xl border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
          <div className="font-medium text-foreground">Setup notes for selected starters</div>
          {missing.secrets.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                Missing secrets:{" "}
                <span className="font-mono text-foreground">
                  {missing.secrets.map((entry) => entry.secret.key).join(", ")}
                </span>
              </span>
              {onOpenSettingsTab !== undefined && (
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() => onOpenSettingsTab("secrets")}
                >
                  Open Secrets
                </Button>
              )}
            </div>
          )}
          {missing.presets.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                Unconnected OAuth presets:{" "}
                <span className="font-mono text-foreground">{missing.presets.join(", ")}</span>
              </span>
              {onOpenSettingsTab !== undefined && (
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() => onOpenSettingsTab("integrations")}
                >
                  Open Integrations
                </Button>
              )}
            </div>
          )}
          <StarterSetupNotes starters={selectedSummaries} />
        </div>
      )}
    </div>
  );
}
