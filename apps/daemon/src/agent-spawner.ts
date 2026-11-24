import { spawn } from "node:child_process";
import { turnResultSchema, type TurnInput, type TurnResult } from "@tetherbox/core";
import type { DaemonConfig } from "./config.ts";

const AGENT_PATH = "/usr/local/bin:/usr/bin:/bin";

function agentCommand(agent: DaemonConfig["agent"]): [string, string[]] {
  if (agent.user === undefined) {
    return [process.execPath, [agent.entry]];
  }

  // TODO: Install a sudoers rule letting the daemon user run only this command as the agent user,
  // or switch to `systemd-run --uid` so a run gets its own cgroup with memory and CPU limits.
  return ["sudo", ["-n", "-H", "-u", agent.user, "--", process.execPath, agent.entry]];
}

/**
 * Runs one agent turn in a child process. The turn input goes over stdin so nothing reaches the
 * child through the environment, and the child prints a single TurnResult JSON document on stdout.
 */
export function runAgent(agent: DaemonConfig["agent"], input: TurnInput): Promise<TurnResult> {
  const [command, args] = agentCommand(agent);
  const child = spawn(command, args, {
    env: {
      PATH: AGENT_PATH,
      LANG: "C.UTF-8",
      ...(agent.user === undefined && { HOME: process.env.HOME }),
    },
    stdio: ["pipe", "pipe", "inherit"],
    timeout: agent.timeoutMs,
    killSignal: "SIGTERM",
  });
  const stdout: Buffer[] = [];

  child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
  child.stdin.end(JSON.stringify(input));

  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code !== 0) {
        reject(new Error(`agent run ${input.runId} exited with ${signal ?? `code ${code}`}`));

        return;
      }

      try {
        resolve(turnResultSchema.parse(JSON.parse(Buffer.concat(stdout).toString("utf8"))));
      } catch (error) {
        reject(error);
      }
    });
  });
}
