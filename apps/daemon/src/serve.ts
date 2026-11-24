import { serve } from "@hono/node-server";
import { secretKeySchema } from "@tetherbox/core";
import type { DaemonConfig } from "./config.ts";
import { startInternalServer } from "./internal-server.ts";
import { Poller } from "./poller.ts";
import { ProfileRegistry, type LoadedProfile } from "./profiles.ts";
import { createPublicServer } from "./public-server.ts";
import { Scheduler } from "./scheduler.ts";
import type { SecretStore } from "./secret-store.ts";
import { createSlack, type ReplyTarget } from "./slack.ts";
import { TurnRunner } from "./turns.ts";

async function requireSecret(secrets: SecretStore, key: string): Promise<string> {
  const secret = await secrets.get(secretKeySchema.parse(key));

  if (secret === undefined) {
    throw new Error(`${key} is not set. Add it with: tetherbox secrets set ${key}`);
  }

  return secret.value;
}

function channelOf(profile: LoadedProfile): ReplyTarget {
  return { kind: "channel", channelId: profile.config.slackChannelId };
}

export async function serveDaemon(config: DaemonConfig, secrets: SecretStore): Promise<void> {
  const registry = new ProfileRegistry(config.profilesDir);
  const scheduler = new Scheduler((profile, name, job) =>
    turns.enqueue(profile.id, { kind: "cron", job: name, prompt: job.prompt }, channelOf(profile)),
  );
  const poller = new Poller(config.dataDir, (profileId, { name, job }, outcome) => {
    const profile = registry.get(profileId);

    if (profile !== undefined) {
      turns.enqueue(
        profileId,
        { kind: "poll", job: name, prompt: job.prompt, ...outcome },
        channelOf(profile),
      );
    }
  });
  const slack = createSlack({
    appToken: await requireSecret(secrets, "SLACK_APP_TOKEN"),
    botToken: await requireSecret(secrets, "SLACK_BOT_TOKEN"),
    onMessage(message) {
      const profile = registry.byChannel(message.channelId);

      if (profile === undefined) {
        return;
      }

      turns.enqueue(
        profile.id,
        { kind: "slack", userId: message.userId, text: message.text },
        {
          kind: "thread",
          channelId: message.channelId,
          threadTs: message.threadTs ?? message.ts,
          sourceTs: message.ts,
        },
      );
    },
  });
  const turns = new TurnRunner({
    config,
    registry,
    slack: slack.transport,
    onProfileReloaded: (profile) => scheduler.sync(profile),
  });

  for (const issue of await registry.loadAll()) {
    console.warn(`${issue.file}: ${issue.message}`);
  }

  for (const profile of registry.all()) {
    for (const issue of scheduler.sync(profile)) {
      console.warn(`${issue.file}: ${issue.message}`);
    }
  }

  await poller.loadAll();

  const internal = await startInternalServer({
    socketPath: config.socketPath,
    registry,
    secrets,
    turns,
    poller,
  });
  const publicServer = serve({
    fetch: createPublicServer({ registry, secrets, turns }).fetch,
    hostname: config.publicHost,
    port: config.publicPort,
  });

  await slack.start();
  console.log(`tetherbox daemon serving ${registry.all().length} profile(s)`);

  const shutdown = async () => {
    scheduler.stopAll();
    poller.stopAll();
    await slack.stop();
    internal.close();
    publicServer.close();
  };

  process.once("SIGTERM", () => void shutdown());
  process.once("SIGINT", () => void shutdown());
}
