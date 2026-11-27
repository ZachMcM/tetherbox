import type { DatabaseSync } from "node:sqlite";
import {
  modelSelectionSchema,
  type AppSettings,
  type UpdateAppSettingsInput,
} from "@tetherbox/core";
import { z } from "zod";
import { parseJsonColumn } from "./json-column.ts";

const appSettingRowSchema = z.object({
  key: z.string(),
  value_json: z.string(),
});

export class AppSettingsTable {
  readonly #db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
  }

  get(): AppSettings {
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

  update(input: UpdateAppSettingsInput): AppSettings {
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

    return this.get();
  }
}
