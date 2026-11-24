import type { TetherboxModule } from "@tetherbox/core";

export default {
  name: "gmail",
  description: "Read, search, and draft Gmail messages.",
  requiredSecrets: [],
  // TODO: Add Gmail tools once the daemon's generic Google OAuth2 flow can mint scoped access tokens.
  tools: [],
} satisfies TetherboxModule;
