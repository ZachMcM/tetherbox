import { randomUUID } from "node:crypto";
import {
  RpcError,
  sessionIdSchema,
  type SessionHandlers,
  type SessionId,
  type SessionRecord,
} from "@tetherbox/core";
import type { DaemonConfig } from "../config.ts";
import type { DaemonDb } from "../db.ts";
import type { DaemonEventBus } from "../events.ts";
import type { Poller } from "../poller.ts";
import type { ProfileRegistry } from "../profiles.ts";
import type { ReminderStore } from "../reminders.ts";
import { readSessionTranscript, removeSessionTranscript } from "../transcript.ts";
import { DEFAULT_SESSION_TITLE, sessionTitleFromText, type TurnRunner } from "../turns.ts";
import { requireProfile } from "./require-profile.ts";

export interface SessionHandlerDeps {
  config: DaemonConfig;
  db: DaemonDb;
  events: DaemonEventBus;
  registry: ProfileRegistry;
  poller: Poller;
  reminders: ReminderStore;
  turns: TurnRunner;
}

export function createSessionHandlers(deps: SessionHandlerDeps): SessionHandlers {
  const { config, db, events, registry, poller, reminders, turns } = deps;

  const requireSession = (sessionId: SessionId): SessionRecord => {
    const session = db.getSession(sessionId);

    if (session === undefined) {
      throw new RpcError(404, `session "${sessionId}" not found`);
    }

    return session;
  };

  return {
    list(profileId) {
      return db.listSessions(profileId);
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
            ? db.renameSession(sessionId, input.title)
            : db.getSession(sessionId);

        if (created === undefined) {
          throw new RpcError(404, `session "${sessionId}" not found`);
        }

        if (input.title !== undefined) {
          events.emit({ kind: "session_updated", session: created });
        }

        return created;
      }

      const sessionId = sessionIdSchema.parse(randomUUID());
      const created = db.createSession({
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
        const renamed = db.renameSession(sessionId, sessionTitleFromText(text));

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
        session = db.renameSession(sessionId, input.title) ?? session;
      }

      if (input.markRead === true) {
        session = db.markSessionRead(sessionId) ?? session;
      }

      if (input.model !== undefined) {
        session = db.updateSessionModel(sessionId, input.model) ?? session;
      }

      events.emit({ kind: "session_updated", session });

      return session;
    },
    async delete(sessionId) {
      const session = requireSession(sessionId);

      await turns.cancelSession(sessionId);
      poller.cancelBySession(sessionId);
      reminders.cancelBySession(sessionId);
      db.deleteSession(sessionId);
      await removeSessionTranscript(config.sessionsDir, session.profileId, sessionId);
      events.emit({ kind: "session_deleted", profileId: session.profileId, sessionId });
    },
  };
}
