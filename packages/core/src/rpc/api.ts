import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import {
  entryNameSchema,
  secretKeySchema,
  type EntryName,
  type ProfileId,
  type RunId,
  type SecretKey,
} from "../ids.ts";
import {
  registerPollJobInputSchema,
  type RegisteredPollJob,
  type RegisterPollJobInput,
} from "../poll.ts";
import type { ProfileValidation } from "../profile.ts";
import type { SecretCheckResult } from "../secrets.ts";
import { RUN_TOKEN_HEADER } from "./headers.ts";

export interface RunContext {
  runId: RunId;
  profileId: ProfileId;
}

export const sendMessageInputSchema = z.object({ text: z.string().min(1) });
export type SendMessageInput = z.infer<typeof sendMessageInputSchema>;

export const addReactionInputSchema = z.object({ emoji: z.string().regex(/^[a-z0-9_+-]+$/) });
export type AddReactionInput = z.infer<typeof addReactionInputSchema>;

export interface InternalApiHandlers {
  resolveRun(runToken: string): RunContext | undefined;
  sendMessage(run: RunContext, input: SendMessageInput): Promise<{ ts: string }>;
  addReaction(run: RunContext, input: AddReactionInput): Promise<void>;
  checkSecret(key: SecretKey): Promise<SecretCheckResult>;
  validateProfile(run: RunContext): Promise<ProfileValidation>;
  registerPollJob(run: RunContext, input: RegisterPollJobInput): Promise<RegisteredPollJob>;
  listPollJobs(run: RunContext): RegisteredPollJob[];
  cancelPollJob(run: RunContext, name: EntryName): Promise<{ cancelled: boolean }>;
  proxyWithSecret(run: RunContext, request: Request): Promise<Response>;
  proxyLlm(run: RunContext, provider: string, request: Request): Promise<Response>;
}

/**
 * Routes served on the daemon's Unix socket. The daemon supplies the handlers; agent runs and
 * modules use the inferred type through `createInternalClient`.
 */
export function createInternalApi(handlers: InternalApiHandlers) {
  return new Hono<{ Variables: { run: RunContext } }>()
    .use(async (c, next) => {
      const token = c.req.header(RUN_TOKEN_HEADER);
      const run = token === undefined ? undefined : handlers.resolveRun(token);

      if (run === undefined) {
        return c.json({ error: "unknown run token" }, 401);
      }

      c.set("run", run);
      await next();
    })
    .post("/rpc/messages", zValidator("json", sendMessageInputSchema), async (c) =>
      c.json(await handlers.sendMessage(c.get("run"), c.req.valid("json"))),
    )
    .post("/rpc/reactions", zValidator("json", addReactionInputSchema), async (c) => {
      await handlers.addReaction(c.get("run"), c.req.valid("json"));

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
    .all("/proxy/*", (c) => handlers.proxyWithSecret(c.get("run"), c.req.raw))
    .all("/llm/:provider/*", (c) =>
      handlers.proxyLlm(c.get("run"), c.req.param("provider"), c.req.raw),
    );
}

export type InternalApi = ReturnType<typeof createInternalApi>;
