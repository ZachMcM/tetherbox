import type { TetherboxModule } from "@tetherbox/core";

export default {
  name: "slack",
  description: "Slack actions beyond replying in the current thread.",
  requiredSecrets: ["SLACK_BOT_TOKEN"],
  // TODO: Add tools for posting to other channels, searching history, and reading threads through ctx.fetchWithSecret against slack.com.
  tools: [],
} satisfies TetherboxModule;
