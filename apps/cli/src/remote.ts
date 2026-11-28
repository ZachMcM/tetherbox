import { spawn } from "node:child_process";

function shellQuote(arg: string): string {
  return `'${arg.replaceAll("'", `'\\''`)}'`;
}

/**
 * Runs a command on the VM over the user's preconfigured SSH alias with shell-quoted arguments.
 */
export function runRemote(alias: string, args: readonly string[]): Promise<number> {
  const child = spawn("ssh", ["-t", "--", alias, ...args.map(shellQuote)], {
    stdio: "inherit",
  });

  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code ?? 1));
  });
}
