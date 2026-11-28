import { profileIdSchema, sessionIdSchema, type ProfileId } from "@tetherbox/core";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import type { DaemonEvent, DaemonEventBus } from "../../events.ts";

const SSE_HEARTBEAT_MS = 25_000;

function matchesEventFilter(
  event: DaemonEvent,
  profileId: ProfileId | undefined,
  sessionId: string | undefined,
): boolean {
  if (event.kind === "cli_install_updated" || event.kind === "cli_auth_updated") {
    return profileId === undefined && sessionId === undefined;
  }

  if (event.kind === "session_updated") {
    if (profileId !== undefined && event.session.profileId !== profileId) {
      return false;
    }

    if (sessionId !== undefined && event.session.id !== sessionId) {
      return false;
    }

    return true;
  }

  if (profileId !== undefined && event.profileId !== profileId) {
    return false;
  }

  if (sessionId !== undefined && event.sessionId !== sessionId) {
    return false;
  }

  return true;
}

export function createEventStreamHandler({
  events,
  shutdownSignal,
}: {
  events: DaemonEventBus;
  shutdownSignal?: AbortSignal | undefined;
}) {
  return (c: Context) => {
    const rawProfileId = c.req.query("profileId");
    const rawSessionId = c.req.query("sessionId");
    const profileId = rawProfileId !== undefined ? profileIdSchema.safeParse(rawProfileId) : null;
    const sessionId = rawSessionId !== undefined ? sessionIdSchema.safeParse(rawSessionId) : null;

    if (profileId !== null && !profileId.success) {
      return c.json({ error: "invalid profileId" }, 400);
    }

    if (sessionId !== null && !sessionId.success) {
      return c.json({ error: "invalid sessionId" }, 400);
    }

    const filterProfileId = profileId?.data;
    const filterSessionId = sessionId?.data;

    return streamSSE(c, async (stream) => {
      if (shutdownSignal?.aborted) {
        return;
      }

      let closedFlag = false;
      const { promise: closed, resolve: resolveClosed } = Promise.withResolvers<void>();

      const unsubscribe = events.subscribe((event) => {
        if (closedFlag || !matchesEventFilter(event, filterProfileId, filterSessionId)) {
          return;
        }

        void stream.writeSSE({
          event: event.kind,
          data: JSON.stringify(event),
        });
      });

      const heartbeat = setInterval(() => {
        if (!closedFlag) {
          void stream.write(": keepalive\n\n");
        }
      }, SSE_HEARTBEAT_MS);

      heartbeat.unref();

      const close = () => {
        if (closedFlag) {
          return;
        }

        closedFlag = true;
        clearInterval(heartbeat);
        unsubscribe();
        shutdownSignal?.removeEventListener("abort", close);
        resolveClosed();
      };

      stream.onAbort(close);
      shutdownSignal?.addEventListener("abort", close, { once: true });

      await stream.writeSSE({
        event: "connected",
        data: JSON.stringify({ ok: true }),
      });

      await closed;
    });
  };
}
