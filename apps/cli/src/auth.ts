import * as p from "@clack/prompts";
import type { StarterCliAuth, StarterCliAuthEntry } from "@tetherbox/starters";
import pc from "picocolors";
import { captureAgentCommand, runAgentCommand, type CaptureResult } from "./remote.ts";

export type CliAuthStatus =
  | { readonly kind: "authenticated" }
  | { readonly kind: "unauthenticated" }
  | { readonly kind: "unknown" }
  | { readonly kind: "missing-binary"; readonly binary: string }
  | { readonly kind: "error"; readonly message: string };

export interface CliAuthDeps {
  readonly captureAgent?: (sshAlias: string, args: readonly string[]) => Promise<CaptureResult>;
  readonly runAgent?: (
    sshAlias: string,
    args: readonly string[],
    options: { interactive: boolean },
  ) => Promise<number>;
}

const SSH_ERROR_EXIT_CODE = 255;

export async function inspectCliAuth(
  sshAlias: string,
  cliAuth: StarterCliAuth,
  deps: Pick<CliAuthDeps, "captureAgent"> = {},
): Promise<CliAuthStatus> {
  const capture = deps.captureAgent ?? captureAgentCommand;
  const probe = await capture(sshAlias, [
    "sh",
    "-c",
    'command -v "$1" >/dev/null 2>&1',
    "_",
    cliAuth.binary,
  ]);

  if (probe.code !== 0) {
    const stderr = probe.stderr.trim();

    if (stderr !== "" || probe.code === SSH_ERROR_EXIT_CODE) {
      return { kind: "error", message: stderr || "failed to reach the VM over SSH" };
    }

    return { kind: "missing-binary", binary: cliAuth.binary };
  }

  if (cliAuth.checkCommand === undefined) {
    return { kind: "unknown" };
  }

  const check = await capture(sshAlias, cliAuth.checkCommand);

  if (check.code === 0) {
    return { kind: "authenticated" };
  }

  if (check.code === SSH_ERROR_EXIT_CODE) {
    return { kind: "error", message: check.stderr.trim() || "failed to reach the VM over SSH" };
  }

  return { kind: "unauthenticated" };
}

export function formatCliAuthStatus(status: CliAuthStatus): string {
  switch (status.kind) {
    case "authenticated":
      return pc.green("authenticated");
    case "unauthenticated":
      return pc.yellow("not authenticated");
    case "unknown":
      return pc.dim("installed (auth status not checked)");
    case "missing-binary":
      return pc.red(`binary "${status.binary}" not installed`);
    case "error":
      return pc.red(`error: ${status.message}`);
    default: {
      const exhaustive: never = status;

      return exhaustive;
    }
  }
}

export interface RunStarterLoginOptions {
  readonly sshAlias: string;
  readonly entry: StarterCliAuthEntry;
  readonly extraArgs?: readonly string[];
  readonly deps?: CliAuthDeps;
}

export async function runStarterLogin({
  sshAlias,
  entry,
  extraArgs = [],
  deps = {},
}: RunStarterLoginOptions): Promise<number> {
  const status = await inspectCliAuth(sshAlias, entry.cliAuth, deps);

  if (status.kind === "missing-binary") {
    p.log.error(
      `${entry.cliAuth.binary} is not installed on the VM for tetherbox-agent. Install it first, then re-run "tetherbox auth ${entry.starterId}".`,
    );

    return 1;
  }

  if (status.kind === "error") {
    p.log.error(`Could not check ${entry.starterId} on the VM: ${status.message}`);

    return 1;
  }

  const command = [...entry.cliAuth.loginCommand, ...extraArgs];

  p.log.info(`Running ${pc.cyan(command.join(" "))} as tetherbox-agent...`);

  const runAgent = deps.runAgent ?? runAgentCommand;

  return runAgent(sshAlias, command, { interactive: true });
}

export interface EnsureStarterCliAuthOptions {
  readonly sshAlias: string;
  readonly entries: readonly StarterCliAuthEntry[];
  readonly deps?: CliAuthDeps;
}

export async function ensureStarterCliAuth({
  sshAlias,
  entries,
  deps = {},
}: EnsureStarterCliAuthOptions): Promise<"ok" | "cancelled"> {
  for (const entry of entries) {
    const status = await inspectCliAuth(sshAlias, entry.cliAuth, deps);

    switch (status.kind) {
      case "authenticated":
        p.log.success(`${entry.starterId} CLI is already authenticated.`);
        continue;
      case "missing-binary":
        p.log.warn(
          `${status.binary} is not installed on the VM for tetherbox-agent. Install it later and run "tetherbox auth ${entry.starterId}".`,
        );
        continue;
      case "error":
        p.log.warn(
          `Could not check ${entry.starterId} CLI auth (${status.message}). You can run "tetherbox auth ${entry.starterId}" later.`,
        );
        continue;
      case "unauthenticated":
      case "unknown":
        break;
      default: {
        const exhaustive: never = status;

        return exhaustive;
      }
    }

    const promptMessage =
      status.kind === "unauthenticated"
        ? `${entry.starterId} CLI is not authenticated. Log in now?`
        : `Run ${entry.starterId} CLI login now?`;
    const shouldLogin = await p.confirm({
      message: promptMessage,
      initialValue: status.kind === "unauthenticated",
    });

    if (p.isCancel(shouldLogin)) {
      return "cancelled";
    }

    if (!shouldLogin) {
      p.log.info(`Skipped. Authenticate later with: tetherbox auth ${entry.starterId}`);
      continue;
    }

    const code = await runStarterLogin({ sshAlias, entry, deps });

    if (code !== 0) {
      p.log.warn(
        `${entry.starterId} login exited with code ${code}. Retry later with: tetherbox auth ${entry.starterId}`,
      );
    }
  }

  return "ok";
}
