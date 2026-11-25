import type { TetherboxModule } from "@tetherbox/core";

export default {
  name: "t3code",
  description: "Dispatch and monitor T3 Code sessions through a remote /mcp endpoint.",
  requiredSecrets: ["T3CODE_TOKEN"],
  // TODO: Add MCP JSON-RPC tools using ctx.config.endpointUrl and ctx.fetchWithSecret("T3CODE_TOKEN", ...) and return session IDs for register_poll_job.
  tools: [],
} satisfies TetherboxModule;
