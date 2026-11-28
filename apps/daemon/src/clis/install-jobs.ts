import { randomUUID } from "node:crypto";
import { RpcError, type CliInstallJobState } from "@tetherbox/core";
import type { DaemonEventBus } from "../events.ts";
import type { StarterCatalog } from "../profiles/starter-catalog.ts";
import type { AgentProcessRunner } from "./agent-process.ts";
import { appendOutput } from "./output.ts";
import { TrackedRuns, type TrackedRun } from "./tracked-runs.ts";

const INSTALL_TIMEOUT_MS = 5 * 60_000;

type InstallJob = TrackedRun<CliInstallJobState>;

/** Installs into the agent user's home (`~/.local`). */
export class CliInstallJobs {
  readonly #runner: AgentProcessRunner;
  readonly #catalog: StarterCatalog;
  readonly #jobs: TrackedRuns<InstallJob>;

  constructor({
    runner,
    catalog,
    events,
  }: {
    runner: AgentProcessRunner;
    catalog: StarterCatalog;
    events: DaemonEventBus;
  }) {
    this.#runner = runner;
    this.#catalog = catalog;
    this.#jobs = new TrackedRuns(events, (job) => ({
      kind: "cli_install_updated",
      job: { ...job.state },
    }));
  }

  start(starterId: string): CliInstallJobState {
    this.#jobs.prune();

    const starter = this.#catalog.get(starterId);

    if (starter?.cli === undefined) {
      throw new RpcError(400, `starter "${starterId}" does not define a CLI`);
    }

    const { cli } = starter;

    if (cli.install === undefined) {
      throw new RpcError(400, `CLI "${cli.binary}" does not support automatic installation`);
    }

    for (const [, existing] of this.#jobs.entries()) {
      if (existing.state.starterId === starterId && existing.state.status === "running") {
        return { ...existing.state };
      }
    }

    const id = randomUUID();
    const child = this.#runner.spawn(cli.install.command, {
      stdio: ["ignore", "pipe", "pipe"],
      extraEnv: { NO_COLOR: "1", FORCE_COLOR: "0", CI: "1" },
    });
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, INSTALL_TIMEOUT_MS);

    const job: InstallJob = {
      state: { id, starterId, binary: cli.binary, status: "running", output: "", error: null },
      child,
      timeout,
    };

    this.#jobs.add(id, job);
    this.#jobs.emitNow(job);

    const onChunk = (chunk: Buffer) => {
      job.state = { ...job.state, output: appendOutput(job.state.output, chunk.toString("utf8")) };
      this.#jobs.scheduleEmit(job);
    };

    child.stdout?.on("data", onChunk);
    child.stderr?.on("data", onChunk);

    child.once("error", (error) => {
      this.#settle(job, { status: "failed", error: error.message });
    });

    child.once("close", (code, signal) => {
      if (job.state.status !== "running") {
        this.#jobs.markSettled(job);

        return;
      }

      if (code === 0) {
        this.#settle(job, { status: "completed", error: null });

        return;
      }

      this.#settle(job, {
        status: "failed",
        error: timedOut
          ? `Install timed out after ${Math.round(INSTALL_TIMEOUT_MS / 60_000)} minutes`
          : `Install exited with ${signal ?? `code ${code ?? 1}`}`,
      });
    });

    return { ...job.state };
  }

  get(jobId: string): CliInstallJobState {
    this.#jobs.prune();

    const job = this.#jobs.get(jobId);

    if (job === undefined) {
      throw new RpcError(404, `unknown CLI install job "${jobId}"`);
    }

    return { ...job.state };
  }

  stop(): void {
    this.#jobs.stop();
  }

  #settle(
    job: InstallJob,
    outcome: { status: "completed"; error: null } | { status: "failed"; error: string },
  ): void {
    this.#jobs.settle(job, { ...job.state, ...outcome });
  }
}
