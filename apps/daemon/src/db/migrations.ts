import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";

const userVersionRowSchema = z.object({ user_version: z.number().int() });

const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL,
    title TEXT NOT NULL,
    trigger_kind TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_read_at TEXT,
    unread_alert INTEGER NOT NULL DEFAULT 0,
    error_message TEXT
  );
  CREATE INDEX idx_sessions_profile_updated ON sessions (profile_id, updated_at DESC);

  CREATE TABLE poll_jobs (
    profile_id TEXT NOT NULL,
    name TEXT NOT NULL,
    session_id TEXT NOT NULL,
    job_json TEXT NOT NULL,
    registered_at TEXT NOT NULL,
    PRIMARY KEY (profile_id, name)
  );
  CREATE INDEX idx_poll_jobs_session ON poll_jobs (session_id);

  CREATE TABLE reminders (
    profile_id TEXT NOT NULL,
    name TEXT NOT NULL,
    session_id TEXT NOT NULL,
    fire_at TEXT NOT NULL,
    prompt TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (profile_id, name)
  );
  CREATE INDEX idx_reminders_session ON reminders (session_id);

  CREATE TABLE push_subscriptions (
    endpoint TEXT PRIMARY KEY,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  `,
  `
  CREATE TABLE app_settings (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  ALTER TABLE sessions ADD COLUMN model_json TEXT;
  `,
  `
  CREATE TABLE favorite_models (
    provider TEXT NOT NULL,
    auth TEXT NOT NULL,
    model_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (provider, auth, model_id)
  );
  `,
];

export function migrate(db: DatabaseSync): void {
  const { user_version: currentVersion } = userVersionRowSchema.parse(
    db.prepare("PRAGMA user_version").get(),
  );

  for (let index = currentVersion; index < MIGRATIONS.length; index++) {
    const sql = MIGRATIONS[index];

    if (sql === undefined) {
      continue;
    }

    db.exec("BEGIN");

    try {
      db.exec(sql);
      db.exec(`PRAGMA user_version = ${index + 1};`);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}
