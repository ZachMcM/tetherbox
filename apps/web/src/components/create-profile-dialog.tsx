import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { StarterConfig } from "@tetherbox/core/app";
import { RefreshCwIcon } from "lucide-react";
import { Button } from "@tetherbox/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@tetherbox/ui/components/dialog";
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

export function CreateProfileDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (profileId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [selectedStarters, setSelectedStarters] = useState<string[]>([]);
  const [starterConfig, setStarterConfig] = useState<StarterConfig>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [authStep, setAuthStep] = useState<AuthStepSnapshot | null>(null);

  const startersQuery = useQuery({ ...startersQueryOptions, enabled: open });
  const secretsQuery = useQuery({ ...secretsQueryOptions, enabled: open });
  const oauthStatusQuery = useQuery({
    ...oauthStatusQueryOptions,
    enabled: open,
    refetchOnWindowFocus: "always",
  });

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

  const resetForm = () => {
    setId("");
    setName("");
    setSelectedStarters([]);
    setStarterConfig({});
    setFieldErrors({});
    setAuthStep(null);
  };

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
      resetForm();
      onOpenChange(false);
      onCreated(data.profile.id);
    },
  });

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      resetForm();
      mutation.reset();
    }

    onOpenChange(nextOpen);
  };

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

  const handleSkipAndCreate = () => {
    const validatedConfig = validateAndGetConfig();

    if (validatedConfig !== null) {
      mutation.mutate(validatedConfig);
    }
  };

  const canContinue = !mutation.isPending && id.trim() !== "";
  const detailsSubmitLabel = hasPendingAuth ? "Next: Authenticate" : "Create profile";
  const authStepSubmitLabel =
    missingCount === 0 ? "Create profile" : `Create profile (${missingCount} skipped)`;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-xl">
        {authStep === null ? (
          <>
            <DialogHeader>
              <DialogTitle>New profile</DialogTitle>
              <DialogDescription>
                Creates a git-backed profile directory, copies selected starters, and loads it into
                the daemon.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleDetailsSubmit} className="flex min-h-0 flex-1 flex-col gap-4">
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
                <div className="grid grid-cols-2 gap-3">
                  <Field>
                    <FieldLabel htmlFor="profile-id">Profile ID</FieldLabel>
                    <Input
                      id="profile-id"
                      placeholder="work"
                      value={id}
                      onChange={(event) => setId(event.target.value)}
                      pattern="[A-Za-z0-9][A-Za-z0-9-]{0,62}"
                      title="Letters, numbers, and hyphens"
                      required
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="profile-name">Display name</FieldLabel>
                    <Input
                      id="profile-name"
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
                      idPrefix="create-profile"
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
              </div>

              {mutation.error !== null && <FieldError>{mutation.error.message}</FieldError>}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
                  Cancel
                </Button>
                {hasPendingAuth && (
                  <Button
                    type="button"
                    variant="destructive-outline"
                    disabled={!canContinue}
                    onClick={handleSkipAndCreate}
                  >
                    {mutation.isPending ? "Creating…" : "Skip & create"}
                  </Button>
                )}
                <Button type="submit" disabled={!canContinue}>
                  {mutation.isPending ? "Creating…" : detailsSubmitLabel}
                </Button>
              </DialogFooter>
            </form>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Authenticate for {name.trim() || id.trim()}</DialogTitle>
              <DialogDescription>
                Configure the missing credentials for your selected starters, or finish now and
                configure them later in Settings.
              </DialogDescription>
            </DialogHeader>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
              {authStep.secrets.length > 0 && (
                <div className="space-y-2.5">
                  <div className="text-xs font-medium text-muted-foreground">Starter secrets</div>
                  {authStep.secrets.map(({ starterId, secret }) => (
                    <StarterSecretInlineCard
                      key={secret.key}
                      starterId={starterId}
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
            </div>

            {mutation.error !== null && <FieldError>{mutation.error.message}</FieldError>}
            <DialogFooter>
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
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
