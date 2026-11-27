import { useState, type FormEvent } from "react";
import type {
  OAuthPresetSummary,
  OAuthStatusEntry,
  ProfileDetail,
  StarterConfig,
  StarterSummary,
} from "@tetherbox/core/app";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { Button } from "@tetherbox/ui/components/button";
import { Switch } from "@tetherbox/ui/components/switch";
import type { CliInstallRunner } from "../../cli-setup/use-cli-install-runner.ts";
import { StarterBadges } from "../../starter-setup/starter-badges.tsx";
import { StarterConfigFields } from "../../starter-setup/starter-config-fields.tsx";
import { StarterVmSetupPanels } from "../../starter-setup/starter-vm-setup-panels.tsx";
import {
  starterFieldKey,
  validateStarterFields,
  type StarterReadiness,
} from "../../../lib/starter-readiness.ts";
import { StarterIcon } from "../../starter-icons.tsx";
import { starterStatusBadge } from "./starter-status-badge.tsx";

export function StarterCatalogRow({
  profile,
  starter,
  enabled,
  readiness,
  oauthPresets,
  oauthLogins,
  installRunner,
  expanded,
  pendingEnable,
  busy,
  updateAvailable,
  updating,
  onUpdate,
  onToggleExpand,
  onToggleSwitch,
  onSaveConfig,
  onCancelPending,
}: {
  profile: ProfileDetail;
  starter: StarterSummary;
  enabled: boolean;
  readiness: StarterReadiness | undefined;
  oauthPresets: readonly OAuthPresetSummary[];
  oauthLogins: readonly OAuthStatusEntry[];
  installRunner: CliInstallRunner;
  expanded: boolean;
  pendingEnable: boolean;
  busy: boolean;
  updateAvailable: boolean;
  updating: boolean;
  onUpdate: () => void;
  onToggleExpand: () => void;
  onToggleSwitch: (checked: boolean) => void;
  onSaveConfig: (values: Record<string, string>) => Promise<void>;
  onCancelPending: () => void;
}) {
  const savedFields = profile.config.starterConfig[starter.id] ?? {};
  const savedSignature = JSON.stringify(savedFields);
  const [draftState, setDraftState] = useState<{
    signature: string;
    values: Record<string, string>;
    errors: Record<string, string>;
  }>({ signature: savedSignature, values: savedFields, errors: {} });
  const [savingConfig, setSavingConfig] = useState(false);

  const isCurrentDraft = draftState.signature === savedSignature;
  const draftFields = isCurrentDraft ? draftState.values : savedFields;
  const fieldErrors = isCurrentDraft ? draftState.errors : {};

  const resetDraft = () => {
    setDraftState({ signature: savedSignature, values: savedFields, errors: {} });
  };

  const effectiveStarterConfig: StarterConfig = {
    ...profile.config.starterConfig,
    [starter.id]: draftFields,
  };

  const hasConfigFields = starter.configFields.length > 0;
  const configDirty =
    pendingEnable ||
    starter.configFields.some(
      (field) => (draftFields[field.key] ?? "").trim() !== (savedFields[field.key] ?? ""),
    );
  const hasDetailContent =
    hasConfigFields ||
    starter.secrets.length > 0 ||
    starter.oauthPreset !== undefined ||
    starter.cli !== undefined ||
    starter.setupNote !== undefined;

  const handleConfigSubmit = async (event: FormEvent) => {
    event.preventDefault();

    const validation = validateStarterFields(starter, effectiveStarterConfig);

    if (!validation.ok) {
      setDraftState({
        signature: savedSignature,
        values: draftFields,
        errors: validation.errors,
      });

      return;
    }

    setDraftState({ signature: savedSignature, values: draftFields, errors: {} });
    setSavingConfig(true);

    try {
      await onSaveConfig(validation.values ?? {});
    } catch {
      // Mutation error is surfaced in the parent section.
    } finally {
      setSavingConfig(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-3 px-4 py-2.5">
        <button
          type="button"
          onClick={() => {
            if (hasDetailContent) {
              onToggleExpand();
            }
          }}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 text-left"
        >
          {hasDetailContent ? (
            expanded ? (
              <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
            )
          ) : (
            <span className="size-3.5 shrink-0" />
          )}
          <StarterIcon starter={starter} />
          <span className="truncate text-sm font-medium">{starter.name}</span>
          <StarterBadges starter={starter} />
        </button>

        <div className="flex shrink-0 items-center gap-2.5">
          {updateAvailable && (
            <Button
              type="button"
              variant="outline"
              size="xs"
              disabled={updating}
              onClick={onUpdate}
            >
              {updating ? "Updating…" : "Update"}
            </Button>
          )}
          {starterStatusBadge(starter, enabled, readiness, profile.config.starterConfig)}
          {enabled && hasDetailContent && (
            <Button type="button" variant="ghost" size="xs" onClick={onToggleExpand}>
              {expanded ? "Done" : "Configure"}
            </Button>
          )}
          <Switch
            size="sm"
            checked={enabled || pendingEnable}
            disabled={busy}
            aria-label={`Enable ${starter.name}`}
            onCheckedChange={(checked) => {
              if (!checked) {
                resetDraft();
              }

              onToggleSwitch(checked);
            }}
          />
        </div>
      </div>

      {expanded && hasDetailContent && (
        <div className="space-y-4 border-t border-border/60 bg-muted/20 px-4 py-3.5">
          {hasConfigFields && (
            <form onSubmit={(event) => void handleConfigSubmit(event)} className="space-y-2.5">
              <StarterConfigFields
                idPrefix={`profile-${profile.id}`}
                starter={starter}
                values={draftFields}
                fieldErrors={fieldErrors}
                onChange={(fieldKey, value) => {
                  const key = starterFieldKey(starter.id, fieldKey);
                  const nextErrors = { ...fieldErrors };

                  delete nextErrors[key];
                  setDraftState({
                    signature: savedSignature,
                    values: { ...draftFields, [fieldKey]: value },
                    errors: nextErrors,
                  });
                }}
              />

              {configDirty && (
                <div className="flex justify-end gap-2 pt-1">
                  {pendingEnable && (
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      disabled={savingConfig}
                      onClick={() => {
                        resetDraft();
                        onCancelPending();
                      }}
                    >
                      Cancel
                    </Button>
                  )}
                  <Button type="submit" size="xs" disabled={savingConfig || busy}>
                    {savingConfig
                      ? "Saving…"
                      : pendingEnable
                        ? `Enable ${starter.name}`
                        : "Save settings"}
                  </Button>
                </div>
              )}
            </form>
          )}

          <StarterVmSetupPanels
            starter={starter}
            readiness={readiness}
            starterConfig={effectiveStarterConfig}
            oauthPresets={oauthPresets}
            oauthLogins={oauthLogins}
            installRunner={installRunner}
            showAllClis
          />
        </div>
      )}
    </div>
  );
}
