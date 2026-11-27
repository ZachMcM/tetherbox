import type { AppApiHandlers } from "@tetherbox/core";
import type { CliManager } from "./cli-manager.ts";
import type { DaemonConfig } from "./config.ts";
import type { DaemonDb } from "./db.ts";
import type { DaemonEventBus } from "./events.ts";
import type { LlmOAuth } from "./llm-oauth.ts";
import type { LlmWebAuthManager } from "./llm-web-auth.ts";
import type { OAuthStore } from "./oauth.ts";
import type { Poller } from "./poller.ts";
import type { ProfileRegistry } from "./profiles.ts";
import type { ReminderStore } from "./reminders.ts";
import type { Scheduler } from "./scheduler.ts";
import type { SecretStore } from "./secret-store.ts";
import type { StarterCatalog } from "./starter-catalog.ts";
import type { TurnRunner } from "./turns.ts";
import type { VapidKeys } from "./vapid.ts";
import { createCliHandlers } from "./app-handlers/clis.ts";
import { createLlmHandlers } from "./app-handlers/llm.ts";
import { createOAuthHandlers } from "./app-handlers/oauth.ts";
import { createProfileHandlers } from "./app-handlers/profiles.ts";
import { createPushHandlers } from "./app-handlers/push.ts";
import { createSecretHandlers } from "./app-handlers/secrets.ts";
import { createSessionHandlers } from "./app-handlers/sessions.ts";
import { createSettingsHandlers } from "./app-handlers/settings.ts";
import { createStarterHandlers } from "./app-handlers/starters.ts";

export interface AppHandlerDeps {
  config: DaemonConfig;
  vapidKeys: VapidKeys;
  db: DaemonDb;
  events: DaemonEventBus;
  registry: ProfileRegistry;
  scheduler: Scheduler;
  poller: Poller;
  reminders: ReminderStore;
  turns: TurnRunner;
  secrets: SecretStore;
  llmOAuth: LlmOAuth;
  llmWebAuth: LlmWebAuthManager;
  oauth: OAuthStore;
  clis: CliManager;
  catalog: StarterCatalog;
}

export function createAppHandlers(deps: AppHandlerDeps): AppApiHandlers {
  return {
    settings: createSettingsHandlers(deps),
    profiles: createProfileHandlers(deps),
    starters: createStarterHandlers(deps),
    clis: createCliHandlers(deps),
    sessions: createSessionHandlers(deps),
    secrets: createSecretHandlers(deps),
    llm: createLlmHandlers(deps),
    oauth: createOAuthHandlers(deps),
    push: createPushHandlers(deps),
  };
}
