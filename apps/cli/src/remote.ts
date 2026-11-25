import { spawn } from "node:child_process";

const DAEMON_USER = "tetherbox";
const DAEMON_BIN = "tetherbox-daemon";

function shellQuote(arg: string): string {
  return `'${arg.replaceAll("'", `'\\''`)}'`;
}

export interface RemoteOptions {
  input?: string;
  interactive?: boolean;
}

export interface CaptureResult {
  code: number;
  stdout: string;
  stderr: string;
}

function daemonCommandArgs(args: readonly string[]): string[] {
  return ["sudo", "-n", "-u", DAEMON_USER, DAEMON_BIN, ...args];
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
  const sshArgs = options.interactive ? ["-t", alias] : [alias];
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

export function captureRemote(
  alias: string,
  args: readonly string[],
  options: Pick<RemoteOptions, "input"> = {},
): Promise<CaptureResult> {
  const child = spawn("ssh", [alias, ...args.map(shellQuote)], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];

  child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));

  if (options.input !== undefined) {
    child.stdin.end(options.input);
  } else {
    child.stdin.end();
  }

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

export function captureDaemonCommand(
  alias: string,
  args: readonly string[],
  options: Pick<RemoteOptions, "input"> = {},
) {
  return captureRemote(alias, daemonCommandArgs(args), options);
}
