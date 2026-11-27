import type { ChildProcess } from "node:child_process";
import type { DaemonEvent, DaemonEventBus } from "../events.ts";

const OUTPUT_EMIT_INTERVAL_MS = 100;
const SETTLED_TTL_MS = 10 * 60_000;

export interface TrackedRun<S extends { status: string }> {
  state: S;
  child: ChildProcess;
  timeout: ReturnType<typeof setTimeout>;
  settledAt?: number | undefined;
  emitTimer?: ReturnType<typeof setTimeout> | undefined;
}

/**
 * Holds CLI child processes the web app watches. Output updates are throttled into daemon events,
 * and settled runs are pruned after a TTL so late polls can still read the final state.
 */
export class TrackedRuns<S extends { status: string }, R extends TrackedRun<S>> {
  readonly #runs = new Map<string, R>();
  readonly #events: DaemonEventBus;
  readonly #toEvent: (run: R) => DaemonEvent;
  #stopped = false;

  constructor(events: DaemonEventBus, toEvent: (run: R) => DaemonEvent) {
    this.#events = events;
    this.#toEvent = toEvent;
  }

  add(id: string, run: R): void {
    this.#runs.set(id, run);
  }

  get(id: string): R | undefined {
    return this.#runs.get(id);
  }

  entries(): IterableIterator<[string, R]> {
    return this.#runs.entries();
  }

  emitNow(run: R): void {
    clearTimeout(run.emitTimer);
    run.emitTimer = undefined;

    if (!this.#stopped) {
      this.#events.emit(this.#toEvent(run));
    }
  }

  scheduleEmit(run: R): void {
    if (this.#stopped || run.emitTimer !== undefined) {
      return;
    }

    run.emitTimer = setTimeout(() => {
      this.emitNow(run);
    }, OUTPUT_EMIT_INTERVAL_MS);
  }

  prune(): void {
    const cutoff = Date.now() - SETTLED_TTL_MS;

    for (const [id, run] of this.#runs) {
      if (run.settledAt !== undefined && run.settledAt < cutoff) {
        this.#runs.delete(id);
      }
    }
  }

  stop(): void {
    this.#stopped = true;

    for (const run of this.#runs.values()) {
      clearTimeout(run.timeout);
      clearTimeout(run.emitTimer);

      if (run.state.status === "running") {
        run.child.kill("SIGTERM");
      }
    }

    this.#runs.clear();
  }
}
