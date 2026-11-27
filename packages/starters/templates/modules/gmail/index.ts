import type { ModuleContext, ModuleToolResult, TetherboxModule } from "@tetherbox/core";

const SECRET_KEY = "GOOGLE_GMAIL_OAUTH";
const BASE_URL = "https://gmail.googleapis.com/gmail/v1/users/me";
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

function optionalRawString(obj: Record<string, unknown>, key: string): string | undefined {
  const value = obj[key];

  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new Error(`Expected string for "${key}"`);
  }

  return value;
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

function decodeBase64Url(data: string): string {
  return Buffer.from(data.replaceAll("-", "+").replaceAll("_", "/"), "base64").toString("utf8");
}

function encodeBase64Url(text: string): string {
  return Buffer.from(text, "utf8").toString("base64url");
}

function extractHeaders(payload: unknown): Record<string, string> {
  if (!isRecord(payload) || !Array.isArray(payload.headers)) {
    return {};
  }

  const wanted = new Set(["from", "to", "cc", "subject", "date", "message-id", "references"]);
  const headers: Record<string, string> = {};

  for (const item of payload.headers) {
    if (
      isRecord(item) &&
      typeof item.name === "string" &&
      typeof item.value === "string" &&
      wanted.has(item.name.toLowerCase())
    ) {
      headers[item.name.toLowerCase()] = item.value;
    }
  }

  return headers;
}

interface MessageParts {
  plain: string[];
  html: string[];
  attachments: string[];
}

function collectParts(payload: unknown, acc: MessageParts): void {
  if (!isRecord(payload)) {
    return;
  }

  const filename = typeof payload.filename === "string" ? payload.filename : "";

  if (filename !== "") {
    acc.attachments.push(filename);
  }

  const mimeType = typeof payload.mimeType === "string" ? payload.mimeType : "";
  const body = isRecord(payload.body) ? payload.body : undefined;
  const data = body !== undefined && typeof body.data === "string" ? body.data : undefined;

  if (data !== undefined) {
    if (mimeType === "text/plain") {
      acc.plain.push(decodeBase64Url(data));
    } else if (mimeType === "text/html") {
      acc.html.push(decodeBase64Url(data));
    }
  }

  if (Array.isArray(payload.parts)) {
    for (const part of payload.parts) {
      collectParts(part, acc);
    }
  }
}

function formatMessage(raw: unknown): Record<string, unknown> {
  if (!isRecord(raw)) {
    return {};
  }

  const headers = extractHeaders(raw.payload);
  const parts: MessageParts = { plain: [], html: [], attachments: [] };

  collectParts(raw.payload, parts);

  const body =
    parts.plain.length > 0
      ? parts.plain.join("\n")
      : parts.html
          .join("\n")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim();

  return {
    id: raw.id,
    threadId: raw.threadId,
    labelIds: raw.labelIds,
    snippet: raw.snippet,
    headers,
    ...(body !== "" ? { body } : {}),
    ...(parts.attachments.length > 0 ? { attachments: parts.attachments } : {}),
  };
}

