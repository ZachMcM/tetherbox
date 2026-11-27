import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import {
  AGENT_SYSTEM_PATH,
  buildAgentSudoCommand,
  localAgentPath,
  RpcError,
  type CliAuthFlowEvent,
  type CliAuthFlowState,
  type CliInstallJobState,
  type Starter,
  type StarterCli,
  type StarterCliStatus,
  type StarterCliStatusEntry,
} from "@tetherbox/core";
import type { DaemonEvent, DaemonEventBus } from "./events.ts";
import type { StarterCatalog } from "./profiles/starter-catalog.ts";

const PROBE_TIMEOUT_MS = 10_000;
const INSTALL_TIMEOUT_MS = 5 * 60_000;
const AUTH_TIMEOUT_MS = 5 * 60_000;
const INITIAL_AUTH_WAIT_MS = 2_000;
const OUTPUT_EMIT_INTERVAL_MS = 100;
const SETTLED_TTL_MS = 10 * 60_000;
const MAX_OUTPUT_CHARS = 32_000;

const ANSI_PATTERN = new RegExp(
  `${String.fromCharCode(0x1b)}(?:\\[[0-?]*[ -/]*[@-~]|\\][^${String.fromCharCode(0x07)}${String.fromCharCode(0x1b)}]*(?:${String.fromCharCode(0x07)}|${String.fromCharCode(0x1b)}\\\\)|[@-Z\\\\-_])`,
  "g",
);

