import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  profileIdSchema,
  scheduledReminderSchema,
  type EntryName,
  type ProfileId,
  type ScheduledReminder,
  type ScheduleReminderInput,
} from "@tetherbox/core";

const MAX_TIMEOUT_MS = 2_147_483_647;

export type ReminderFire = (profileId: ProfileId, reminder: ScheduledReminder) => void;

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

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
 * Persists one-shot reminders in `<dataDir>/reminders/<profileId>/<name>.json` so they survive
 * daemon restarts without creating git-tracked cron files.
 */
export class ReminderStore {
  readonly #dir: string;
  readonly #reminders = new Map<ProfileId, Map<EntryName, ScheduledReminder>>();
  readonly #timers = new Map<string, ReturnType<typeof setTimeout>>();
  readonly #onFire: ReminderFire;

  constructor(dataDir: string, onFire: ReminderFire) {
    this.#dir = join(dataDir, "reminders");
    this.#onFire = onFire;
  }

  async loadAll(): Promise<void> {
    let profileDirs: string[];

    try {
      profileDirs = await readdir(this.#dir);
    } catch (error) {
      if (isMissing(error)) {
        return;
      }

      throw error;
    }

    for (const dir of profileDirs) {
      const profileId = profileIdSchema.parse(dir);

      for (const file of await readdir(join(this.#dir, dir))) {
        const path = join(this.#dir, dir, file);

        try {
          const reminder = scheduledReminderSchema.parse(JSON.parse(await readFile(path, "utf8")));

          this.#remindersFor(profileId).set(reminder.name, reminder);
          this.#arm(profileId, reminder);
        } catch (error) {
          console.warn(`skipping reminder ${path}`, error);
        }
      }
    }
  }

  async schedule(
    profileId: ProfileId,
    input: ScheduleReminderInput,
    threadTs?: string,
  ): Promise<ScheduledReminder> {
    const now = Date.now();
    const fireAt = computeFireAt(input, now);
    const reminder: ScheduledReminder = {
      name: input.name,
      fireAt,
      prompt: input.prompt,
      createdAt: new Date(now).toISOString(),
      ...(threadTs !== undefined ? { threadTs } : {}),
    };

    await mkdir(join(this.#dir, profileId), { recursive: true, mode: 0o700 });
    await writeFile(this.#fileFor(profileId, reminder.name), JSON.stringify(reminder), {
      mode: 0o600,
    });
    this.#remindersFor(profileId).set(reminder.name, reminder);
    this.#arm(profileId, reminder);

    return reminder;
  }

  list(profileId: ProfileId): ScheduledReminder[] {
    return [...(this.#reminders.get(profileId)?.values() ?? [])].toSorted((a, b) =>
      a.fireAt.localeCompare(b.fireAt),
    );
  }

  async cancel(profileId: ProfileId, name: EntryName): Promise<boolean> {
    this.#clearTimer(profileId, name);

    const existed = this.#reminders.get(profileId)?.delete(name) ?? false;

    await rm(this.#fileFor(profileId, name), { force: true });

    return existed;
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
      void this.#fire(profileId, reminder.name);
    }, delayMs);

    this.#timers.set(timerKey(profileId, reminder.name), timer);
  }

  async #fire(profileId: ProfileId, name: EntryName): Promise<void> {
    const reminder = this.#reminders.get(profileId)?.get(name);

    if (reminder === undefined) {
      return;
    }

    await this.cancel(profileId, name);
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

  #fileFor(profileId: ProfileId, name: EntryName): string {
    return join(this.#dir, profileId, `${name}.json`);
  }
}
