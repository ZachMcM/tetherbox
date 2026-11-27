import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { entryNameSchema, type EntryName } from "../../../ids.ts";
import {
  registerPollJobInputSchema,
  type RegisteredPollJob,
  type RegisterPollJobInput,
} from "../../../poll.ts";
import type { InternalEnv, RunContext } from "../run-context.ts";

export interface PollJobHandlers {
  register(run: RunContext, input: RegisterPollJobInput): Promise<RegisteredPollJob>;
  list(run: RunContext): RegisteredPollJob[];
  cancel(run: RunContext, name: EntryName): Promise<{ cancelled: boolean }>;
}

export function createPollJobRoutes(handlers: PollJobHandlers) {
  return new Hono<InternalEnv>()
    .post("/rpc/poll-jobs", zValidator("json", registerPollJobInputSchema), async (c) =>
      c.json(await handlers.register(c.get("run"), c.req.valid("json"))),
    )
    .get("/rpc/poll-jobs", (c) => c.json({ jobs: handlers.list(c.get("run")) }))
    .delete(
      "/rpc/poll-jobs/:name",
      zValidator("param", z.object({ name: entryNameSchema })),
      async (c) => c.json(await handlers.cancel(c.get("run"), c.req.valid("param").name)),
    );
}
