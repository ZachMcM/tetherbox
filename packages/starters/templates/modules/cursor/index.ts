import type { TetherboxModule } from "@tetherbox/core";

export default {
  name: "cursor",
  description: "Launch and monitor Cursor Cloud Agents sessions via api.cursor.com.",
  requiredSecrets: ["CURSOR_API_KEY"],
  // TODO: Add tools calling POST /v1/agents, GET /v1/agents/{agentId}/runs/{runId}, and GET /v1/agents/{agentId}/conversation via ctx.fetchWithSecret.
  tools: [],
} satisfies TetherboxModule;
