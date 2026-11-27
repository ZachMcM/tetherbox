import { Hono } from "hono";
import { RpcError } from "../../errors.ts";
import { createCliRoutes, type CliHandlers } from "./clis.ts";
import { createLlmRoutes, type LlmHandlers } from "./llm.ts";
import { createOAuthRoutes, type OAuthHandlers } from "./oauth.ts";
import { createProfileRoutes, type ProfileHandlers } from "./profiles.ts";
import { createPushRoutes, type PushHandlers } from "./push.ts";
import { createSecretRoutes, type SecretHandlers } from "./secrets.ts";
import { createSessionRoutes, type SessionHandlers } from "./sessions.ts";
import { createSettingsRoutes, type SettingsHandlers } from "./settings.ts";
import { createStarterRoutes, type StarterHandlers } from "./starters.ts";

export type {
  CliHandlers,
  LlmHandlers,
  OAuthHandlers,
  ProfileHandlers,
  PushHandlers,
  SecretHandlers,
  SessionHandlers,
  SettingsHandlers,
  StarterHandlers,
};

export interface AppApiHandlers {
  settings: SettingsHandlers;
  profiles: ProfileHandlers;
  starters: StarterHandlers;
  clis: CliHandlers;
  sessions: SessionHandlers;
  secrets: SecretHandlers;
  llm: LlmHandlers;
  oauth: OAuthHandlers;
  push: PushHandlers;
}

/**
 * Typed Hono RPC routes mounted under `/api` on the daemon's private app server. Both `apps/web`
 * and thin CLI shims use the inferred type through `createAppClient`.
 */
export function createAppApi(handlers: AppApiHandlers) {
  return new Hono()
    .onError((error, c) => {
      if (error instanceof RpcError) {
        return c.json({ error: error.message }, error.status);
      }

      console.error(error);

      return c.json(
        { error: error instanceof Error ? error.message : "Internal Server Error" },
        500,
      );
    })
    .route("/", createSettingsRoutes(handlers.settings))
    .route("/", createProfileRoutes(handlers.profiles))
    .route("/", createStarterRoutes(handlers.starters))
    .route("/", createCliRoutes(handlers.clis))
    .route("/", createSessionRoutes(handlers.sessions))
    .route("/", createSecretRoutes(handlers.secrets))
    .route("/", createLlmRoutes(handlers.llm))
    .route("/", createOAuthRoutes(handlers.oauth))
    .route("/", createPushRoutes(handlers.push));
}

export type AppApi = ReturnType<typeof createAppApi>;
