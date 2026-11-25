import { spawn } from "node:child_process";

const DAEMON_USER = "tetherbox";
const DAEMON_BIN = "tetherbox-daemon";
const AGENT_USER = "tetherbox-agent";

function shellQuote(arg: string): string {
  return `'${arg.replaceAll("'", `'\\''`)}'`;
}

export interface RemoteOptions {
  input?: string;
  interactive?: boolean;
  forwardPorts?: readonly number[];
}

interface CaptureResult {
  code: number;
  stdout: string;
  stderr: string;
}

function daemonCommandArgs(args: readonly string[]): string[] {
  return ["sudo", "-n", "-u", DAEMON_USER, DAEMON_BIN, ...args];
}

function agentCommandArgs(args: readonly string[], nonInteractive: boolean): string[] {
  return ["sudo", ...(nonInteractive ? ["-n"] : []), "-H", "-u", AGENT_USER, "--", ...args];
}

/**
 * Runs a command on the VM over the user's preconfigured SSH alias. Arguments are quoted for the
 * remote shell, and `input` goes over stdin so secrets stay out of argv.
 */
export function runRemote(
  alias: string,
  args: readonly string[],
  options: RemoteOptions = {},
): Promise<number> {
  const forwards = (options.forwardPorts ?? []).flatMap((port) => [
    "-L",
    `${port}:127.0.0.1:${port}`,
  ]);
  const sshArgs = [...(options.interactive ? ["-t"] : []), ...forwards, "--", alias];
  const child = spawn("ssh", [...sshArgs, ...args.map(shellQuote)], {
    stdio: [options.input === undefined ? "inherit" : "pipe", "inherit", "inherit"],
  });

  if (options.input !== undefined) {
    child.stdin?.end(options.input);
  }

  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code ?? 1));
  });
}

function captureRemote(alias: string, args: readonly string[]): Promise<CaptureResult> {
  const child = spawn("ssh", ["--", alias, ...args.map(shellQuote)], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];

  child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));

  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) =>
      resolve({
        code: code ?? 1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      }),
    );
  });
}

export function runDaemonCommand(
  alias: string,
  args: readonly string[],
  options: RemoteOptions = {},
) {
  return runRemote(alias, daemonCommandArgs(args), options);
}

export function captureDaemonCommand(alias: string, args: readonly string[]) {
  return captureRemote(alias, daemonCommandArgs(args));
}

export function runAgentCommand(
  alias: string,
  args: readonly string[],
  options: RemoteOptions = {},
) {
  return runRemote(alias, agentCommandArgs(args, !options.interactive), options);
}

export function captureAgentCommand(alias: string, args: readonly string[]) {
  return captureRemote(alias, agentCommandArgs(args, true));
}
