import type { TetherboxModule } from "@tetherbox/core";

export default {
  name: "codex",
  description: "Dispatch and monitor Codex sessions.",
  requiredSecrets: [],
  // TODO: Drive Codex through @openai/codex-sdk or the app server protocol and return the session id so the agent can call register_poll_job.
  tools: [],
} satisfies TetherboxModule;
