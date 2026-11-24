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

export function runDaemonCommand(
  alias: string,
  args: readonly string[],
  options: RemoteOptions = {},
) {
  return runRemote(alias, ["sudo", "-n", "-u", DAEMON_USER, DAEMON_BIN, ...args], options);
}
