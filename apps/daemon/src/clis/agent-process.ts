import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { AGENT_SYSTEM_PATH, buildAgentSudoCommand, localAgentPath } from "@tetherbox/core";

const CAPTURE_TIMEOUT_MS = 10_000;

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

function wrapPtyCommand(command: readonly string[]): readonly string[] {
  if (process.platform === "linux" && existsSync("/usr/bin/script")) {
    return ["/usr/bin/script", "-qefc", command.map(shellQuote).join(" "), "/dev/null"];
  }

  if (existsSync("/usr/bin/python3")) {
    return ["/usr/bin/python3", "-c", PYTHON_PTY_BRIDGE, ...command];
  }

  return command;
}

export function writeChildStdin(child: ChildProcess, data: string): boolean {
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

export interface CaptureResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface SpawnOptions {
  stdio: ["ignore" | "pipe", "pipe", "pipe"];
  extraEnv?: Readonly<Record<string, string>>;
  pty?: boolean;
}

export class AgentProcessRunner {
  readonly #agentUser: string | undefined;

  constructor(agentUser: string | undefined) {
    this.#agentUser = agentUser;
  }

  spawn(command: readonly string[], options: SpawnOptions): ChildProcess {
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

  capture(command: readonly string[], timeoutMs = CAPTURE_TIMEOUT_MS): Promise<CaptureResult> {
    const child = this.spawn(command, {
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
}
