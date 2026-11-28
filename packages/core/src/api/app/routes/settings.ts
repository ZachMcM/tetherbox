import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import {
  updateAppSettingsInputSchema,
  type AppSettings,
  type UpdateAppSettingsInput,
} from "../schemas.ts";

export interface SettingsHandlers {
  get(): AppSettings;
  update(input: UpdateAppSettingsInput): AppSettings;
}

export function createSettingsRoutes(handlers: SettingsHandlers) {
  return new Hono()
    .get("/settings", (c) => c.json(handlers.get(), 200))
    .patch("/settings", zValidator("json", updateAppSettingsInputSchema), (c) =>
      c.json(handlers.update(c.req.valid("json")), 200),
    );
}
