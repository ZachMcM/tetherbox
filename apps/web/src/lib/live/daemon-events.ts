import { useEffect } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  daemonEventSchema,
  type DaemonEvent,
  type SessionRecord,
  type TranscriptEntry,
} from "@tetherbox/core/app";
import { getAuthStatus, queryKeys } from "../api.ts";
import {
  clearCliState,
  resyncActiveCliState,
  upsertCliAuthFlow,
  upsertCliInstallJob,
} from "./cli-store.ts";
import { applyTurnEvent, clearAllTurns, clearTurn, startTurn } from "./turn-store.ts";

function upsertSessionInCache(queryClient: QueryClient, updated: SessionRecord): void {
  queryClient.setQueryData<{ sessions: SessionRecord[] }>(queryKeys.sessions, (prev) => {
    if (prev === undefined) {
      return { sessions: [updated] };
    }

    const exists = prev.sessions.some((item) => item.id === updated.id);
    const next = exists
      ? prev.sessions.map((item) => (item.id === updated.id ? updated : item))
      : [updated, ...prev.sessions];

    return {
      sessions: next.toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    };
  });

  queryClient.setQueryData<{ session: SessionRecord; entries: TranscriptEntry[] }>(
    queryKeys.session(updated.id),
    (prev) => (prev === undefined ? prev : { ...prev, session: updated }),
  );
}

function handleDaemonEvent(queryClient: QueryClient, event: DaemonEvent): void {
  switch (event.kind) {
    case "session_updated":
      upsertSessionInCache(queryClient, event.session);
      break;
    case "session_deleted":
      clearTurn(event.sessionId);
      queryClient.setQueryData<{ sessions: SessionRecord[] }>(queryKeys.sessions, (prev) =>
        prev === undefined
          ? prev
          : { sessions: prev.sessions.filter((item) => item.id !== event.sessionId) },
      );
      queryClient.removeQueries({ queryKey: queryKeys.session(event.sessionId) });
      break;
    case "turn_started":
      startTurn(event.sessionId, event.runId, {
        ...(event.trigger.kind === "user" ? { triggerText: event.trigger.text } : {}),
        baselineEntryCount: event.baselineEntryCount,
      });
      break;
    case "turn_event":
      applyTurnEvent(event.sessionId, event.runId, event.event);
      break;
    case "turn_finished":
      void queryClient
        .invalidateQueries({ queryKey: queryKeys.session(event.sessionId) })
        .finally(() => {
          clearTurn(event.sessionId, event.runId);
        });
      void queryClient.invalidateQueries({ queryKey: queryKeys.profile(event.profileId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.cliStatus });
      break;
    case "notification":
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
      break;
    case "cli_install_updated":
      upsertCliInstallJob(event.job, queryClient);
      break;
    case "cli_auth_updated":
      upsertCliAuthFlow(event.flow, queryClient);
      break;
    default: {
      const exhaustive: never = event;

      return exhaustive;
    }
  }
}

const SSE_EVENT_NAMES: readonly DaemonEvent["kind"][] = [
  "session_updated",
  "session_deleted",
  "turn_started",
  "turn_event",
  "turn_finished",
  "notification",
  "cli_install_updated",
  "cli_auth_updated",
];

export function useDaemonEvents(enabled: boolean): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) {
      clearAllTurns();
      clearCliState();

      return;
    }

    const source = new EventSource("/api/events");
    let hasConnectedOnce = false;
    let checkingAuth = false;

    const onConnected = () => {
      if (hasConnectedOnce) {
        clearAllTurns();
        void queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
        void queryClient.invalidateQueries({ queryKey: queryKeys.profiles });
        void queryClient.invalidateQueries({ queryKey: queryKeys.cliStatus });
        void resyncActiveCliState(queryClient);
      }

      hasConnectedOnce = true;
    };

    const onError = () => {
      if (checkingAuth) {
        return;
      }

      checkingAuth = true;
      void getAuthStatus()
        .then(({ authenticated }) => {
          if (!authenticated) {
            queryClient.setQueryData(queryKeys.auth, { authenticated: false });
            void queryClient.invalidateQueries({ queryKey: queryKeys.auth });
          }
        })
        .catch(() => {
          // Daemon may be restarting; EventSource will retry automatically.
        })
        .finally(() => {
          checkingAuth = false;
        });
    };

    const onMessage = (message: MessageEvent<string>) => {
      try {
        const parsed = daemonEventSchema.safeParse(JSON.parse(message.data));

        if (parsed.success) {
          handleDaemonEvent(queryClient, parsed.data);
        }
      } catch {
        // Ignore malformed SSE payloads.
      }
    };

    source.addEventListener("connected", onConnected);
    source.addEventListener("error", onError);

    for (const eventName of SSE_EVENT_NAMES) {
      source.addEventListener(eventName, onMessage);
    }

    return () => {
      source.removeEventListener("connected", onConnected);
      source.removeEventListener("error", onError);

      for (const eventName of SSE_EVENT_NAMES) {
        source.removeEventListener(eventName, onMessage);
      }

      source.close();
    };
  }, [enabled, queryClient]);
}
