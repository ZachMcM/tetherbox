import { useState, type KeyboardEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import type { ModelSelection } from "@tetherbox/core/app";
import { ArrowUpIcon, MessageSquarePlusIcon, PlusIcon } from "lucide-react";
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
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@tetherbox/ui/components/input-group";
import { NativeSelect, NativeSelectOption } from "@tetherbox/ui/components/native-select";
import { Separator } from "@tetherbox/ui/components/separator";
import { SidebarTrigger } from "@tetherbox/ui/components/sidebar";
import { CreateProfileDialog } from "../components/create-profile-dialog.tsx";
import { ModelPicker, resolveAvailableModel } from "../components/model-picker.tsx";
import { appClient, queryKeys, unwrapJson } from "../lib/api.ts";
import { isSendShortcutEvent, sendShortcutHint, usePreferences } from "../lib/preferences.ts";
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

  const profilesQuery = useQuery(profilesQueryOptions);
  const settingsQuery = useQuery(appSettingsQueryOptions);
  const modelsQuery = useQuery(llmModelsQueryOptions);

  const profiles = profilesQuery.data?.profiles ?? [];
  const models = modelsQuery.data?.models ?? [];

  const activeProfile = profiles.find((profile) => profile.id === requestedProfile) ?? profiles[0];
  const activeProfileId = activeProfile?.id;

  const activeModel = resolveAvailableModel(models, [
    chosenModel,
    activeProfile?.config.model,
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

    startConversationMutation.mutate({
      profileId: activeProfileId,
      text: trimmed,
      model: activeModel,
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (isSendShortcutEvent(event, preferences.sendShortcut)) {
      event.preventDefault();
      submit();
    }
  };

  const placeholder = `Start a conversation… (${sendShortcutHint(preferences.sendShortcut)})`;

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
        {profiles.length === 0 ? (
          <Empty className="max-w-md border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <MessageSquarePlusIcon />
              </EmptyMedia>
              <EmptyTitle>Create your first profile</EmptyTitle>
              <EmptyDescription>
                Profiles isolate memory, skills, modules, cron jobs, and Pi sessions.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button onClick={() => setCreateOpen(true)}>
                <PlusIcon className="size-4" />
                <span>New profile</span>
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          <div className="w-full max-w-2xl space-y-4">
            <div className="text-center">
              <h1 className="font-heading text-xl font-semibold tracking-tight">
                Start a conversation
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Pick a profile and model below to launch a new Pi session.
              </p>
            </div>

            <InputGroup className="rounded-xl">
              <InputGroupTextarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={onKeyDown}
                placeholder={placeholder}
                rows={3}
                className="max-h-48 min-h-20 resize-none px-4 py-3 text-sm"
                disabled={startConversationMutation.isPending}
              />
              <InputGroupAddon align="block-end" className="justify-between gap-2 px-3 pb-2.5">
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                  <NativeSelect
                    aria-label="Target profile"
                    size="sm"
                    value={activeProfileId ?? ""}
                    onChange={(event) => {
                      const nextId = event.target.value;

                      void navigate({
                        to: "/",
                        search: (prev) => ({ ...prev, profile: nextId }),
                        replace: true,
                      });
                    }}
                  >
                    {profiles.map((profile) => (
                      <NativeSelectOption key={profile.id} value={profile.id}>
                        {profile.config.name}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>

                  <ModelPicker
                    compact
                    side="top"
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
                </div>

                <InputGroupButton
                  variant="default"
                  size="icon-sm"
                  onClick={submit}
                  disabled={
                    startConversationMutation.isPending ||
                    draft.trim() === "" ||
                    activeProfileId === undefined ||
                    activeModel === null
                  }
                  aria-label="Send message"
                >
                  <ArrowUpIcon className="size-4" />
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>

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
