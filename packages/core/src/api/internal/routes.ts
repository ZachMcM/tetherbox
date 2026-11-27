import { zValidator } from "@hono/zod-validator";
import { Hono, type Context } from "hono";
import { z } from "zod";
import {
  entryNameSchema,
  secretKeySchema,
  type EntryName,
  type ProfileId,
  type RunId,
  type SecretKey,
  type SessionId,
} from "../../ids.ts";
import { llmProviderSchema, type LlmProvider } from "../../llm-auth.ts";
import {
  registerPollJobInputSchema,
  type RegisteredPollJob,
  type RegisterPollJobInput,
} from "../../poll.ts";
import type { ProfileValidation } from "../../profile.ts";
import {
  scheduleReminderInputSchema,
  type ScheduledReminder,
  type ScheduleReminderInput,
} from "../../reminder.ts";
import type { SecretCheckResult } from "../../secrets.ts";
import { RpcError } from "../errors.ts";
import { bearerToken, RUN_TOKEN_HEADER } from "../headers.ts";
import { notifyInputSchema, type NotifyInput } from "./schemas.ts";

export interface RunContext {
  runId: RunId;
  profileId: ProfileId;
  sessionId: SessionId;
}

export interface InternalApiHandlers {
  resolveRun(runToken: string): RunContext | undefined;
  notify(run: RunContext, input: NotifyInput): Promise<void> | void;
  checkSecret(key: SecretKey): Promise<SecretCheckResult>;
  validateProfile(run: RunContext): Promise<ProfileValidation>;
  registerPollJob(run: RunContext, input: RegisterPollJobInput): Promise<RegisteredPollJob>;
  listPollJobs(run: RunContext): RegisteredPollJob[];
  cancelPollJob(run: RunContext, name: EntryName): Promise<{ cancelled: boolean }>;
  scheduleReminder(run: RunContext, input: ScheduleReminderInput): Promise<ScheduledReminder>;
  listReminders(run: RunContext): ScheduledReminder[];
  cancelReminder(run: RunContext, name: EntryName): Promise<{ cancelled: boolean }>;
  proxyWithSecret(run: RunContext, request: Request): Promise<Response>;
  proxyLlm(run: RunContext, provider: LlmProvider, request: Request): Promise<Response>;
}

function runTokenCandidates(c: Context): readonly (string | undefined)[] {
  const explicit = c.req.header(RUN_TOKEN_HEADER)?.trim();

  if (!c.req.path.startsWith("/llm/")) {
    return [explicit];
  }

  return [
    explicit,
    bearerToken(c.req.header("authorization")),
    c.req.header("x-api-key")?.trim(),
    c.req.header("x-goog-api-key")?.trim(),
  ];
}

/**
 * Routes served on the daemon's Unix socket. The daemon supplies the handlers; agent runs and
 * modules use the inferred type through `createInternalClient`.
 */
export function createInternalApi(handlers: InternalApiHandlers) {
  return new Hono<{ Variables: { run: RunContext } }>()
    .onError((error, c) => {
      if (error instanceof RpcError) {
        return c.json({ error: error.message }, error.status);
      }

      console.error(error);

      return c.text("Internal Server Error", 500);
    })
    .use(async (c, next) => {
      let run: RunContext | undefined;

      for (const token of runTokenCandidates(c)) {
        if (token === undefined || token === "") {
          continue;
        }

        run = handlers.resolveRun(token);

        if (run !== undefined) {
          break;
        }
      }

      if (run === undefined) {
        return c.json({ error: "unknown run token" }, 401);
      }

      c.set("run", run);
      await next();
    })
    .post("/rpc/notify", zValidator("json", notifyInputSchema), async (c) => {
      await handlers.notify(c.get("run"), c.req.valid("json"));

      return c.body(null, 204);
    })
    .get("/rpc/secrets/:key", zValidator("param", z.object({ key: secretKeySchema })), async (c) =>
      c.json(await handlers.checkSecret(c.req.valid("param").key)),
    )
    .post("/rpc/profile/validate", async (c) =>
      c.json(await handlers.validateProfile(c.get("run"))),
    )
    .post("/rpc/poll-jobs", zValidator("json", registerPollJobInputSchema), async (c) =>
      c.json(await handlers.registerPollJob(c.get("run"), c.req.valid("json"))),
    )
    .get("/rpc/poll-jobs", (c) => c.json({ jobs: handlers.listPollJobs(c.get("run")) }))
    .delete(
      "/rpc/poll-jobs/:name",
      zValidator("param", z.object({ name: entryNameSchema })),
      async (c) => c.json(await handlers.cancelPollJob(c.get("run"), c.req.valid("param").name)),
    )
    .post("/rpc/reminders", zValidator("json", scheduleReminderInputSchema), async (c) =>
      c.json(await handlers.scheduleReminder(c.get("run"), c.req.valid("json"))),
    )
    .get("/rpc/reminders", (c) => c.json({ reminders: handlers.listReminders(c.get("run")) }))
    .delete(
      "/rpc/reminders/:name",
      zValidator("param", z.object({ name: entryNameSchema })),
      async (c) => c.json(await handlers.cancelReminder(c.get("run"), c.req.valid("param").name)),
    )
    .all("/proxy/*", (c) => handlers.proxyWithSecret(c.get("run"), c.req.raw))
    .all("/llm/:provider/*", zValidator("param", z.object({ provider: llmProviderSchema })), (c) =>
      handlers.proxyLlm(c.get("run"), c.req.valid("param").provider, c.req.raw),
    );
}

export type InternalApi = ReturnType<typeof createInternalApi>;
