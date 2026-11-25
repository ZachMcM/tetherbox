import type { ModuleContext, ModuleToolResult, TetherboxModule } from "@tetherbox/core";

const SECRET_KEY = "SENTRY_AUTH_TOKEN";
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

function normalizeBaseUrl(raw: string | undefined): string {
  const trimmed = raw?.trim();

  return (trimmed || "https://sentry.io").replace(/\/+$/, "");
}

async function sentryRequest(
  ctx: ModuleContext,
  path: string,
  init: { method?: string; body?: Record<string, unknown> } = {},
): Promise<ModuleToolResult> {
  const baseUrl = normalizeBaseUrl(ctx.config.apiBaseUrl);

  if (!(await ctx.hasSecret(SECRET_KEY))) {
    const host = URL.parse(baseUrl)?.hostname ?? "sentry.io";

    return {
      kind: "text",
      text: `Missing ${SECRET_KEY}. Run: tetherbox secrets set ${SECRET_KEY} --domain ${host}`,
    };
  }

  const response = await ctx.fetchWithSecret(SECRET_KEY, `${baseUrl}/api/0${path}`, {
    method: init.method ?? "GET",
    ...(init.body !== undefined
      ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(init.body),
        }
      : {}),
  });
  const rawBody = await response.text();

  if (!response.ok) {
    throw new Error(
      `Sentry API ${path} failed (${response.status}): ${rawBody.slice(0, MAX_ERROR_CHARS)}`,
    );
  }

  if (rawBody.trim() === "") {
    return { kind: "json", value: null };
  }

  return cappedJsonResult(JSON.parse(rawBody));
}

function resolveOrgSlug(ctx: ModuleContext, obj: Record<string, unknown>): string {
  const fromParams = optionalString(obj, "orgSlug");
  const fromConfig = ctx.config.orgSlug?.trim();
  const orgSlug = fromParams ?? (fromConfig || undefined);

  if (orgSlug === undefined) {
    throw new Error(
      'Missing Sentry organization slug. Pass "orgSlug" or set starterConfig.sentry.orgSlug in profile.json.',
    );
  }

  return orgSlug;
}

export default {
  name: "sentry",
  description: "Inspect and update Sentry issues and error events.",
  requiredSecrets: [SECRET_KEY],
  tools: [
    {
      name: "list_issues",
      description:
        "List Sentry issues for an organization, optionally filtered by project or query.",
      parameters: {
        type: "object",
        properties: {
          orgSlug: { type: "string", description: "Optional Sentry org slug override." },
          project: { type: "string", description: "Optional project slug or numeric ID." },
          query: {
            type: "string",
            description: 'Sentry search query, e.g. "is:unresolved level:error".',
          },
          limit: { type: "integer", description: "Maximum number of issues to return (1-100)." },
        },
        additionalProperties: false,
      },
      async execute(params, ctx) {
        const obj = asObject(params);
        const orgSlug = resolveOrgSlug(ctx, obj);
        const project = optionalString(obj, "project");
        const query = optionalString(obj, "query");
        const limit = optionalNumber(obj, "limit");
        const search = new URLSearchParams();

        if (query !== undefined) {
          search.set("query", query);
        }

        if (limit !== undefined) {
          search.set("limit", String(Math.min(Math.max(Math.trunc(limit), 1), 100)));
        }

        const qs = search.toString();
        const suffix = qs !== "" ? `?${qs}` : "";
        const path =
          project !== undefined
            ? `/projects/${encodeURIComponent(orgSlug)}/${encodeURIComponent(project)}/issues/${suffix}`
            : `/organizations/${encodeURIComponent(orgSlug)}/issues/${suffix}`;

        return sentryRequest(ctx, path);
      },
    },
    {
      name: "get_issue",
      description: "Fetch metadata and counts for a single Sentry issue by ID.",
      parameters: {
        type: "object",
        properties: {
          issueId: { type: "string", description: "Numeric Sentry issue ID." },
        },
        required: ["issueId"],
        additionalProperties: false,
      },
      async execute(params, ctx) {
        const issueId = requireString(asObject(params), "issueId");

        return sentryRequest(ctx, `/issues/${encodeURIComponent(issueId)}/`);
      },
    },
    {
      name: "get_latest_event",
      description:
        "Fetch the latest event for a Sentry issue, including stack trace, tags, and breadcrumbs.",
      parameters: {
        type: "object",
        properties: {
          issueId: { type: "string", description: "Numeric Sentry issue ID." },
        },
        required: ["issueId"],
        additionalProperties: false,
      },
      async execute(params, ctx) {
        const issueId = requireString(asObject(params), "issueId");

        return sentryRequest(ctx, `/issues/${encodeURIComponent(issueId)}/events/latest/`);
      },
    },
    {
      name: "update_issue",
      description: "Update a Sentry issue's status (resolved, unresolved, ignored) or assignee.",
      parameters: {
        type: "object",
        properties: {
          issueId: { type: "string", description: "Numeric Sentry issue ID." },
          status: {
            type: "string",
            enum: ["resolved", "unresolved", "ignored"],
            description: "New issue status.",
          },
          assignedTo: {
            type: "string",
            description: 'Assignee email, username, or team slug (e.g. "team:backend").',
          },
        },
        required: ["issueId"],
        additionalProperties: false,
      },
      async execute(params, ctx) {
        const obj = asObject(params);
        const issueId = requireString(obj, "issueId");
        const status = optionalString(obj, "status");
        const assignedTo = optionalString(obj, "assignedTo");
        const body: Record<string, unknown> = {};

        if (status !== undefined) {
          body.status = status;
        }

        if (assignedTo !== undefined) {
          body.assignedTo = assignedTo;
        }

        if (Object.keys(body).length === 0) {
          throw new Error('Provide at least one field to update ("status" or "assignedTo")');
        }

        return sentryRequest(ctx, `/issues/${encodeURIComponent(issueId)}/`, {
          method: "PUT",
          body,
        });
      },
    },
  ],
} satisfies TetherboxModule;
