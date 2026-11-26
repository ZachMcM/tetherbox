import { useState, type KeyboardEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
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
import { SidebarTrigger } from "@tetherbox/ui/components/sidebar";
import { CreateProfileDialog } from "../components/create-profile-dialog.tsx";
import { appClient, queryKeys, unwrapJson } from "../lib/api.ts";
import { usePreferences } from "../lib/preferences.ts";
import { profilesQueryOptions } from "../lib/queries.ts";

interface HomeSearch {
  profile?: string;
}

function HomePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const requestedProfile = Route.useSearch({ select: (search) => search.profile });
  const { preferences } = usePreferences();

  const [createOpen, setCreateOpen] = useState(false);
  const [selectedProfileId, setSelectedProfileId] = useState<string | undefined>(undefined);
  const [draft, setDraft] = useState("");

  const profilesQuery = useQuery(profilesQueryOptions);
  const profiles = profilesQuery.data?.profiles ?? [];

  const activeProfileId =
    profiles.find((p) => p.id === selectedProfileId)?.id ??
    profiles.find((p) => p.id === requestedProfile)?.id ??
    profiles[0]?.id;

  const startConversationMutation = useMutation({
    mutationFn: async ({ profileId, text }: { profileId: string; text: string }) => {
      const { session } = await unwrapJson(
        await appClient.profiles[":profileId"].sessions.$post({
          param: { profileId },
          json: {},
        }),
      );

      await queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
      await unwrapJson(
        await appClient.sessions[":sessionId"].messages.$post({
          param: { sessionId: session.id },
          json: { text },
        }),
      );

      return session;
    },
    onSuccess: (session) => {
      setDraft("");
      void navigate({ to: "/sessions/$sessionId", params: { sessionId: session.id } });
    },
  });

  const submit = () => {
    const trimmed = draft.trim();

    if (trimmed === "" || activeProfileId === undefined || startConversationMutation.isPending) {
      return;
    }

    startConversationMutation.mutate({ profileId: activeProfileId, text: trimmed });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter") {
      return;
    }

    const shouldSend =
      preferences.sendShortcut === "enter"
        ? !event.shiftKey && !event.metaKey && !event.ctrlKey
        : event.metaKey || event.ctrlKey;

    if (shouldSend) {
      event.preventDefault();
      submit();
    }
  };

  const placeholder =
    preferences.sendShortcut === "enter"
      ? "Start a conversation… (Enter to send, Shift+Enter for newline)"
      : "Start a conversation… (Cmd+Enter to send)";

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
        <SidebarTrigger />
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
                Pick a profile below and send a message to launch a new Pi session.
              </p>
            </div>

            <InputGroup className="rounded-3xl bg-muted/60">
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
                <NativeSelect
                  aria-label="Target profile"
                  size="sm"
                  value={activeProfileId ?? ""}
                  onChange={(event) => {
                    const nextId = event.target.value;

                    setSelectedProfileId(nextId);
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

                <InputGroupButton
                  variant="default"
                  size="icon-sm"
                  onClick={submit}
                  disabled={
                    startConversationMutation.isPending ||
                    draft.trim() === "" ||
                    activeProfileId === undefined
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
          setSelectedProfileId(profileId);
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