function encodeHeaderValue(value: string): string {
  return /^[\x20-\x7e]*$/.test(value)
    ? value
    : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function buildRawEmail(options: {
  to: string;
  subject: string;
  body: string;
  cc?: string | undefined;
  bcc?: string | undefined;
  inReplyTo?: string | undefined;
  references?: string | undefined;
}): string {
  const lines = [
    `To: ${options.to}`,
    ...(options.cc !== undefined ? [`Cc: ${options.cc}`] : []),
    ...(options.bcc !== undefined ? [`Bcc: ${options.bcc}`] : []),
    `Subject: ${encodeHeaderValue(options.subject)}`,
    ...(options.inReplyTo !== undefined ? [`In-Reply-To: ${options.inReplyTo}`] : []),
    ...(options.references !== undefined ? [`References: ${options.references}`] : []),
    "Content-Type: text/plain; charset=utf-8",
    "MIME-Version: 1.0",
    "",
    options.body,
  ];

  return encodeBase64Url(lines.join("\r\n"));
}

async function gmailJson(
  ctx: ModuleContext,
  path: string,
  options: {
    method?: string;
    query?: Array<[string, string]>;
    body?: unknown;
  } = {},
): Promise<unknown> {
  const url = new URL(`${BASE_URL}${path}`);

  for (const [key, value] of options.query ?? []) {
    url.searchParams.append(key, value);
  }

  const response = await ctx.fetchWithSecret(SECRET_KEY, url, {
    method: options.method ?? "GET",
    headers: {
      Accept: "application/json",
      ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });

  if (response.status === 204) {
    return { ok: true };
  }

  const raw = await response.text();

  if (!response.ok) {
    if (
      response.status === 403 &&
      (raw.includes("insufficientPermissions") || raw.includes("ACCESS_TOKEN_SCOPE_INSUFFICIENT"))
    ) {
      throw new Error(
        "Gmail returned 403 (insufficient OAuth scope). Reconnect Gmail with read and write permissions in Tetherbox Settings -> Integrations.",
      );
    }

    throw new Error(`Gmail API returned ${response.status}: ${raw.slice(0, MAX_ERROR_CHARS)}`);
  }

  return raw.trim() === "" ? { ok: true } : JSON.parse(raw);
}

export default {
  name: "gmail",
  description: "Search, read, draft, send, and organize Gmail messages and threads.",
  requiredSecrets: [SECRET_KEY],
  tools: [
    {
      name: "list_messages",
      description:
        "Search or list Gmail messages using Gmail search syntax (for example `from:alice is:unread`).",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Gmail search query." },
          labelIds: {
            type: "array",
            items: { type: "string" },
            description: 'Optional label IDs to filter by (for example ["INBOX", "UNREAD"]).',
          },
          maxResults: {
            type: "number",
            description: "Max messages to return (default 20, max 50).",
          },
          pageToken: { type: "string", description: "Pagination token from nextPageToken." },
          includeSpamTrash: {
            type: "boolean",
            description: "Include Spam and Trash (default false).",
          },
        },
        additionalProperties: false,
      },
      async execute(params, ctx) {
        if (!(await ctx.hasSecret(SECRET_KEY))) {
          return {
            kind: "text",
            text: `Missing ${SECRET_KEY}. Connect Gmail in Tetherbox Settings -> Integrations.`,
          };
        }

        const obj = asObject(params);
        const query: Array<[string, string]> = [];
        const q = optionalString(obj, "query");
        const labelIds = optionalStringArray(obj, "labelIds");
        const maxResults = Math.min(
          50,
          Math.max(1, Math.trunc(optionalNumber(obj, "maxResults") ?? 20)),
        );
        const pageToken = optionalString(obj, "pageToken");
        const includeSpamTrash = optionalBoolean(obj, "includeSpamTrash");

        query.push(["maxResults", String(maxResults)]);

        if (q !== undefined) {
          query.push(["q", q]);
        }

        for (const labelId of labelIds ?? []) {
          query.push(["labelIds", labelId]);
        }

        if (pageToken !== undefined) {
          query.push(["pageToken", pageToken]);
        }

        if (includeSpamTrash !== undefined) {
          query.push(["includeSpamTrash", String(includeSpamTrash)]);
        }

        const listed = await gmailJson(ctx, "/messages", { query });

        if (!isRecord(listed) || !Array.isArray(listed.messages)) {
          return cappedJsonResult(listed);
        }

        const summaries = await Promise.all(
          listed.messages.map(async (entry) => {
            if (!isRecord(entry) || typeof entry.id !== "string") {
              return entry;
            }

            const detail = await gmailJson(ctx, `/messages/${encodeURIComponent(entry.id)}`, {
              query: [
                ["format", "metadata"],
                ["metadataHeaders", "From"],
                ["metadataHeaders", "To"],
                ["metadataHeaders", "Subject"],
                ["metadataHeaders", "Date"],
              ],
            });

            return formatMessage(detail);
          }),
        );

        return cappedJsonResult({
          messages: summaries,
          ...(typeof listed.nextPageToken === "string"
            ? { nextPageToken: listed.nextPageToken }
            : {}),
          ...(typeof listed.resultSizeEstimate === "number"
            ? { resultSizeEstimate: listed.resultSizeEstimate }
            : {}),
        });
      },
    },
    {
      name: "get_message",
      description: "Read a full Gmail message by ID, including decoded text body and headers.",
      parameters: {
        type: "object",
        properties: {
          messageId: { type: "string", description: "Gmail message ID." },
        },
        required: ["messageId"],
        additionalProperties: false,
      },
      async execute(params, ctx) {
        if (!(await ctx.hasSecret(SECRET_KEY))) {
          return {
            kind: "text",
            text: `Missing ${SECRET_KEY}. Connect Gmail in Tetherbox Settings -> Integrations.`,
          };
        }

        const messageId = requireString(asObject(params), "messageId");
        const raw = await gmailJson(ctx, `/messages/${encodeURIComponent(messageId)}`, {
          query: [["format", "full"]],
        });

        return cappedJsonResult(formatMessage(raw));
      },
    },
    {
      name: "get_thread",
      description: "Read all messages in a Gmail thread by thread ID.",
      parameters: {
        type: "object",
        properties: {
          threadId: { type: "string", description: "Gmail thread ID." },
        },
        required: ["threadId"],
        additionalProperties: false,
      },
      async execute(params, ctx) {
        if (!(await ctx.hasSecret(SECRET_KEY))) {
          return {
            kind: "text",
            text: `Missing ${SECRET_KEY}. Connect Gmail in Tetherbox Settings -> Integrations.`,
          };
        }

        const threadId = requireString(asObject(params), "threadId");
        const raw = await gmailJson(ctx, `/threads/${encodeURIComponent(threadId)}`, {
          query: [["format", "full"]],
        });

        if (!isRecord(raw) || !Array.isArray(raw.messages)) {
          return cappedJsonResult(raw);
        }

        return cappedJsonResult({
          id: raw.id,
          messages: raw.messages.map((message) => formatMessage(message)),
        });
      },
    },
    {
      name: "list_labels",
      description: "List Gmail labels.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      async execute(_params, ctx) {
        if (!(await ctx.hasSecret(SECRET_KEY))) {
          return {
            kind: "text",
            text: `Missing ${SECRET_KEY}. Connect Gmail in Tetherbox Settings -> Integrations.`,
          };
        }

        return cappedJsonResult(await gmailJson(ctx, "/labels"));
      },
    },
    {
      name: "create_draft",
      description: "Create a Gmail draft message (or reply draft when threadId is provided).",
      parameters: {
        type: "object",
        properties: {
          to: { type: "string", description: "Recipient email address(es)." },
          subject: { type: "string", description: "Email subject." },
          body: { type: "string", description: "Plain-text email body." },
          cc: { type: "string", description: "Optional CC recipients." },
          bcc: { type: "string", description: "Optional BCC recipients." },
          threadId: { type: "string", description: "Optional Gmail thread ID for a reply draft." },
          inReplyTo: {
            type: "string",
            description: "Optional Message-ID header being replied to.",
          },
          references: { type: "string", description: "Optional References header for threading." },
        },
        required: ["to", "subject", "body"],
        additionalProperties: false,
      },
      async execute(params, ctx) {
        if (!(await ctx.hasSecret(SECRET_KEY))) {
          return {
            kind: "text",
            text: `Missing ${SECRET_KEY}. Connect Gmail in Tetherbox Settings -> Integrations.`,
          };
        }

        const obj = asObject(params);
        const threadId = optionalString(obj, "threadId");
        const raw = buildRawEmail({
          to: requireString(obj, "to"),
          subject: requireString(obj, "subject"),
          body: optionalRawString(obj, "body") ?? "",
          cc: optionalString(obj, "cc"),
          bcc: optionalString(obj, "bcc"),
          inReplyTo: optionalString(obj, "inReplyTo"),
          references: optionalString(obj, "references"),
        });

        return cappedJsonResult(
          await gmailJson(ctx, "/drafts", {
            method: "POST",
            body: {
              message: {
                raw,
                ...(threadId !== undefined ? { threadId } : {}),
              },
            },
          }),
        );
      },
    },
    {
      name: "send_draft",
      description: "Send an existing Gmail draft by draft ID.",
      parameters: {
        type: "object",
        properties: {
          draftId: { type: "string", description: "Gmail draft ID." },
        },
        required: ["draftId"],
        additionalProperties: false,
      },
      async execute(params, ctx) {
        if (!(await ctx.hasSecret(SECRET_KEY))) {
          return {
            kind: "text",
            text: `Missing ${SECRET_KEY}. Connect Gmail in Tetherbox Settings -> Integrations.`,
          };
        }

        const draftId = requireString(asObject(params), "draftId");

        return cappedJsonResult(
          await gmailJson(ctx, "/drafts/send", {
            method: "POST",
            body: { id: draftId },
          }),
        );
      },
    },
    {
      name: "send_message",
      description: "Send a Gmail message (or reply to an existing thread).",
      parameters: {
        type: "object",
        properties: {
          to: { type: "string", description: "Recipient email address(es)." },
          subject: { type: "string", description: "Email subject." },
          body: { type: "string", description: "Plain-text email body." },
          cc: { type: "string", description: "Optional CC recipients." },
          bcc: { type: "string", description: "Optional BCC recipients." },
          threadId: { type: "string", description: "Optional Gmail thread ID for replies." },
          inReplyTo: {
            type: "string",
            description: "Optional Message-ID header being replied to.",
          },
          references: { type: "string", description: "Optional References header for threading." },
        },
        required: ["to", "subject", "body"],
        additionalProperties: false,
      },
      async execute(params, ctx) {
        if (!(await ctx.hasSecret(SECRET_KEY))) {
          return {
            kind: "text",
            text: `Missing ${SECRET_KEY}. Connect Gmail in Tetherbox Settings -> Integrations.`,
          };
        }

        const obj = asObject(params);
        const threadId = optionalString(obj, "threadId");
        const raw = buildRawEmail({
          to: requireString(obj, "to"),
          subject: requireString(obj, "subject"),
          body: optionalRawString(obj, "body") ?? "",
          cc: optionalString(obj, "cc"),
          bcc: optionalString(obj, "bcc"),
          inReplyTo: optionalString(obj, "inReplyTo"),
          references: optionalString(obj, "references"),
        });

        return cappedJsonResult(
          await gmailJson(ctx, "/messages/send", {
            method: "POST",
            body: {
              raw,
              ...(threadId !== undefined ? { threadId } : {}),
            },
          }),
        );
      },
    },
    {
      name: "modify_message",
      description: "Add or remove labels on a Gmail message, archive it, or mark it read/unread.",
      parameters: {
        type: "object",
        properties: {
          messageId: { type: "string", description: "Gmail message ID." },
          addLabelIds: {
            type: "array",
            items: { type: "string" },
            description: "Label IDs to add.",
          },
          removeLabelIds: {
            type: "array",
            items: { type: "string" },
            description: "Label IDs to remove.",
          },
          archive: { type: "boolean", description: "Remove the INBOX label." },
          markRead: { type: "boolean", description: "Remove the UNREAD label." },
          markUnread: { type: "boolean", description: "Add the UNREAD label." },
        },
        required: ["messageId"],
        additionalProperties: false,
      },
      async execute(params, ctx) {
        if (!(await ctx.hasSecret(SECRET_KEY))) {
          return {
            kind: "text",
            text: `Missing ${SECRET_KEY}. Connect Gmail in Tetherbox Settings -> Integrations.`,
          };
        }

        const obj = asObject(params);
        const messageId = requireString(obj, "messageId");
        const add = new Set(optionalStringArray(obj, "addLabelIds") ?? []);
        const remove = new Set(optionalStringArray(obj, "removeLabelIds") ?? []);

        if (optionalBoolean(obj, "archive")) {
          remove.add("INBOX");
        }

        if (optionalBoolean(obj, "markRead")) {
          remove.add("UNREAD");
        }

        if (optionalBoolean(obj, "markUnread")) {
          add.add("UNREAD");
        }

        return cappedJsonResult(
          await gmailJson(ctx, `/messages/${encodeURIComponent(messageId)}/modify`, {
            method: "POST",
            body: {
              addLabelIds: [...add],
              removeLabelIds: [...remove],
            },
          }),
        );
      },
    },
    {
      name: "trash_message",
      description: "Move a Gmail message to Trash.",
      parameters: {
        type: "object",
        properties: {
          messageId: { type: "string", description: "Gmail message ID." },
        },
        required: ["messageId"],
        additionalProperties: false,
      },
      async execute(params, ctx) {
        if (!(await ctx.hasSecret(SECRET_KEY))) {
          return {
            kind: "text",
            text: `Missing ${SECRET_KEY}. Connect Gmail in Tetherbox Settings -> Integrations.`,
          };
        }

        const messageId = requireString(asObject(params), "messageId");

        return cappedJsonResult(
          await gmailJson(ctx, `/messages/${encodeURIComponent(messageId)}/trash`, {
            method: "POST",
          }),
        );
      },
    },
  ],
} satisfies TetherboxModule;
