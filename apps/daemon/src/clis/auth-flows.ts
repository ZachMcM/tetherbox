import { randomUUID } from "node:crypto";
import { RpcError, type CliAuthFlowState } from "@tetherbox/core";
import type { DaemonEventBus } from "../events.ts";
import type { StarterCatalog } from "../profiles/starter-catalog.ts";
import { writeChildStdin, type AgentProcessRunner } from "./agent-process.ts";
import { appendOutput, detectPromptLine, extractAuthEvents } from "./output.ts";
import { probeBinary } from "./status.ts";
import { TrackedRuns, type TrackedRun } from "./tracked-runs.ts";

const AUTH_TIMEOUT_MS = 5 * 60_000;
const INITIAL_AUTH_WAIT_MS = 2_000;

interface AuthFlow extends TrackedRun<CliAuthFlowState> {
  timedOut: boolean;
  autoPressedEnter: boolean;
  onActivity?: (() => void) | undefined;
}

type LoginStarter = NonNullable<ReturnType<StarterCatalog["getCliAuth"]>>;

type AuthOutcome =
  | { status: "completed"; error: null }
  | { status: "failed" | "cancelled"; error: string };

function cloneAuthState(state: CliAuthFlowState): CliAuthFlowState {
  return { ...state, events: [...state.events] };
}

function hasActivity(flow: AuthFlow): boolean {
  return (
    flow.state.status !== "running" || flow.state.events.length > 0 || flow.state.prompt !== null
  );
}

