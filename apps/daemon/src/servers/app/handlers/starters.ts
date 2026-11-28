import {
  CONFIG_PLACEHOLDER_PATTERN,
  RpcError,
  starterConfigFieldSchemas,
  type StarterConnectionCheckResult,
  type StarterHandlers,
} from "@tetherbox/core";
import type { AgentProcessRunner } from "../../../clis/agent-process.ts";
import { probeBinary } from "../../../clis/status.ts";
import type { StarterCatalog } from "../../../profiles/starter-catalog.ts";

const COMMAND_CHECK_TIMEOUT_MS = 8_000;
const HTTP_CHECK_TIMEOUT_MS = 5_000;

export function createStarterHandlers({
  catalog,
  agentRunner,
}: {
  catalog: StarterCatalog;
  agentRunner: AgentProcessRunner;
}): StarterHandlers {
  return {
    list: () => catalog.summaries(),
    async checkConnection(starterId, input): Promise<StarterConnectionCheckResult> {
      const starter = catalog.get(starterId);

      if (starter === undefined) {
        throw new RpcError(404, `unknown starter "${starterId}"`);
      }

      const check = starter.connectionCheck;

      if (check === undefined) {
        throw new RpcError(400, `starter "${starterId}" does not define a connection check`);
      }

      const validated: Record<string, string> = {};

      for (const field of starter.configFields) {
        const parsed = starterConfigFieldSchemas[field.kind].safeParse(
          input.config[field.key] ?? "",
        );

        if (!parsed.success) {
          return {
            ok: false,
            error: parsed.error.issues[0]?.message ?? `Invalid value for ${field.key}`,
          };
        }

        validated[field.key] = parsed.data;
      }

      if (check.kind === "http") {
        const rawUrl = validated[check.urlField];

        if (rawUrl === undefined) {
          return { ok: false, error: `Missing ${check.urlField}` };
        }

        const targetUrl =
          check.path !== undefined ? URL.parse(check.path, rawUrl) : URL.parse(rawUrl);

        if (
          targetUrl === null ||
          (targetUrl.protocol !== "http:" && targetUrl.protocol !== "https:")
        ) {
          return { ok: false, error: `Invalid URL for ${check.urlField}` };
        }

        try {
          const response = await fetch(targetUrl, {
            method: "GET",
            redirect: "manual",
            signal: AbortSignal.timeout(HTTP_CHECK_TIMEOUT_MS),
          });

          if (response.status >= 500) {
            return { ok: false, error: `HTTP ${response.status} from ${targetUrl.host}` };
          }

          return { ok: true };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);

          return { ok: false, error: `Could not reach ${targetUrl.host}: ${message}` };
        }
      }

      if (starter.cli !== undefined) {
        const probe = await probeBinary(agentRunner, starter.cli.binary);

        if (probe.kind === "missing") {
          return {
            ok: false,
            error: `${starter.cli.binary} is not installed yet. Install it first.`,
          };
        }

        if (probe.kind === "error") {
          return { ok: false, error: probe.message };
        }
      }

      const resolvedCommand = check.command.map((arg) =>
        arg.replaceAll(CONFIG_PLACEHOLDER_PATTERN, (_match, key: string) => validated[key] ?? ""),
      );
      const result = await agentRunner.capture(resolvedCommand, {
        timeoutMs: COMMAND_CHECK_TIMEOUT_MS,
      });

      if (result.code === 0) {
        return { ok: true };
      }

      const detail = (result.stderr || result.stdout).trim();

      return {
        ok: false,
        error: detail !== "" ? detail : `Check exited with code ${result.code}`,
      };
    },
    removeFromLibrary: (starterId) => catalog.remove(starterId),
  };
}
