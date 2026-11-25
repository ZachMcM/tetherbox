import { chmod, mkdir, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { createAdaptorServer } from "@hono/node-server";
import { createInternalApi, type ProfileValidation } from "@tetherbox/core";
import { proxyLlm } from "./llm-proxy.ts";
import type { Poller } from "./poller.ts";
import { loadProfile, type ProfileRegistry } from "./profiles.ts";
import { proxyWithSecret } from "./secret-proxy.ts";
import type { SecretStore } from "./secret-store.ts";
import type { TurnRunner } from "./turns.ts";

export interface InternalServerDeps {
  socketPath: string;
  registry: ProfileRegistry;
  secrets: SecretStore;
  turns: TurnRunner;
  poller: Poller;
}

export async function startInternalServer({
  socketPath,
  registry,
  secrets,
  turns,
  poller,
}: InternalServerDeps) {
  const app = createInternalApi({
    resolveRun: (token) => turns.resolveRun(token),
    sendMessage: (run, input) => turns.sendMessage(run, input),
    addReaction: (run, input) => turns.addReaction(run, input),
    async checkSecret(key) {
      const secret = await secrets.get(key);

      return secret === undefined ? { exists: false } : { exists: true, kind: secret.binding.kind };
    },
    async validateProfile(run): Promise<ProfileValidation> {
      const profile = registry.get(run.profileId);

      if (profile === undefined) {
        return { ok: false, issues: [{ file: run.profileId, message: "profile is not loaded" }] };
      }

      const load = await loadProfile(profile.id, profile.dir);

      return load.issues.length === 0 ? { ok: true } : { ok: false, issues: load.issues };
    },
    registerPollJob: (run, input) => poller.register(run.profileId, input),
    listPollJobs: (run) => poller.list(run.profileId),
    cancelPollJob: async (run, name) => ({ cancelled: await poller.cancel(run.profileId, name) }),
    proxyWithSecret: (_run, request) => proxyWithSecret(secrets, request),
    proxyLlm: (_run, provider, request) => proxyLlm(secrets, provider, request),
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
