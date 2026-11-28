import type { DatabaseSync } from "node:sqlite";
import { modelRefSchema, type ModelRef } from "@tetherbox/core";
import { z } from "zod";

const favoriteModelRowSchema = z.object({
  provider: z.string(),
  auth: z.string(),
  model_id: z.string(),
});

export class FavoriteModelTable {
  readonly #db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
  }

  list(): ModelRef[] {
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

  add(model: ModelRef): void {
    this.#db
      .prepare(
        `INSERT INTO favorite_models (provider, auth, model_id, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT DO NOTHING`,
      )
      .run(model.provider, model.auth, model.id, new Date().toISOString());
  }

  remove(model: ModelRef): void {
    this.#db
      .prepare("DELETE FROM favorite_models WHERE provider = ? AND auth = ? AND model_id = ?")
      .run(model.provider, model.auth, model.id);
  }
}