const URL_PATTERN = /https:\/\/[^\s"'<>)\]]+/g;
const DEVICE_CODE_PATTERN =
  /(?:one-time\s+code|enter\s+(?:the\s+)?code|user\s+code)[^\nA-Z0-9]*([A-Z0-9]{4}-[A-Z0-9]{4})/i;
const PROMPT_LINE_PATTERN =
  /(?:paste|enter|code|token|url|password|passphrase|confirm|\(y\/n\)|\[y\/n\])[^\n]*[:?]\s*$/i;

const PYTHON_PTY_BRIDGE = [
  "import os, pty, select, signal, sys",
  "pid, fd = pty.fork()",
  "if pid == 0: os.execvp(sys.argv[1], sys.argv[1:])",
  "def fwd(s, _f):",
  "  try: os.killpg(pid, s)",
  "  except OSError: pass",
  "signal.signal(signal.SIGTERM, fwd)",
  "stdin_open = True",
  "while True:",
  "  rfds = [fd] + ([0] if stdin_open else [])",
  "  r, _, _ = select.select(rfds, [], [])",
  "  if fd in r:",
  "    try: data = os.read(fd, 4096)",
  "    except OSError: break",
  "    if not data: break",
  "    os.write(1, data)",
  "  if 0 in r:",
  "    data = os.read(0, 4096)",
  "    if not data: stdin_open = False",
  "    else:",
  "      try: os.write(fd, data)",
  "      except OSError: break",
  "_, status = os.waitpid(pid, 0)",
  "sys.exit(os.waitstatus_to_exitcode(status))",
].join("\n");

function shellQuote(arg: string): string {
  return `'${arg.replaceAll("'", `'\\''`)}'`;
}

function stripAnsi(raw: string): string {
  return raw.replaceAll(ANSI_PATTERN, "").replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}

function appendOutput(current: string, chunk: string): string {
  const combined = current + stripAnsi(chunk);

  return combined.length <= MAX_OUTPUT_CHARS ? combined : combined.slice(-MAX_OUTPUT_CHARS);
}

function wrapPtyCommand(command: readonly string[]): readonly string[] {
  if (process.platform === "linux" && existsSync("/usr/bin/script")) {
    return ["/usr/bin/script", "-qefc", command.map(shellQuote).join(" "), "/dev/null"];
  }

  if (existsSync("/usr/bin/python3")) {
    return ["/usr/bin/python3", "-c", PYTHON_PTY_BRIDGE, ...command];
  }

  return command;
}

function writeChildStdin(child: ChildProcess, data: string): boolean {
  const { stdin } = child;

  if (stdin === null || stdin.destroyed || !stdin.writable) {
    return false;
  }

  try {
    stdin.write(data);

    return true;
  } catch {
    return false;
  }
}

function cleanUrl(raw: string): string {
  return raw.replace(/[.,;:!?]+$/, "");
}

function extractAuthEvents(output: string): CliAuthFlowEvent[] {
  const urls: string[] = [];
  const seenUrls = new Set<string>();

  for (const match of output.matchAll(URL_PATTERN)) {
    const url = cleanUrl(match[0]);

    if (!seenUrls.has(url)) {
      seenUrls.add(url);
      urls.push(url);
    }
  }

  const events: CliAuthFlowEvent[] = [];
  const codeMatch = DEVICE_CODE_PATTERN.exec(output);

  if (codeMatch?.[1] !== undefined) {
    const verificationUri =
      urls.find((url) => /device|activate|verify|login/i.test(url)) ?? urls[0];

    if (verificationUri !== undefined) {
      events.push({
        kind: "device_code",
        verificationUri,
        userCode: codeMatch[1].toUpperCase(),
      });
    }
  }

  for (const url of urls) {
    events.push({ kind: "auth_url", url });
  }

  return events;
}

function detectPromptLine(output: string): string | null {
  const lines = output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const last = lines.at(-1);

  if (last === undefined) {
    return null;
  }

  return PROMPT_LINE_PATTERN.test(last) ? last : null;
}

type BinaryProbeResult =
  | { readonly kind: "present" }
  | { readonly kind: "missing" }
  | { readonly kind: "error"; readonly message: string };

interface CaptureResult {
  code: number;
  stdout: string;
  stderr: string;
}

interface EmitTarget {
  emitTimer?: ReturnType<typeof setTimeout> | undefined;
}

interface ActiveInstallJob extends EmitTarget {
  state: CliInstallJobState;
  child: ChildProcess;
  timeout: ReturnType<typeof setTimeout>;
  settledAt?: number | undefined;
}

interface ActiveAuthFlow extends EmitTarget {
  state: CliAuthFlowState;
  child: ChildProcess;
  timeout: ReturnType<typeof setTimeout>;
  autoPressedEnter: boolean;
  settledAt?: number | undefined;
  onActivity?: (() => void) | undefined;
}

function cloneAuthState(state: CliAuthFlowState): CliAuthFlowState {
  return { ...state, events: [...state.events] };
}

function installUpdated(job: ActiveInstallJob): DaemonEvent {
  return { kind: "cli_install_updated", job: { ...job.state } };
}

function authUpdated(flow: ActiveAuthFlow): DaemonEvent {
  return { kind: "cli_auth_updated", flow: cloneAuthState(flow.state) };
}

/**
 * Probes, installs (in user space under `~/.local`), and authenticates starter CLIs as the
 * unprivileged agent user so the web app can manage CLI starters without SSH or root.
 */
export class CliManager {
  readonly #agentUser: string | undefined;
  readonly #events: DaemonEventBus;
  readonly #catalog: StarterCatalog;
  readonly #installJobs = new Map<string, ActiveInstallJob>();
  readonly #authFlows = new Map<string, ActiveAuthFlow>();
  #stopped = false;

  constructor({
    agentUser,
    events,
    catalog,
  }: {
    agentUser: string | undefined;
    events: DaemonEventBus;
    catalog: StarterCatalog;
  }) {
    this.#agentUser = agentUser;
    this.#events = events;
    this.#catalog = catalog;
  }

  #emitNow(target: EmitTarget, toEvent: () => DaemonEvent): void {
    clearTimeout(target.emitTimer);
    target.emitTimer = undefined;

    if (!this.#stopped) {
      this.#events.emit(toEvent());
    }
  }

  #scheduleEmit(target: EmitTarget, toEvent: () => DaemonEvent): void {
    if (this.#stopped || target.emitTimer !== undefined) {
      return;
    }

    target.emitTimer = setTimeout(() => {
      this.#emitNow(target, toEvent);
    }, OUTPUT_EMIT_INTERVAL_MS);
  }

  #spawnAgent(
    command: readonly string[],
    options: {
      stdio: ["ignore" | "pipe", "pipe", "pipe"];
      extraEnv?: Readonly<Record<string, string>>;
      pty?: boolean;
    },
  ): ChildProcess {
    const envPairs = Object.entries(options.extraEnv ?? {}).map(([k, v]) => `${k}=${v}`);
    const innerCommand = envPairs.length > 0 ? ["env", ...envPairs, ...command] : [...command];
    const targetCommand = options.pty ? wrapPtyCommand(innerCommand) : innerCommand;
    const [execBin, execArgs] =
      this.#agentUser !== undefined
        ? buildAgentSudoCommand({
            user: this.#agentUser,
            command: targetCommand,
            nonInteractive: true,
          })
        : [targetCommand[0] ?? "sh", targetCommand.slice(1)];

    return spawn(execBin, execArgs, {
      env: {
        PATH: this.#agentUser === undefined ? localAgentPath(process.env.HOME) : AGENT_SYSTEM_PATH,
        LANG: "C.UTF-8",
        ...(this.#agentUser === undefined && process.env.HOME !== undefined
          ? { HOME: process.env.HOME }
          : {}),
        ...(this.#agentUser === undefined ? options.extraEnv : {}),
      },
      stdio: options.stdio,
    });
  }

  #captureAgent(command: readonly string[], timeoutMs = PROBE_TIMEOUT_MS): Promise<CaptureResult> {
    const child = this.#spawnAgent(command, {
      stdio: ["ignore", "pipe", "pipe"],
      extraEnv: { NO_COLOR: "1", FORCE_COLOR: "0" },
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));

    return new Promise((resolve) => {
      child.once("error", (error) => {
        clearTimeout(timer);
        resolve({ code: 1, stdout: "", stderr: error.message });
      });
      child.once("close", (code) => {
        clearTimeout(timer);
        resolve({
          code: code ?? 1,
          stdout: Buffer.concat(stdout).toString("utf8"),
          stderr: timedOut
            ? `timed out after ${Math.round(timeoutMs / 1000)}s`
            : Buffer.concat(stderr).toString("utf8"),
        });
      });
    });
  }

  async #probeBinary(binary: string): Promise<BinaryProbeResult> {
    const result = await this.#captureAgent([
      "sh",
      "-c",
      'if command -v "$1" >/dev/null 2>&1; then printf present; else printf missing; fi',
      "_",
      binary,
    ]);

    if (result.code === 0) {
      const output = result.stdout.trim();

      if (output === "present") {
        return { kind: "present" };
      }

      if (output === "missing") {
        return { kind: "missing" };
      }

      return {
        kind: "error",
        message: result.stderr.trim() || `unexpected probe output for "${binary}"`,
      };
    }

    return { kind: "error", message: result.stderr.trim() || `failed to check "${binary}"` };
  }

  async #inspectCli(cli: StarterCli): Promise<StarterCliStatus> {
    const probe = await this.#probeBinary(cli.binary);

    switch (probe.kind) {
      case "missing":
        return { kind: "missing" };
      case "error":
        return { kind: "error", message: probe.message };
      case "present":
        break;
      default: {
        const exhaustive: never = probe;

        return exhaustive;
      }
    }

    if (cli.auth === undefined) {
      return { kind: "installed", auth: "none" };
    }

    if (cli.auth.checkCommand === undefined) {
      return { kind: "installed", auth: "unknown" };
    }

    const check = await this.#captureAgent(cli.auth.checkCommand);

    return {
      kind: "installed",
      auth: check.code === 0 ? "authenticated" : "unauthenticated",
    };
  }

  async listStatuses(): Promise<StarterCliStatusEntry[]> {
    const cliStarters: readonly (Starter & { readonly cli: StarterCli })[] = this.#catalog
      .all()
      .flatMap((starter) => (starter.cli === undefined ? [] : [{ ...starter, cli: starter.cli }]));

    return Promise.all(
      cliStarters.map(async (starter) => ({
        starterId: starter.id,
        name: starter.name,
        binary: starter.cli.binary,
        hasInstall: starter.cli.install !== undefined,
        ...(starter.cli.install !== undefined
          ? { installDescription: starter.cli.install.description }
          : {}),
        hasAuth: starter.cli.auth !== undefined,
        status: await this.#inspectCli(starter.cli),
      })),
    );
  }

  startInstall(starterId: string): CliInstallJobState {
    this.#prune();

    const starter = this.#catalog.get(starterId);

    if (starter?.cli === undefined) {
      throw new RpcError(400, `starter "${starterId}" does not define a CLI`);
    }

    const { cli } = starter;

    if (cli.install === undefined) {
      throw new RpcError(400, `CLI "${cli.binary}" does not support automatic installation`);
    }

    for (const existing of this.#installJobs.values()) {
      if (existing.state.starterId === starterId && existing.state.status === "running") {
        return { ...existing.state };
      }
    }

    const id = randomUUID();
    const child = this.#spawnAgent(cli.install.command, {
      stdio: ["ignore", "pipe", "pipe"],
      extraEnv: { NO_COLOR: "1", FORCE_COLOR: "0", CI: "1" },
    });
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, INSTALL_TIMEOUT_MS);

    const job: ActiveInstallJob = {
      state: {
        id,
        starterId,
        binary: cli.binary,
        status: "running",
        output: "",
        error: null,
      },
      child,
      timeout,
    };

    this.#installJobs.set(id, job);
    this.#emitNow(job, () => installUpdated(job));

    const onChunk = (chunk: Buffer) => {
      job.state = {
        ...job.state,
        output: appendOutput(job.state.output, chunk.toString("utf8")),
      };
      this.#scheduleEmit(job, () => installUpdated(job));
    };

    child.stdout?.on("data", onChunk);
    child.stderr?.on("data", onChunk);

    child.once("error", (error) => {
      clearTimeout(job.timeout);
      job.settledAt = Date.now();
      job.state = {
        id,
        starterId,
        binary: cli.binary,
        status: "failed",
        output: job.state.output,
        error: error.message,
      };
      this.#emitNow(job, () => installUpdated(job));
    });

    child.once("close", (code, signal) => {
      clearTimeout(job.timeout);
      job.settledAt = Date.now();

      if (job.state.status !== "running") {
        return;
      }

      if (code === 0) {
        job.state = {
          id,
          starterId,
          binary: cli.binary,
          status: "completed",
          output: job.state.output,
          error: null,
        };
        this.#emitNow(job, () => installUpdated(job));

        return;
      }

      job.state = {
        id,
        starterId,
        binary: cli.binary,
        status: "failed",
        output: job.state.output,
        error: timedOut
          ? `Install timed out after ${Math.round(INSTALL_TIMEOUT_MS / 60_000)} minutes`
          : `Install exited with ${signal ?? `code ${code ?? 1}`}`,
      };
      this.#emitNow(job, () => installUpdated(job));
    });

    return { ...job.state };
  }

  getInstallJob(jobId: string): CliInstallJobState {
    this.#prune();

    const job = this.#installJobs.get(jobId);

    if (job === undefined) {
      throw new RpcError(404, `unknown CLI install job "${jobId}"`);
    }

    return { ...job.state };
  }

  async startAuth(starterId: string): Promise<CliAuthFlowState> {
    this.#prune();

    const entry = this.#catalog.getCliAuth(starterId);

    if (entry === undefined) {
      throw new RpcError(400, `starter "${starterId}" does not support CLI login`);
    }

    const probe = await this.#probeBinary(entry.cli.binary);

    switch (probe.kind) {
      case "missing":
        throw new RpcError(409, `${entry.cli.binary} is not installed yet. Install it first.`);
      case "error":
        throw new Error(probe.message);
      case "present":
        break;
      default: {
        const exhaustive: never = probe;

        return exhaustive;
      }
    }

    for (const [existingId, existing] of this.#authFlows) {
      if (existing.state.starterId === starterId && existing.state.status === "running") {
        this.cancelAuthFlow(existingId);
      }
    }

    const id = randomUUID();
    const child = this.#spawnAgent(entry.cli.auth.loginCommand, {
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

    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, AUTH_TIMEOUT_MS);

    const flow: ActiveAuthFlow = {
      state: {
        id,
        starterId,
        binary: entry.cli.binary,
        status: "running",
        events: [],
        output: "",
        prompt: null,
        error: null,
      },
      child,
      timeout,
      autoPressedEnter: false,
    };

    this.#authFlows.set(id, flow);
    this.#emitNow(flow, () => authUpdated(flow));

    const notifyReady = () => {
      if (
        flow.state.status !== "running" ||
        flow.state.events.length > 0 ||
        flow.state.prompt !== null
      ) {
        flow.onActivity?.();
        flow.onActivity = undefined;
      }
    };

    const onChunk = (chunk: Buffer) => {
      if (flow.state.status !== "running") {
        return;
      }

      const prevEventCount = flow.state.events.length;
      const prevPrompt = flow.state.prompt;
      const nextOutput = appendOutput(flow.state.output, chunk.toString("utf8"));
      const events = extractAuthEvents(nextOutput);
      const nextPrompt = detectPromptLine(nextOutput);

      if (!flow.autoPressedEnter && /press enter to open/i.test(nextOutput)) {
        flow.autoPressedEnter = true;
        writeChildStdin(child, "\n");
      }

      flow.state = {
        id,
        starterId,
        binary: entry.cli.binary,
        status: "running",
        events,
        output: nextOutput,
        prompt: nextPrompt,
        error: null,
      };

      if (events.length !== prevEventCount || nextPrompt !== prevPrompt) {
        this.#emitNow(flow, () => authUpdated(flow));
      } else {
        this.#scheduleEmit(flow, () => authUpdated(flow));
      }

      notifyReady();
    };

    child.stdout?.on("data", onChunk);
    child.stderr?.on("data", onChunk);

    child.once("error", (error) => {
      clearTimeout(flow.timeout);
      flow.settledAt = Date.now();
      flow.state = {
        id,
        starterId,
        binary: entry.cli.binary,
        status: "failed",
        events: flow.state.events,
        output: flow.state.output,
        prompt: null,
        error: error.message,
      };
      this.#emitNow(flow, () => authUpdated(flow));
      notifyReady();
    });

    child.once("close", (code, signal) => {
      clearTimeout(flow.timeout);
      flow.settledAt = Date.now();

      if (flow.state.status !== "running") {
        notifyReady();

        return;
      }

      if (code === 0) {
        flow.state = {
          id,
          starterId,
          binary: entry.cli.binary,
          status: "completed",
          events: flow.state.events,
          output: flow.state.output,
          prompt: null,
          error: null,
        };
      } else {
        flow.state = {
          id,
          starterId,
          binary: entry.cli.binary,
          status: "failed",
          events: flow.state.events,
          output: flow.state.output,
          prompt: null,
          error: timedOut
            ? `Login timed out after ${Math.round(AUTH_TIMEOUT_MS / 60_000)} minutes`
            : `Login exited with ${signal ?? `code ${code ?? 1}`}`,
        };
      }

      this.#emitNow(flow, () => authUpdated(flow));
      notifyReady();
    });

    await new Promise<void>((resolve) => {
      if (
        flow.state.status !== "running" ||
        flow.state.events.length > 0 ||
        flow.state.prompt !== null
      ) {
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

    return cloneAuthState(flow.state);
  }

  getAuthFlow(flowId: string): CliAuthFlowState {
    this.#prune();

    const flow = this.#authFlows.get(flowId);

    if (flow === undefined) {
      throw new RpcError(404, `unknown CLI auth flow "${flowId}"`);
    }

    return cloneAuthState(flow.state);
  }

  respondAuthFlow(flowId: string, value: string): CliAuthFlowState {
    const flow = this.#authFlows.get(flowId);

    if (flow === undefined) {
      throw new RpcError(404, `unknown CLI auth flow "${flowId}"`);
    }

    if (flow.state.status !== "running") {
      throw new RpcError(409, `CLI auth flow "${flowId}" is no longer running`);
    }

    if (!writeChildStdin(flow.child, `${value}\n`)) {
      throw new RpcError(409, `CLI auth flow "${flowId}" is no longer accepting input`);
    }

    flow.state = {
      ...flow.state,
      prompt: null,
    };
    this.#emitNow(flow, () => authUpdated(flow));

    return cloneAuthState(flow.state);
  }

  cancelAuthFlow(flowId: string): { cancelled: boolean } {
    const flow = this.#authFlows.get(flowId);

    if (flow === undefined) {
      return { cancelled: false };
    }

    clearTimeout(flow.timeout);
    flow.settledAt = Date.now();

    if (flow.state.status === "running") {
      flow.state = {
        id: flow.state.id,
        starterId: flow.state.starterId,
        binary: flow.state.binary,
        status: "cancelled",
        events: flow.state.events,
        output: flow.state.output,
        prompt: null,
        error: "Login cancelled",
      };
      this.#emitNow(flow, () => authUpdated(flow));
      flow.child.kill("SIGTERM");
    }

    return { cancelled: true };
  }

  stopAll(): void {
    this.#stopped = true;

    for (const job of this.#installJobs.values()) {
      clearTimeout(job.timeout);
      clearTimeout(job.emitTimer);

      if (job.state.status === "running") {
        job.child.kill("SIGTERM");
      }
    }

    for (const flow of this.#authFlows.values()) {
      clearTimeout(flow.timeout);
      clearTimeout(flow.emitTimer);

      if (flow.state.status === "running") {
        flow.child.kill("SIGTERM");
      }
    }

    this.#installJobs.clear();
    this.#authFlows.clear();
  }

  #prune(): void {
    const cutoff = Date.now() - SETTLED_TTL_MS;

    for (const [id, job] of this.#installJobs) {
      if (job.settledAt !== undefined && job.settledAt < cutoff) {
        this.#installJobs.delete(id);
      }
    }

    for (const [id, flow] of this.#authFlows) {
      if (flow.settledAt !== undefined && flow.settledAt < cutoff) {
        this.#authFlows.delete(id);
      }
    }
  }
}
