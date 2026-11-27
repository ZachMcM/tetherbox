import type { InternalApiHandlers, ProfileValidation } from "@tetherbox/core";
import type { LlmOAuth } from "../../credentials/llm-oauth.ts";
import type { OAuthStore } from "../../credentials/oauth-store.ts";
import type { SecretStore } from "../../credentials/secret-store.ts";
import type { Poller } from "../../jobs/poller.ts";
import type { ReminderStore } from "../../jobs/reminders.ts";
import { loadProfile, type ProfileRegistry } from "../../profiles/registry.ts";
import { proxyLlm } from "../../proxy/llm-proxy.ts";
import { proxyWithSecret } from "../../proxy/secret-proxy.ts";
import type { TurnRunner } from "../../sessions/turns.ts";

export interface InternalHandlerDeps {
  registry: ProfileRegistry;
  secrets: SecretStore;
  llmOAuth: LlmOAuth;
  oauth: OAuthStore;
  turns: TurnRunner;
  poller: Poller;
  reminders: ReminderStore;
}

export function createInternalHandlers({
  registry,
  secrets,
  llmOAuth,
  oauth,
  turns,
  poller,
  reminders,
}: InternalHandlerDeps): InternalApiHandlers {
  return {
    resolveRun: (token) => turns.resolveRun(token),
    notify: (run, input) => turns.notify(run, input),
    async checkSecret(key) {
      const secret = await secrets.get(key);

      if (secret !== undefined) {
        return { exists: true, kind: secret.binding.kind };
      }

      return (await oauth.has(key)) ? { exists: true, kind: "oauth" } : { exists: false };
    },
    async validateProfile(run): Promise<ProfileValidation> {
      const profile = registry.get(run.profileId);

      if (profile === undefined) {
        return { ok: false, issues: [{ file: run.profileId, message: "profile is not loaded" }] };
      }

      const load = await loadProfile(profile.id, profile.dir);

      return load.issues.length === 0 ? { ok: true } : { ok: false, issues: load.issues };
    },
    registerPollJob: async (run, input) => poller.register(run.profileId, input, run.sessionId),
    listPollJobs: (run) => poller.list(run.profileId),
    cancelPollJob: async (run, name) => ({ cancelled: poller.cancel(run.profileId, name) }),
    scheduleReminder: async (run, input) => reminders.schedule(run.profileId, input, run.sessionId),
    listReminders: (run) => reminders.list(run.profileId),
    cancelReminder: async (run, name) => ({
      cancelled: reminders.cancel(run.profileId, name),
    }),
    proxyWithSecret: (_run, request) => proxyWithSecret({ secrets, oauth }, request),
    proxyLlm(run, provider, request) {
      const model = turns.resolveRunModel(run.runId);
      const authKind = model?.provider === provider ? model.auth : "api-key";

      return proxyLlm({ secrets, oauth: llmOAuth }, { provider, authKind, request });
    },
  };
}
