import type { DatabaseSync } from "node:sqlite";
import {
  profileIdSchema,
  scheduledReminderSchema,
  type EntryName,
  type ProfileId,
  type ScheduledReminder,
} from "@tetherbox/core";
import { z } from "zod";

const reminderRowSchema = z.object({
  profile_id: z.string(),
  name: z.string(),
  session_id: z.string(),
  fire_at: z.string(),
  prompt: z.string(),
  created_at: z.string(),
});

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

export class ReminderTable {
  readonly #db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
  }

  listAll(): { profileId: ProfileId; reminder: ScheduledReminder }[] {
    return this.#db
      .prepare("SELECT * FROM reminders ORDER BY fire_at ASC")
      .all()
      .map(mapReminderRow);
  }

  upsert(profileId: ProfileId, reminder: ScheduledReminder): void {
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

  delete(profileId: ProfileId, name: EntryName): boolean {
    const result = this.#db
      .prepare("DELETE FROM reminders WHERE profile_id = ? AND name = ?")
      .run(profileId, name);

    return Number(result.changes) > 0;
  }
}
