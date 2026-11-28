import { chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { FavoriteModelTable } from "./favorite-models.ts";
import { migrate } from "./migrations.ts";
import { PollJobTable } from "./poll-jobs.ts";
import { ProfileTable } from "./profiles.ts";
import { PushSubscriptionTable } from "./push-subscriptions.ts";
import { ReminderTable } from "./reminders.ts";
import { SessionTable } from "./sessions.ts";
import { AppSettingsTable } from "./settings.ts";

export interface DaemonDb {
  readonly sessions: SessionTable;
  readonly pollJobs: PollJobTable;
  readonly reminders: ReminderTable;
  readonly settings: AppSettingsTable;
  readonly favoriteModels: FavoriteModelTable;
  readonly pushSubscriptions: PushSubscriptionTable;
  readonly profiles: ProfileTable;
  close(): void;
}

export function openDaemonDb(dataDir: string): DaemonDb {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });

  const dbPath = join(dataDir, "tetherbox.db");
  const db = new DatabaseSync(dbPath);

  chmodSync(dbPath, 0o600);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  migrate(db);

  return {
    sessions: new SessionTable(db),
    pollJobs: new PollJobTable(db),
    reminders: new ReminderTable(db),
    settings: new AppSettingsTable(db),
    favoriteModels: new FavoriteModelTable(db),
    pushSubscriptions: new PushSubscriptionTable(db),
    profiles: new ProfileTable(db),
    close: () => db.close(),
  };
}
