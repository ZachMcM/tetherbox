import type { ModuleContext, ModuleToolResult, TetherboxModule } from "@tetherbox/core";

const SECRET_KEY = "LINEAR_API_KEY";
const GRAPHQL_URL = "https://api.linear.app/graphql";
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

function assignOptionalIssueFields(
  obj: Record<string, unknown>,
  input: Record<string, unknown>,
): void {
  const description = optionalString(obj, "description");
  const priority = optionalNumber(obj, "priority");
  const stateId = optionalString(obj, "stateId");
  const assigneeId = optionalString(obj, "assigneeId");
  const projectId = optionalString(obj, "projectId");
  const labelIds = optionalStringArray(obj, "labelIds");

  if (description !== undefined) {
    input.description = description;
  }

  if (priority !== undefined) {
    input.priority = Math.trunc(priority);
  }

  if (stateId !== undefined) {
    input.stateId = stateId;
  }

  if (assigneeId !== undefined) {
    input.assigneeId = assigneeId;
  }

  if (projectId !== undefined) {
    input.projectId = projectId;
  }

  if (labelIds !== undefined) {
    input.labelIds = labelIds;
  }
}

async function linearGraphql(
  ctx: ModuleContext,
  query: string,
  variables?: Record<string, unknown>,
): Promise<ModuleToolResult> {
  if (!(await ctx.hasSecret(SECRET_KEY))) {
    return {
      kind: "text",
      text: `Missing ${SECRET_KEY}. Run: tetherbox secrets set ${SECRET_KEY} --domain api.linear.app --inject header:Authorization`,
    };
  }

  const response = await ctx.fetchWithSecret(SECRET_KEY, GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(variables !== undefined ? { query, variables } : { query }),
  });
  const raw = await response.text();

  if (!response.ok) {
    throw new Error(`Linear API returned ${response.status}: ${raw.slice(0, MAX_ERROR_CHARS)}`);
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Linear API returned non-JSON body: ${raw.slice(0, MAX_ERROR_CHARS)}`);
  }

  if (!isRecord(parsed)) {
    throw new Error("Linear API returned an unexpected response payload");
  }

  if (Array.isArray(parsed.errors) && parsed.errors.length > 0) {
    const messages = parsed.errors
      .map((err) => (isRecord(err) && typeof err.message === "string" ? err.message : String(err)))
      .join("; ");

    throw new Error(`Linear GraphQL error: ${messages}`);
  }

  return cappedJsonResult(parsed.data);
}

const ISSUE_SUMMARY_FIELDS = `
  id
  identifier
  title
  priority
  url
  updatedAt
  state { id name type }
  team { id key name }
  assignee { id name email }
  project { id name }
`;

export default {
  name: "linear",
  description: "Read and update Linear issues, comments, and GraphQL resources.",
  requiredSecrets: [SECRET_KEY],
  tools: [
    {
      name: "list_issues",
      description:
        "List or search Linear issues, with optional filters for team key, assignee email, state name, or search query.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Full-text search query across issues." },
          teamKey: { type: "string", description: "Filter by team key (for example ENG)." },
          assigneeEmail: { type: "string", description: "Filter by assignee email address." },
          stateName: { type: "string", description: "Filter by workflow state name." },
          limit: { type: "number", description: "Maximum number of issues (default 25, max 100)." },
          after: { type: "string", description: "Pagination cursor from pageInfo.endCursor." },
        },
        additionalProperties: false,
      },
      async execute(params, ctx) {
        const obj = asObject(params);
        const searchTerm = optionalString(obj, "query");
        const teamKey = optionalString(obj, "teamKey");
        const assigneeEmail = optionalString(obj, "assigneeEmail");
        const stateName = optionalString(obj, "stateName");
        const limit = Math.min(100, Math.max(1, Math.trunc(optionalNumber(obj, "limit") ?? 25)));
        const after = optionalString(obj, "after");

        const filter: Record<string, unknown> = {};

        if (teamKey !== undefined) {
          filter.team = { key: { eqIgnoreCase: teamKey } };
        }

        if (assigneeEmail !== undefined) {
          filter.assignee = { email: { eqIgnoreCase: assigneeEmail } };
        }

        if (stateName !== undefined) {
          filter.state = { name: { eqIgnoreCase: stateName } };
        }

        const hasFilter = Object.keys(filter).length > 0;

        if (searchTerm !== undefined) {
          const gql = `
            query SearchIssues($term: String!, $first: Int!, $after: String, $filter: IssueFilter) {
              searchIssues(term: $term, first: $first, after: $after, filter: $filter) {
                nodes { ${ISSUE_SUMMARY_FIELDS} }
                pageInfo { hasNextPage endCursor }
              }
            }
          `;

          return linearGraphql(ctx, gql, {
            term: searchTerm,
            first: limit,
            ...(after !== undefined ? { after } : {}),
            ...(hasFilter ? { filter } : {}),
          });
        }

        const gql = `
          query ListIssues($first: Int!, $after: String, $filter: IssueFilter) {
            issues(first: $first, after: $after, filter: $filter) {
              nodes { ${ISSUE_SUMMARY_FIELDS} }
              pageInfo { hasNextPage endCursor }
            }
          }
        `;

        return linearGraphql(ctx, gql, {
          first: limit,
          ...(after !== undefined ? { after } : {}),
          ...(hasFilter ? { filter } : {}),
        });
      },
    },
    {
      name: "get_issue",
      description: "Get a Linear issue by UUID or identifier (for example ENG-123) with comments.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Issue UUID or identifier (e.g. ENG-123)." },
        },
        required: ["id"],
        additionalProperties: false,
      },
      async execute(params, ctx) {
        const id = requireString(asObject(params), "id");
        const gql = `
          query GetIssue($id: String!) {
            issue(id: $id) {
              ${ISSUE_SUMMARY_FIELDS}
              description
              createdAt
              labels { nodes { id name } }
              parent { id identifier title }
              comments(first: 25) {
                nodes {
                  id
                  body
                  createdAt
                  user { id name email }
                }
              }
            }
          }
        `;

        return linearGraphql(ctx, gql, { id });
      },
    },
    {
      name: "create_issue",
      description: "Create a new Linear issue.",
      parameters: {
        type: "object",
        properties: {
          teamId: { type: "string", description: "Target Linear team ID." },
          title: { type: "string", description: "Issue title." },
          description: { type: "string", description: "Markdown description." },
          priority: {
            type: "number",
            description: "Priority: 0 none, 1 urgent, 2 high, 3 medium, 4 low.",
          },
          stateId: { type: "string", description: "Optional workflow state ID." },
          assigneeId: { type: "string", description: "Optional assignee user ID." },
          projectId: { type: "string", description: "Optional project ID." },
          parentId: { type: "string", description: "Optional parent issue ID." },
          labelIds: {
            type: "array",
            items: { type: "string" },
            description: "Optional label IDs.",
          },
        },
        required: ["teamId", "title"],
        additionalProperties: false,
      },
      async execute(params, ctx) {
        const obj = asObject(params);
        const input: Record<string, unknown> = {
          teamId: requireString(obj, "teamId"),
          title: requireString(obj, "title"),
        };
        const parentId = optionalString(obj, "parentId");

        assignOptionalIssueFields(obj, input);

        if (parentId !== undefined) {
          input.parentId = parentId;
        }

        const gql = `
          mutation CreateIssue($input: IssueCreateInput!) {
            issueCreate(input: $input) {
              success
              issue { ${ISSUE_SUMMARY_FIELDS} }
            }
          }
        `;

        return linearGraphql(ctx, gql, { input });
      },
    },
    {
      name: "update_issue",
      description: "Update fields on an existing Linear issue.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Issue UUID or identifier." },
          title: { type: "string", description: "New title." },
          description: { type: "string", description: "New markdown description." },
          priority: {
            type: "number",
            description: "Priority: 0 none, 1 urgent, 2 high, 3 medium, 4 low.",
          },
          stateId: { type: "string", description: "New workflow state ID." },
          assigneeId: { type: "string", description: "New assignee user ID." },
          projectId: { type: "string", description: "New project ID." },
          labelIds: {
            type: "array",
            items: { type: "string" },
            description: "Replacement label IDs.",
          },
        },
        required: ["id"],
        additionalProperties: false,
      },
      async execute(params, ctx) {
        const obj = asObject(params);
        const id = requireString(obj, "id");
        const input: Record<string, unknown> = {};
        const title = optionalString(obj, "title");

        if (title !== undefined) {
          input.title = title;
        }

        assignOptionalIssueFields(obj, input);

        const gql = `
          mutation UpdateIssue($id: String!, $input: IssueUpdateInput!) {
            issueUpdate(id: $id, input: $input) {
              success
              issue { ${ISSUE_SUMMARY_FIELDS} }
            }
          }
        `;

        return linearGraphql(ctx, gql, { id, input });
      },
    },
    {
      name: "add_comment",
      description: "Post a markdown comment on a Linear issue.",
      parameters: {
        type: "object",
        properties: {
          issueId: { type: "string", description: "Issue UUID or identifier." },
          body: { type: "string", description: "Markdown comment body." },
        },
        required: ["issueId", "body"],
        additionalProperties: false,
      },
      async execute(params, ctx) {
        const obj = asObject(params);
        const issueId = requireString(obj, "issueId");
        const body = requireString(obj, "body");
        const gql = `
          mutation AddComment($input: CommentCreateInput!) {
            commentCreate(input: $input) {
              success
              comment {
                id
                body
                createdAt
                url
              }
            }
          }
        `;

        return linearGraphql(ctx, gql, { input: { issueId, body } });
      },
    },
    {
      name: "graphql",
      description:
        "Execute an arbitrary Linear GraphQL query or mutation (useful for listing teams, workflow states, projects, or custom fields).",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "GraphQL query or mutation document." },
          variables: {
            type: "object",
            description: "Optional GraphQL variables object.",
            additionalProperties: true,
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
      async execute(params, ctx) {
        const obj = asObject(params);
        const query = requireString(obj, "query");
        const variables = optionalRecord(obj, "variables");

        return linearGraphql(ctx, query, variables);
      },
    },
  ],
} satisfies TetherboxModule;
