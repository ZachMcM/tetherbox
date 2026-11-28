import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import type { EntryName } from "../../../ids.ts";
import {
  registerPollJobInputSchema,
  type RegisteredPollJob,
  type RegisterPollJobInput,
} from "../../../poll.ts";
import { entryNameParam } from "../../params.ts";
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
    .delete("/rpc/poll-jobs/:name", zValidator("param", entryNameParam), async (c) =>
      c.json(await handlers.cancel(c.get("run"), c.req.valid("param").name)),
    );
}
