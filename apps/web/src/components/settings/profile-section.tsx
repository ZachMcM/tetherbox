import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  webhookPath,
  type OAuthPresetSummary,
  type OAuthStatusEntry,
  type ProfileDetail,
  type StarterConfig,
  type StarterSummary,
} from "@tetherbox/core/app";
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronRightIcon,
  RefreshCwIcon,
  Trash2Icon,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@tetherbox/ui/components/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@tetherbox/ui/components/alert-dialog";
import { Badge } from "@tetherbox/ui/components/badge";
import { Button } from "@tetherbox/ui/components/button";
import { Field, FieldError, FieldLabel } from "@tetherbox/ui/components/field";
import { Input } from "@tetherbox/ui/components/input";
import { Spinner } from "@tetherbox/ui/components/spinner";
import { Switch } from "@tetherbox/ui/components/switch";
import { Textarea } from "@tetherbox/ui/components/textarea";
import { toast } from "@tetherbox/ui/components/toast";
import { appClient, expectOk, queryKeys, unwrapJson } from "../../lib/api.ts";
import { CliInstallCard, type CliInstallRunner } from "../cli-setup-panels.tsx";
import {
  isStarterConfigValid,
  selectInstallEntries,
  STARTER_CATEGORY_ORDER,
  StarterConfigFields,
  starterFieldKey,
  StarterBadges,
  StarterVmSetupPanels,
  useStarterSetupState,
  validateStarterFields,
  type StarterReadiness,
} from "../profile-form-fields.tsx";
import { StarterIcon } from "../starter-icons.tsx";
import { SectionHeader, SettingGroup, SettingRow } from "./shared.tsx";

const MEMORY_LIMIT_BYTES = 8 * 1024;
const textEncoder = new TextEncoder();

function starterStatusBadge(
  starter: StarterSummary,
  enabled: boolean,
  readiness: StarterReadiness | undefined,
  starterConfig: StarterConfig,
) {
  if (readiness === undefined) {
    return null;
  }

  if (!enabled) {
    return readiness.hasVmRequirements && readiness.isVmReady ? (
      <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400">
        <CheckCircle2Icon className="size-3" />
        <span>Ready on VM</span>
      </span>
    ) : null;
  }

  if (!readiness.isStatusLoaded) {
    return <Badge variant="outline">Checking…</Badge>;
  }

  if (readiness.cliEntry?.status.kind === "error") {
    return <Badge variant="destructive">Error</Badge>;
  }

  if (readiness.needsBinaryInstall) {
    return <Badge variant="outline">Needs install</Badge>;
  }

  if (readiness.needsCliAuth) {
    return <Badge variant="outline">Needs sign-in</Badge>;
  }

  if (readiness.missingSecrets.length > 0) {
    return <Badge variant="outline">Needs secret</Badge>;
  }

  if (readiness.missingOAuthPreset !== undefined) {
    return <Badge variant="outline">Needs OAuth</Badge>;
  }

  if (!isStarterConfigValid(starter, starterConfig)) {
    return <Badge variant="outline">Needs config</Badge>;
  }

  return (
    <Badge variant="secondary" className="gap-1">
      <CheckCircle2Icon className="size-3 text-emerald-600 dark:text-emerald-400" />
      <span>Ready</span>
    </Badge>
  );
}

function ProfileNameRow({
  profile,
  onSaved,
}: {
  profile: ProfileDetail;
  onSaved: (updated: { profile: ProfileDetail }) => void;
}) {
  const [name, setName] = useState(profile.config.name);
  const trimmed = name.trim();
  const dirty = trimmed !== "" && trimmed !== profile.config.name;

  const mutation = useMutation({
    mutationFn: async () =>
      unwrapJson(
        await appClient.profiles[":profileId"].$patch({
          param: { profileId: profile.id },
          json: { name: trimmed },
        }),
      ),
    onSuccess: (data) => {
      onSaved(data);
      toast.add({ type: "success", title: "Profile name updated" });
    },
  });

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();

    if (dirty) {
      mutation.mutate();
    }
  };

  return (
    <div className="space-y-2 px-4 py-3">
      <form onSubmit={handleSubmit} className="flex items-end gap-2">
        <Field className="flex-1">
          <FieldLabel htmlFor={`profile-name-${profile.id}`}>Display name</FieldLabel>
          <Input
            id={`profile-name-${profile.id}`}
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
        </Field>
        {dirty && (
          <Button type="submit" size="sm" disabled={mutation.isPending}>
            {mutation.isPending ? "Saving…" : "Save"}
          </Button>
        )}
      </form>
      {mutation.error !== null && <FieldError>{mutation.error.message}</FieldError>}
    </div>
  );
}

