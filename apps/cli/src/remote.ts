import { spawn } from "node:child_process";

const DAEMON_USER = "tetherbox";
const DAEMON_BIN = "tetherbox-daemon";

function shellQuote(arg: string): string {
  return `'${arg.replaceAll("'", `'\\''`)}'`;
}

export interface RemoteOptions {
  interactive?: boolean;
}

function daemonCommandArgs(args: readonly string[]): string[] {
  return ["sudo", "-n", "-u", DAEMON_USER, DAEMON_BIN, ...args];
}

/**
 * Runs a command on the VM over the user's preconfigured SSH alias with shell-quoted arguments.
 */
export function runRemote(
  alias: string,
  args: readonly string[],
  options: RemoteOptions = {},
): Promise<number> {
  const sshArgs = [...(options.interactive ? ["-t"] : []), "--", alias];
  const child = spawn("ssh", [...sshArgs, ...args.map(shellQuote)], {
    stdio: "inherit",
  });

  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code ?? 1));
  });
}

export function runDaemonCommand(alias: string, args: readonly string[]) {
  return runRemote(alias, daemonCommandArgs(args));
}