export class CliAuthFlows {
  readonly #runner: AgentProcessRunner;
  readonly #catalog: StarterCatalog;
  readonly #flows: TrackedRuns<AuthFlow>;

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
    this.#flows = new TrackedRuns(events, (flow) => ({
      kind: "cli_auth_updated",
      flow: cloneAuthState(flow.state),
    }));
  }

  async start(starterId: string): Promise<CliAuthFlowState> {
    this.#flows.prune();

    const entry = this.#catalog.getCliAuth(starterId);

    if (entry === undefined) {
      throw new RpcError(400, `starter "${starterId}" does not support CLI login`);
    }

    await this.#requireInstalled(entry.cli.binary);
    this.#cancelRunningFor(starterId);

    const flow = this.#spawnLogin(entry);

    await this.#waitForFirstActivity(flow);

    return cloneAuthState(flow.state);
  }

  get(flowId: string): CliAuthFlowState {
    this.#flows.prune();

    return cloneAuthState(this.#require(flowId).state);
  }

  respond(flowId: string, value: string): CliAuthFlowState {
    this.#flows.prune();

    const flow = this.#require(flowId);

    if (flow.state.status !== "running") {
      throw new RpcError(409, `CLI auth flow "${flowId}" is no longer running`);
    }

    if (!writeChildStdin(flow.child, `${value}\n`)) {
      throw new RpcError(409, `CLI auth flow "${flowId}" is no longer accepting input`);
    }

    flow.state = { ...flow.state, prompt: null };
    this.#flows.emitNow(flow);

    return cloneAuthState(flow.state);
  }

  cancel(flowId: string): { cancelled: boolean } {
    this.#flows.prune();

    const flow = this.#flows.get(flowId);

    if (flow === undefined) {
      return { cancelled: false };
    }

    this.#flows.markSettled(flow);

    if (flow.state.status === "running") {
      this.#settle(flow, { status: "cancelled", error: "Login cancelled" });
      flow.child.kill("SIGTERM");
    }

    return { cancelled: true };
  }

  stop(): void {
    this.#flows.stop();
  }

  #require(flowId: string): AuthFlow {
    const flow = this.#flows.get(flowId);

    if (flow === undefined) {
      throw new RpcError(404, `unknown CLI auth flow "${flowId}"`);
    }

    return flow;
  }

  async #requireInstalled(binary: string): Promise<void> {
    const probe = await probeBinary(this.#runner, binary);

    switch (probe.kind) {
      case "missing":
        throw new RpcError(409, `${binary} is not installed yet. Install it first.`);
      case "error":
        throw new Error(probe.message);
      case "present":
        return;
      default: {
        const exhaustive: never = probe;

        return exhaustive;
      }
    }
  }

  #cancelRunningFor(starterId: string): void {
    for (const [existingId, existing] of this.#flows.entries()) {
      if (existing.state.starterId === starterId && existing.state.status === "running") {
        this.cancel(existingId);
      }
    }
  }

  #spawnLogin(entry: LoginStarter): AuthFlow {
    const id = randomUUID();
    const child = this.#runner.spawn(entry.cli.auth.loginCommand, {
      stdio: ["pipe", "pipe", "pipe"],
      extraEnv: {
        NO_COLOR: "1",
        FORCE_COLOR: "0",
        TERM: "dumb",
        BROWSER: "true",
        GH_BROWSER: "true",
      },
      pty: true,
    });

    child.stdin?.on("error", () => {
      // Child closed stdin or exited before a write flushed; close/error events settle the flow.
    });

    const flow: AuthFlow = {
      state: {
        id,
        starterId: entry.starterId,
        binary: entry.cli.binary,
        status: "running",
        events: [],
        output: "",
        prompt: null,
        error: null,
      },
      child,
      timeout: setTimeout(() => {
        flow.timedOut = true;
        child.kill("SIGTERM");
      }, AUTH_TIMEOUT_MS),
      timedOut: false,
      autoPressedEnter: false,
    };

    this.#flows.add(id, flow);
    this.#flows.emitNow(flow);

    const onChunk = (chunk: Buffer) => this.#handleOutput(flow, chunk);

    child.stdout?.on("data", onChunk);
    child.stderr?.on("data", onChunk);
    child.once("error", (error) => {
      this.#settle(flow, { status: "failed", error: error.message });
      this.#notifyActivity(flow);
    });
    child.once("close", (code, signal) => this.#handleExit(flow, code, signal));

    return flow;
  }

  #handleOutput(flow: AuthFlow, chunk: Buffer): void {
    if (flow.state.status !== "running") {
      return;
    }

    const prevEventCount = flow.state.events.length;
    const prevPrompt = flow.state.prompt;
    const output = appendOutput(flow.state.output, chunk.toString("utf8"));
    const events = extractAuthEvents(output);
    const prompt = detectPromptLine(output);

    if (!flow.autoPressedEnter && /press enter to open/i.test(output)) {
      flow.autoPressedEnter = true;
      writeChildStdin(flow.child, "\n");
    }

    flow.state = { ...flow.state, events, output, prompt };

    if (events.length !== prevEventCount || prompt !== prevPrompt) {
      this.#flows.emitNow(flow);
    } else {
      this.#flows.scheduleEmit(flow);
    }

    this.#notifyActivity(flow);
  }

  #handleExit(flow: AuthFlow, code: number | null, signal: NodeJS.Signals | null): void {
    if (flow.state.status !== "running") {
      this.#flows.markSettled(flow);
      this.#notifyActivity(flow);

      return;
    }

    if (code === 0) {
      this.#settle(flow, { status: "completed", error: null });
    } else {
      this.#settle(flow, {
        status: "failed",
        error: flow.timedOut
          ? `Login timed out after ${Math.round(AUTH_TIMEOUT_MS / 60_000)} minutes`
          : `Login exited with ${signal ?? `code ${code ?? 1}`}`,
      });
    }

    this.#notifyActivity(flow);
  }

  #settle(flow: AuthFlow, outcome: AuthOutcome): void {
    this.#flows.settle(flow, { ...flow.state, ...outcome, prompt: null });
  }

  #notifyActivity(flow: AuthFlow): void {
    if (hasActivity(flow)) {
      flow.onActivity?.();
      flow.onActivity = undefined;
    }
  }

  #waitForFirstActivity(flow: AuthFlow): Promise<void> {
    return new Promise((resolve) => {
      if (hasActivity(flow)) {
        resolve();

        return;
      }

      const timer = setTimeout(() => {
        flow.onActivity = undefined;
        resolve();
      }, INITIAL_AUTH_WAIT_MS);

      flow.onActivity = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  }
}
