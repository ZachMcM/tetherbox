import type { ModuleContext, ModuleToolResult, TetherboxModule } from "@tetherbox/core";

const SECRET_KEY = "SLACK_BOT_TOKEN";
const API_BASE = "https://slack.com/api";
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
  const serialized = JSON.stringify(value, null, 2);

  if (serialized.length <= MAX_RESULT_CHARS) {
    return { kind: "json", value };
  }

  return {
    kind: "json",
    value: {
      truncated: true,
      body: serialized.slice(0, MAX_RESULT_CHARS),
    },
  };
}

async function slackCall(
  ctx: ModuleContext,
  method: string,
  options: { httpMethod: "GET"; query?: URLSearchParams } | { httpMethod: "POST"; body: unknown },
): Promise<ModuleToolResult> {
  if (!(await ctx.hasSecret(SECRET_KEY))) {
    return {
      kind: "text",
      text: `Missing ${SECRET_KEY}. Run: tetherbox secrets set ${SECRET_KEY} --domain slack.com`,
    };
  }

  let url = `${API_BASE}/${method}`;
  const requestInit: RequestInit = {
    method: options.httpMethod,
    headers: { Accept: "application/json" },
  };

  if (options.httpMethod === "GET") {
    const qs = options.query?.toString() ?? "";

    if (qs !== "") {
      url = `${url}?${qs}`;
    }
  } else {
    requestInit.headers = {
      Accept: "application/json",
      "Content-Type": "application/json; charset=utf-8",
    };
    requestInit.body = JSON.stringify(options.body);
  }

  const response = await ctx.fetchWithSecret(SECRET_KEY, url, requestInit);
  const raw = await response.text();

  if (!response.ok) {
    throw new Error(
      `Slack ${method} returned ${response.status}: ${raw.slice(0, MAX_ERROR_CHARS)}`,
    );
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Slack ${method} returned non-JSON body: ${raw.slice(0, MAX_ERROR_CHARS)}`);
  }

  if (!isRecord(parsed)) {
    throw new Error(`Slack ${method} returned an unexpected response payload`);
  }

  if (parsed.ok !== true) {
    const code = typeof parsed.error === "string" ? parsed.error : "unknown_error";
    const needed = typeof parsed.needed === "string" ? ` (needed scope: ${parsed.needed})` : "";

    throw new Error(`Slack ${method} failed: ${code}${needed}`);
  }

  return cappedJsonResult(parsed);
}

export default {
  name: "slack",
  description: "Read, search, and post messages in Slack channels and threads.",
  requiredSecrets: [SECRET_KEY],
  tools: [
    {
      name: "list_channels",
      description: "List Slack channels visible to the bot.",
      parameters: {
        type: "object",
        properties: {
          types: {
            type: "string",
            description: "Comma-separated channel types (default public_channel,private_channel).",
          },
          excludeArchived: {
            type: "boolean",
            description: "Exclude archived channels (default true).",
          },
          limit: { type: "number", description: "Max channels to return (1-200)." },
          cursor: { type: "string", description: "Pagination cursor from response_metadata." },
        },
        additionalProperties: false,
      },
      async execute(params, ctx) {
        const obj = asObject(params);
        const query = new URLSearchParams({
          types: optionalString(obj, "types") ?? "public_channel,private_channel",
          exclude_archived: String(optionalBoolean(obj, "excludeArchived") ?? true),
        });
        const limit = optionalNumber(obj, "limit");
        const cursor = optionalString(obj, "cursor");

        if (limit !== undefined) {
          query.set("limit", String(Math.min(200, Math.max(1, Math.trunc(limit)))));
        }

        if (cursor !== undefined) {
          query.set("cursor", cursor);
        }

        return slackCall(ctx, "conversations.list", { httpMethod: "GET", query });
      },
    },
    {
      name: "read_channel",
      description: "Read recent messages from a Slack channel.",
      parameters: {
        type: "object",
        properties: {
          channel: { type: "string", description: "Slack channel ID (for example C01234567)." },
          limit: { type: "number", description: "Max messages to return (default 25, max 200)." },
          oldest: { type: "string", description: "Only messages after this Slack timestamp." },
          latest: { type: "string", description: "Only messages before this Slack timestamp." },
          cursor: { type: "string", description: "Pagination cursor from response_metadata." },
        },
        required: ["channel"],
        additionalProperties: false,
      },
      async execute(params, ctx) {
        const obj = asObject(params);
        const query = new URLSearchParams({
          channel: requireString(obj, "channel"),
          limit: String(Math.min(200, Math.max(1, Math.trunc(optionalNumber(obj, "limit") ?? 25)))),
        });
        const oldest = optionalString(obj, "oldest");
        const latest = optionalString(obj, "latest");
        const cursor = optionalString(obj, "cursor");

        if (oldest !== undefined) {
          query.set("oldest", oldest);
        }

        if (latest !== undefined) {
          query.set("latest", latest);
        }

        if (cursor !== undefined) {
          query.set("cursor", cursor);
        }

        return slackCall(ctx, "conversations.history", { httpMethod: "GET", query });
      },
    },
    {
      name: "read_thread",
      description: "Read replies in a Slack thread.",
      parameters: {
        type: "object",
        properties: {
          channel: { type: "string", description: "Slack channel ID." },
          ts: { type: "string", description: "Parent message timestamp (thread_ts)." },
          limit: { type: "number", description: "Max replies to return (default 50, max 200)." },
          cursor: { type: "string", description: "Pagination cursor from response_metadata." },
        },
        required: ["channel", "ts"],
        additionalProperties: false,
      },
      async execute(params, ctx) {
        const obj = asObject(params);
        const query = new URLSearchParams({
          channel: requireString(obj, "channel"),
          ts: requireString(obj, "ts"),
          limit: String(Math.min(200, Math.max(1, Math.trunc(optionalNumber(obj, "limit") ?? 50)))),
        });
        const cursor = optionalString(obj, "cursor");

        if (cursor !== undefined) {
          query.set("cursor", cursor);
        }

        return slackCall(ctx, "conversations.replies", { httpMethod: "GET", query });
      },
    },
    {
      name: "post_message",
      description: "Post a message to a Slack channel or thread.",
      parameters: {
        type: "object",
        properties: {
          channel: { type: "string", description: "Slack channel ID." },
          text: { type: "string", description: "Message text (Slack mrkdwn)." },
          threadTs: {
            type: "string",
            description: "Optional parent thread timestamp to reply to.",
          },
          replyBroadcast: {
            type: "boolean",
            description: "Also post the thread reply to the channel.",
          },
        },
        required: ["channel", "text"],
        additionalProperties: false,
      },
      async execute(params, ctx) {
        const obj = asObject(params);
        const body: Record<string, unknown> = {
          channel: requireString(obj, "channel"),
          text: requireString(obj, "text"),
        };
        const threadTs = optionalString(obj, "threadTs");
        const replyBroadcast = optionalBoolean(obj, "replyBroadcast");

        if (threadTs !== undefined) {
          body.thread_ts = threadTs;
        }

        if (replyBroadcast !== undefined) {
          body.reply_broadcast = replyBroadcast;
        }

        return slackCall(ctx, "chat.postMessage", { httpMethod: "POST", body });
      },
    },
    {
      name: "search_messages",
      description:
        "Search Slack messages across channels (requires a token with the search:read scope).",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Slack search query string." },
          count: { type: "number", description: "Results per page (default 20, max 100)." },
          page: { type: "number", description: "1-based page number." },
          sort: {
            type: "string",
            enum: ["score", "timestamp"],
            description: "Sort by relevance score or timestamp.",
          },
          sortDir: {
            type: "string",
            enum: ["asc", "desc"],
            description: "Sort direction.",
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
      async execute(params, ctx) {
        const obj = asObject(params);
        const query = new URLSearchParams({
          query: requireString(obj, "query"),
          count: String(Math.min(100, Math.max(1, Math.trunc(optionalNumber(obj, "count") ?? 20)))),
        });
        const page = optionalNumber(obj, "page");
        const sort = optionalString(obj, "sort");
        const sortDir = optionalString(obj, "sortDir");

        if (page !== undefined) {
          query.set("page", String(Math.max(1, Math.trunc(page))));
        }

        if (sort !== undefined) {
          if (sort !== "score" && sort !== "timestamp") {
            throw new Error('Expected "sort" to be "score" or "timestamp"');
          }

          query.set("sort", sort);
        }

        if (sortDir !== undefined) {
          if (sortDir !== "asc" && sortDir !== "desc") {
            throw new Error('Expected "sortDir" to be "asc" or "desc"');
          }

          query.set("sort_dir", sortDir);
        }

        return slackCall(ctx, "search.messages", { httpMethod: "GET", query });
      },
    },
  ],
} satisfies TetherboxModule;
