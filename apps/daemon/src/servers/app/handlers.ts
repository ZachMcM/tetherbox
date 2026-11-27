import type { AppApiHandlers } from "@tetherbox/core";
import type { CliAuthFlows } from "../../clis/auth-flows.ts";
import type { CliInstallJobs } from "../../clis/install-jobs.ts";
import type { CliStatusProbe } from "../../clis/status.ts";
import type { DaemonConfig } from "../../config.ts";
import type { DaemonDb } from "../../db/database.ts";
import type { DaemonEventBus } from "../../events.ts";
import type { LlmOAuth } from "../../credentials/llm-oauth.ts";
import type { LlmWebAuthManager } from "../../credentials/llm-web-auth.ts";
import type { OAuthStore } from "../../credentials/oauth-store.ts";
import type { Poller } from "../../jobs/poller.ts";
import type { ProfileRegistry } from "../../profiles/registry.ts";
import type { ReminderStore } from "../../jobs/reminders.ts";
import type { Scheduler } from "../../jobs/scheduler.ts";
import type { SecretStore } from "../../credentials/secret-store.ts";
import type { StarterCatalog } from "../../profiles/starter-catalog.ts";
import type { TurnRunner } from "../../sessions/turns.ts";
import type { VapidKeys } from "../../credentials/vapid.ts";
import { createCliHandlers } from "./handlers/clis.ts";
import { createLlmHandlers } from "./handlers/llm.ts";
import { createOAuthHandlers } from "./handlers/oauth.ts";
import { createProfileHandlers } from "./handlers/profiles.ts";
import { createPushHandlers } from "./handlers/push.ts";
import { createSecretHandlers } from "./handlers/secrets.ts";
import { createSessionHandlers } from "./handlers/sessions.ts";
import { createSettingsHandlers } from "./handlers/settings.ts";
import { createStarterHandlers } from "./handlers/starters.ts";

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
  cliStatus: CliStatusProbe;
  cliInstalls: CliInstallJobs;
  cliAuthFlows: CliAuthFlows;
  catalog: StarterCatalog;
}

export function createAppHandlers(deps: AppHandlerDeps): AppApiHandlers {
  const { db } = deps;

  return {
    settings: createSettingsHandlers({ settings: db.settings }),
    profiles: createProfileHandlers({ ...deps, sessions: db.sessions }),
    starters: createStarterHandlers(deps),
    clis: createCliHandlers(deps),
    sessions: createSessionHandlers({ ...deps, sessions: db.sessions }),
    secrets: createSecretHandlers(deps),
    llm: createLlmHandlers({ ...deps, favoriteModels: db.favoriteModels }),
    oauth: createOAuthHandlers(deps),
    push: createPushHandlers({ ...deps, pushSubscriptions: db.pushSubscriptions }),
  };
}
