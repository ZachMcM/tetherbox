import type {
  EntryName,
  ProfileId,
  RegisteredPollJob,
  RegisterPollJobInput,
  SessionId,
} from "@tetherbox/core";
import type { PollJobTable } from "../db/poll-jobs.ts";

export type PollOutcome = { status: "done" | "stalled"; output: string };
export type PollFire = (profileId: ProfileId, job: RegisteredPollJob, outcome: PollOutcome) => void;

/**
 * Watches long-running external tasks (such as coding harness sessions) that agent runs register
 * over RPC, and starts a follow-up run in the originating session when one finishes or stalls.
 */
export class Poller {
  readonly #table: PollJobTable;
  readonly #jobs = new Map<ProfileId, Map<EntryName, RegisteredPollJob>>();
  readonly #onFire: PollFire;

  constructor(table: PollJobTable, onFire: PollFire) {
    this.#table = table;
    this.#onFire = onFire;
  }

  loadAll(): void {
    this.#jobs.clear();

    for (const { profileId, job } of this.#table.listAll()) {
      this.#jobsFor(profileId).set(job.name, job);
    }

    // TODO: Start each loaded job's check loop.
  }

  register(
    profileId: ProfileId,
    input: RegisterPollJobInput,
    sessionId: SessionId,
  ): RegisteredPollJob {
    const { name, ...job } = input;
    const registered: RegisteredPollJob = {
      name,
      job,
      registeredAt: new Date().toISOString(),
      sessionId,
    };

    this.#table.upsert(profileId, registered);
    this.#jobsFor(profileId).set(name, registered);
    // TODO: Run the job's check command every intervalSeconds as the agent OS user (never inside
    // the daemon process), define the check's stdout contract (running, done, failed), and call
    // complete() on done or once stallAfterSeconds pass without progress.

    return registered;
  }

  list(profileId: ProfileId): RegisteredPollJob[] {
    return [...(this.#jobs.get(profileId)?.values() ?? [])];
  }

  cancel(profileId: ProfileId, name: EntryName): boolean {
    const existed = this.#jobs.get(profileId)?.delete(name) ?? false;

    this.#table.delete(profileId, name);

    return existed;
  }

  cancelBySession(sessionId: SessionId): void {
    for (const [profileId, jobs] of this.#jobs) {
      for (const [name, job] of jobs) {
        if (job.sessionId === sessionId) {
          this.cancel(profileId, name);
        }
      }
    }
  }

  cancelByProfile(profileId: ProfileId): void {
    for (const name of this.#jobs.get(profileId)?.keys() ?? []) {
      this.cancel(profileId, name);
    }

    this.#jobs.delete(profileId);
  }

  complete(profileId: ProfileId, name: EntryName, outcome: PollOutcome): void {
    const job = this.#jobs.get(profileId)?.get(name);

    if (job === undefined) {
      return;
    }

    this.cancel(profileId, name);
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
}
