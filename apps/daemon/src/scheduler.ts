import { join } from "node:path";
import {
  profileLayout,
  type CronJob,
  type EntryName,
  type ProfileId,
  type ProfileIssue,
} from "@tetherbox/core";
import { Cron } from "croner";
import type { LoadedProfile } from "./profiles.ts";

export type CronFire = (profile: LoadedProfile, name: EntryName, job: CronJob) => void;

export class Scheduler {
  readonly #jobs = new Map<ProfileId, Cron[]>();
  readonly #onFire: CronFire;

  constructor(onFire: CronFire) {
    this.#onFire = onFire;
  }

  sync(profile: LoadedProfile): ProfileIssue[] {
    this.remove(profile.id);

    const issues: ProfileIssue[] = [];
    const crons: Cron[] = [];

    for (const [name, job] of profile.cron) {
      try {
        crons.push(
          new Cron(
            job.schedule,
            { ...(job.timezone && { timezone: job.timezone }), protect: true },
            () => this.#onFire(profile, name, job),
          ),
        );
      } catch (error) {
        issues.push({
          file: join(profile.dir, profileLayout.cronDir, `${name}.json`),
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    this.#jobs.set(profile.id, crons);

    return issues;
  }

  syncAll(profiles: readonly LoadedProfile[]): ProfileIssue[] {
    const active = new Set(profiles.map((profile) => profile.id));

    for (const profileId of this.#jobs.keys()) {
      if (!active.has(profileId)) {
        this.remove(profileId);
      }
    }

    const issues: ProfileIssue[] = [];

    for (const profile of profiles) {
      issues.push(...this.sync(profile));
    }

    return issues;
  }

  remove(profileId: ProfileId): void {
    for (const cron of this.#jobs.get(profileId) ?? []) {
      cron.stop();
    }

    this.#jobs.delete(profileId);
  }

  stopAll(): void {
    for (const profileId of this.#jobs.keys()) {
      this.remove(profileId);
    }
  }
}
