import { randomUUID } from "node:crypto";
import {
  RpcError,
  sessionIdSchema,
  type SessionHandlers,
  type SessionId,
  type SessionRecord,
} from "@tetherbox/core";
import type { DaemonConfig } from "../../../config.ts";
import type { SessionTable } from "../../../db/sessions.ts";
import type { DaemonEventBus } from "../../../events.ts";
import type { Poller } from "../../../jobs/poller.ts";
import type { ProfileRegistry } from "../../../profiles/registry.ts";
import type { ReminderStore } from "../../../jobs/reminders.ts";
import { readSessionTranscript, removeSessionTranscript } from "../../../sessions/transcript.ts";
import {
  DEFAULT_SESSION_TITLE,
  sessionTitleFromText,
  type TurnRunner,
} from "../../../sessions/turns.ts";
import { requireProfile } from "./require-profile.ts";

export function createSessionHandlers({
  config,
  sessions,
  events,
  registry,
  poller,
  reminders,
  turns,
}: {
  config: DaemonConfig;
  sessions: SessionTable;
  events: DaemonEventBus;
  registry: ProfileRegistry;
  poller: Poller;
  reminders: ReminderStore;
  turns: TurnRunner;
}): SessionHandlers {
  const requireSession = (sessionId: SessionId): SessionRecord => {
    const session = sessions.get(sessionId);

    if (session === undefined) {
      throw new RpcError(404, `session "${sessionId}" not found`);
    }

    return session;
  };

  return {
    list(profileId) {
      return sessions.list(profileId);
    },
    create(profileId, input) {
      requireProfile(registry, profileId);

      if (input.prompt !== undefined) {
        const sessionId = turns.enqueue(
          profileId,
          { kind: "user", text: input.prompt },
          { model: input.model },
        );
        const created =
          input.title !== undefined
            ? sessions.rename(sessionId, input.title)
            : sessions.get(sessionId);

        if (created === undefined) {
          throw new RpcError(404, `session "${sessionId}" not found`);
        }

        if (input.title !== undefined) {
          events.emit({ kind: "session_updated", session: created });
        }

        return created;
      }

      const sessionId = sessionIdSchema.parse(randomUUID());
      const created = sessions.create({
        id: sessionId,
        profileId,
        title: input.title ?? DEFAULT_SESSION_TITLE,
        triggerKind: "user",
        model: input.model ?? null,
      });

      events.emit({ kind: "session_updated", session: created });

      return created;
    },
    async get(sessionId) {
      const session = requireSession(sessionId);
      const entries = await readSessionTranscript(config.sessionsDir, session.profileId, sessionId);

      return { session, entries };
    },
    sendMessage(sessionId, { text, model }) {
      const session = requireSession(sessionId);

      requireProfile(registry, session.profileId);

      if (session.title === DEFAULT_SESSION_TITLE) {
        const renamed = sessions.rename(sessionId, sessionTitleFromText(text));

        if (renamed !== undefined) {
          events.emit({ kind: "session_updated", session: renamed });
        }
      }

      turns.enqueue(session.profileId, { kind: "user", text }, { sessionId, model });

      return { accepted: true, sessionId };
    },
    abort(sessionId) {
      requireSession(sessionId);

      return { aborted: turns.abort(sessionId) };
    },
    update(sessionId, input) {
      let session = requireSession(sessionId);

      if (input.title !== undefined) {
        session = sessions.rename(sessionId, input.title) ?? session;
      }

      if (input.markRead === true) {
        session = sessions.markRead(sessionId) ?? session;
      }

      if (input.model !== undefined) {
        session = sessions.updateModel(sessionId, input.model) ?? session;
      }

      events.emit({ kind: "session_updated", session });

      return session;
    },
    async delete(sessionId) {
      const session = requireSession(sessionId);

      await turns.cancelSession(sessionId);
      poller.cancelBySession(sessionId);
      reminders.cancelBySession(sessionId);
      sessions.delete(sessionId);
      await removeSessionTranscript(config.sessionsDir, session.profileId, sessionId);
      events.emit({ kind: "session_deleted", profileId: session.profileId, sessionId });
    },
  };
}
