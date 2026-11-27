import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { entryNameSchema, type EntryName } from "../../../ids.ts";
import {
  scheduleReminderInputSchema,
  type ScheduledReminder,
  type ScheduleReminderInput,
} from "../../../reminder.ts";
import type { InternalEnv, RunContext } from "../run-context.ts";

export interface ReminderHandlers {
  schedule(run: RunContext, input: ScheduleReminderInput): Promise<ScheduledReminder>;
  list(run: RunContext): ScheduledReminder[];
  cancel(run: RunContext, name: EntryName): Promise<{ cancelled: boolean }>;
}

export function createReminderRoutes(handlers: ReminderHandlers) {
  return new Hono<InternalEnv>()
    .post("/rpc/reminders", zValidator("json", scheduleReminderInputSchema), async (c) =>
      c.json(await handlers.schedule(c.get("run"), c.req.valid("json"))),
    )
    .get("/rpc/reminders", (c) => c.json({ reminders: handlers.list(c.get("run")) }))
    .delete(
      "/rpc/reminders/:name",
      zValidator("param", z.object({ name: entryNameSchema })),
      async (c) => c.json(await handlers.cancel(c.get("run"), c.req.valid("param").name)),
    );
}
