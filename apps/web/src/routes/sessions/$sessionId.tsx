import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import type { ModelSelection } from "@tetherbox/core/app";
import { Trash2Icon } from "lucide-react";
import { Badge } from "@tetherbox/ui/components/badge";
import { Button } from "@tetherbox/ui/components/button";
import { Separator } from "@tetherbox/ui/components/separator";
import { SidebarTrigger } from "@tetherbox/ui/components/sidebar";
import { Spinner } from "@tetherbox/ui/components/spinner";
import { resolveAvailableModel } from "../../components/model-picker.tsx";
import { SessionComposer } from "../../components/session-composer.tsx";
import { SessionTranscript } from "../../components/session-transcript.tsx";
import { appClient, expectOk, queryKeys, unwrapJson } from "../../lib/api.ts";
import { useLiveTurn } from "../../lib/live-store.ts";
import {
  appSettingsQueryOptions,
  llmModelsQueryOptions,
  profilesQueryOptions,
} from "../../lib/queries.ts";
import { buildDisplayItems } from "../../lib/transcript.ts";

function SessionView({ sessionId }: { sessionId: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const liveTurn = useLiveTurn(sessionId);
  const [chosenModel, setChosenModel] = useState<ModelSelection | null>(null);
  const pendingAuthMessages = useRef(new Set<string>());

  const sessionQuery = useQuery({
    queryKey: queryKeys.session(sessionId),
    queryFn: async () =>
      unwrapJson(await appClient.sessions[":sessionId"].$get({ param: { sessionId } })),
  });
  const profilesQuery = useQuery(profilesQueryOptions);
  const settingsQuery = useQuery(appSettingsQueryOptions);
  const modelsQuery = useQuery(llmModelsQueryOptions);

  const markReadMutation = useMutation({
    mutationFn: async (id: string) =>
      unwrapJson(
        await appClient.sessions[":sessionId"].$patch({
          param: { sessionId: id },
          json: { markRead: true },
        }),
      ),
  });

  const updateModelMutation = useMutation({
    mutationFn: async (model: ModelSelection) =>
      unwrapJson(
        await appClient.sessions[":sessionId"].$patch({
          param: { sessionId },
          json: { model },
        }),
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.session(sessionId), (previous: typeof sessionQuery.data) =>
        previous === undefined ? previous : { ...previous, session: data.session },
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
    },
  });

  const sendMutation = useMutation({
    mutationFn: async ({ text, model }: { text: string; model: ModelSelection }) =>
      unwrapJson(
        await appClient.sessions[":sessionId"].messages.$post({
          param: { sessionId },
          json: { text, model },
        }),
      ),
  });

  const abortMutation = useMutation({
    mutationFn: async () =>
      unwrapJson(await appClient.sessions[":sessionId"].abort.$post({ param: { sessionId } })),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await expectOk(await appClient.sessions[":sessionId"].$delete({ param: { sessionId } }));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
      void navigate({ to: "/" });
    },
  });

  const session = sessionQuery.data?.session;

  useEffect(() => {
    if (session?.unreadAlert) {
      markReadMutation.mutate(session.id);
    }
  }, [session?.id, session?.unreadAlert]);

  const items = useMemo(
    () => buildDisplayItems(sessionQuery.data?.entries ?? [], liveTurn),
    [sessionQuery.data?.entries, liveTurn],
  );

  if (sessionQuery.isPending) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner className="size-5 text-muted-foreground" />
      </div>
    );
  }

  if (sessionQuery.error !== null || session === undefined) {
    return (
      <div className="flex flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center gap-2 px-4 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
          <SidebarTrigger className="-ml-1" />
          <Separator
            orientation="vertical"
            className="mr-2 data-vertical:h-4 data-vertical:self-center"
          />
          <span className="text-sm font-medium">Session unavailable</span>
        </header>
        <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
          {sessionQuery.error?.message ?? "Session not found."}
        </div>
      </div>
    );
  }

  const profile = profilesQuery.data?.profiles.find((entry) => entry.id === session.profileId);
  const models = modelsQuery.data?.models ?? [];
  const activeModel = resolveAvailableModel(models, [
    chosenModel,
    session.model,
    profile?.config.model,
    settingsQuery.data?.defaultModel,
  ]);

  const running = session.status === "running" || liveTurn !== undefined;
  const composerError =
    sendMutation.error?.message ??
    abortMutation.error?.message ??
    updateModelMutation.error?.message ??
    null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-16 shrink-0 items-center justify-between gap-3 px-4 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
        <div className="flex min-w-0 items-center gap-2">
          <SidebarTrigger className="-ml-1" />
          <Separator
            orientation="vertical"
            className="mr-2 data-vertical:h-4 data-vertical:self-center"
          />
          <Link
            to="/profiles/$profileId"
            params={{ profileId: session.profileId }}
            className="shrink-0"
          >
            <Badge variant="secondary">{session.profileId}</Badge>
          </Link>
          <h1 className="truncate text-sm font-medium">{session.title}</h1>
          {session.triggerKind !== "user" && (
            <Badge variant="outline" className="shrink-0">
              {session.triggerKind}
            </Badge>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => deleteMutation.mutate()}
          disabled={deleteMutation.isPending}
          title="Delete conversation"
        >
          <Trash2Icon className="size-3.5" />
        </Button>
      </header>

      <SessionTranscript
        session={session}
        items={items}
        onAuthComplete={(message) => {
          if (activeModel === null || pendingAuthMessages.current.has(message)) {
            return;
          }

          pendingAuthMessages.current.add(message);
          void sendMutation
            .mutateAsync({ text: message, model: activeModel })
            .catch(() => undefined)
            .finally(() => pendingAuthMessages.current.delete(message));
        }}
      />

      <SessionComposer
        running={running}
        disabled={sendMutation.isPending}
        aborting={abortMutation.isPending}
        error={composerError}
        models={models}
        model={activeModel}
        onModelChange={(model) => {
          setChosenModel(model);
          updateModelMutation.mutate(model);
        }}
        onConfigureProviders={() =>
          void navigate({
            to: ".",
            search: (prev) => ({ ...prev, settings: "providers" }),
          })
        }
        onSend={async (text) => {
          if (activeModel !== null) {
            await sendMutation.mutateAsync({ text, model: activeModel });
          }
        }}
        onAbort={() => abortMutation.mutate()}
      />
    </div>
  );
}

function SessionPage() {
  const { sessionId } = Route.useParams();

  return <SessionView key={sessionId} sessionId={sessionId} />;
}

export const Route = createFileRoute("/sessions/$sessionId")({
  component: SessionPage,
});
