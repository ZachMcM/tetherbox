import type { InternalApiHandlers } from "@tetherbox/core";
import type { LlmOAuth } from "../../../credentials/llm-oauth.ts";
import type { OAuthStore } from "../../../credentials/oauth-store.ts";
import type { SecretStore } from "../../../credentials/secret-store.ts";
import type { Poller } from "../../../jobs/poller.ts";
import type { ReminderStore } from "../../../jobs/reminders.ts";
import type { ProfileRegistry } from "../../../profiles/registry.ts";
import type { TurnRunner } from "../../../sessions/turns.ts";
import { createNotifyHandlers } from "./notify.ts";
import { createPollJobHandlers } from "./poll-jobs.ts";
import { createProfileValidationHandlers } from "./profile.ts";
import { createProxyHandlers } from "./proxy.ts";
import { createReminderHandlers } from "./reminders.ts";
import { createSecretCheckHandlers } from "./secrets.ts";

export interface InternalHandlerDeps {
  registry: ProfileRegistry;
  secrets: SecretStore;
  llmOAuth: LlmOAuth;
  oauth: OAuthStore;
  turns: TurnRunner;
  poller: Poller;
  reminders: ReminderStore;
}

export function createInternalHandlers(deps: InternalHandlerDeps): InternalApiHandlers {
  return {
    resolveRun: (token) => deps.turns.resolveRun(token),
    notify: createNotifyHandlers(deps),
    secrets: createSecretCheckHandlers(deps),
    profile: createProfileValidationHandlers(deps),
    pollJobs: createPollJobHandlers(deps),
    reminders: createReminderHandlers(deps),
    proxy: createProxyHandlers(deps),
  };
}
