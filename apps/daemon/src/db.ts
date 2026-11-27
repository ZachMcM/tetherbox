import { chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  modelRefSchema,
  modelSelectionSchema,
  profileIdSchema,
  registeredPollJobSchema,
  scheduledReminderSchema,
  sessionRecordSchema,
  type AppSettings,
  type EntryName,
  type ModelRef,
  type ModelSelection,
  type ProfileId,
  type PushSubscriptionRecord,
  type RegisteredPollJob,
  type ScheduledReminder,
  type SessionId,
  type SessionRecord,
  type SessionStatus,
  type SessionTriggerKind,
  type UpdateAppSettingsInput,
} from "@tetherbox/core";
import { z } from "zod";

const userVersionRowSchema = z.object({ user_version: z.number().int() });

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

const favoriteModelRowSchema = z.object({
  provider: z.string(),
  auth: z.string(),
  model_id: z.string(),
});

const appSettingRowSchema = z.object({
  key: z.string(),
  value_json: z.string(),
});

const pollJobRowSchema = z.object({
  profile_id: z.string(),
  name: z.string(),
  session_id: z.string(),
  job_json: z.string(),
  registered_at: z.string(),
});

const reminderRowSchema = z.object({
  profile_id: z.string(),
  name: z.string(),
  session_id: z.string(),
  fire_at: z.string(),
  prompt: z.string(),
  created_at: z.string(),
});

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

function parseJsonColumn<T>({
  column,
  schema,
  raw,
  fallback,
}: {
  column: string;
  schema: z.ZodType<T>;
  raw: string | null | undefined;
  fallback: T;
}): T {
  if (raw === null || raw === undefined) {
    return fallback;
  }

  try {
    return schema.parse(JSON.parse(raw));
  } catch (error) {
    console.error(`ignoring unreadable stored ${column}`, error);

    return fallback;
  }
}

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

function mapPollJobRow(raw: unknown): { profileId: ProfileId; job: RegisteredPollJob } {
  const row = pollJobRowSchema.parse(raw);

  return {
    profileId: profileIdSchema.parse(row.profile_id),
    job: registeredPollJobSchema.parse({
      name: row.name,
      job: JSON.parse(row.job_json),
      registeredAt: row.registered_at,
      sessionId: row.session_id,
    }),
  };
}

function mapReminderRow(raw: unknown): { profileId: ProfileId; reminder: ScheduledReminder } {
  const row = reminderRowSchema.parse(raw);

  return {
    profileId: profileIdSchema.parse(row.profile_id),
    reminder: scheduledReminderSchema.parse({
      name: row.name,
      fireAt: row.fire_at,
      prompt: row.prompt,
      createdAt: row.created_at,
      sessionId: row.session_id,
    }),
  };
}

