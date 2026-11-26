import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  profileIdSchema,
  registeredPollJobSchema,
  type EntryName,
  type ProfileId,
  type RegisteredPollJob,
  type RegisterPollJobInput,
} from "@tetherbox/core";

export type PollOutcome = { status: "done" | "stalled"; output: string };
export type PollFire = (profileId: ProfileId, job: RegisteredPollJob, outcome: PollOutcome) => void;

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/**
 * Watches long-running external tasks (such as coding harness sessions) that agent runs register
 * over RPC, and starts a follow-up run when one finishes or stalls. Jobs are daemon-owned state in
 * `<dataDir>/poller/<profileId>/<name>.json`, so they survive restarts and stay out of profile git.
 */
export class Poller {
  readonly #dir: string;
  readonly #jobs = new Map<ProfileId, Map<EntryName, RegisteredPollJob>>();
  readonly #onFire: PollFire;

  constructor(dataDir: string, onFire: PollFire) {
    this.#dir = join(dataDir, "poller");
    this.#onFire = onFire;
  }

  async loadAll(): Promise<void> {
    let profileDirs: string[];

    try {
      profileDirs = await readdir(this.#dir);
    } catch (error) {
      if (isMissing(error)) {
        return;
      }

      throw error;
    }

    for (const dir of profileDirs) {
      const profileId = profileIdSchema.parse(dir);

      for (const file of await readdir(join(this.#dir, dir))) {
        const path = join(this.#dir, dir, file);

        try {
          const job = registeredPollJobSchema.parse(JSON.parse(await readFile(path, "utf8")));

          this.#jobsFor(profileId).set(job.name, job);
        } catch (error) {
          console.warn(`skipping poll job ${path}`, error);
        }
      }
    }

    // TODO: Start each loaded job's check loop.
  }

  async register(
    profileId: ProfileId,
    input: RegisterPollJobInput,
    origin: { channelId: string; threadTs: string | undefined },
  ): Promise<RegisteredPollJob> {
    const { name, ...job } = input;
    const registered: RegisteredPollJob = {
      name,
      job,
      registeredAt: new Date().toISOString(),
      channelId: origin.channelId,
      ...(origin.threadTs !== undefined ? { threadTs: origin.threadTs } : {}),
    };

    await mkdir(join(this.#dir, profileId), { recursive: true, mode: 0o700 });
    await writeFile(this.#fileFor(profileId, name), JSON.stringify(registered), { mode: 0o600 });
    this.#jobsFor(profileId).set(name, registered);
    // TODO: Run the job's check command every intervalSeconds as the agent OS user (never inside
    // the daemon process), define the check's stdout contract (running, done, failed), and call
    // complete() on done or once stallAfterSeconds pass without progress.

    return registered;
  }

  list(profileId: ProfileId): RegisteredPollJob[] {
    return [...(this.#jobs.get(profileId)?.values() ?? [])];
  }

  async cancel(profileId: ProfileId, name: EntryName): Promise<boolean> {
    const existed = this.#jobs.get(profileId)?.delete(name) ?? false;

    await rm(this.#fileFor(profileId, name), { force: true });

    return existed;
  }

  async complete(profileId: ProfileId, name: EntryName, outcome: PollOutcome): Promise<void> {
    const job = this.#jobs.get(profileId)?.get(name);

    if (job === undefined) {
      return;
    }

    await this.cancel(profileId, name);
    this.#onFire(profileId, job, outcome);
  }

  stopAll(): void {
    // TODO: Stop the check loops once they exist.
  }

  #jobsFor(profileId: ProfileId): Map<EntryName, RegisteredPollJob> {
    let jobs = this.#jobs.get(profileId);

    if (jobs === undefined) {
      jobs = new Map();
      this.#jobs.set(profileId, jobs);
    }

    return jobs;
  }

  #fileFor(profileId: ProfileId, name: EntryName): string {
    return join(this.#dir, profileId, `${name}.json`);
  }
}
