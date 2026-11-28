import { Hono, type Context } from "hono";
import { RpcError } from "../../errors.ts";
import { bearerToken, RUN_TOKEN_HEADER } from "../../headers.ts";
import type { InternalEnv, RunContext } from "../run-context.ts";
import { createNotifyRoutes, type NotifyHandlers } from "./notify.ts";
import { createPollJobRoutes, type PollJobHandlers } from "./poll-jobs.ts";
import { createProfileValidationRoutes, type ProfileValidationHandlers } from "./profile.ts";
import { createProxyRoutes, type ProxyHandlers } from "./proxy.ts";
import { createReminderRoutes, type ReminderHandlers } from "./reminders.ts";
import { createSecretCheckRoutes, type SecretCheckHandlers } from "./secrets.ts";

export type { RunContext };
export type {
  NotifyHandlers,
  PollJobHandlers,
  ProfileValidationHandlers,
  ProxyHandlers,
  ReminderHandlers,
  SecretCheckHandlers,
};

export interface InternalApiHandlers {
  resolveRun(runToken: string): RunContext | undefined;
  notify: NotifyHandlers;
  secrets: SecretCheckHandlers;
  profile: ProfileValidationHandlers;
  pollJobs: PollJobHandlers;
  reminders: ReminderHandlers;
  proxy: ProxyHandlers;
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
  return new Hono<InternalEnv>()
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
    .route("/", createNotifyRoutes(handlers.notify))
    .route("/", createSecretCheckRoutes(handlers.secrets))
    .route("/", createProfileValidationRoutes(handlers.profile))
    .route("/", createPollJobRoutes(handlers.pollJobs))
    .route("/", createReminderRoutes(handlers.reminders))
    .route("/", createProxyRoutes(handlers.proxy));
}

export type InternalApi = ReturnType<typeof createInternalApi>;