function StarterCatalogRow({
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

function ProfileMemoryEditor({
  profileId,
  initialContent,
  onDone,
}: {
  profileId: string;
  initialContent: string;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [content, setContent] = useState(initialContent);
  const bytes = textEncoder.encode(content).byteLength;
  const overLimit = bytes > MEMORY_LIMIT_BYTES;

  const saveMutation = useMutation({
    mutationFn: async () =>
      unwrapJson(
        await appClient.profiles[":profileId"].memory.$put({
          param: { profileId },
          json: { content },
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.profile(profileId) });
      onDone();
    },
  });

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    saveMutation.mutate();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <Textarea
        value={content}
        onChange={(event) => setContent(event.target.value)}
        className="min-h-48 font-mono text-xs"
        placeholder="# Profile memory"
      />
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className={overLimit ? "text-destructive" : "text-muted-foreground"}>
          {bytes.toLocaleString()} / {MEMORY_LIMIT_BYTES.toLocaleString()} bytes loaded per turn
        </span>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="xs" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" size="xs" disabled={saveMutation.isPending}>
            {saveMutation.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
      {saveMutation.error !== null && <FieldError>{saveMutation.error.message}</FieldError>}
    </form>
  );
}

export function ProfileSettingsSection({
  profileId,
  onBack,
  onDeleted,
}: {
  profileId: string;
  onDeleted: () => void;
  onBack?: (() => void) | undefined;
}) {
  const queryClient = useQueryClient();
  const [editingMemory, setEditingMemory] = useState(false);
  const [expandedStarters, setExpandedStarters] = useState<Record<string, boolean>>({});
  const [pendingEnableIds, setPendingEnableIds] = useState<Record<string, boolean>>({});

  const {
    starters,
    startersQuery,
    oauthPresets,
    oauthLogins,
    readinessById,
    installRunner,
    isRefreshing,
    statusError,
    refreshStatus,
  } = useStarterSetupState();

  const profileQuery = useQuery({
    queryKey: queryKeys.profile(profileId),
    queryFn: async () =>
      unwrapJson(await appClient.profiles[":profileId"].$get({ param: { profileId } })),
  });

  const applyProfileUpdate = (data: { profile: ProfileDetail }) => {
    queryClient.setQueryData(queryKeys.profile(profileId), data);
    void queryClient.invalidateQueries({ queryKey: queryKeys.profiles });
  };

  const updateStartersMutation = useMutation({
    mutationFn: async (input: { starters: string[]; starterConfig: StarterConfig }) =>
      unwrapJson(
        await appClient.profiles[":profileId"].$patch({
          param: { profileId },
          json: input,
        }),
      ),
    onSuccess: applyProfileUpdate,
  });

  const [updatingStarterIds, setUpdatingStarterIds] = useState<Record<string, boolean>>({});

  const updateStarterMutation = useMutation({
    onMutate: (starter: StarterSummary) => {
      setUpdatingStarterIds((prev) => ({ ...prev, [starter.id]: true }));
    },
    onSettled: (_data, _error, starter) => {
      setUpdatingStarterIds((prev) => ({ ...prev, [starter.id]: false }));
    },
    mutationFn: async (starter: StarterSummary) =>
      unwrapJson(
        await appClient.profiles[":profileId"].starters[":starterId"].update.$post({
          param: { profileId, starterId: starter.id },
        }),
      ),
    onSuccess: (data, starter) => {
      applyProfileUpdate(data);
      toast.add({ type: "success", title: `Updated ${starter.name} from the library` });
    },
  });

  const clearModelOverrideMutation = useMutation({
    mutationFn: async () =>
      unwrapJson(
        await appClient.profiles[":profileId"].$patch({
          param: { profileId },
          json: { model: null },
        }),
      ),
    onSuccess: applyProfileUpdate,
  });

  const cancelPollMutation = useMutation({
    mutationFn: async (name: string) =>
      unwrapJson(
        await appClient.profiles[":profileId"]["poll-jobs"][":name"].$delete({
          param: { profileId, name },
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.profile(profileId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.profiles });
    },
  });

  const cancelReminderMutation = useMutation({
    mutationFn: async (name: string) =>
      unwrapJson(
        await appClient.profiles[":profileId"].reminders[":name"].$delete({
          param: { profileId, name },
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.profile(profileId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.profiles });
    },
  });

  const deleteProfileMutation = useMutation({
    mutationFn: async () => {
      await expectOk(await appClient.profiles[":profileId"].$delete({ param: { profileId } }));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.profiles });
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
      queryClient.removeQueries({ queryKey: queryKeys.profile(profileId) });
      onDeleted();
    },
  });

  if (profileQuery.isPending) {
    return (
      <div className="flex flex-1 items-center justify-center py-12">
        <Spinner className="size-5 text-muted-foreground" />
      </div>
    );
  }

  const profile = profileQuery.data?.profile;

  if (profileQuery.error !== null || profile === undefined) {
    return (
      <div className="text-sm text-muted-foreground">
        {profileQuery.error?.message ?? "Profile not found."}
      </div>
    );
  }

  const enabledSet = new Set(profile.config.starters);
  const updateSet = new Set(profile.starterUpdates);
  const enabledSummaries = starters.filter((starter) => enabledSet.has(starter.id));
  const missingInstallEntries = selectInstallEntries(
    enabledSummaries,
    readinessById,
    installRunner,
  );

  const nextOrderedStarters = (nextSet: Set<string>): string[] =>
    starters.filter((starter) => nextSet.has(starter.id)).map((starter) => starter.id);

  const handleToggleStarter = (starter: StarterSummary, checked: boolean) => {
    if (!checked) {
      if (pendingEnableIds[starter.id]) {
        setPendingEnableIds((prev) => ({ ...prev, [starter.id]: false }));
        setExpandedStarters((prev) => ({ ...prev, [starter.id]: false }));

        return;
      }

      const nextSet = new Set(profile.config.starters);

      nextSet.delete(starter.id);

      const nextConfig: Record<string, Record<string, string>> = {};

      for (const [id, fields] of Object.entries(profile.config.starterConfig)) {
        if (nextSet.has(id)) {
          nextConfig[id] = fields;
        }
      }

      setExpandedStarters((prev) => ({ ...prev, [starter.id]: false }));
      updateStartersMutation.mutate({
        starters: nextOrderedStarters(nextSet),
        starterConfig: nextConfig,
      });

      return;
    }

    if (starter.configFields.length > 0) {
      setPendingEnableIds((prev) => ({ ...prev, [starter.id]: true }));
      setExpandedStarters((prev) => ({ ...prev, [starter.id]: true }));

      return;
    }

    const nextSet = new Set(profile.config.starters);

    nextSet.add(starter.id);

    const readiness = readinessById.get(starter.id);
    const shouldExpand =
      readiness !== undefined &&
      (!readiness.isVmReady || readiness.hasUnverifiedCliAuth || starter.setupNote !== undefined);

    if (shouldExpand) {
      setExpandedStarters((prev) => ({ ...prev, [starter.id]: true }));
    }

    updateStartersMutation.mutate({
      starters: nextOrderedStarters(nextSet),
      starterConfig: profile.config.starterConfig,
    });
  };

  const handleSaveStarterConfig = async (
    starter: StarterSummary,
    values: Record<string, string>,
  ) => {
    const nextSet = new Set(profile.config.starters);

    nextSet.add(starter.id);

    const nextConfig: StarterConfig = {
      ...profile.config.starterConfig,
      [starter.id]: values,
    };

    await updateStartersMutation.mutateAsync({
      starters: nextOrderedStarters(nextSet),
      starterConfig: nextConfig,
    });

    setPendingEnableIds((prev) => ({ ...prev, [starter.id]: false }));

    const readiness = readinessById.get(starter.id);

    if (
      readiness?.isVmReady &&
      !readiness.hasUnverifiedCliAuth &&
      starter.setupNote === undefined
    ) {
      setExpandedStarters((prev) => ({ ...prev, [starter.id]: false }));
    }

    toast.add({
      type: "success",
      title: enabledSet.has(starter.id)
        ? `Updated ${starter.name} settings`
        : `Enabled ${starter.name}`,
    });
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        onBack={onBack}
        title={profile.config.name}
        description={`Profile ID: ${profile.id}`}
      />

      {profile.issues.length > 0 && (
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertTitle>Profile validation issues</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {profile.issues.map((issue) => (
                <li key={`${issue.file}:${issue.message}`}>
                  <code>{issue.file}</code>: {issue.message}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <SettingGroup title="Profile">
        <ProfileNameRow key={profile.config.name} profile={profile} onSaved={applyProfileUpdate} />
        {profile.config.model !== undefined && (
          <SettingRow
            title="Pinned model override"
            description={`${profile.config.model.provider}/${profile.config.model.id} (${profile.config.model.auth})`}
            control={
              <Button
                variant="outline"
                size="xs"
                disabled={clearModelOverrideMutation.isPending}
                onClick={() => clearModelOverrideMutation.mutate()}
              >
                Use default
              </Button>
            }
          />
        )}
      </SettingGroup>

      {missingInstallEntries.length > 0 && (
        <CliInstallCard entries={missingInstallEntries} runner={installRunner} />
      )}

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-medium">Starters</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Toggle integrations, coding harnesses, and CLIs for this profile. Binaries and
              credentials persist across the VM.
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={refreshStatus}
            disabled={isRefreshing}
          >
            <RefreshCwIcon className="size-3.5" />
            <span>Refresh</span>
          </Button>
        </div>

        {startersQuery.isPending ? (
          <div className="flex justify-center py-6">
            <Spinner className="size-4 text-muted-foreground" />
          </div>
        ) : startersQuery.error !== null ? (
          <FieldError>{startersQuery.error.message}</FieldError>
        ) : (
          <div className="space-y-4">
            {STARTER_CATEGORY_ORDER.map(({ category, label }) => {
              const group = starters.filter((starter) => starter.category === category);

              if (group.length === 0) {
                return null;
              }

              return (
                <SettingGroup key={category} title={label}>
                  {group.map((starter) => (
                    <StarterCatalogRow
                      key={`${profile.id}-${starter.id}`}
                      profile={profile}
                      starter={starter}
                      enabled={enabledSet.has(starter.id)}
                      readiness={readinessById.get(starter.id)}
                      oauthPresets={oauthPresets}
                      oauthLogins={oauthLogins}
                      installRunner={installRunner}
                      expanded={expandedStarters[starter.id] === true}
                      pendingEnable={pendingEnableIds[starter.id] === true}
                      busy={updateStartersMutation.isPending}
                      updateAvailable={updateSet.has(starter.id)}
                      updating={updatingStarterIds[starter.id] === true}
                      onUpdate={() => updateStarterMutation.mutate(starter)}
                      onToggleExpand={() =>
                        setExpandedStarters((prev) => ({
                          ...prev,
                          [starter.id]: !prev[starter.id],
                        }))
                      }
                      onToggleSwitch={(checked) => handleToggleStarter(starter, checked)}
                      onSaveConfig={(values) => handleSaveStarterConfig(starter, values)}
                      onCancelPending={() => {
                        setPendingEnableIds((prev) => ({ ...prev, [starter.id]: false }));
                        setExpandedStarters((prev) => ({ ...prev, [starter.id]: false }));
                      }}
                    />
                  ))}
                </SettingGroup>
              );
            })}
          </div>
        )}

        {statusError !== null && <FieldError>{statusError.message}</FieldError>}
        {updateStartersMutation.error !== null && (
          <FieldError>{updateStartersMutation.error.message}</FieldError>
        )}
        {updateStarterMutation.error !== null && (
          <FieldError>{updateStarterMutation.error.message}</FieldError>
        )}
      </section>

      <section className="space-y-2.5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-medium">MEMORY.md</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Loaded into every turn for this profile.
            </p>
          </div>
          {!editingMemory && (
            <Button variant="outline" size="xs" onClick={() => setEditingMemory(true)}>
              Edit
            </Button>
          )}
        </div>
        {editingMemory ? (
          <ProfileMemoryEditor
            key={profile.id}
            profileId={profile.id}
            initialContent={profile.memory}
            onDone={() => setEditingMemory(false)}
          />
        ) : (
          <pre className="max-h-48 overflow-auto rounded-xl border border-border bg-muted/50 p-3 font-mono text-xs whitespace-pre-wrap">
            {profile.memory || "(empty)"}
          </pre>
        )}
      </section>

      <SettingGroup title="Automation">
        <SettingRow
          title="Cron jobs"
          description={
            profile.cron.length > 0
              ? profile.cron.map(({ name, job }) => `${name} (${job.schedule})`).join(", ")
              : undefined
          }
          control={<Badge variant="outline">{profile.cron.length}</Badge>}
        />
        <SettingRow
          title="Webhooks"
          description={
            profile.webhooks.length > 0
              ? profile.webhooks
                  .map(
                    ({ name, webhook }) =>
                      `${webhookPath(profile.id, name)} (${webhook.verify.kind})`,
                  )
                  .join(", ")
              : undefined
          }
          control={<Badge variant="outline">{profile.webhooks.length}</Badge>}
        />
        {profile.pollJobs.map((job) => (
          <SettingRow
            key={`poll-${job.name}`}
            title={`Poll: ${job.name}`}
            description={`Every ${job.job.intervalSeconds}s`}
            control={
              <Button
                variant="outline"
                size="xs"
                disabled={cancelPollMutation.isPending}
                onClick={() => cancelPollMutation.mutate(job.name)}
              >
                Cancel
              </Button>
            }
          />
        ))}
        {profile.reminders.map((reminder) => (
          <SettingRow
            key={`reminder-${reminder.name}`}
            title={`Reminder: ${reminder.name}`}
            description={`Due ${new Date(reminder.fireAt).toLocaleString()}`}
            control={
              <Button
                variant="outline"
                size="xs"
                disabled={cancelReminderMutation.isPending}
                onClick={() => cancelReminderMutation.mutate(reminder.name)}
              >
                Cancel
              </Button>
            }
          />
        ))}
      </SettingGroup>

      <SettingGroup title="Danger zone">
        <SettingRow
          title="Delete profile"
          description="Removes this profile directory, its sessions, poll jobs, and reminders."
          control={
            <AlertDialog>
              <AlertDialogTrigger
                render={
                  <Button
                    variant="destructive-outline"
                    size="xs"
                    disabled={deleteProfileMutation.isPending}
                  />
                }
              >
                <Trash2Icon className="size-3.5" />
                <span>Delete</span>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete {profile.config.name}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This permanently deletes profile <code>{profile.id}</code> and all of its
                    conversations.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    variant="destructive"
                    onClick={() => deleteProfileMutation.mutate()}
                    disabled={deleteProfileMutation.isPending}
                  >
                    {deleteProfileMutation.isPending ? "Deleting…" : "Delete profile"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          }
        />
      </SettingGroup>
      {deleteProfileMutation.error !== null && (
        <FieldError>{deleteProfileMutation.error.message}</FieldError>
      )}
    </div>
  );
}
