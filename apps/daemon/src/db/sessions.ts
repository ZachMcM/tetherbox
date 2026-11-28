import type { DatabaseSync } from "node:sqlite";
import {
  modelSelectionSchema,
  sessionRecordSchema,
  type ModelSelection,
  type ProfileId,
  type SessionId,
  type SessionRecord,
  type SessionStatus,
  type SessionTriggerKind,
} from "@tetherbox/core";
import { z } from "zod";
import { parseJsonColumn } from "./json-column.ts";

const sessionRowSchema = z.object({
  id: z.string(),
  profile_id: z.string(),
  title: z.string(),
  trigger_kind: z.string(),
  status: z.string(),
  model_json: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  last_read_at: z.string().nullable(),
  unread_alert: z.number().int(),
  error_message: z.string().nullable(),
});

function mapSessionRow(raw: unknown): SessionRecord {
  const row = sessionRowSchema.parse(raw);

  return sessionRecordSchema.parse({
    id: row.id,
    profileId: row.profile_id,
    title: row.title,
    triggerKind: row.trigger_kind,
    status: row.status,
    model: parseJsonColumn({
      column: "sessions.model_json",
      schema: modelSelectionSchema.nullable(),
      raw: row.model_json,
      fallback: null,
    }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastReadAt: row.last_read_at,
    unreadAlert: row.unread_alert !== 0,
    errorMessage: row.error_message,
  });
}

function mapOptionalRow(row: unknown): SessionRecord | undefined {
  return row === undefined ? undefined : mapSessionRow(row);
}

export class SessionTable {
  readonly #db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
  }

  resetRunning(): number {
    const result = this.#db
      .prepare(
        `UPDATE sessions
         SET status = 'error', error_message = 'Daemon restarted while run was in progress.', updated_at = ?
         WHERE status = 'running'`,
      )
      .run(new Date().toISOString());

    return Number(result.changes);
  }

  create(input: {
    id: SessionId;
    profileId: ProfileId;
    title: string;
    triggerKind: SessionTriggerKind;
    model: ModelSelection | null;
  }): SessionRecord {
    const now = new Date().toISOString();

    this.#db
      .prepare(
        `INSERT INTO sessions (id, profile_id, title, trigger_kind, status, model_json, created_at, updated_at, last_read_at, unread_alert, error_message)
         VALUES (?, ?, ?, ?, 'idle', ?, ?, ?, NULL, 0, NULL)`,
      )
      .run(
        input.id,
        input.profileId,
        input.title,
        input.triggerKind,
        input.model === null ? null : JSON.stringify(input.model),
        now,
        now,
      );

    return {
      id: input.id,
      profileId: input.profileId,
      title: input.title,
      triggerKind: input.triggerKind,
      status: "idle",
      model: input.model,
      createdAt: now,
      updatedAt: now,
      lastReadAt: null,
      unreadAlert: false,
      errorMessage: null,
    };
  }

  get(id: SessionId): SessionRecord | undefined {
    return mapOptionalRow(this.#db.prepare("SELECT * FROM sessions WHERE id = ?").get(id));
  }

  list(profileId?: ProfileId): SessionRecord[] {
    const rows =
      profileId === undefined
        ? this.#db.prepare("SELECT * FROM sessions ORDER BY updated_at DESC").all()
        : this.#db
            .prepare("SELECT * FROM sessions WHERE profile_id = ? ORDER BY updated_at DESC")
            .all(profileId);

    return rows.map(mapSessionRow);
  }

  updateStatus(
    id: SessionId,
    update: { status: SessionStatus; errorMessage: string | null },
  ): SessionRecord | undefined {
    return mapOptionalRow(
      this.#db
        .prepare(
          "UPDATE sessions SET status = ?, error_message = ?, updated_at = ? WHERE id = ? RETURNING *",
        )
        .get(update.status, update.errorMessage, new Date().toISOString(), id),
    );
  }

  rename(id: SessionId, title: string): SessionRecord | undefined {
    return mapOptionalRow(
      this.#db.prepare("UPDATE sessions SET title = ? WHERE id = ? RETURNING *").get(title, id),
    );
  }

  updateModel(id: SessionId, model: ModelSelection | null): SessionRecord | undefined {
    return mapOptionalRow(
      this.#db
        .prepare("UPDATE sessions SET model_json = ? WHERE id = ? RETURNING *")
        .get(model === null ? null : JSON.stringify(model), id),
    );
  }

  markRead(id: SessionId): SessionRecord | undefined {
    return mapOptionalRow(
      this.#db
        .prepare("UPDATE sessions SET last_read_at = ?, unread_alert = 0 WHERE id = ? RETURNING *")
        .get(new Date().toISOString(), id),
    );
  }

  markUnreadAlert(id: SessionId): SessionRecord | undefined {
    return mapOptionalRow(
      this.#db
        .prepare("UPDATE sessions SET unread_alert = 1, updated_at = ? WHERE id = ? RETURNING *")
        .get(new Date().toISOString(), id),
    );
  }

  delete(id: SessionId): boolean {
    this.#db.prepare("DELETE FROM poll_jobs WHERE session_id = ?").run(id);
    this.#db.prepare("DELETE FROM reminders WHERE session_id = ?").run(id);

    const result = this.#db.prepare("DELETE FROM sessions WHERE id = ?").run(id);

    return Number(result.changes) > 0;
  }

  deleteByProfile(profileId: ProfileId): SessionId[] {
    const ids = this.list(profileId).map((session) => session.id);

    this.#db.prepare("DELETE FROM poll_jobs WHERE profile_id = ?").run(profileId);
    this.#db.prepare("DELETE FROM reminders WHERE profile_id = ?").run(profileId);
    this.#db.prepare("DELETE FROM sessions WHERE profile_id = ?").run(profileId);

    return ids;
  }
}
