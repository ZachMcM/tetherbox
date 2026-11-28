import { useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  OAuthPresetSummary,
  OAuthProviderId,
  StarterConfig,
  StarterSummary,
} from "@tetherbox/core/app";
import { RefreshCwIcon } from "lucide-react";
import { Badge } from "@tetherbox/ui/components/badge";
import { Button } from "@tetherbox/ui/components/button";
import { Field, FieldError, FieldLabel } from "@tetherbox/ui/components/field";
import { Input } from "@tetherbox/ui/components/input";
import { Spinner } from "@tetherbox/ui/components/spinner";
import { appClient, queryKeys, unwrapJson } from "../lib/api.ts";
import {
  OAUTH_PROVIDER_LABELS,
  OAuthPresetCredentialsForm,
} from "./auth-setup/oauth-preset-forms.tsx";
import { CliInstallCard } from "./cli-setup/cli-install-card.tsx";
import { StarterSelectionFields } from "./starter-setup/starter-selection-fields.tsx";
import { StarterSetupCard } from "./starter-setup/starter-setup-card.tsx";
import { useStarterSetupState } from "./starter-setup/use-starter-setup-state.ts";
import {
  countIncompleteVmItems,
  describeStarterAdditions,
  selectInstallEntries,
  starterFieldKey,
  starterNeedsSetupStep,
  validateSelectedStarterConfig,
} from "../lib/starter-readiness.ts";

