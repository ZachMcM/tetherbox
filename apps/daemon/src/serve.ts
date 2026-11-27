import { serve } from "@hono/node-server";
import { loadOrCreateAppToken } from "./app-auth.ts";
import { createAppServer } from "./app-server.ts";
import { CliManager } from "./cli-manager.ts";
import type { DaemonConfig } from "./config.ts";
import { DaemonDb } from "./db.ts";
import { DaemonEventBus } from "./events.ts";
import { startInternalServer } from "./internal-server.ts";
import type { LlmOAuth } from "./llm-oauth.ts";
import { LlmWebAuthManager } from "./llm-web-auth.ts";
import type { OAuthStore } from "./oauth.ts";
import { removePidFile, writePidFile } from "./pid.ts";
import { Poller } from "./poller.ts";
import { ProfileRegistry } from "./profiles.ts";
import { createPublicServer } from "./public-server.ts";
import { ReminderStore } from "./reminders.ts";
import { Scheduler } from "./scheduler.ts";
import type { SecretStore } from "./secret-store.ts";
import { TurnRunner } from "./turns.ts";
import { loadOrCreateVapidKeys } from "./vapid.ts";

export interface DaemonStores {
  secrets: SecretStore;
  llmOAuth: LlmOAuth;
  oauth: OAuthStore;
}

export async function serveDaemon(
  config: DaemonConfig,
  { secrets, llmOAuth, oauth }: DaemonStores,
): Promise<void> {
  const appToken = loadOrCreateAppToken(config.dataDir);
  const vapidKeys = loadOrCreateVapidKeys(config.dataDir);
  const db = new DaemonDb(config.dataDir);
  const resetCount = db.resetRunningSessions();

  if (resetCount > 0) {
    console.warn(`reset ${resetCount} stale running session(s) from a previous daemon run`);
  }

  const events = new DaemonEventBus();
  const llmWebAuth = new LlmWebAuthManager(llmOAuth);
  const clis = new CliManager(config.agent.user);
  const registry = new ProfileRegistry(config.profilesDir);
  const scheduler = new Scheduler((profile, name, job) => {
    turns.enqueue(
      profile.id,
      { kind: "cron", job: name, prompt: job.prompt },
      { sessionId: job.sessionId },
    );
  });
  const poller = new Poller(db, (profileId, registered, outcome) => {
    const profile = registry.get(profileId);

    if (profile !== undefined) {
      turns.enqueue(
        profileId,
        { kind: "poll", job: registered.name, prompt: registered.job.prompt, ...outcome },
        { sessionId: registered.sessionId },
      );
    }
  });
  const reminders = new ReminderStore(db, (profileId, reminder) => {
    const profile = registry.get(profileId);

    if (profile !== undefined) {
      turns.enqueue(
        profileId,
        { kind: "reminder", name: reminder.name, prompt: reminder.prompt },
        { sessionId: reminder.sessionId },
      );
    }
  });
  const turns = new TurnRunner({
    config,
    registry,
    llmOAuth,
    db,
    events,
    onProfileReloaded: (profile) => scheduler.sync(profile),
  });

  const reloadAll = async () => {
    for (const issue of await registry.loadAll()) {
      console.warn(`${issue.file}: ${issue.message}`);
    }

    for (const issue of scheduler.syncAll(registry.all())) {
      console.warn(`${issue.file}: ${issue.message}`);
    }
  };

  await reloadAll();
  poller.loadAll();
  reminders.loadAll();

  const shutdownController = new AbortController();
  const internal = await startInternalServer({
    socketPath: config.socketPath,
    registry,
    secrets,
    llmOAuth,
    oauth,
    turns,
    poller,
    reminders,
  });
  const publicServer = serve({
    fetch: createPublicServer({ registry, secrets, turns }).fetch,
    hostname: config.publicHost,
    port: config.publicPort,
  });
  const appServer = serve({
    fetch: createAppServer({
      config,
      appToken,
      vapidKeys,
      db,
      events,
      registry,
      scheduler,
      poller,
      reminders,
      turns,
      secrets,
      llmOAuth,
      llmWebAuth,
      oauth,
      clis,
      shutdownSignal: shutdownController.signal,
    }).fetch,
    hostname: config.appHost,
    port: config.appPort,
  });

  await writePidFile(config.dataDir);
  console.log(
    `tetherbox daemon serving ${registry.all().length} profile(s) (app http://${config.appHost}:${config.appPort}, public http://${config.publicHost}:${config.publicPort})`,
  );

  let reloadChain = Promise.resolve();
  const onReload = () => {
    reloadChain = reloadChain
      .then(() => reloadAll())
      .then(() => {
        console.log(`reloaded ${registry.all().length} profile(s)`);
      })
      .catch((error) => {
        console.error("failed to reload profiles", error);
      });
  };

  process.on("SIGHUP", onReload);

  let shutdownPromise: Promise<void> | undefined;
  const shutdown = () => {
    shutdownPromise ??= (async () => {
      process.off("SIGHUP", onReload);
      scheduler.stopAll();
      poller.stopAll();
      reminders.stopAll();
      llmWebAuth.stopAll();
      clis.stopAll();
      shutdownController.abort();
      internal.close();
      publicServer.close();
      appServer.close();
      await turns.shutdown();
      db.close();
      await removePidFile(config.dataDir);
    })();

    return shutdownPromise;
  };

  process.once("SIGTERM", () => void shutdown());
  process.once("SIGINT", () => void shutdown());
}
