import type { TetherboxModule } from "@tetherbox/core";

export default {
  name: "notion",
  description: "Read and update Notion pages and databases.",
  requiredSecrets: ["NOTION_API_KEY"],
  // TODO: Add page and database tools through ctx.fetchWithSecret against api.notion.com.
  tools: [],
} satisfies TetherboxModule;