export function CreateProfileForm({
  idPrefix,
  title,
  secondaryAction,
  renderHeader,
  renderFooter,
  onCreated,
}: {
  idPrefix: string;
  title: string;
  secondaryAction: ReactNode;
  renderHeader: (heading: { title: string; description: string }) => ReactNode;
  renderFooter: (actions: ReactNode) => ReactNode;
  onCreated: (profileId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [selectedStarters, setSelectedStarters] = useState<string[]>([]);
  const [starterConfig, setStarterConfig] = useState<StarterConfig>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [step, setStep] = useState<"select" | "prepare">("select");
  const [prepareStarterIds, setPrepareStarterIds] = useState<string[]>([]);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const {
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
  } = useStarterSetupState();

  const selectedSet = new Set(selectedStarters);
  const selectedSummaries = starters.filter((starter) => selectedSet.has(starter.id));
  const startersNeedingSetup = selectedSummaries.filter((starter) => {
    const readiness = readinessById.get(starter.id);

    return readiness !== undefined && starterNeedsSetupStep(starter, readiness);
  });

  const mutation = useMutation({
    mutationFn: async (validatedConfig: StarterConfig) => {
      const trimmedId = id.trim();
      const response = await appClient.profiles.$post({
        json: {
          id: trimmedId.toLowerCase(),
          name: name.trim() || trimmedId,
          starters: selectedStarters,
          starterConfig: validatedConfig,
        },
      });

      return unwrapJson(response);
    },
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.profiles });
      onCreated(data.profile.id);
    },
  });

  const commitProfile = () => {
    const validation = validateSelectedStarterConfig(starters, selectedStarters, starterConfig);

    if (!validation.ok) {
      setFieldErrors(validation.errors);

      return;
    }

    setFieldErrors({});
    mutation.mutate(validation.config);
  };

  const handleSelectSubmit = (event: FormEvent) => {
    event.preventDefault();

    if (startersNeedingSetup.length > 0) {
      setPrepareStarterIds(startersNeedingSetup.map((starter) => starter.id));
      setFieldErrors({});
      setStep("prepare");

      return;
    }

    commitProfile();
  };

  const updateStarterField = (starterId: string, fieldKey: string, value: string) => {
    setStarterConfig((prev) => ({
      ...prev,
      [starterId]: {
        ...prev[starterId],
        [fieldKey]: value,
      },
    }));
    setFieldErrors((prev) => {
      const key = starterFieldKey(starterId, fieldKey);

      if (!(key in prev)) {
        return prev;
      }

      const next = { ...prev };

      delete next[key];

      return next;
    });
  };

  const prepareSummaries: StarterSummary[] = prepareStarterIds.flatMap((starterId) => {
    const found = starters.find((entry) => entry.id === starterId);

    return found !== undefined ? [found] : [];
  });

  const installEntries = selectInstallEntries(prepareSummaries, readinessById, installRunner);

  const configOrAuthStarters = prepareSummaries.filter((starter) => {
    const readiness = readinessById.get(starter.id);

    return (
      starter.configFields.length > 0 ||
      starter.secrets.length > 0 ||
      starter.oauthPreset !== undefined ||
      starter.cli?.hasAuth === true ||
      starter.setupNote !== undefined ||
      readiness?.cliEntry?.status.kind === "error"
    );
  });

  const groupsByProvider = new Map<
    OAuthProviderId,
    { provider: OAuthProviderId; preset: OAuthPresetSummary; starterNames: string[] }
  >();

  for (const starter of configOrAuthStarters) {
    if (starter.oauthPreset === undefined) {
      continue;
    }

    const preset = oauthPresets.find((entry) => entry.id === starter.oauthPreset);

    if (preset === undefined || preset.hasClientCredentials) {
      continue;
    }

    const existing = groupsByProvider.get(preset.provider);

    if (existing !== undefined) {
      existing.starterNames.push(starter.name);
    } else {
      groupsByProvider.set(preset.provider, {
        provider: preset.provider,
        preset,
        starterNames: [starter.name],
      });
    }
  }

  const sharedOAuthCredentialsGroups = [...groupsByProvider.values()].filter(
    (group) => group.starterNames.length >= 2,
  );

  const sharedOAuthProviders = new Set(sharedOAuthCredentialsGroups.map((group) => group.provider));

  const incompleteVmCount = countIncompleteVmItems(selectedSummaries, readinessById);
  const additionsSummary = describeStarterAdditions(selectedSummaries);
  const canContinue = !mutation.isPending && id.trim() !== "";
  const selectSubmitLabel =
    startersNeedingSetup.length > 0
      ? `Continue to setup (${startersNeedingSetup.length})`
      : "Create profile";
  const prepareSubmitLabel =
    incompleteVmCount === 0 ? "Create profile" : `Create profile (${incompleteVmCount} skipped)`;
  const displayName = name.trim() || id.trim();

  if (step === "select") {
    return (
      <>
        {renderHeader({
          title,
          description:
            "Creates a git-backed profile directory, copies selected starters, and loads it into the daemon.",
        })}
        <form onSubmit={handleSelectSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1 pb-4">
            <div className="grid grid-cols-2 gap-3">
              <Field>
                <FieldLabel htmlFor={`${idPrefix}-id`}>Profile ID</FieldLabel>
                <Input
                  id={`${idPrefix}-id`}
                  placeholder="work"
                  value={id}
                  onChange={(event) => setId(event.target.value)}
                  pattern="[A-Za-z0-9][A-Za-z0-9-]{0,62}"
                  title="Letters, numbers, and hyphens"
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`${idPrefix}-name`}>Display name</FieldLabel>
                <Input
                  id={`${idPrefix}-name`}
                  placeholder="Work"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </Field>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-medium">Starters</div>
                <span className="text-xs text-muted-foreground">
                  Green check means already ready on this VM
                </span>
              </div>
              {startersQuery.isPending ? (
                <div className="flex justify-center py-4">
                  <Spinner className="size-4 text-muted-foreground" />
                </div>
              ) : startersQuery.error !== null ? (
                <FieldError>{startersQuery.error.message}</FieldError>
              ) : (
                <StarterSelectionFields
                  idPrefix={idPrefix}
                  starters={starters}
                  selectedStarters={selectedStarters}
                  starterConfig={starterConfig}
                  readinessById={readinessById}
                  onChange={(next) => {
                    setSelectedStarters(next.starters);
                    setStarterConfig(next.starterConfig);
                    setFieldErrors({});
                  }}
                />
              )}
            </div>
            {mutation.error !== null && <FieldError>{mutation.error.message}</FieldError>}
          </div>
          {renderFooter(
            <>
              {secondaryAction}
              <Button type="submit" disabled={!canContinue}>
                {mutation.isPending ? "Creating…" : selectSubmitLabel}
              </Button>
            </>,
          )}
        </form>
      </>
    );
  }

  return (
    <>
      {renderHeader({
        title: `Set up ${displayName}`,
        description:
          "Binaries, secrets, and logins persist across the VM once configured. Profile settings apply only to this profile.",
      })}

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1 pb-4">
          {statusError !== null && (
            <div className="flex items-center justify-between gap-2 rounded-xl border border-destructive/40 bg-destructive/5 px-3.5 py-2.5">
              <FieldError>{statusError.message}</FieldError>
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={refreshStatus}
                disabled={isRefreshing}
              >
                Retry
              </Button>
            </div>
          )}

          {statusPending && installEntries.length === 0 && configOrAuthStarters.length === 0 && (
            <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
              <Spinner className="size-4" />
              <span>Checking VM status…</span>
            </div>
          )}

          {installEntries.length > 0 && (
            <CliInstallCard entries={installEntries} runner={installRunner} />
          )}

          {sharedOAuthCredentialsGroups.map((group) => (
            <div key={group.provider} className="rounded-xl border border-border bg-card">
              <div className="px-3.5 py-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">
                    {OAUTH_PROVIDER_LABELS[group.provider]} OAuth app credentials
                  </span>
                  <Badge variant="secondary" className="text-[10px] font-normal">
                    VM-wide · once
                  </Badge>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Shared by {group.starterNames.join(", ")}.
                </p>
              </div>
              <div className="border-t border-border px-3.5 py-3">
                <OAuthPresetCredentialsForm preset={group.preset} />
              </div>
            </div>
          ))}

          {configOrAuthStarters.length > 0 && (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-muted-foreground">
                  Configure & authenticate
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() => {
                    refreshStatus();
                    setRefreshNonce((prev) => prev + 1);
                  }}
                  disabled={isRefreshing}
                >
                  <RefreshCwIcon className="size-3.5" />
                  <span>Refresh status</span>
                </Button>
              </div>

              {configOrAuthStarters.map((starter) => {
                const readiness = readinessById.get(starter.id);

                if (readiness === undefined) {
                  return null;
                }

                return (
                  <StarterSetupCard
                    key={starter.id}
                    idPrefix={idPrefix}
                    starter={starter}
                    readiness={readiness}
                    starterConfig={starterConfig}
                    fieldErrors={fieldErrors}
                    oauthPresets={oauthPresets}
                    oauthLogins={oauthLogins}
                    installRunner={installRunner}
                    sharedOAuthProviders={sharedOAuthProviders}
                    refreshNonce={refreshNonce}
                    onConfigChange={updateStarterField}
                  />
                );
              })}
            </div>
          )}

          {Object.keys(fieldErrors).length > 0 && (
            <FieldError>Fix the highlighted profile settings above before creating.</FieldError>
          )}
          {mutation.error !== null && <FieldError>{mutation.error.message}</FieldError>}
        </div>

        {renderFooter(
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">{additionsSummary}</span>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={mutation.isPending}
                onClick={() => setStep("select")}
              >
                Back
              </Button>
              <Button type="button" disabled={mutation.isPending} onClick={commitProfile}>
                {mutation.isPending ? "Creating…" : prepareSubmitLabel}
              </Button>
            </div>
          </div>,
        )}
      </div>
    </>
  );
}
