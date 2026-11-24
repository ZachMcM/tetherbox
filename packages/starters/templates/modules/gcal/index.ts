import type { TetherboxModule } from "@tetherbox/core";

export default {
  name: "gcal",
  description: "Read and manage Google Calendar events.",
  requiredSecrets: [],
  // TODO: Add calendar tools once the daemon's generic Google OAuth2 flow can mint scoped access tokens.
  tools: [],
} satisfies TetherboxModule;
