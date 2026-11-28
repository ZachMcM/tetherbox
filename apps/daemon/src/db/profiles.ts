import type { DatabaseSync } from "node:sqlite";
import {
  buddySchema,
  defaultBuddy,
  modelSelectionSchema,
  type ProfileId,
  type ProfileRecord,
} from "@tetherbox/core";
import { z } from "zod";
import { parseJsonColumn } from "./json-column.ts";

const profileRowSchema = z.object({
  profile_id: z.string(),
  name: z.string(),
  buddy_json: z.string(),
  model_json: z.string().nullable(),
});

type ProfileRow = z.infer<typeof profileRowSchema>;

function toRecord(row: ProfileRow): ProfileRecord {
  return {
    name: row.name,
    buddy: parseJsonColumn({
      column: "profiles.buddy_json",
      schema: buddySchema,
      raw: row.buddy_json,
      fallback: defaultBuddy(row.profile_id),
    }),
    model: parseJsonColumn({
      column: "profiles.model_json",
      schema: modelSelectionSchema.nullable(),
      raw: row.model_json,
      fallback: null,
    }),
  };
}

export class ProfileTable {
  readonly #db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
  }

  find(id: ProfileId): ProfileRecord | undefined {
    const raw = this.#db
      .prepare("SELECT profile_id, name, buddy_json, model_json FROM profiles WHERE profile_id = ?")
      .get(id);

    return raw === undefined ? undefined : toRecord(profileRowSchema.parse(raw));
  }

  get(id: ProfileId): ProfileRecord {
    return this.find(id) ?? { name: id, buddy: defaultBuddy(id), model: null };
  }

  ids(): string[] {
    return this.#db
      .prepare("SELECT profile_id FROM profiles")
      .all()
      .map((raw) => z.object({ profile_id: z.string() }).parse(raw).profile_id);
  }

  upsert(id: ProfileId, patch: Partial<ProfileRecord>): void {
    const next = { ...this.get(id), ...patch };

    this.#db
      .prepare(
        `INSERT INTO profiles (profile_id, name, buddy_json, model_json, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (profile_id) DO UPDATE SET
           name = excluded.name,
           buddy_json = excluded.buddy_json,
           model_json = excluded.model_json,
           updated_at = excluded.updated_at`,
      )
      .run(
        id,
        next.name,
        JSON.stringify(next.buddy),
        next.model === null ? null : JSON.stringify(next.model),
        new Date().toISOString(),
      );
  }

  delete(id: string): void {
    this.#db.prepare("DELETE FROM profiles WHERE profile_id = ?").run(id);
  }
}
