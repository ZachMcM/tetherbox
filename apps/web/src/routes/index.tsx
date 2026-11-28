import { useState, type KeyboardEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import type { ModelSelection } from "@tetherbox/core/app";
import { MessageSquarePlusIcon, PlusIcon } from "lucide-react";
import { Buddy } from "@tetherbox/ui/components/buddy";
import { Button } from "@tetherbox/ui/components/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@tetherbox/ui/components/empty";
import {
  PromptInput,
  PromptInputActions,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@tetherbox/ui/components/prompt-input";
import { Separator } from "@tetherbox/ui/components/separator";
import { SidebarTrigger } from "@tetherbox/ui/components/sidebar";
import {
  AttachmentList,
  AttachmentButton,
  useComposerAttachments,
} from "../components/composer-attachments.tsx";
import { CreateProfileDialog } from "../components/create-profile-dialog.tsx";
import { ModelPicker, resolveAvailableModel } from "../components/model-picker.tsx";
import { ProfileSelect } from "../components/profile-select.tsx";
import { appClient, queryKeys, unwrapJson } from "../lib/api.ts";
import { isSendShortcutEvent, usePreferences } from "../lib/preferences.ts";
import {
  appSettingsQueryOptions,
  llmModelsQueryOptions,
  profilesQueryOptions,
} from "../lib/queries.ts";

interface HomeSearch {
  profile?: string;
}

function HomePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const requestedProfile = Route.useSearch({ select: (search) => search.profile });
  const { preferences } = usePreferences();

  const [createOpen, setCreateOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [chosenModel, setChosenModel] = useState<ModelSelection | null>(null);
  const attachments = useComposerAttachments();

  const profilesQuery = useQuery(profilesQueryOptions);
  const settingsQuery = useQuery(appSettingsQueryOptions);
  const modelsQuery = useQuery(llmModelsQueryOptions);

  const profiles = profilesQuery.data?.profiles ?? [];
  const models = modelsQuery.data?.models ?? [];

  const activeProfile = profiles.find((profile) => profile.id === requestedProfile) ?? profiles[0];
  const activeProfileId = activeProfile?.id;

  const activeModel = resolveAvailableModel(models, [
    chosenModel,
    activeProfile?.model,
    settingsQuery.data?.defaultModel,
  ]);

  const startConversationMutation = useMutation({
    mutationFn: async ({
      profileId,
      text,
      model,
    }: {
      profileId: string;
      text: string;
      model: ModelSelection;
    }) => {
      const { session } = await unwrapJson(
        await appClient.profiles[":profileId"].sessions.$post({
          param: { profileId },
          json: { prompt: text, model },
        }),
      );

      return session;
    },
    onSuccess: (session) => {
      setDraft("");
      attachments.clear();
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
      void navigate({ to: "/sessions/$sessionId", params: { sessionId: session.id } });
    },
  });

  const submit = () => {
    const trimmed = draft.trim();

    if (
      trimmed === "" ||
      activeProfileId === undefined ||
      activeModel === null ||
      startConversationMutation.isPending
    ) {
      return;
    }

    // TODO: Upload attachments once turns accept files.
    startConversationMutation.mutate({
      profileId: activeProfileId,
      text: trimmed,
      model: activeModel,
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (isSendShortcutEvent(event, preferences.sendShortcut)) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex h-16 shrink-0 items-center gap-2 px-4 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
        <SidebarTrigger className="-ml-1" />
        <Separator
          orientation="vertical"
          className="mr-2 data-vertical:h-4 data-vertical:self-center"
        />
        <span className="text-sm font-medium text-muted-foreground">New conversation</span>
      </header>

      <div className="flex flex-1 items-center justify-center p-6">
        {profilesQuery.isPending ? null : activeProfile === undefined ? (
          <Empty className="max-w-md border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <MessageSquarePlusIcon />
              </EmptyMedia>
              <EmptyTitle>Create your first profile</EmptyTitle>
              <EmptyDescription>
                Profiles keep separate memory and tools for each part of your life, like work and
                side projects.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button onClick={() => setCreateOpen(true)}>
                <PlusIcon data-icon="inline-start" />
                <span>New profile</span>
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          <div className="w-full max-w-2xl space-y-6">
            <div className="flex flex-col items-center gap-4 text-center">
              <Buddy {...activeProfile.buddy} size={56} />
              <h1 className="font-heading text-2xl font-medium tracking-tight text-balance">
                Hey, what are we working on?
              </h1>
            </div>

            <PromptInput onSubmit={submit} {...attachments.dropTarget}>
              <AttachmentList attachments={attachments.attachments} onRemove={attachments.remove} />
              <PromptInputTextarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={onKeyDown}
                onPaste={attachments.onPaste}
                placeholder={`Ask ${activeProfile.name} anything...`}
                rows={3}
                className="min-h-20"
                disabled={startConversationMutation.isPending}
              />
              <PromptInputFooter>
                <PromptInputTools>
                  <AttachmentButton onFiles={attachments.add} />
                  <ProfileSelect
                    profiles={profiles}
                    value={activeProfile.id}
                    onChange={(nextId) =>
                      void navigate({
                        to: "/",
                        search: (prev) => ({ ...prev, profile: nextId }),
                        replace: true,
                      })
                    }
                    onCreateProfile={() => setCreateOpen(true)}
                  />
                </PromptInputTools>
                <PromptInputActions>
                  <ModelPicker
                    variant="ghost"
                    side="top"
                    align="end"
                    models={models}
                    value={activeModel}
                    onChange={setChosenModel}
                    onConfigureProviders={() =>
                      void navigate({
                        to: ".",
                        search: (prev) => ({ ...prev, settings: "providers" }),
                      })
                    }
                  />
                  <PromptInputSubmit
                    disabled={
                      startConversationMutation.isPending ||
                      draft.trim() === "" ||
                      activeModel === null
                    }
                  />
                </PromptInputActions>
              </PromptInputFooter>
            </PromptInput>

            {startConversationMutation.error !== null && (
              <p className="px-2 text-xs text-destructive">
                {startConversationMutation.error.message}
              </p>
            )}
          </div>
        )}
      </div>

      <CreateProfileDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(profileId) => {
          void navigate({ to: "/", search: (prev) => ({ ...prev, profile: profileId }) });
        }}
      />
    </div>
  );
}

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): HomeSearch =>
    typeof search.profile === "string" && search.profile !== "" ? { profile: search.profile } : {},
  component: HomePage,
});
