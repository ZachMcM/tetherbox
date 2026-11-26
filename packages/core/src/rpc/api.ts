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
} from "../ids.ts";
import { llmProviderSchema, type LlmProvider } from "../llm-auth.ts";
import {
  registerPollJobInputSchema,
  type RegisteredPollJob,
  type RegisterPollJobInput,
} from "../poll.ts";
import type { ProfileValidation } from "../profile.ts";
import {
  scheduleReminderInputSchema,
  type ScheduledReminder,
  type ScheduleReminderInput,
} from "../reminder.ts";
import type { SecretCheckResult } from "../secrets.ts";
import { RUN_TOKEN_HEADER } from "./headers.ts";

export class RpcError extends Error {
  readonly status: 400 | 404 | 409;

  constructor(status: 400 | 404 | 409, message: string) {
    super(message);
    this.status = status;
  }
}

export interface RunContext {
  runId: RunId;
  profileId: ProfileId;
}

export const MAX_UPLOAD_FILE_BYTES = 10 * 1024 * 1024;
const MAX_UPLOAD_BASE64_CHARS = Math.ceil((MAX_UPLOAD_FILE_BYTES * 4) / 3) + 4;

export const sendMessageInputSchema = z.object({
  text: z.string().min(1),
  channel: entryNameSchema.optional(),
});
export type SendMessageInput = z.infer<typeof sendMessageInputSchema>;

export const sendFileInputSchema = z.object({
  filename: z.string().min(1).max(255),
  contentBase64: z.string().min(1).max(MAX_UPLOAD_BASE64_CHARS),
  title: z.string().min(1).max(255).optional(),
  initialComment: z.string().min(1).optional(),
  channel: entryNameSchema.optional(),
});
export type SendFileInput = z.infer<typeof sendFileInputSchema>;

export const addReactionInputSchema = z.object({ emoji: z.string().regex(/^[a-z0-9_+-]+$/) });
export type AddReactionInput = z.infer<typeof addReactionInputSchema>;

export interface InternalApiHandlers {
  resolveRun(runToken: string): RunContext | undefined;
  sendMessage(run: RunContext, input: SendMessageInput): Promise<{ ts: string }>;
  sendFile(run: RunContext, input: SendFileInput): Promise<void>;
  addReaction(run: RunContext, input: AddReactionInput): Promise<void>;
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

function bearerToken(header: string | undefined): string | undefined {
  if (header === undefined) {
    return undefined;
  }

  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());

  return match?.[1];
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
    .post("/rpc/messages", zValidator("json", sendMessageInputSchema), async (c) =>
      c.json(await handlers.sendMessage(c.get("run"), c.req.valid("json"))),
    )
    .post("/rpc/files", zValidator("json", sendFileInputSchema), async (c) => {
      await handlers.sendFile(c.get("run"), c.req.valid("json"));

      return c.body(null, 204);
    })
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
