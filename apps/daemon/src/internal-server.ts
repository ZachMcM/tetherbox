import { chmod, mkdir, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { createAdaptorServer } from "@hono/node-server";
import { createInternalApi, type ProfileValidation } from "@tetherbox/core";
import type { LlmOAuth } from "./llm-oauth.ts";
import { proxyLlm } from "./llm-proxy.ts";
import type { OAuthStore } from "./oauth.ts";
import type { Poller } from "./poller.ts";
import { loadProfile, type ProfileRegistry } from "./profiles.ts";
import type { ReminderStore } from "./reminders.ts";
import { proxyWithSecret } from "./secret-proxy.ts";
import type { SecretStore } from "./secret-store.ts";
import type { TurnRunner } from "./turns.ts";

export interface InternalServerDeps {
  socketPath: string;
  registry: ProfileRegistry;
  secrets: SecretStore;
  llmOAuth: LlmOAuth;
  oauth: OAuthStore;
  turns: TurnRunner;
  poller: Poller;
  reminders: ReminderStore;
}

export async function startInternalServer({
  socketPath,
  registry,
  secrets,
  llmOAuth,
  oauth,
  turns,
  poller,
  reminders,
}: InternalServerDeps) {
  const app = createInternalApi({
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
      const model = registry.get(run.profileId)?.config.model;
      const authKind = model?.provider === provider ? model.auth : "api-key";

      return proxyLlm({ secrets, oauth: llmOAuth }, { provider, authKind, request });
    },
  });
  const server = createAdaptorServer({ fetch: app.fetch });

  await mkdir(dirname(socketPath), { recursive: true });
  await rm(socketPath, { force: true });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });
  // TODO: Have the installer create a group shared by the daemon and agent users and chgrp the
  // socket to it, so 0660 lets agent runs connect and nobody else.
  await chmod(socketPath, 0o660);

  return server;
}
