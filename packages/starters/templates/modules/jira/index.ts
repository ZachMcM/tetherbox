import type { ModuleContext, ModuleToolResult, TetherboxModule } from "@tetherbox/core";

const SECRET_KEY = "JIRA_AUTH";
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

function plainTextToAdf(text: string): Record<string, unknown> {
  const paragraphs = text.split(/\r?\n\r?\n/).map((block) => ({
    type: "paragraph",
    content: block ? [{ type: "text", text: block }] : [],
  }));

  return {
    type: "doc",
    version: 1,
    content: paragraphs,
  };
}

async function jiraRequest(
  ctx: ModuleContext,
  path: string,
  init: { method?: string; body?: Record<string, unknown> } = {},
): Promise<ModuleToolResult> {
  const rawSiteUrl = ctx.config.siteUrl?.trim();

  if (rawSiteUrl === undefined || rawSiteUrl === "") {
    return {
      kind: "text",
      text: "Missing starterConfig.jira.siteUrl in profile.json. Set it to your https://<site>.atlassian.net URL.",
    };
  }

  const siteUrl = rawSiteUrl.replace(/\/+$/, "");

  if (!(await ctx.hasSecret(SECRET_KEY))) {
    const host = URL.parse(siteUrl)?.hostname ?? "<site>.atlassian.net";

    return {
      kind: "text",
      text: `Missing ${SECRET_KEY}. Add it in Tetherbox Settings -> Secrets pinned to ${host} (header: Authorization).`,
    };
  }

  const response = await ctx.fetchWithSecret(SECRET_KEY, `${siteUrl}/rest/api/3${path}`, {
    method: init.method ?? "GET",
    headers: {
      Accept: "application/json",
      ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  const rawBody = await response.text();

  if (!response.ok) {
    throw new Error(
      `Jira API ${path} failed (${response.status}): ${rawBody.slice(0, MAX_ERROR_CHARS)}`,
    );
  }

  if (rawBody.trim() === "") {
    return { kind: "json", value: { ok: true } };
  }

  return cappedJsonResult(JSON.parse(rawBody));
}

export default {
  name: "jira",
  description: "Search, read, create, comment on, and transition Jira issues.",
  requiredSecrets: [SECRET_KEY],
  tools: [
    {
      name: "search_issues",
      description: "Search Jira issues using a JQL query.",
      parameters: {
        type: "object",
        properties: {
          jql: {
            type: "string",
            description: 'JQL query, e.g. "project = ENG AND status != Done".',
          },
          maxResults: {
            type: "integer",
            description: "Maximum number of issues to return (1-100).",
          },
          fields: {
            type: "array",
            items: { type: "string" },
            description: 'Fields to include, e.g. ["summary", "status", "assignee", "priority"].',
          },
        },
        required: ["jql"],
        additionalProperties: false,
      },
      async execute(params, ctx) {
        const obj = asObject(params);
        const jql = requireString(obj, "jql");
        const maxResults = optionalNumber(obj, "maxResults");
        const fields = optionalStringArray(obj, "fields") ?? [
          "summary",
          "status",
          "assignee",
          "priority",
          "issuetype",
          "updated",
        ];

        return jiraRequest(ctx, "/search/jql", {
          method: "POST",
          body: {
            jql,
            fields,
            ...(maxResults !== undefined
              ? { maxResults: Math.min(Math.max(Math.trunc(maxResults), 1), 100) }
              : {}),
          },
        });
      },
    },
    {
      name: "get_issue",
      description: "Fetch a Jira issue by key or ID.",
      parameters: {
        type: "object",
        properties: {
          issueKey: { type: "string", description: 'Jira issue key or ID, e.g. "ENG-123".' },
        },
        required: ["issueKey"],
        additionalProperties: false,
      },
      async execute(params, ctx) {
        const issueKey = requireString(asObject(params), "issueKey");

        return jiraRequest(ctx, `/issue/${encodeURIComponent(issueKey)}`);
      },
    },
    {
      name: "create_issue",
      description: "Create a new Jira issue in a project.",
      parameters: {
        type: "object",
        properties: {
          projectKey: { type: "string", description: 'Project key, e.g. "ENG".' },
          issueType: { type: "string", description: 'Issue type name, e.g. "Task" or "Bug".' },
          summary: { type: "string", description: "Issue summary title." },
          description: { type: "string", description: "Optional plain-text description." },
          labels: { type: "array", items: { type: "string" }, description: "Optional labels." },
        },
        required: ["projectKey", "issueType", "summary"],
        additionalProperties: false,
      },
      async execute(params, ctx) {
        const obj = asObject(params);
        const projectKey = requireString(obj, "projectKey");
        const issueType = requireString(obj, "issueType");
        const summary = requireString(obj, "summary");
        const description = optionalString(obj, "description");
        const labels = optionalStringArray(obj, "labels");

        return jiraRequest(ctx, "/issue", {
          method: "POST",
          body: {
            fields: {
              project: { key: projectKey },
              issuetype: { name: issueType },
              summary,
              ...(description !== undefined ? { description: plainTextToAdf(description) } : {}),
              ...(labels !== undefined ? { labels } : {}),
            },
          },
        });
      },
    },
    {
      name: "add_comment",
      description: "Add a plain-text comment to a Jira issue.",
      parameters: {
        type: "object",
        properties: {
          issueKey: { type: "string", description: 'Jira issue key or ID, e.g. "ENG-123".' },
          body: { type: "string", description: "Comment text." },
        },
        required: ["issueKey", "body"],
        additionalProperties: false,
      },
      async execute(params, ctx) {
        const obj = asObject(params);
        const issueKey = requireString(obj, "issueKey");
        const body = requireString(obj, "body");

        return jiraRequest(ctx, `/issue/${encodeURIComponent(issueKey)}/comment`, {
          method: "POST",
          body: { body: plainTextToAdf(body) },
        });
      },
    },
    {
      name: "transition_issue",
      description:
        "List available transitions for a Jira issue (when transitionId is omitted) or execute a transition by ID.",
      parameters: {
        type: "object",
        properties: {
          issueKey: { type: "string", description: 'Jira issue key or ID, e.g. "ENG-123".' },
          transitionId: {
            type: "string",
            description: "Transition ID to apply. Omit to list valid transitions for this issue.",
          },
        },
        required: ["issueKey"],
        additionalProperties: false,
      },
      async execute(params, ctx) {
        const obj = asObject(params);
        const issueKey = requireString(obj, "issueKey");
        const transitionId = optionalString(obj, "transitionId");

        if (transitionId === undefined) {
          return jiraRequest(ctx, `/issue/${encodeURIComponent(issueKey)}/transitions`);
        }

        return jiraRequest(ctx, `/issue/${encodeURIComponent(issueKey)}/transitions`, {
          method: "POST",
          body: { transition: { id: transitionId } },
        });
      },
    },
  ],
} satisfies TetherboxModule;
