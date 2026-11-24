import type { TetherboxModule } from "@tetherbox/core";

export default {
  name: "linear",
  description: "Read and update Linear issues and projects.",
  requiredSecrets: ["LINEAR_API_KEY"],
  // TODO: Add GraphQL-backed issue tools through ctx.fetchWithSecret against api.linear.app.
  tools: [],
} satisfies TetherboxModule;
