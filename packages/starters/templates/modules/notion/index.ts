import type { ModuleContext, ModuleToolResult, TetherboxModule } from "@tetherbox/core";

const SECRET_KEY = "NOTION_API_KEY";
const API_BASE = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";
const MAX_RESULT_CHARS = 32 * 1024;
const MAX_ERROR_CHARS = 2000;
const MAX_RICH_TEXT_CHUNK = 1900;

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

function optionalArray(obj: Record<string, unknown>, key: string): unknown[] | undefined {
  const value = obj[key];

  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new Error(`Expected array for "${key}"`);
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

function extractRichText(items: unknown): string {
  if (!Array.isArray(items)) {
    return "";
  }

  return items
    .map((item) => (isRecord(item) && typeof item.plain_text === "string" ? item.plain_text : ""))
    .join("");
}

function renderBlock(block: unknown): string | undefined {
  if (!isRecord(block) || typeof block.type !== "string") {
    return undefined;
  }

  const type = block.type;
  const data = block[type];

  if (type === "divider") {
    return "---";
  }

  if (!isRecord(data)) {
    return undefined;
  }

  const text = extractRichText(data.rich_text);

  switch (type) {
    case "heading_1":
      return `# ${text}`;
    case "heading_2":
      return `## ${text}`;
    case "heading_3":
      return `### ${text}`;
    case "bulleted_list_item":
      return `- ${text}`;
    case "numbered_list_item":
      return `1. ${text}`;
    case "to_do":
      return `- [${data.checked === true ? "x" : " "}] ${text}`;
    case "quote":
      return `> ${text}`;
    case "code": {
      const lang = typeof data.language === "string" ? data.language : "";

      return `\`\`\`${lang}\n${text}\n\`\`\``;
    }
    case "child_page":
      return typeof data.title === "string" ? `[Child page: ${data.title}]` : undefined;
    case "child_database":
      return typeof data.title === "string" ? `[Child database: ${data.title}]` : undefined;
    default:
      return text === "" ? undefined : text;
  }
}

function textToParagraphBlocks(content: string): Record<string, unknown>[] {
  const blocks: Record<string, unknown>[] = [];
  const paragraphs = content.split(/\r?\n\r?\n/);

  for (const rawParagraph of paragraphs) {
    const paragraph = rawParagraph.trim();

    if (paragraph === "") {
      continue;
    }

    const richText: Record<string, unknown>[] = [];

    for (let offset = 0; offset < paragraph.length; offset += MAX_RICH_TEXT_CHUNK) {
      richText.push({
        type: "text",
        text: { content: paragraph.slice(offset, offset + MAX_RICH_TEXT_CHUNK) },
      });
    }

    blocks.push({
      object: "block",
      type: "paragraph",
      paragraph: { rich_text: richText },
    });
  }

  return blocks;
}

async function missingSecretResult(ctx: ModuleContext): Promise<ModuleToolResult | undefined> {
  if (await ctx.hasSecret(SECRET_KEY)) {
    return undefined;
  }

  return {
    kind: "text",
    text: `Missing ${SECRET_KEY}. Run: tetherbox secrets set ${SECRET_KEY} --domain api.notion.com`,
  };
}

async function notionFetchJson(
  ctx: ModuleContext,
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<unknown> {
  const headers: Record<string, string> = {
    "Notion-Version": NOTION_VERSION,
    Accept: "application/json",
  };
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
    throw new Error(`Notion API returned ${response.status}: ${raw.slice(0, MAX_ERROR_CHARS)}`);
  }

  return JSON.parse(raw);
}

export default {
  name: "notion",
  description: "Read and update Notion pages, blocks, and databases.",
  requiredSecrets: [SECRET_KEY],
  tools: [
    {
      name: "search",
      description: "Search Notion pages and databases accessible to the integration.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Text to match against titles." },
          objectType: {
            type: "string",
            enum: ["page", "database"],
            description: "Optional filter to restrict results to pages or databases.",
          },
          pageSize: { type: "number", description: "Max results to return (1-100)." },
          startCursor: { type: "string", description: "Pagination cursor from a previous search." },
        },
        additionalProperties: false,
      },
      async execute(params, ctx) {
        const missing = await missingSecretResult(ctx);

        if (missing !== undefined) {
          return missing;
        }

        const obj = asObject(params);
        const body: Record<string, unknown> = {};
        const query = optionalString(obj, "query");
        const objectType = optionalString(obj, "objectType");
        const pageSize = optionalNumber(obj, "pageSize");
        const startCursor = optionalString(obj, "startCursor");

        if (query !== undefined) {
          body.query = query;
        }

        if (objectType !== undefined) {
          if (objectType !== "page" && objectType !== "database") {
            throw new Error('Expected "objectType" to be "page" or "database"');
          }

          body.filter = { property: "object", value: objectType };
        }

        if (pageSize !== undefined) {
          body.page_size = Math.min(100, Math.max(1, Math.trunc(pageSize)));
        }

        if (startCursor !== undefined) {
          body.start_cursor = startCursor;
        }

        const data = await notionFetchJson(ctx, "/search", { method: "POST", body });

        return cappedJsonResult(data);
      },
    },
    {
      name: "get_page",
      description: "Fetch a Notion page's metadata and unwrapped top-level block text.",
      parameters: {
        type: "object",
        properties: {
          pageId: { type: "string", description: "Notion page ID." },
          includeBlocks: {
            type: "boolean",
            description: "Include rendered top-level block content (default true).",
          },
          startCursor: {
            type: "string",
            description: "Optional pagination cursor for block children.",
          },
        },
        required: ["pageId"],
        additionalProperties: false,
      },
      async execute(params, ctx) {
        const missing = await missingSecretResult(ctx);

        if (missing !== undefined) {
          return missing;
        }

        const obj = asObject(params);
        const pageId = requireString(obj, "pageId");
        const includeBlocks = optionalBoolean(obj, "includeBlocks") ?? true;
        const startCursor = optionalString(obj, "startCursor");
        const page = await notionFetchJson(ctx, `/pages/${encodeURIComponent(pageId)}`);

        if (!includeBlocks) {
          return cappedJsonResult({ page });
        }

        const query = new URLSearchParams({ page_size: "100" });

        if (startCursor !== undefined) {
          query.set("start_cursor", startCursor);
        }

        const blocksResponse = await notionFetchJson(
          ctx,
          `/blocks/${encodeURIComponent(pageId)}/children?${query.toString()}`,
        );
        const results =
          isRecord(blocksResponse) && Array.isArray(blocksResponse.results)
            ? blocksResponse.results
            : [];
        const content = results
          .map(renderBlock)
          .filter((line): line is string => line !== undefined)
          .join("\n\n");

        return cappedJsonResult({
          page,
          content,
          hasMoreBlocks: isRecord(blocksResponse) ? blocksResponse.has_more === true : false,
          nextCursor:
            isRecord(blocksResponse) && typeof blocksResponse.next_cursor === "string"
              ? blocksResponse.next_cursor
              : null,
        });
      },
    },
    {
      name: "create_page",
      description:
        "Create a Notion page under a parent page or database, with optional plain-text content or raw Notion blocks.",
      parameters: {
        type: "object",
        properties: {
          parentType: {
            type: "string",
            enum: ["page_id", "database_id"],
            description: "Whether parentId is a page_id or database_id.",
          },
          parentId: { type: "string", description: "Parent page or database ID." },
          title: {
            type: "string",
            description:
              "Page title (used for the default title property if properties is omitted).",
          },
          properties: {
            type: "object",
            description: "Raw Notion properties object (for database rows or custom titles).",
            additionalProperties: true,
          },
          content: {
            type: "string",
            description: "Plain text body split on blank lines into paragraph blocks.",
          },
          children: {
            type: "array",
            items: { type: "object", additionalProperties: true },
            description: "Raw Notion block objects (takes precedence over content).",
          },
        },
        required: ["parentType", "parentId"],
        additionalProperties: false,
      },
      async execute(params, ctx) {
        const missing = await missingSecretResult(ctx);

        if (missing !== undefined) {
          return missing;
        }

        const obj = asObject(params);
        const parentType = requireString(obj, "parentType");

        if (parentType !== "page_id" && parentType !== "database_id") {
          throw new Error('Expected "parentType" to be "page_id" or "database_id"');
        }

        const parentId = requireString(obj, "parentId");
        const title = optionalString(obj, "title");
        const properties = optionalRecord(obj, "properties");
        const content = optionalString(obj, "content");
        const children = optionalArray(obj, "children");

        const body: Record<string, unknown> = {
          parent: { [parentType]: parentId },
          properties:
            properties ??
            (title !== undefined
              ? {
                  title: {
                    title: [{ type: "text", text: { content: title } }],
                  },
                }
              : {}),
        };

        if (children !== undefined) {
          body.children = children;
        } else if (content !== undefined) {
          body.children = textToParagraphBlocks(content);
        }

        const data = await notionFetchJson(ctx, "/pages", { method: "POST", body });

        return cappedJsonResult(data);
      },
    },
    {
      name: "append_blocks",
      description: "Append plain-text paragraphs or raw Notion blocks to a page or block.",
      parameters: {
        type: "object",
        properties: {
          blockId: { type: "string", description: "Target Notion page or block ID." },
          content: {
            type: "string",
            description: "Plain text split on blank lines into paragraph blocks.",
          },
          children: {
            type: "array",
            items: { type: "object", additionalProperties: true },
            description: "Raw Notion block objects (takes precedence over content).",
          },
        },
        required: ["blockId"],
        additionalProperties: false,
      },
      async execute(params, ctx) {
        const missing = await missingSecretResult(ctx);

        if (missing !== undefined) {
          return missing;
        }

        const obj = asObject(params);
        const blockId = requireString(obj, "blockId");
        const content = optionalString(obj, "content");
        const children = optionalArray(obj, "children");
        const blocks = children ?? (content !== undefined ? textToParagraphBlocks(content) : []);

        if (blocks.length === 0) {
          throw new Error('Provide either non-empty "content" or "children"');
        }

        const data = await notionFetchJson(ctx, `/blocks/${encodeURIComponent(blockId)}/children`, {
          method: "PATCH",
          body: { children: blocks },
        });

        return cappedJsonResult(data);
      },
    },
    {
      name: "query_database",
      description: "Query rows from a Notion database with optional filter and sorts.",
      parameters: {
        type: "object",
        properties: {
          databaseId: { type: "string", description: "Notion database ID." },
          filter: {
            type: "object",
            description: "Optional Notion database filter object.",
            additionalProperties: true,
          },
          sorts: {
            type: "array",
            items: { type: "object", additionalProperties: true },
            description: "Optional Notion sort objects.",
          },
          pageSize: { type: "number", description: "Max rows to return (1-100)." },
          startCursor: { type: "string", description: "Pagination cursor from a previous query." },
        },
        required: ["databaseId"],
        additionalProperties: false,
      },
      async execute(params, ctx) {
        const missing = await missingSecretResult(ctx);

        if (missing !== undefined) {
          return missing;
        }

        const obj = asObject(params);
        const databaseId = requireString(obj, "databaseId");
        const filter = optionalRecord(obj, "filter");
        const sorts = optionalArray(obj, "sorts");
        const pageSize = optionalNumber(obj, "pageSize");
        const startCursor = optionalString(obj, "startCursor");
        const body: Record<string, unknown> = {};

        if (filter !== undefined) {
          body.filter = filter;
        }

        if (sorts !== undefined) {
          body.sorts = sorts;
        }

        if (pageSize !== undefined) {
          body.page_size = Math.min(100, Math.max(1, Math.trunc(pageSize)));
        }

        if (startCursor !== undefined) {
          body.start_cursor = startCursor;
        }

        const data = await notionFetchJson(
          ctx,
          `/databases/${encodeURIComponent(databaseId)}/query`,
          { method: "POST", body },
        );

        return cappedJsonResult(data);
      },
    },
  ],
} satisfies TetherboxModule;
