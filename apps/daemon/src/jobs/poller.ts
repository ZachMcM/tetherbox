import type {
  EntryName,
  PollOutcomeStatus,
  ProfileId,
  RegisteredPollJob,
  RegisterPollJobInput,
  SessionId,
} from "@tetherbox/core";
import type { AgentProcessRunner, CaptureResult } from "../clis/agent-process.ts";
import type { PollJobTable } from "../db/poll-jobs.ts";

const CHECK_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_CHARS = 8_000;

export type PollOutcome = { status: PollOutcomeStatus; output: string };
export type PollFire = (profileId: ProfileId, job: RegisteredPollJob, outcome: PollOutcome) => void;

type CheckReading = { kind: "running" | "done" | "failed" | "invalid"; output: string };

interface WatchedJob {
  readonly profileId: ProfileId;
  readonly registered: RegisteredPollJob;
  timer: ReturnType<typeof setTimeout> | undefined;
  lastOutput: string | undefined;
  lastProgressAt: number;
}

function tail(text: string): string {
  return text.length <= MAX_OUTPUT_CHARS ? text : text.slice(-MAX_OUTPUT_CHARS);
}

function readCheck(result: CaptureResult): CheckReading {
  const stdout = result.stdout.trim();
  const status = stdout.split("\n", 1)[0]?.trim();

  if (status === "running" || status === "done" || status === "failed") {
    return { kind: status, output: tail(stdout) };
  }

  const stderr = result.stderr.trim();

  return {
    kind: "invalid",
    output: tail(
      [
        `The check exited with code ${result.code} without printing running, done, or failed as its first line.`,
        stdout !== "" ? `stdout:\n${stdout}` : "",
        stderr !== "" ? `stderr:\n${stderr}` : "",
      ]
        .filter((part) => part !== "")
        .join("\n\n"),
    ),
  };
}

/**
 * Watches long-running external tasks (such as coding harness sessions) that agent runs register
 * over RPC, and starts a follow-up run in the originating session when one finishes or stalls.
 *
 * Each check runs as the agent OS user in the profile directory. Its first stdout line is the
 * status: `running`, `done`, or `failed`. A `running` check whose output differs from the previous
 * one counts as progress. Any other output counts as no progress, so a broken check surfaces as
 * `stalled` once stallAfterSeconds pass.
 */
export class Poller {
  readonly #table: PollJobTable;
  readonly #runner: AgentProcessRunner;
  readonly #profileDir: (profileId: ProfileId) => string | undefined;
  readonly #onFire: PollFire;
  readonly #jobs = new Map<ProfileId, Map<EntryName, WatchedJob>>();
  #stopped = false;

  constructor({
    table,
    runner,
    profileDir,
    onFire,
  }: {
    table: PollJobTable;
    runner: AgentProcessRunner;
    profileDir: (profileId: ProfileId) => string | undefined;
    onFire: PollFire;
  }) {
    this.#table = table;
    this.#runner = runner;
    this.#profileDir = profileDir;
    this.#onFire = onFire;
  }

  loadAll(): void {
    this.stopAll();
    this.#jobs.clear();
    this.#stopped = false;

    for (const { profileId, job } of this.#table.listAll()) {
      this.#watch(profileId, job);
    }
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
    this.#watch(profileId, registered);

    return registered;
  }

  list(profileId: ProfileId): RegisteredPollJob[] {
    return [...(this.#jobs.get(profileId)?.values() ?? [])].map((watched) => watched.registered);
  }

  cancel(profileId: ProfileId, name: EntryName): boolean {
    const watched = this.#jobs.get(profileId)?.get(name);

    clearTimeout(watched?.timer);
    this.#jobs.get(profileId)?.delete(name);
    this.#table.delete(profileId, name);

    return watched !== undefined;
  }

  cancelBySession(sessionId: SessionId): void {
    for (const [profileId, jobs] of this.#jobs) {
      for (const [name, watched] of jobs) {
        if (watched.registered.sessionId === sessionId) {
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

  stopAll(): void {
    this.#stopped = true;

    for (const jobs of this.#jobs.values()) {
      for (const watched of jobs.values()) {
        clearTimeout(watched.timer);
        watched.timer = undefined;
      }
    }
  }

  #watch(profileId: ProfileId, registered: RegisteredPollJob): void {
    clearTimeout(this.#jobs.get(profileId)?.get(registered.name)?.timer);

    let jobs = this.#jobs.get(profileId);

    if (jobs === undefined) {
      jobs = new Map();
      this.#jobs.set(profileId, jobs);
    }

    const watched: WatchedJob = {
      profileId,
      registered,
      timer: undefined,
      lastOutput: undefined,
      lastProgressAt: Date.now(),
    };

    jobs.set(registered.name, watched);
    this.#scheduleCheck(watched);
  }

  #scheduleCheck(watched: WatchedJob): void {
    watched.timer = setTimeout(() => {
      void this.#check(watched);
    }, watched.registered.job.intervalSeconds * 1000);
  }

  #isCurrent(watched: WatchedJob): boolean {
    return (
      !this.#stopped && this.#jobs.get(watched.profileId)?.get(watched.registered.name) === watched
    );
  }

  async #check(watched: WatchedJob): Promise<void> {
    watched.timer = undefined;

    const cwd = this.#profileDir(watched.profileId);

    if (cwd === undefined) {
      this.#scheduleCheck(watched);

      return;
    }

    const result = await this.#runner.capture(watched.registered.job.check.command, {
      timeoutMs: CHECK_TIMEOUT_MS,
      cwd,
    });

    if (!this.#isCurrent(watched)) {
      return;
    }

    const reading = readCheck(result);

    if (reading.kind === "done" || reading.kind === "failed") {
      this.#finish(watched, { status: reading.kind, output: reading.output });

      return;
    }

    const now = Date.now();

    if (reading.kind === "running" && reading.output !== watched.lastOutput) {
      watched.lastOutput = reading.output;
      watched.lastProgressAt = now;
    } else if (now - watched.lastProgressAt >= watched.registered.job.stallAfterSeconds * 1000) {
      this.#finish(watched, { status: "stalled", output: reading.output });

      return;
    }

    this.#scheduleCheck(watched);
  }

  #finish(watched: WatchedJob, outcome: PollOutcome): void {
    this.cancel(watched.profileId, watched.registered.name);
    this.#onFire(watched.profileId, watched.registered, outcome);
  }
}
