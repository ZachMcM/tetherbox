import type { DatabaseSync } from "node:sqlite";
import {
  profileIdSchema,
  registeredPollJobSchema,
  type EntryName,
  type ProfileId,
  type RegisteredPollJob,
} from "@tetherbox/core";
import { z } from "zod";

const pollJobRowSchema = z.object({
  profile_id: z.string(),
  name: z.string(),
  session_id: z.string(),
  job_json: z.string(),
  registered_at: z.string(),
});

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

export class PollJobTable {
  readonly #db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
  }

  listAll(): { profileId: ProfileId; job: RegisteredPollJob }[] {
    return this.#db.prepare("SELECT * FROM poll_jobs").all().map(mapPollJobRow);
  }

  upsert(profileId: ProfileId, job: RegisteredPollJob): void {
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

  delete(profileId: ProfileId, name: EntryName): boolean {
    const result = this.#db
      .prepare("DELETE FROM poll_jobs WHERE profile_id = ? AND name = ?")
      .run(profileId, name);

    return Number(result.changes) > 0;
  }
}
