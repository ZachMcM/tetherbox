import { spawn } from "node:child_process";
import {
  AGENT_SYSTEM_PATH,
  buildAgentSudoCommand,
  localAgentPath,
  turnStreamEventSchema,
  type TurnInput,
  type TurnStreamEvent,
} from "@tetherbox/core";
import type { DaemonConfig } from "./config.ts";

export interface RunAgentOptions {
  onEvent?(event: TurnStreamEvent): void;
  signal?: AbortSignal;
}

function agentCommand(agent: DaemonConfig["agent"]): readonly [string, string[]] {
  if (agent.user === undefined) {
    return [process.execPath, [agent.entry]];
  }

  // TODO: Install a sudoers rule letting the daemon user run only this command as the agent user,
  // or switch to `systemd-run --uid` so a run gets its own cgroup with memory and CPU limits.
  return buildAgentSudoCommand({
    user: agent.user,
    command: [process.execPath, agent.entry],
    nonInteractive: true,
  });
}

function isBrokenPipeError(error: unknown): boolean {
  if (!(error instanceof Error) || !("code" in error)) {
    return false;
  }

  return error.code === "EPIPE" || error.code === "ERR_STREAM_DESTROYED";
}

/**
 * Runs one agent turn in a child process. Turn input goes over stdin so nothing reaches the child
 * through the environment, and the child writes newline-delimited TurnStreamEvent JSON on stdout.
 */
export function runAgent(
  agent: DaemonConfig["agent"],
  input: TurnInput,
  options?: RunAgentOptions,
): Promise<void> {
  const [command, args] = agentCommand(agent);
  const child = spawn(command, args, {
    env: {
      PATH: agent.user === undefined ? localAgentPath(process.env.HOME) : AGENT_SYSTEM_PATH,
      LANG: "C.UTF-8",
      ...(agent.user === undefined && { HOME: process.env.HOME }),
    },
    stdio: ["pipe", "pipe", "inherit"],
    timeout: agent.timeoutMs,
    killSignal: "SIGTERM",
  });

  child.stdout.setEncoding("utf8");

  let remainder = "";
  let streamError: Error | undefined;

  const handleLine = (line: string): void => {
    const trimmed = line.trim();

    if (trimmed === "") {
      return;
    }

    try {
      const event = turnStreamEventSchema.parse(JSON.parse(trimmed));

      options?.onEvent?.(event);
    } catch (error) {
      streamError ??= error instanceof Error ? error : new Error(String(error));
    }
  };

  child.stdout.on("data", (chunk: string) => {
    remainder += chunk;

    let newlineIndex = remainder.indexOf("\n");

    while (newlineIndex !== -1) {
      const line = remainder.slice(0, newlineIndex);

      remainder = remainder.slice(newlineIndex + 1);
      handleLine(line);
      newlineIndex = remainder.indexOf("\n");
    }
  });

  const onAbort = (): void => {
    child.kill("SIGTERM");
  };

  if (options?.signal !== undefined) {
    if (options.signal.aborted) {
      child.kill("SIGTERM");
    } else {
      options.signal.addEventListener("abort", onAbort, { once: true });
    }
  }

  const cleanup = (): void => {
    options?.signal?.removeEventListener("abort", onAbort);
  };

  child.stdin.on("error", (error) => {
    if (!isBrokenPipeError(error)) {
      streamError ??= error;
    }
  });
  child.stdin.end(JSON.stringify(input));

  return new Promise((resolve, reject) => {
    child.once("error", (error) => {
      cleanup();
      reject(error);
    });
    child.once("close", (code, signal) => {
      cleanup();

      if (remainder.trim() !== "") {
        handleLine(remainder);
      }

      if (code !== 0) {
        reject(new Error(`agent run ${input.runId} exited with ${signal ?? `code ${code}`}`));

        return;
      }

      if (streamError !== undefined) {
        reject(streamError);

        return;
      }

      resolve();
    });
  });
}
