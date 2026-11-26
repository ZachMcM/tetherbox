import { useEffect, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Trash2Icon } from "lucide-react";
import { Badge } from "@tetherbox/ui/components/badge";
import { Button } from "@tetherbox/ui/components/button";
import { Separator } from "@tetherbox/ui/components/separator";
import { SidebarTrigger } from "@tetherbox/ui/components/sidebar";
import { Spinner } from "@tetherbox/ui/components/spinner";
import { SessionComposer } from "../../components/session-composer.tsx";
import { SessionTranscript } from "../../components/session-transcript.tsx";
import { appClient, expectOk, queryKeys, unwrapJson } from "../../lib/api.ts";
import { useLiveTurn } from "../../lib/live-store.ts";
import { buildDisplayItems } from "../../lib/transcript.ts";

function SessionView({ sessionId }: { sessionId: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const liveTurn = useLiveTurn(sessionId);

  const sessionQuery = useQuery({
    queryKey: queryKeys.session(sessionId),
    queryFn: async () =>
      unwrapJson(await appClient.sessions[":sessionId"].$get({ param: { sessionId } })),
  });

  const markReadMutation = useMutation({
    mutationFn: async (id: string) =>
      unwrapJson(
        await appClient.sessions[":sessionId"].$patch({
          param: { sessionId: id },
          json: { markRead: true },
        }),
      ),
  });

  const sendMutation = useMutation({
    mutationFn: async (text: string) =>
      unwrapJson(
        await appClient.sessions[":sessionId"].messages.$post({
          param: { sessionId },
          json: { text },
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
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
          <SidebarTrigger />
          <span className="text-sm font-medium">Session unavailable</span>
        </header>
        <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
          {sessionQuery.error?.message ?? "Session not found."}
        </div>
      </div>
    );
  }

  const running = session.status === "running" || liveTurn !== undefined;
  const composerError = sendMutation.error?.message ?? abortMutation.error?.message ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border px-4">
        <div className="flex min-w-0 items-center gap-2">
          <SidebarTrigger />
          <Separator
            orientation="vertical"
            className="data-vertical:h-4 data-vertical:self-center"
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

      <SessionTranscript session={session} items={items} />

      <SessionComposer
        running={running}
        disabled={sendMutation.isPending}
        aborting={abortMutation.isPending}
        error={composerError}
        onSend={async (text) => {
          await sendMutation.mutateAsync(text);
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
