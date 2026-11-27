import type { ModuleContext, ModuleToolResult, TetherboxModule } from "@tetherbox/core";

const SECRET_KEY = "CURSOR_API_KEY";
const API_BASE = "https://api.cursor.com/v1";
const MAX_RESULT_CHARS = 32 * 1024;
const MAX_ERROR_CHARS = 2000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asObject(params: unknown): Record<string, unknown> {
  return isRecord(params) ? params : {};
}

function requireString(obj: Record<string, unknown>, key: string): string {
  const value = obj[key];

  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Expected non-empty string for "${key}"`);
  }

  return value.trim();
}

function optionalString(obj: Record<string, unknown>, key: string): string | undefined {
  const value = obj[key];

  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new Error(`Expected string for "${key}"`);
  }

  const trimmed = value.trim();

  return trimmed === "" ? undefined : trimmed;
}

function optionalNumber(obj: Record<string, unknown>, key: string): number | undefined {
  const value = obj[key];

  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Expected finite number for "${key}"`);
  }

  return value;
}

function optionalBoolean(obj: Record<string, unknown>, key: string): boolean | undefined {
  const value = obj[key];

  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "boolean") {
    throw new Error(`Expected boolean for "${key}"`);
  }

  return value;
}

function cappedJsonResult(value: unknown): ModuleToolResult {
  const safeValue = value === undefined ? null : value;
  const serialized = JSON.stringify(safeValue, null, 2);

  if (serialized.length <= MAX_RESULT_CHARS) {
    return { kind: "json", value: safeValue };
  }

  return {
    kind: "json",
    value: {
      truncated: true,
      body: serialized.slice(0, MAX_RESULT_CHARS),
    },
  };
}

