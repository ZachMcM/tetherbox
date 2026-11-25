import type { TetherboxModule } from "@tetherbox/core";

export default {
  name: "devin",
  description: "Launch and monitor Devin cloud sessions via api.devin.ai.",
  requiredSecrets: ["DEVIN_API_KEY"],
  // TODO: Add tools calling POST /v1/sessions, GET /v1/sessions/{id}, and POST /v1/sessions/{id}/message via ctx.fetchWithSecret.
  tools: [],
} satisfies TetherboxModule;
