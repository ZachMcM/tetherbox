import type { ModuleContext, ModuleToolResult, TetherboxModule } from "@tetherbox/core";

const SECRET_KEY = "GOOGLE_DRIVE_OAUTH";
const BASE_URL = "https://www.googleapis.com/drive/v3";
const UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3";
const MAX_RESULT_CHARS = 32 * 1024;
const MAX_ERROR_CHARS = 2000;
const FILE_FIELDS =
  "id,name,mimeType,size,modifiedTime,createdTime,webViewLink,parents,trashed,description,owners(displayName,emailAddress)";

const WORKSPACE_EXPORTS: Readonly<Record<string, string>> = {
  "application/vnd.google-apps.document": "text/markdown",
  "application/vnd.google-apps.spreadsheet": "text/csv",
  "application/vnd.google-apps.presentation": "text/plain",
};

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

function checkDriveError(status: number, raw: string): never {
  if (
    status === 403 &&
    (raw.includes("insufficientPermissions") || raw.includes("ACCESS_TOKEN_SCOPE_INSUFFICIENT"))
  ) {
    throw new Error(
      "Google Drive returned 403 (insufficient OAuth scope). Re-run: tetherbox oauth login gdrive --scope=read-write",
    );
  }

  throw new Error(`Google Drive API returned ${status}: ${raw.slice(0, MAX_ERROR_CHARS)}`);
}

async function driveJson(ctx: ModuleContext, url: URL, init: RequestInit = {}): Promise<unknown> {
  const response = await ctx.fetchWithSecret(SECRET_KEY, url, init);

  if (response.status === 204) {
    return { ok: true };
  }

  const raw = await response.text();

  if (!response.ok) {
    checkDriveError(response.status, raw);
  }

  return raw.trim() === "" ? { ok: true } : JSON.parse(raw);
}