export class DaemonDb {
  readonly #db: DatabaseSync;

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });

    const dbPath = join(dataDir, "tetherbox.db");

    this.#db = new DatabaseSync(dbPath);
    chmodSync(dbPath, 0o600);
    this.#db.exec("PRAGMA journal_mode = WAL;");
    this.#db.exec("PRAGMA foreign_keys = ON;");
    this.#migrate();
  }

  #migrate(): void {
    const { user_version: currentVersion } = userVersionRowSchema.parse(
      this.#db.prepare("PRAGMA user_version").get(),
    );

    for (let index = currentVersion; index < MIGRATIONS.length; index++) {
      const sql = MIGRATIONS[index];

      if (sql === undefined) {
        continue;
      }

      this.#db.exec("BEGIN");

      try {
        this.#db.exec(sql);
        this.#db.exec(`PRAGMA user_version = ${index + 1};`);
        this.#db.exec("COMMIT");
      } catch (error) {
        this.#db.exec("ROLLBACK");
        throw error;
      }
    }
  }

  resetRunningSessions(): number {
    const now = new Date().toISOString();
    const result = this.#db
      .prepare(
        `UPDATE sessions
         SET status = 'error', error_message = 'Daemon restarted while run was in progress.', updated_at = ?
         WHERE status = 'running'`,
      )
      .run(now);

    return Number(result.changes);
  }

  getAppSettings(): AppSettings {
    const rows = this.#db
      .prepare("SELECT key, value_json FROM app_settings")
      .all()
      .map((raw) => appSettingRowSchema.parse(raw));
    const map = new Map(rows.map((row) => [row.key, row.value_json]));

    const defaultModel = parseJsonColumn({
      column: "app_settings.default_model",
      schema: modelSelectionSchema.nullable(),
      raw: map.get("default_model"),
      fallback: null,
    });
    const onboardingCompleted = parseJsonColumn({
      column: "app_settings.onboarding_completed",
      schema: z.boolean(),
      raw: map.get("onboarding_completed"),
      fallback: false,
    });

    return { defaultModel, onboardingCompleted };
  }

  updateAppSettings(input: UpdateAppSettingsInput): AppSettings {
    const now = new Date().toISOString();
    const upsert = this.#db.prepare(
      `INSERT INTO app_settings (key, value_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET
         value_json = excluded.value_json,
         updated_at = excluded.updated_at`,
    );

    if (input.defaultModel !== undefined) {
      upsert.run("default_model", JSON.stringify(input.defaultModel), now);
    }

    if (input.onboardingCompleted !== undefined) {
      upsert.run("onboarding_completed", JSON.stringify(input.onboardingCompleted), now);
    }

    return this.getAppSettings();
  }

  listFavoriteModels(): ModelRef[] {
    return this.#db
      .prepare("SELECT provider, auth, model_id FROM favorite_models ORDER BY created_at")
      .all()
      .flatMap((raw) => {
        const row = favoriteModelRowSchema.parse(raw);
        const parsed = modelRefSchema.safeParse({
          provider: row.provider,
          auth: row.auth,
          id: row.model_id,
        });

        if (!parsed.success) {
          console.error(
            `ignoring unreadable favorite model ${row.provider}/${row.auth}/${row.model_id}`,
          );

          return [];
        }

        return [parsed.data];
      });
  }

  addFavoriteModel(model: ModelRef): void {
    this.#db
      .prepare(
        `INSERT INTO favorite_models (provider, auth, model_id, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT DO NOTHING`,
      )
      .run(model.provider, model.auth, model.id, new Date().toISOString());
  }

  removeFavoriteModel(model: ModelRef): void {
    this.#db
      .prepare("DELETE FROM favorite_models WHERE provider = ? AND auth = ? AND model_id = ?")
      .run(model.provider, model.auth, model.id);
  }

  createSession(input: {
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

  getSession(id: SessionId): SessionRecord | undefined {
    const row = this.#db.prepare("SELECT * FROM sessions WHERE id = ?").get(id);

    return row === undefined ? undefined : mapSessionRow(row);
  }

  listSessions(profileId?: ProfileId): SessionRecord[] {
    const rows =
      profileId === undefined
        ? this.#db.prepare("SELECT * FROM sessions ORDER BY updated_at DESC").all()
        : this.#db
            .prepare("SELECT * FROM sessions WHERE profile_id = ? ORDER BY updated_at DESC")
            .all(profileId);

    return rows.map(mapSessionRow);
  }

  updateSessionStatus(
    id: SessionId,
    update: { status: SessionStatus; errorMessage: string | null },
  ): SessionRecord | undefined {
    const row = this.#db
      .prepare(
        "UPDATE sessions SET status = ?, error_message = ?, updated_at = ? WHERE id = ? RETURNING *",
      )
      .get(update.status, update.errorMessage, new Date().toISOString(), id);

    return row === undefined ? undefined : mapSessionRow(row);
  }

  renameSession(id: SessionId, title: string): SessionRecord | undefined {
    const row = this.#db
      .prepare("UPDATE sessions SET title = ? WHERE id = ? RETURNING *")
      .get(title, id);

    return row === undefined ? undefined : mapSessionRow(row);
  }

  updateSessionModel(id: SessionId, model: ModelSelection | null): SessionRecord | undefined {
    const row = this.#db
      .prepare("UPDATE sessions SET model_json = ? WHERE id = ? RETURNING *")
      .get(model === null ? null : JSON.stringify(model), id);

    return row === undefined ? undefined : mapSessionRow(row);
  }

  markSessionRead(id: SessionId): SessionRecord | undefined {
    const row = this.#db
      .prepare("UPDATE sessions SET last_read_at = ?, unread_alert = 0 WHERE id = ? RETURNING *")
      .get(new Date().toISOString(), id);

    return row === undefined ? undefined : mapSessionRow(row);
  }

  markSessionUnreadAlert(id: SessionId): SessionRecord | undefined {
    const row = this.#db
      .prepare("UPDATE sessions SET unread_alert = 1, updated_at = ? WHERE id = ? RETURNING *")
      .get(new Date().toISOString(), id);

    return row === undefined ? undefined : mapSessionRow(row);
  }

  deleteSession(id: SessionId): boolean {
    this.#db.prepare("DELETE FROM poll_jobs WHERE session_id = ?").run(id);
    this.#db.prepare("DELETE FROM reminders WHERE session_id = ?").run(id);

    const result = this.#db.prepare("DELETE FROM sessions WHERE id = ?").run(id);

    return Number(result.changes) > 0;
  }

  deleteSessionsByProfile(profileId: ProfileId): SessionId[] {
    const ids = this.listSessions(profileId).map((session) => session.id);

    this.#db.prepare("DELETE FROM poll_jobs WHERE profile_id = ?").run(profileId);
    this.#db.prepare("DELETE FROM reminders WHERE profile_id = ?").run(profileId);
    this.#db.prepare("DELETE FROM sessions WHERE profile_id = ?").run(profileId);

    return ids;
  }

  listAllPollJobs(): { profileId: ProfileId; job: RegisteredPollJob }[] {
    return this.#db.prepare("SELECT * FROM poll_jobs").all().map(mapPollJobRow);
  }

  upsertPollJob(profileId: ProfileId, job: RegisteredPollJob): void {
    this.#db
      .prepare(
        `INSERT INTO poll_jobs (profile_id, name, session_id, job_json, registered_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (profile_id, name) DO UPDATE SET
           session_id = excluded.session_id,
           job_json = excluded.job_json,
           registered_at = excluded.registered_at`,
      )
      .run(profileId, job.name, job.sessionId, JSON.stringify(job.job), job.registeredAt);
  }

  deletePollJob(profileId: ProfileId, name: EntryName): boolean {
    const result = this.#db
      .prepare("DELETE FROM poll_jobs WHERE profile_id = ? AND name = ?")
      .run(profileId, name);

    return Number(result.changes) > 0;
  }

  listAllReminders(): { profileId: ProfileId; reminder: ScheduledReminder }[] {
    return this.#db
      .prepare("SELECT * FROM reminders ORDER BY fire_at ASC")
      .all()
      .map(mapReminderRow);
  }

  upsertReminder(profileId: ProfileId, reminder: ScheduledReminder): void {
    this.#db
      .prepare(
        `INSERT INTO reminders (profile_id, name, session_id, fire_at, prompt, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (profile_id, name) DO UPDATE SET
           session_id = excluded.session_id,
           fire_at = excluded.fire_at,
           prompt = excluded.prompt,
           created_at = excluded.created_at`,
      )
      .run(
        profileId,
        reminder.name,
        reminder.sessionId,
        reminder.fireAt,
        reminder.prompt,
        reminder.createdAt,
      );
  }

  deleteReminder(profileId: ProfileId, name: EntryName): boolean {
    const result = this.#db
      .prepare("DELETE FROM reminders WHERE profile_id = ? AND name = ?")
      .run(profileId, name);

    return Number(result.changes) > 0;
  }

  upsertPushSubscription(sub: PushSubscriptionRecord): void {
    this.#db
      .prepare(
        `INSERT INTO push_subscriptions (endpoint, p256dh, auth, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (endpoint) DO UPDATE SET
           p256dh = excluded.p256dh,
           auth = excluded.auth,
           created_at = excluded.created_at`,
      )
      .run(sub.endpoint, sub.p256dh, sub.auth, sub.createdAt);
  }

  deletePushSubscription(endpoint: string): boolean {
    const result = this.#db
      .prepare("DELETE FROM push_subscriptions WHERE endpoint = ?")
      .run(endpoint);

    return Number(result.changes) > 0;
  }

  close(): void {
    this.#db.close();
  }
}
