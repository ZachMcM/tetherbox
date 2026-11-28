import { rm } from "node:fs/promises";
import { join } from "node:path";
import {
  RpcError,
  type ProfileDetail,
  type ProfileHandlers,
  type ProfileId,
  type ProfileSummary,
} from "@tetherbox/core";
import type { DaemonConfig } from "../../../config.ts";
import type { SessionTable } from "../../../db/sessions.ts";
import type { DaemonEventBus } from "../../../events.ts";
import type { Poller } from "../../../jobs/poller.ts";
import {
  createProfileOnDisk,
  deleteProfileOnDisk,
  readProfileMemoryFile,
  updateProfileOnDisk,
  writeProfileMemoryFile,
} from "../../../profiles/files.ts";
import {
  loadProfile,
  type LoadedProfile,
  type ProfileRegistry,
} from "../../../profiles/registry.ts";
import type { ReminderStore } from "../../../jobs/reminders.ts";
import type { Scheduler } from "../../../jobs/scheduler.ts";
import type { StarterCatalog } from "../../../profiles/starter-catalog.ts";
import type { TurnRunner } from "../../../sessions/turns.ts";
import { requireProfile } from "./require-profile.ts";

export function createProfileHandlers({
  config,
  sessions,
  events,
  registry,
  scheduler,
  poller,
  reminders,
  turns,
  catalog,
}: {
  config: DaemonConfig;
  sessions: SessionTable;
  events: DaemonEventBus;
  registry: ProfileRegistry;
  scheduler: Scheduler;
  poller: Poller;
  reminders: ReminderStore;
  turns: TurnRunner;
  catalog: StarterCatalog;
}): ProfileHandlers {
  const toSummary = (profile: LoadedProfile): ProfileSummary => ({
    id: profile.id,
    config: { ...profile.config, starters: catalog.enabledIds(profile) },
    cronCount: profile.cron.size,
    webhookCount: profile.webhooks.size,
    pollJobCount: poller.list(profile.id).length,
    reminderCount: reminders.list(profile.id).length,
  });

  const toDetail = async (profile: LoadedProfile): Promise<ProfileDetail> => {
    const [memory, load] = await Promise.all([
      readProfileMemoryFile(profile.dir),
      loadProfile(profile.id, profile.dir),
    ]);

    return {
      id: profile.id,
      config: { ...profile.config, starters: catalog.enabledIds(profile) },
      memory,
      cron: [...profile.cron.entries()].map(([name, job]) => ({ name, job })),
      webhooks: [...profile.webhooks.entries()].map(([name, webhook]) => ({ name, webhook })),
      pollJobs: poller.list(profile.id),
      reminders: reminders.list(profile.id),
      issues: load.issues,
      starterUpdates: await catalog.updatesFor(profile),
    };
  };

  const reloadOrThrow = async (id: ProfileId): Promise<LoadedProfile> => {
    const load = await registry.reload(id);

    if (load.kind === "invalid") {
      throw new RpcError(400, load.issues.map((issue) => issue.message).join("; "));
    }

    scheduler.sync(load.profile);

    return load.profile;
  };

  return {
    list() {
      return registry.all().map(toSummary);
    },
    async get(id) {
      return toDetail(requireProfile(registry, id));
    },
    async create(input) {
      await createProfileOnDisk({ profilesDir: config.profilesDir, catalog, input });

      return toDetail(await reloadOrThrow(input.id));
    },
    async update(id, input) {
      requireProfile(registry, id);
      await updateProfileOnDisk({ profilesDir: config.profilesDir, catalog, id, input });

      return toDetail(await reloadOrThrow(id));
    },
    async updateMemory(id, content) {
      const profile = requireProfile(registry, id);

      await writeProfileMemoryFile(profile.dir, content);

      return { content };
    },
    async delete(id) {
      requireProfile(registry, id);
      scheduler.remove(id);

      const existingIds = sessions.list(id).map((session) => session.id);

      try {
        await turns.cancelProfile(id, existingIds);
        poller.cancelByProfile(id);
        reminders.cancelByProfile(id);

        const deletedIds = sessions.deleteByProfile(id);

        await rm(join(config.sessionsDir, id), { recursive: true, force: true });
        await deleteProfileOnDisk(config.profilesDir, id);
        await registry.remove(id);

        for (const sessionId of deletedIds) {
          events.emit({ kind: "session_deleted", profileId: id, sessionId });
        }
      } finally {
        turns.finishProfileDeletion(id);
      }
    },
    async updateStarter(id, starterId) {
      await catalog.updateProfileCopy({ profile: requireProfile(registry, id), starterId });

      return toDetail(await reloadOrThrow(id));
    },
    cancelPollJob(id, name) {
      requireProfile(registry, id);

      return { cancelled: poller.cancel(id, name) };
    },
    cancelReminder(id, name) {
      requireProfile(registry, id);

      return { cancelled: reminders.cancel(id, name) };
    },
  };
}
