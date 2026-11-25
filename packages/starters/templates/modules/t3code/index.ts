import type { ModuleContext, ModuleToolResult, TetherboxModule } from "@tetherbox/core";

const SECRET_KEY = "T3CODE_TOKEN";
const MCP_PROTOCOL_VERSION = "2025-03-26";
const MAX_RESULT_CHARS = 32 * 1024;
const MAX_ERROR_CHARS = 2000;

interface McpSessionState {
  endpointUrl: string;
  sessionId: string | undefined;
}

let cachedSession: McpSessionState | undefined;
let nextRpcId = 1;

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

function optionalRecord(
  obj: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const value = obj[key];

  if (value === undefined) {
    return undefined;
  }

  if (!isRecord(value)) {
    throw new Error(`Expected object for "${key}"`);
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

function parseSseMessages(body: string): unknown[] {
  const messages: unknown[] = [];
  const blocks = body.split(/\r?\n\r?\n/);

  for (const block of blocks) {
    const dataLines = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim());

    if (dataLines.length === 0) {
      continue;
    }

    const payload = dataLines.join("\n");

    if (payload === "" || payload === "[DONE]") {
      continue;
    }

    try {
      messages.push(JSON.parse(payload));
    } catch {
      // Ignore non-JSON SSE control frames.
    }
  }

  return messages;
}

function extractRpcResponse(
  contentType: string,
  rawBody: string,
  expectedId: number,
): Record<string, unknown> {
  const lower = contentType.toLowerCase();

  if (lower.includes("text/event-stream")) {
    const messages = parseSseMessages(rawBody);
    const matching = messages.find((msg) => isRecord(msg) && msg.id === expectedId);

    if (isRecord(matching)) {
      return matching;
    }

    throw new Error(
      `T3 Code MCP stream contained no JSON-RPC response for id ${expectedId}: ${rawBody.slice(0, 500)}`,
    );
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw new Error(`T3 Code MCP returned non-JSON body: ${rawBody.slice(0, MAX_ERROR_CHARS)}`);
  }

  if (!isRecord(parsed)) {
    throw new Error("T3 Code MCP returned an unexpected JSON-RPC payload");
  }

  return parsed;
}

async function sendMcpMessage(
  ctx: ModuleContext,
  endpointUrl: string,
  body: Record<string, unknown>,
  sessionId?: string,
): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };

  if (sessionId !== undefined) {
    headers["Mcp-Session-Id"] = sessionId;
  }

  return ctx.fetchWithSecret(SECRET_KEY, endpointUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

async function ensureMcpSession(ctx: ModuleContext, endpointUrl: string): Promise<McpSessionState> {
  if (cachedSession !== undefined && cachedSession.endpointUrl === endpointUrl) {
    return cachedSession;
  }

  const initId = nextRpcId++;
  const initResponse = await sendMcpMessage(ctx, endpointUrl, {
    jsonrpc: "2.0",
    id: initId,
    method: "initialize",
    params: {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "tetherbox", version: "1.0.0" },
    },
  });
  const initBody = await initResponse.text();

  if (!initResponse.ok) {
    throw new Error(
      `T3 Code MCP initialize failed (${initResponse.status}): ${initBody.slice(0, MAX_ERROR_CHARS)}`,
    );
  }

  const rpc = extractRpcResponse(initResponse.headers.get("content-type") ?? "", initBody, initId);

  if (rpc.error !== undefined) {
    throw new Error(`T3 Code MCP initialize error: ${JSON.stringify(rpc.error)}`);
  }

  const sessionId = initResponse.headers.get("mcp-session-id") ?? undefined;
  const state: McpSessionState = { endpointUrl, sessionId };
  const initializedResponse = await sendMcpMessage(
    ctx,
    endpointUrl,
    { jsonrpc: "2.0", method: "notifications/initialized" },
    sessionId,
  );

  await initializedResponse.body?.cancel();
  cachedSession = state;

  return state;
}

async function mcpRequest(
  ctx: ModuleContext,
  method: string,
  params?: Record<string, unknown>,
): Promise<ModuleToolResult> {
  const endpointUrl = ctx.config.endpointUrl?.trim();

  if (endpointUrl === undefined || endpointUrl === "") {
    return {
      kind: "text",
      text: "Missing starterConfig.t3code.endpointUrl in profile.json. Set it to your https://<environment-host>/mcp URL.",
    };
  }

  if (!(await ctx.hasSecret(SECRET_KEY))) {
    const host = URL.parse(endpointUrl)?.hostname ?? "<environment-host>";

    return {
      kind: "text",
      text: `Missing ${SECRET_KEY}. Run: tetherbox secrets set ${SECRET_KEY} --domain ${host}`,
    };
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const session = await ensureMcpSession(ctx, endpointUrl);
    const id = nextRpcId++;
    const response = await sendMcpMessage(
      ctx,
      endpointUrl,
      {
        jsonrpc: "2.0",
        id,
        method,
        ...(params !== undefined ? { params } : {}),
      },
      session.sessionId,
    );

    if ((response.status === 400 || response.status === 404) && attempt === 0) {
      await response.body?.cancel();
      cachedSession = undefined;
      continue;
    }

    const rawBody = await response.text();

    if (!response.ok) {
      throw new Error(
        `T3 Code MCP ${method} failed (${response.status}): ${rawBody.slice(0, MAX_ERROR_CHARS)}`,
      );
    }

    const rpc = extractRpcResponse(response.headers.get("content-type") ?? "", rawBody, id);

    if (rpc.error !== undefined) {
      throw new Error(`T3 Code MCP ${method} error: ${JSON.stringify(rpc.error)}`);
    }

    return cappedJsonResult(rpc.result);
  }

  throw new Error(`T3 Code MCP ${method} failed after session re-initialization`);
}

export default {
  name: "t3code",
  description: "Discover and invoke T3 Code MCP tools through a remote /mcp endpoint.",
  requiredSecrets: [SECRET_KEY],
  tools: [
    {
      name: "list_tools",
      description: "List tools exposed by the configured T3 Code /mcp server.",
      parameters: {
        type: "object",
        properties: {
          cursor: { type: "string", description: "Optional pagination cursor." },
        },
        additionalProperties: false,
      },
      async execute(params, ctx) {
        const cursor = optionalString(asObject(params), "cursor");

        return mcpRequest(ctx, "tools/list", cursor !== undefined ? { cursor } : undefined);
      },
    },
    {
      name: "call_tool",
      description:
        "Invoke a tool exposed by the configured T3 Code /mcp server. Call t3code_list_tools first to inspect tool names and argument schemas.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Exact MCP tool name from t3code_list_tools." },
          arguments: {
            type: "object",
            description: "Arguments object matching the MCP tool's inputSchema.",
            additionalProperties: true,
          },
        },
        required: ["name"],
        additionalProperties: false,
      },
      async execute(params, ctx) {
        const obj = asObject(params);
        const name = requireString(obj, "name");
        const args = optionalRecord(obj, "arguments") ?? {};

        return mcpRequest(ctx, "tools/call", { name, arguments: args });
      },
    },
  ],
} satisfies TetherboxModule;