function buildMultipartBody(
  metadata: Record<string, unknown>,
  content: string,
  contentMimeType: string,
): { body: string; contentType: string } {
  const boundary = `tetherbox_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const body = [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(metadata),
    `--${boundary}`,
    `Content-Type: ${contentMimeType}`,
    "",
    content,
    `--${boundary}--`,
  ].join("\r\n");

  return { body, contentType: `multipart/related; boundary=${boundary}` };
}

export default {
  name: "gdrive",
  description: "Search, read, export, and manage Google Drive files, Docs, and Sheets.",
  requiredSecrets: [SECRET_KEY],
  tools: [
    {
      name: "list_files",
      description: "List or search Google Drive files and folders.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              'Google Drive query string (for example `name contains "Roadmap"` or `fullText contains "Q3"`).',
          },
          folderId: {
            type: "string",
            description: "Limit results to files inside this folder ID.",
          },
          pageSize: {
            type: "number",
            description: "Maximum files to return (default 25, max 100).",
          },
          pageToken: { type: "string", description: "Pagination token from nextPageToken." },
          orderBy: {
            type: "string",
            description: 'Sort order (default "modifiedTime desc").',
          },
          includeTrashed: {
            type: "boolean",
            description: "Include trashed files (default false).",
          },
        },
        additionalProperties: false,
      },
      async execute(params, ctx) {
        if (!(await ctx.hasSecret(SECRET_KEY))) {
          return { kind: "text", text: `Missing ${SECRET_KEY}. Run: tetherbox oauth login gdrive` };
        }

        const obj = asObject(params);
        const clauses: string[] = [];
        const query = optionalString(obj, "query");
        const folderId = optionalString(obj, "folderId");
        const includeTrashed = optionalBoolean(obj, "includeTrashed") ?? false;

        if (!includeTrashed) {
          clauses.push("trashed = false");
        }

        if (folderId !== undefined) {
          clauses.push(`'${folderId.replaceAll("'", "\\'")}' in parents`);
        }

        if (query !== undefined) {
          clauses.push(`(${query})`);
        }

        const pageSize = Math.min(
          100,
          Math.max(1, Math.trunc(optionalNumber(obj, "pageSize") ?? 25)),
        );
        const url = new URL(`${BASE_URL}/files`);

        url.searchParams.set("fields", `nextPageToken,files(${FILE_FIELDS})`);
        url.searchParams.set("pageSize", String(pageSize));
        url.searchParams.set("orderBy", optionalString(obj, "orderBy") ?? "modifiedTime desc");
        url.searchParams.set("supportsAllDrives", "true");
        url.searchParams.set("includeItemsFromAllDrives", "true");

        if (clauses.length > 0) {
          url.searchParams.set("q", clauses.join(" and "));
        }

        const pageToken = optionalString(obj, "pageToken");

        if (pageToken !== undefined) {
          url.searchParams.set("pageToken", pageToken);
        }

        return cappedJsonResult(
          await driveJson(ctx, url, { headers: { Accept: "application/json" } }),
        );
      },
    },
    {
      name: "get_file",
      description: "Get metadata for a Google Drive file or folder by ID.",
      parameters: {
        type: "object",
        properties: {
          fileId: { type: "string", description: "Google Drive file ID." },
        },
        required: ["fileId"],
        additionalProperties: false,
      },
      async execute(params, ctx) {
        if (!(await ctx.hasSecret(SECRET_KEY))) {
          return { kind: "text", text: `Missing ${SECRET_KEY}. Run: tetherbox oauth login gdrive` };
        }

        const fileId = requireString(asObject(params), "fileId");
        const url = new URL(`${BASE_URL}/files/${encodeURIComponent(fileId)}`);

        url.searchParams.set("fields", FILE_FIELDS);
        url.searchParams.set("supportsAllDrives", "true");

        return cappedJsonResult(
          await driveJson(ctx, url, { headers: { Accept: "application/json" } }),
        );
      },
    },
    {
      name: "read_file",
      description:
        "Read a Google Doc (as Markdown), Google Sheet (as CSV), Google Slides (as plain text), or a text-based Drive file.",
      parameters: {
        type: "object",
        properties: {
          fileId: { type: "string", description: "Google Drive file ID." },
          exportMimeType: {
            type: "string",
            description:
              "Optional export MIME type override for Google Workspace files (for example text/plain or text/csv).",
          },
        },
        required: ["fileId"],
        additionalProperties: false,
      },
      async execute(params, ctx) {
        if (!(await ctx.hasSecret(SECRET_KEY))) {
          return { kind: "text", text: `Missing ${SECRET_KEY}. Run: tetherbox oauth login gdrive` };
        }

        const obj = asObject(params);
        const fileId = requireString(obj, "fileId");
        const metaUrl = new URL(`${BASE_URL}/files/${encodeURIComponent(fileId)}`);

        metaUrl.searchParams.set("fields", "id,name,mimeType");
        metaUrl.searchParams.set("supportsAllDrives", "true");

        const meta = await driveJson(ctx, metaUrl, { headers: { Accept: "application/json" } });
        const mimeType = isRecord(meta) && typeof meta.mimeType === "string" ? meta.mimeType : "";
        const exportMime = optionalString(obj, "exportMimeType") ?? WORKSPACE_EXPORTS[mimeType];
        const contentUrl =
          exportMime !== undefined
            ? new URL(`${BASE_URL}/files/${encodeURIComponent(fileId)}/export`)
            : new URL(`${BASE_URL}/files/${encodeURIComponent(fileId)}`);

        if (exportMime !== undefined) {
          contentUrl.searchParams.set("mimeType", exportMime);
        } else {
          contentUrl.searchParams.set("alt", "media");
          contentUrl.searchParams.set("supportsAllDrives", "true");
        }

        const response = await ctx.fetchWithSecret(SECRET_KEY, contentUrl);
        const body = await response.text();

        if (!response.ok) {
          checkDriveError(response.status, body);
        }

        const truncated = body.length > MAX_RESULT_CHARS;

        return {
          kind: "text",
          text: truncated ? `${body.slice(0, MAX_RESULT_CHARS)}\n\n[truncated]` : body,
        };
      },
    },
    {
      name: "create_file",
      description: "Create a Google Drive folder or upload a text-based file (or Google Doc).",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "File or folder name." },
          mimeType: {
            type: "string",
            description:
              'Target Drive MIME type (defaults to "text/plain"; use "application/vnd.google-apps.folder" for a folder or "application/vnd.google-apps.document" for a Google Doc).',
          },
          content: { type: "string", description: "File text content (omit for folders)." },
          contentMimeType: {
            type: "string",
            description:
              'MIME type of the uploaded content (defaults to "text/plain; charset=UTF-8").',
          },
          parentIds: {
            type: "array",
            items: { type: "string" },
            description: "Optional parent folder IDs.",
          },
          description: { type: "string", description: "Optional file description." },
        },
        required: ["name"],
        additionalProperties: false,
      },
      async execute(params, ctx) {
        if (!(await ctx.hasSecret(SECRET_KEY))) {
          return { kind: "text", text: `Missing ${SECRET_KEY}. Run: tetherbox oauth login gdrive` };
        }

        const obj = asObject(params);
        const name = requireString(obj, "name");
        const mimeType = optionalString(obj, "mimeType") ?? "text/plain";
        const content = optionalRawString(obj, "content");
        const parentIds = optionalStringArray(obj, "parentIds");
        const description = optionalString(obj, "description");
        const metadata: Record<string, unknown> = { name, mimeType };

        if (parentIds !== undefined) {
          metadata.parents = parentIds;
        }

        if (description !== undefined) {
          metadata.description = description;
        }

        if (content === undefined) {
          const url = new URL(`${BASE_URL}/files`);

          url.searchParams.set("fields", FILE_FIELDS);
          url.searchParams.set("supportsAllDrives", "true");

          return cappedJsonResult(
            await driveJson(ctx, url, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
              },
              body: JSON.stringify(metadata),
            }),
          );
        }

        const url = new URL(`${UPLOAD_URL}/files`);

        url.searchParams.set("uploadType", "multipart");
        url.searchParams.set("fields", FILE_FIELDS);
        url.searchParams.set("supportsAllDrives", "true");

        const multipart = buildMultipartBody(
          metadata,
          content,
          optionalString(obj, "contentMimeType") ?? "text/plain; charset=UTF-8",
        );

        return cappedJsonResult(
          await driveJson(ctx, url, {
            method: "POST",
            headers: {
              "Content-Type": multipart.contentType,
              Accept: "application/json",
            },
            body: multipart.body,
          }),
        );
      },
    },
    {
      name: "update_file",
      description:
        "Update metadata (name, description, parents, trashed) and/or replace content of a Drive file.",
      parameters: {
        type: "object",
        properties: {
          fileId: { type: "string", description: "Google Drive file ID." },
          name: { type: "string", description: "New file name." },
          description: { type: "string", description: "New file description." },
          trashed: { type: "boolean", description: "Move to or restore from trash." },
          addParents: {
            type: "array",
            items: { type: "string" },
            description: "Parent folder IDs to add.",
          },
          removeParents: {
            type: "array",
            items: { type: "string" },
            description: "Parent folder IDs to remove.",
          },
          content: { type: "string", description: "Replacement text content." },
          contentMimeType: {
            type: "string",
            description:
              'MIME type of replacement content (defaults to "text/plain; charset=UTF-8").',
          },
        },
        required: ["fileId"],
        additionalProperties: false,
      },
      async execute(params, ctx) {
        if (!(await ctx.hasSecret(SECRET_KEY))) {
          return { kind: "text", text: `Missing ${SECRET_KEY}. Run: tetherbox oauth login gdrive` };
        }

        const obj = asObject(params);
        const fileId = requireString(obj, "fileId");
        const metadata: Record<string, unknown> = {};
        const name = optionalString(obj, "name");
        const description = optionalString(obj, "description");
        const trashed = optionalBoolean(obj, "trashed");
        const addParents = optionalStringArray(obj, "addParents");
        const removeParents = optionalStringArray(obj, "removeParents");
        const content = optionalRawString(obj, "content");

        if (name !== undefined) {
          metadata.name = name;
        }

        if (description !== undefined) {
          metadata.description = description;
        }

        if (trashed !== undefined) {
          metadata.trashed = trashed;
        }

        const base = content === undefined ? BASE_URL : UPLOAD_URL;
        const url = new URL(`${base}/files/${encodeURIComponent(fileId)}`);

        url.searchParams.set("fields", FILE_FIELDS);
        url.searchParams.set("supportsAllDrives", "true");

        if (addParents !== undefined && addParents.length > 0) {
          url.searchParams.set("addParents", addParents.join(","));
        }

        if (removeParents !== undefined && removeParents.length > 0) {
          url.searchParams.set("removeParents", removeParents.join(","));
        }

        if (content === undefined) {
          return cappedJsonResult(
            await driveJson(ctx, url, {
              method: "PATCH",
              headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
              },
              body: JSON.stringify(metadata),
            }),
          );
        }

        url.searchParams.set("uploadType", "multipart");

        const multipart = buildMultipartBody(
          metadata,
          content,
          optionalString(obj, "contentMimeType") ?? "text/plain; charset=UTF-8",
        );

        return cappedJsonResult(
          await driveJson(ctx, url, {
            method: "PATCH",
            headers: {
              "Content-Type": multipart.contentType,
              Accept: "application/json",
            },
            body: multipart.body,
          }),
        );
      },
    },
    {
      name: "delete_file",
      description: "Move a Google Drive file to trash (default) or permanently delete it.",
      parameters: {
        type: "object",
        properties: {
          fileId: { type: "string", description: "Google Drive file ID." },
          permanent: {
            type: "boolean",
            description:
              "Set true to permanently delete instead of moving to trash (default false).",
          },
        },
        required: ["fileId"],
        additionalProperties: false,
      },
      async execute(params, ctx) {
        if (!(await ctx.hasSecret(SECRET_KEY))) {
          return { kind: "text", text: `Missing ${SECRET_KEY}. Run: tetherbox oauth login gdrive` };
        }

        const obj = asObject(params);
        const fileId = requireString(obj, "fileId");
        const permanent = optionalBoolean(obj, "permanent") ?? false;
        const url = new URL(`${BASE_URL}/files/${encodeURIComponent(fileId)}`);

        url.searchParams.set("supportsAllDrives", "true");

        if (permanent) {
          return cappedJsonResult(await driveJson(ctx, url, { method: "DELETE" }));
        }

        url.searchParams.set("fields", FILE_FIELDS);

        return cappedJsonResult(
          await driveJson(ctx, url, {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({ trashed: true }),
          }),
        );
      },
    },
  ],
} satisfies TetherboxModule;
