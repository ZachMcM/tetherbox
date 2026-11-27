import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ProfileDetail, StarterConfig } from "@tetherbox/core/app";
import { AlertCircleIcon, RefreshCwIcon, Trash2Icon } from "lucide-react";
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
import { Textarea } from "@tetherbox/ui/components/textarea";
import { appClient, expectOk, queryKeys, unwrapJson } from "../../lib/api.ts";
import {
  oauthStatusQueryOptions,
  secretsQueryOptions,
  startersQueryOptions,
} from "../../lib/queries.ts";
import { OAuthPresetInlineCard, StarterSecretInlineCard } from "../auth-setup-panels.tsx";
import { StarterIcon } from "../starter-icons.tsx";
import {
  collectMissingStarterAuth,
  StarterSelectionFields,
  validateSelectedStarterConfig,
} from "../profile-form-fields.tsx";
import { SectionHeader, SettingGroup, SettingRow } from "./shared.tsx";
import type { SettingsTab } from "./types.ts";

const MEMORY_LIMIT_BYTES = 8 * 1024;
const textEncoder = new TextEncoder();

function ProfileConfigEditor({
  profile,
  onDone,
  onOpenSettingsTab,
}: {
  profile: ProfileDetail;
  onDone: () => void;
  onOpenSettingsTab: (tab: SettingsTab) => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(profile.config.name);
  const [selectedStarters, setSelectedStarters] = useState<string[]>([...profile.config.starters]);
  const [starterConfig, setStarterConfig] = useState<StarterConfig>(profile.config.starterConfig);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const startersQuery = useQuery(startersQueryOptions);
  const secretsQuery = useQuery(secretsQueryOptions);
  const oauthStatusQuery = useQuery(oauthStatusQueryOptions);

  const starters = startersQuery.data?.starters ?? [];

  const updateMutation = useMutation({
    mutationFn: async (validatedConfig: StarterConfig) =>
      unwrapJson(
        await appClient.profiles[":profileId"].$patch({
          param: { profileId: profile.id },
          json: {
            name: name.trim(),
            starters: selectedStarters,
            starterConfig: validatedConfig,
          },
        }),
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.profile(profile.id), data);
      void queryClient.invalidateQueries({ queryKey: queryKeys.profiles });
      onDone();
    },
  });

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();

    const validation = validateSelectedStarterConfig(starters, selectedStarters, starterConfig);

    if (!validation.ok) {
      setFieldErrors(validation.errors);

      return;
    }

    setFieldErrors({});
    updateMutation.mutate(validation.config);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Field>
        <FieldLabel htmlFor={`edit-${profile.id}-name`}>Display name</FieldLabel>
        <Input
          id={`edit-${profile.id}-name`}
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
        />
      </Field>

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
            idPrefix={`edit-${profile.id}`}
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
            onOpenSettingsTab={onOpenSettingsTab}
          />
        )}
      </div>

      {updateMutation.error !== null && <FieldError>{updateMutation.error.message}</FieldError>}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={updateMutation.isPending || name.trim() === ""}>
          {updateMutation.isPending ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </form>
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

function ProfileMissingAuthSection({ profile }: { profile: ProfileDetail }) {
  const startersQuery = useQuery(startersQueryOptions);
  const secretsQuery = useQuery(secretsQueryOptions);
  const oauthStatusQuery = useQuery({
    ...oauthStatusQueryOptions,
    refetchOnWindowFocus: "always",
  });

  if (
    startersQuery.data === undefined ||
    secretsQuery.data === undefined ||
    oauthStatusQuery.data === undefined
  ) {
    return null;
  }

  const enabledSet = new Set(profile.config.starters);
  const oauthPresets = oauthStatusQuery.data.presets;
  const { secrets: missingSecrets, presets: missingPresets } = collectMissingStarterAuth({
    starters: startersQuery.data.starters.filter((starter) => enabledSet.has(starter.id)),
    secrets: secretsQuery.data.secrets,
    oauthLogins: oauthStatusQuery.data.logins,
  });

  if (missingSecrets.length === 0 && missingPresets.length === 0) {
    return null;
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-medium">Credentials needed</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Finish authenticating the starters enabled on this profile.
          </p>
        </div>
        {missingPresets.length > 0 && (
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
        )}
      </div>

      <div className="space-y-3">
        {missingSecrets.map(({ starter, secret }) => (
          <StarterSecretInlineCard
            key={secret.key}
            starter={starter}
            secret={secret}
            starterConfig={profile.config.starterConfig}
            isConfigured={false}
          />
        ))}

        {missingPresets.map((presetId) => {
          const preset = oauthPresets.find((entry) => entry.id === presetId);

          if (preset === undefined) {
            return null;
          }

          return <OAuthPresetInlineCard key={presetId} preset={preset} />;
        })}
      </div>
    </section>
  );
}

export function ProfileSettingsSection({
  profileId,
  onBack,
  onOpenSettingsTab,
  onDeleted,
}: {
  profileId: string;
  onOpenSettingsTab: (tab: SettingsTab) => void;
  onDeleted: () => void;
  onBack?: (() => void) | undefined;
}) {
  const queryClient = useQueryClient();
  const [editingConfig, setEditingConfig] = useState(false);
  const [editingMemory, setEditingMemory] = useState(false);

  const startersQuery = useQuery(startersQueryOptions);
  const profileQuery = useQuery({
    queryKey: queryKeys.profile(profileId),
    queryFn: async () =>
      unwrapJson(await appClient.profiles[":profileId"].$get({ param: { profileId } })),
  });

  const clearModelOverrideMutation = useMutation({
    mutationFn: async () =>
      unwrapJson(
        await appClient.profiles[":profileId"].$patch({
          param: { profileId },
          json: { model: null },
        }),
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.profile(profileId), data);
      void queryClient.invalidateQueries({ queryKey: queryKeys.profiles });
    },
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

  const startersById = new Map(
    (startersQuery.data?.starters ?? []).map((starter) => [starter.id, starter]),
  );
  const starterName = (id: string) => startersById.get(id)?.name ?? id;
  const starterConfigEntries = Object.entries(profile.config.starterConfig).flatMap(
    ([starterId, fields]) =>
      Object.entries(fields).map(([key, value]) => ({ starterId, key, value })),
  );

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

      {editingConfig ? (
        <section className="space-y-2">
          <h3 className="text-sm font-medium">Profile & starters</h3>
          <ProfileConfigEditor
            key={profile.id}
            profile={profile}
            onDone={() => setEditingConfig(false)}
            onOpenSettingsTab={onOpenSettingsTab}
          />
        </section>
      ) : (
        <SettingGroup
          title="Profile & starters"
          action={
            <Button variant="outline" size="xs" onClick={() => setEditingConfig(true)}>
              Edit
            </Button>
          }
        >
          <SettingRow
            title="Starters"
            control={
              profile.config.starters.length === 0 ? (
                <span className="text-xs text-muted-foreground">None enabled</span>
              ) : (
                <div className="flex flex-wrap justify-end gap-1">
                  {profile.config.starters.map((id) => {
                    const starter = startersById.get(id);

                    return (
                      <Badge key={id} variant="secondary" className="gap-1">
                        {starter !== undefined && (
                          <StarterIcon starter={starter} className="size-3" />
                        )}
                        <span>{starterName(id)}</span>
                      </Badge>
                    );
                  })}
                </div>
              )
            }
          />
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
          {starterConfigEntries.length > 0 && (
            <div className="space-y-1 px-4 py-3 text-xs">
              <div className="font-medium text-muted-foreground">Starter settings</div>
              {starterConfigEntries.map((entry) => (
                <div
                  key={`${entry.starterId}.${entry.key}`}
                  className="flex items-center justify-between gap-4"
                >
                  <span className="text-muted-foreground">
                    {starterName(entry.starterId)} · <code>{entry.key}</code>
                  </span>
                  <span className="truncate font-mono">{entry.value}</span>
                </div>
              ))}
            </div>
          )}
        </SettingGroup>
      )}

      {!editingConfig && <ProfileMissingAuthSection profile={profile} />}

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
                    ({ name, webhook }) => `/hooks/${profile.id}/${name} (${webhook.verify.kind})`,
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
