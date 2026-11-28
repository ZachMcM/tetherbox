import { serve } from "@hono/node-server";
import { loadOrCreateAppToken } from "./servers/app/app-token.ts";
import { createAppServer } from "./servers/app/server.ts";
import { AgentProcessRunner } from "./clis/agent-process.ts";
import { CliAuthFlows } from "./clis/auth-flows.ts";
import { CliInstallJobs } from "./clis/install-jobs.ts";
import { CliStatusProbe } from "./clis/status.ts";
import type { DaemonConfig } from "./config.ts";
import { openDaemonDb } from "./db/database.ts";
import { DaemonEventBus } from "./events.ts";
import { startInternalServer } from "./servers/internal/server.ts";
import type { LlmOAuth } from "./credentials/llm-oauth.ts";
import { LlmWebAuthManager } from "./credentials/llm-web-auth.ts";
import type { OAuthStore } from "./credentials/oauth-store.ts";
import { removePidFile, writePidFile } from "./pid.ts";
import { Poller } from "./jobs/poller.ts";
import { ProfileRegistry } from "./profiles/registry.ts";
import { createPublicServer } from "./servers/public/server.ts";
import { ReminderStore } from "./jobs/reminders.ts";
import { Scheduler } from "./jobs/scheduler.ts";
import { StarterCatalog } from "./profiles/starter-catalog.ts";
import type { SecretStore } from "./credentials/secret-store.ts";
import { TurnRunner } from "./sessions/turns.ts";
import { loadOrCreateVapidKeys } from "./credentials/vapid.ts";

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
  const db = openDaemonDb(config.dataDir);
  const resetCount = db.sessions.resetRunning();

  if (resetCount > 0) {
    console.warn(`reset ${resetCount} stale running session(s) from a previous daemon run`);
  }

  const events = new DaemonEventBus();
  const llmWebAuth = new LlmWebAuthManager(llmOAuth);
  const catalog = new StarterCatalog(config.dataDir);
  const agentRunner = new AgentProcessRunner(config.agent.user);
  const cliStatus = new CliStatusProbe({ runner: agentRunner, catalog });
  const cliInstalls = new CliInstallJobs({ runner: agentRunner, catalog, events });
  const cliAuthFlows = new CliAuthFlows({ runner: agentRunner, catalog, events });
  const registry = new ProfileRegistry(config.profilesDir);
  const scheduler = new Scheduler((profile, name, job) => {
    turns.enqueue(
      profile.id,
      { kind: "cron", job: name, prompt: job.prompt },
      { sessionId: job.sessionId },
    );
  });
  const poller = new Poller({
    table: db.pollJobs,
    runner: agentRunner,
    profileDir: (profileId) => registry.get(profileId)?.dir,
    onFire(profileId, registered, outcome) {
      if (registry.get(profileId) !== undefined) {
        turns.enqueue(
          profileId,
          { kind: "poll", job: registered.name, prompt: registered.job.prompt, ...outcome },
          { sessionId: registered.sessionId },
        );
      }
    },
  });
  const reminders = new ReminderStore(db.reminders, (profileId, reminder) => {
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
    sessions: db.sessions,
    settings: db.settings,
    events,
    onProfileReloaded: async (profile) => [
      ...scheduler.sync(profile),
      ...(await catalog.sync(profile)),
    ],
  });

  const reloadAll = async () => {
    const issues = [...(await catalog.load()), ...(await registry.loadAll())];

    issues.push(...scheduler.syncAll(registry.all()));

    for (const profile of registry.all()) {
      issues.push(...(await catalog.sync(profile)));
    }

    for (const issue of issues) {
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
      cliStatus,
      cliInstalls,
      cliAuthFlows,
      catalog,
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
      cliInstalls.stop();
      cliAuthFlows.stop();
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
