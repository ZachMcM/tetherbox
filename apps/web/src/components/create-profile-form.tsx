import { useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { StarterConfig } from "@tetherbox/core/app";
import { RefreshCwIcon } from "lucide-react";
import { Button } from "@tetherbox/ui/components/button";
import { Field, FieldError, FieldLabel } from "@tetherbox/ui/components/field";
import { Input } from "@tetherbox/ui/components/input";
import { Spinner } from "@tetherbox/ui/components/spinner";
import { appClient, queryKeys, unwrapJson } from "../lib/api.ts";
import {
  oauthStatusQueryOptions,
  secretsQueryOptions,
  startersQueryOptions,
} from "../lib/queries.ts";
import {
  findPresetLogin,
  OAuthPresetInlineCard,
  StarterSecretInlineCard,
} from "./auth-setup-panels.tsx";
import {
  collectMissingStarterAuth,
  needsSetupNote,
  StarterSelectionFields,
  StarterSetupNotes,
  validateSelectedStarterConfig,
  type MissingStarterAuth,
} from "./profile-form-fields.tsx";

interface AuthStepSnapshot {
  readonly starterConfig: StarterConfig;
  readonly secrets: MissingStarterAuth["secrets"];
  readonly oauthPresets: MissingStarterAuth["presets"];
}

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
  const [authStep, setAuthStep] = useState<AuthStepSnapshot | null>(null);

  const startersQuery = useQuery(startersQueryOptions);
  const secretsQuery = useQuery(secretsQueryOptions);
  const oauthStatusQuery = useQuery({ ...oauthStatusQueryOptions, refetchOnWindowFocus: "always" });

  const starters = startersQuery.data?.starters ?? [];
  const oauthPresets = oauthStatusQuery.data?.presets ?? [];
  const oauthLogins = oauthStatusQuery.data?.logins ?? [];

  const selectedSet = new Set(selectedStarters);
  const selectedSummaries = starters.filter((starter) => selectedSet.has(starter.id));
  const missingNow = collectMissingStarterAuth({
    starters: selectedSummaries,
    secrets: secretsQuery.data?.secrets,
    oauthLogins: oauthStatusQuery.data?.logins,
  });
  const missingCount = missingNow.secrets.length + missingNow.presets.length;
  const hasPendingAuth = missingCount > 0;
  const missingSecretKeys = new Set(missingNow.secrets.map((entry) => entry.secret.key));

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

  const validateAndGetConfig = (): StarterConfig | null => {
    const validation = validateSelectedStarterConfig(starters, selectedStarters, starterConfig);

    if (!validation.ok) {
      setFieldErrors(validation.errors);

      return null;
    }

    setFieldErrors({});

    return validation.config;
  };

  const handleDetailsSubmit = (event: FormEvent) => {
    event.preventDefault();

    const validatedConfig = validateAndGetConfig();

    if (validatedConfig === null) {
      return;
    }

    if (hasPendingAuth) {
      setAuthStep({
        starterConfig: validatedConfig,
        secrets: missingNow.secrets,
        oauthPresets: missingNow.presets,
      });

      return;
    }

    mutation.mutate(validatedConfig);
  };

  const canContinue = !mutation.isPending && id.trim() !== "";
  const detailsSubmitLabel = hasPendingAuth ? "Next: Authenticate" : "Create profile";
  const authStepSubmitLabel =
    missingCount === 0 ? "Create profile" : `Create profile (${missingCount} skipped)`;

  return (
    <>
      {authStep === null ? (
        <>
          {renderHeader({
            title,
            description:
              "Creates a git-backed profile directory, copies selected starters, and loads it into the daemon.",
          })}
          <form onSubmit={handleDetailsSubmit} className="flex min-h-0 flex-1 flex-col">
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
                <div className="text-sm font-medium">Starters</div>
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
                    fieldErrors={fieldErrors}
                    existingSecrets={secretsQuery.data?.secrets}
                    oauthLogins={oauthStatusQuery.data?.logins}
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
                  {mutation.isPending ? "Creating…" : detailsSubmitLabel}
                </Button>
              </>,
            )}
          </form>
        </>
      ) : (
        <>
          {renderHeader({
            title: `Authenticate for ${name.trim() || id.trim()}`,
            description:
              "Configure the missing credentials for your selected starters, or finish now and configure them later in Settings.",
          })}

          <div className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1 pb-4">
              {authStep.secrets.length > 0 && (
                <div className="space-y-2.5">
                  <div className="text-xs font-medium text-muted-foreground">Starter secrets</div>
                  {authStep.secrets.map(({ starter, secret }) => (
                    <StarterSecretInlineCard
                      key={secret.key}
                      starter={starter}
                      secret={secret}
                      starterConfig={authStep.starterConfig}
                      isConfigured={!missingSecretKeys.has(secret.key)}
                    />
                  ))}
                </div>
              )}

              {authStep.oauthPresets.length > 0 && (
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-medium text-muted-foreground">
                      OAuth integrations
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      onClick={() => void oauthStatusQuery.refetch()}
                      disabled={oauthStatusQuery.isFetching}
                    >
                      <RefreshCwIcon className="size-3.5" />
                      <span>Refresh</span>
                    </Button>
                  </div>
                  {authStep.oauthPresets.map((presetId) => {
                    const preset = oauthPresets.find((entry) => entry.id === presetId);

                    if (preset === undefined) {
                      return null;
                    }

                    return (
                      <OAuthPresetInlineCard
                        key={presetId}
                        preset={preset}
                        activeLogin={findPresetLogin(oauthLogins, presetId)}
                      />
                    );
                  })}
                </div>
              )}

              {selectedSummaries.some(needsSetupNote) && (
                <div className="space-y-1.5 rounded-xl border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
                  <div className="font-medium text-foreground">Additional VM setup</div>
                  <StarterSetupNotes starters={selectedSummaries} />
                </div>
              )}
              {mutation.error !== null && <FieldError>{mutation.error.message}</FieldError>}
            </div>
            {renderFooter(
              <>
                <Button
                  type="button"
                  variant="outline"
                  disabled={mutation.isPending}
                  onClick={() => setAuthStep(null)}
                >
                  Back
                </Button>
                <Button
                  type="button"
                  disabled={mutation.isPending}
                  onClick={() => mutation.mutate(authStep.starterConfig)}
                >
                  {mutation.isPending ? "Creating…" : authStepSubmitLabel}
                </Button>
              </>,
            )}
          </div>
        </>
      )}
    </>
  );
}
