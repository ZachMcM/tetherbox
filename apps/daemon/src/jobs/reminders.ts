import type {
  EntryName,
  ProfileId,
  ScheduledReminder,
  ScheduleReminderInput,
  SessionId,
} from "@tetherbox/core";
import type { DaemonDb } from "../db.ts";

const MAX_TIMEOUT_MS = 2_147_483_647;

export type ReminderFire = (profileId: ProfileId, reminder: ScheduledReminder) => void;

function timerKey(profileId: ProfileId, name: EntryName): string {
  return `${profileId}:${name}`;
}

function computeFireAt(input: ScheduleReminderInput, now: number): string {
  switch (input.kind) {
    case "at":
      return new Date(Date.parse(input.fireAt)).toISOString();
    case "in":
      return new Date(now + input.delaySeconds * 1000).toISOString();
    default: {
      const exhaustive: never = input;

      return exhaustive;
    }
  }
}

/**
 * Persists one-shot reminders in SQLite so they survive daemon restarts without creating
 * git-tracked cron files.
 */
export class ReminderStore {
  readonly #db: DaemonDb;
  readonly #reminders = new Map<ProfileId, Map<EntryName, ScheduledReminder>>();
  readonly #timers = new Map<string, ReturnType<typeof setTimeout>>();
  readonly #onFire: ReminderFire;

  constructor(db: DaemonDb, onFire: ReminderFire) {
    this.#db = db;
    this.#onFire = onFire;
  }

  loadAll(): void {
    this.stopAll();
    this.#reminders.clear();

    for (const { profileId, reminder } of this.#db.listAllReminders()) {
      this.#remindersFor(profileId).set(reminder.name, reminder);
      this.#arm(profileId, reminder);
    }
  }

  schedule(
    profileId: ProfileId,
    input: ScheduleReminderInput,
    sessionId: SessionId,
  ): ScheduledReminder {
    const now = Date.now();
    const fireAt = computeFireAt(input, now);
    const reminder: ScheduledReminder = {
      name: input.name,
      fireAt,
      prompt: input.prompt,
      createdAt: new Date(now).toISOString(),
      sessionId,
    };

    this.#db.upsertReminder(profileId, reminder);
    this.#remindersFor(profileId).set(reminder.name, reminder);
    this.#arm(profileId, reminder);

    return reminder;
  }

  list(profileId: ProfileId): ScheduledReminder[] {
    return [...(this.#reminders.get(profileId)?.values() ?? [])].toSorted((a, b) =>
      a.fireAt.localeCompare(b.fireAt),
    );
  }

  cancel(profileId: ProfileId, name: EntryName): boolean {
    this.#clearTimer(profileId, name);

    const existed = this.#reminders.get(profileId)?.delete(name) ?? false;

    this.#db.deleteReminder(profileId, name);

    return existed;
  }

  cancelBySession(sessionId: SessionId): void {
    for (const [profileId, reminders] of this.#reminders) {
      for (const [name, reminder] of reminders) {
        if (reminder.sessionId === sessionId) {
          this.cancel(profileId, name);
        }
      }
    }
  }

  cancelByProfile(profileId: ProfileId): void {
    for (const name of this.#reminders.get(profileId)?.keys() ?? []) {
      this.cancel(profileId, name);
    }

    this.#reminders.delete(profileId);
  }

  stopAll(): void {
    for (const timer of this.#timers.values()) {
      clearTimeout(timer);
    }

    this.#timers.clear();
  }

  #arm(profileId: ProfileId, reminder: ScheduledReminder): void {
    this.#clearTimer(profileId, reminder.name);

    const remainingMs = Date.parse(reminder.fireAt) - Date.now();

    if (remainingMs > MAX_TIMEOUT_MS) {
      const timer = setTimeout(() => this.#arm(profileId, reminder), MAX_TIMEOUT_MS);

      this.#timers.set(timerKey(profileId, reminder.name), timer);

      return;
    }

    const delayMs = Math.max(0, remainingMs);
    const timer = setTimeout(() => {
      this.#fire(profileId, reminder.name);
    }, delayMs);

    this.#timers.set(timerKey(profileId, reminder.name), timer);
  }

  #fire(profileId: ProfileId, name: EntryName): void {
    const reminder = this.#reminders.get(profileId)?.get(name);

    if (reminder === undefined) {
      return;
    }

    this.cancel(profileId, name);
    this.#onFire(profileId, reminder);
  }

  #clearTimer(profileId: ProfileId, name: EntryName): void {
    const key = timerKey(profileId, name);
    const existing = this.#timers.get(key);

    if (existing !== undefined) {
      clearTimeout(existing);
      this.#timers.delete(key);
    }
  }

  #remindersFor(profileId: ProfileId): Map<EntryName, ScheduledReminder> {
    let reminders = this.#reminders.get(profileId);

    if (reminders === undefined) {
      reminders = new Map();
      this.#reminders.set(profileId, reminders);
    }

    return reminders;
  }
}
