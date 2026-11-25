import type { ModuleContext, ModuleToolResult, TetherboxModule } from "@tetherbox/core";

const SECRET_KEY = "DEVIN_API_KEY";
const API_BASE = "https://api.devin.ai/v3/organizations";
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

function optionalStringArray(obj: Record<string, unknown>, key: string): string[] | undefined {
  const value = obj[key];

  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`Expected string array for "${key}"`);
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

async function devinRequest(
  ctx: ModuleContext,
  orgIdOverride: string | undefined,
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<ModuleToolResult> {
  if (!(await ctx.hasSecret(SECRET_KEY))) {
    return {
      kind: "text",
      text: `Missing ${SECRET_KEY}. Run: tetherbox secrets set ${SECRET_KEY} --domain api.devin.ai`,
    };
  }

  const orgId = orgIdOverride ?? ctx.config.orgId?.trim();

  if (orgId === undefined || orgId === "") {
    return {
      kind: "text",
      text: "Missing Devin organization ID. Set starterConfig.devin.orgId in profile.json or pass orgId.",
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

  const response = await ctx.fetchWithSecret(
    SECRET_KEY,
    `${API_BASE}/${encodeURIComponent(orgId)}${path}`,
    requestInit,
  );
  const raw = await response.text();

  if (!response.ok) {
    throw new Error(`Devin API returned ${response.status}: ${raw.slice(0, MAX_ERROR_CHARS)}`);
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
  name: "devin",
  description: "Launch and manage Devin v3 cloud sessions via api.devin.ai.",
  requiredSecrets: [SECRET_KEY],
  tools: [
    {
      name: "create_session",
      description:
        "Start a new Devin session with a prompt and optional repo or playbook settings.",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "Task instructions for Devin." },
          orgId: { type: "string", description: "Override starterConfig.devin.orgId." },
          repos: {
            type: "array",
            items: { type: "string" },
            description: "Optional repositories to attach to the session.",
          },
          title: { type: "string", description: "Optional display title for the session." },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "Optional tags for organizing sessions.",
          },
          playbook_id: { type: "string", description: "Optional playbook ID to run." },
          max_acu_limit: { type: "number", description: "Optional ACU spending cap." },
          bypass_approval: {
            type: "boolean",
            description: "Skip interactive approval prompts when supported.",
          },
        },
        required: ["prompt"],
        additionalProperties: false,
      },
      async execute(params, ctx) {
        const obj = asObject(params);
        const payload: Record<string, unknown> = { prompt: requireString(obj, "prompt") };
        const repos = optionalStringArray(obj, "repos");
        const title = optionalString(obj, "title");
        const tags = optionalStringArray(obj, "tags");
        const playbookId = optionalString(obj, "playbook_id");
        const maxAcuLimit = optionalNumber(obj, "max_acu_limit");
        const bypassApproval = optionalBoolean(obj, "bypass_approval");

        if (repos !== undefined) {
          payload.repos = repos;
        }

        if (title !== undefined) {
          payload.title = title;
        }

        if (tags !== undefined) {
          payload.tags = tags;
        }

        if (playbookId !== undefined) {
          payload.playbook_id = playbookId;
        }

        if (maxAcuLimit !== undefined) {
          payload.max_acu_limit = maxAcuLimit;
        }

        if (bypassApproval !== undefined) {
          payload.bypass_approval = bypassApproval;
        }

        return devinRequest(ctx, optionalString(obj, "orgId"), "/sessions", {
          method: "POST",
          body: payload,
        });
      },
    },
    {
      name: "list_sessions",
      description: "List Devin sessions in the organization.",
      parameters: {
        type: "object",
        properties: {
          orgId: { type: "string", description: "Override starterConfig.devin.orgId." },
          limit: { type: "number", description: "Maximum number of sessions to return." },
          after: { type: "string", description: "Pagination cursor from a previous response." },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "Optional tags to filter by.",
          },
        },
        additionalProperties: false,
      },
      async execute(params, ctx) {
        const obj = asObject(params);
        const query = new URLSearchParams();
        const limit = optionalNumber(obj, "limit");
        const after = optionalString(obj, "after");
        const tags = optionalStringArray(obj, "tags");

        if (limit !== undefined) {
          query.set("first", String(Math.max(1, Math.trunc(limit))));
        }

        if (after !== undefined) {
          query.set("after", after);
        }

        if (tags !== undefined) {
          for (const tag of tags) {
            query.append("tags", tag);
          }
        }

        const qs = query.toString();

        return devinRequest(
          ctx,
          optionalString(obj, "orgId"),
          `/sessions${qs === "" ? "" : `?${qs}`}`,
        );
      },
    },
    {
      name: "get_session",
      description: "Get status and details for a specific Devin session.",
      parameters: {
        type: "object",
        properties: {
          sessionId: { type: "string", description: "Devin session ID (e.g. devin-...)." },
          orgId: { type: "string", description: "Override starterConfig.devin.orgId." },
        },
        required: ["sessionId"],
        additionalProperties: false,
      },
      async execute(params, ctx) {
        const obj = asObject(params);
        const sessionId = requireString(obj, "sessionId");

        return devinRequest(
          ctx,
          optionalString(obj, "orgId"),
          `/sessions/${encodeURIComponent(sessionId)}`,
        );
      },
    },
    {
      name: "list_messages",
      description: "List messages in a Devin session.",
      parameters: {
        type: "object",
        properties: {
          sessionId: { type: "string", description: "Devin session ID." },
          orgId: { type: "string", description: "Override starterConfig.devin.orgId." },
          limit: { type: "number", description: "Maximum number of messages to return." },
          after: { type: "string", description: "Pagination cursor from a previous response." },
        },
        required: ["sessionId"],
        additionalProperties: false,
      },
      async execute(params, ctx) {
        const obj = asObject(params);
        const sessionId = requireString(obj, "sessionId");
        const query = new URLSearchParams();
        const limit = optionalNumber(obj, "limit");
        const after = optionalString(obj, "after");

        if (limit !== undefined) {
          query.set("first", String(Math.max(1, Math.trunc(limit))));
        }

        if (after !== undefined) {
          query.set("after", after);
        }

        const qs = query.toString();

        return devinRequest(
          ctx,
          optionalString(obj, "orgId"),
          `/sessions/${encodeURIComponent(sessionId)}/messages${qs === "" ? "" : `?${qs}`}`,
        );
      },
    },
    {
      name: "send_message",
      description: "Send a follow-up message to an existing Devin session (resumes if suspended).",
      parameters: {
        type: "object",
        properties: {
          sessionId: { type: "string", description: "Devin session ID." },
          message: { type: "string", description: "Message text to send to Devin." },
          attachmentUrls: {
            type: "array",
            items: { type: "string" },
            description: "Optional attachment URLs.",
          },
          orgId: { type: "string", description: "Override starterConfig.devin.orgId." },
        },
        required: ["sessionId", "message"],
        additionalProperties: false,
      },
      async execute(params, ctx) {
        const obj = asObject(params);
        const sessionId = requireString(obj, "sessionId");
        const payload: Record<string, unknown> = { message: requireString(obj, "message") };
        const attachmentUrls = optionalStringArray(obj, "attachmentUrls");

        if (attachmentUrls !== undefined) {
          payload.attachment_urls = attachmentUrls;
        }

        return devinRequest(
          ctx,
          optionalString(obj, "orgId"),
          `/sessions/${encodeURIComponent(sessionId)}/messages`,
          { method: "POST", body: payload },
        );
      },
    },
    {
      name: "terminate_session",
      description: "Terminate an active Devin session.",
      parameters: {
        type: "object",
        properties: {
          sessionId: { type: "string", description: "Devin session ID." },
          orgId: { type: "string", description: "Override starterConfig.devin.orgId." },
        },
        required: ["sessionId"],
        additionalProperties: false,
      },
      async execute(params, ctx) {
        const obj = asObject(params);
        const sessionId = requireString(obj, "sessionId");

        return devinRequest(
          ctx,
          optionalString(obj, "orgId"),
          `/sessions/${encodeURIComponent(sessionId)}`,
          {
            method: "DELETE",
          },
        );
      },
    },
  ],
} satisfies TetherboxModule;