async function cursorRequest(
  ctx: ModuleContext,
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<ModuleToolResult> {
  if (!(await ctx.hasSecret(SECRET_KEY))) {
    return {
      kind: "text",
      text: `Missing ${SECRET_KEY}. Add it in Tetherbox Settings -> Secrets pinned to api.cursor.com.`,
    };
  }

  const headers: Record<string, string> = { Accept: "application/json" };
  const requestInit: RequestInit = {
    method: init?.method ?? "GET",
    headers,
  };

  if (init?.body !== undefined) {
    headers["Content-Type"] = "application/json";
    requestInit.body = JSON.stringify(init.body);
  }

  const response = await ctx.fetchWithSecret(SECRET_KEY, `${API_BASE}${path}`, requestInit);
  const raw = await response.text();

  if (!response.ok) {
    throw new Error(`Cursor API returned ${response.status}: ${raw.slice(0, MAX_ERROR_CHARS)}`);
  }

  if (raw.trim() === "") {
    return { kind: "json", value: { ok: true, status: response.status } };
  }

  try {
    return cappedJsonResult(JSON.parse(raw));
  } catch {
    return {
      kind: "text",
      text: raw.length > MAX_RESULT_CHARS ? `${raw.slice(0, MAX_RESULT_CHARS)}\n[truncated]` : raw,
    };
  }
}

export default {
  name: "cursor",
  description: "Launch and monitor Cursor Cloud Agents sessions via api.cursor.com.",
  requiredSecrets: [SECRET_KEY],
  tools: [
    {
      name: "launch_agent",
      description: "Create a Cursor Cloud Agent and enqueue its initial prompt run.",
      parameters: {
        type: "object",
        properties: {
          repository: {
            type: "string",
            description: "Git repository URL (for example https://github.com/org/repo).",
          },
          prompt: { type: "string", description: "Initial task prompt for the agent." },
          ref: { type: "string", description: "Optional base branch, tag, or commit ref." },
          model: { type: "string", description: "Optional model identifier." },
          branchName: { type: "string", description: "Optional target branch name." },
          autoCreatePr: {
            type: "boolean",
            description: "Whether to open a pull request automatically when finished.",
          },
        },
        required: ["repository", "prompt"],
        additionalProperties: false,
      },
      async execute(params, ctx) {
        const obj = asObject(params);
        const payload: Record<string, unknown> = {
          repository: requireString(obj, "repository"),
          prompt: { text: requireString(obj, "prompt") },
        };
        const ref = optionalString(obj, "ref");
        const model = optionalString(obj, "model");
        const branchName = optionalString(obj, "branchName");
        const autoCreatePr = optionalBoolean(obj, "autoCreatePr");

        if (ref !== undefined) {
          payload.ref = ref;
        }

        if (model !== undefined) {
          payload.model = model;
        }

        const target: Record<string, unknown> = {};

        if (branchName !== undefined) {
          target.branchName = branchName;
        }

        if (autoCreatePr !== undefined) {
          target.autoCreatePr = autoCreatePr;
        }

        if (Object.keys(target).length > 0) {
          payload.target = target;
        }

        return cursorRequest(ctx, "/agents", { method: "POST", body: payload });
      },
    },
    {
      name: "list_agents",
      description: "List Cursor Cloud Agents.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Maximum number of agents to return." },
          cursor: { type: "string", description: "Pagination cursor from a previous response." },
        },
        additionalProperties: false,
      },
      async execute(params, ctx) {
        const obj = asObject(params);
        const query = new URLSearchParams();
        const limit = optionalNumber(obj, "limit");
        const cursor = optionalString(obj, "cursor");

        if (limit !== undefined) {
          query.set("limit", String(Math.max(1, Math.trunc(limit))));
        }

        if (cursor !== undefined) {
          query.set("cursor", cursor);
        }

        const qs = query.toString();

        return cursorRequest(ctx, `/agents${qs === "" ? "" : `?${qs}`}`);
      },
    },
    {
      name: "get_agent",
      description: "Get metadata and current status for a Cursor Cloud Agent.",
      parameters: {
        type: "object",
        properties: {
          agentId: { type: "string", description: "Cursor Cloud Agent ID." },
        },
        required: ["agentId"],
        additionalProperties: false,
      },
      async execute(params, ctx) {
        const agentId = requireString(asObject(params), "agentId");

        return cursorRequest(ctx, `/agents/${encodeURIComponent(agentId)}`);
      },
    },
    {
      name: "get_run",
      description: "Get status and output for a specific run on a Cursor Cloud Agent.",
      parameters: {
        type: "object",
        properties: {
          agentId: { type: "string", description: "Cursor Cloud Agent ID." },
          runId: { type: "string", description: "Run ID returned when launching or following up." },
        },
        required: ["agentId", "runId"],
        additionalProperties: false,
      },
      async execute(params, ctx) {
        const obj = asObject(params);
        const agentId = requireString(obj, "agentId");
        const runId = requireString(obj, "runId");

        return cursorRequest(
          ctx,
          `/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(runId)}`,
        );
      },
    },
    {
      name: "get_conversation",
      description: "Fetch the conversation history for a Cursor Cloud Agent.",
      parameters: {
        type: "object",
        properties: {
          agentId: { type: "string", description: "Cursor Cloud Agent ID." },
        },
        required: ["agentId"],
        additionalProperties: false,
      },
      async execute(params, ctx) {
        const agentId = requireString(asObject(params), "agentId");

        return cursorRequest(ctx, `/agents/${encodeURIComponent(agentId)}/conversation`);
      },
    },
    {
      name: "add_followup",
      description: "Enqueue a follow-up prompt run on an existing Cursor Cloud Agent.",
      parameters: {
        type: "object",
        properties: {
          agentId: { type: "string", description: "Cursor Cloud Agent ID." },
          prompt: { type: "string", description: "Follow-up prompt text." },
          model: { type: "string", description: "Optional model override for this run." },
        },
        required: ["agentId", "prompt"],
        additionalProperties: false,
      },
      async execute(params, ctx) {
        const obj = asObject(params);
        const agentId = requireString(obj, "agentId");
        const payload: Record<string, unknown> = {
          prompt: { text: requireString(obj, "prompt") },
        };
        const model = optionalString(obj, "model");

        if (model !== undefined) {
          payload.model = model;
        }

        return cursorRequest(ctx, `/agents/${encodeURIComponent(agentId)}/runs`, {
          method: "POST",
          body: payload,
        });
      },
    },
    {
      name: "cancel_run",
      description: "Cancel an active run on a Cursor Cloud Agent.",
      parameters: {
        type: "object",
        properties: {
          agentId: { type: "string", description: "Cursor Cloud Agent ID." },
          runId: { type: "string", description: "Run ID to cancel." },
        },
        required: ["agentId", "runId"],
        additionalProperties: false,
      },
      async execute(params, ctx) {
        const obj = asObject(params);
        const agentId = requireString(obj, "agentId");
        const runId = requireString(obj, "runId");

        return cursorRequest(
          ctx,
          `/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(runId)}/cancel`,
          { method: "POST" },
        );
      },
    },
  ],
} satisfies TetherboxModule;
