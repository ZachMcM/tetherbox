import type { TetherboxModule } from "@tetherbox/core";

export default {
  name: "gdrive",
  description: "Search and read Google Drive files, Docs, and Sheets.",
  requiredSecrets: [],
  // TODO: Add Drive tools once the daemon's generic Google OAuth2 flow can mint scoped access tokens.
  tools: [],
} satisfies TetherboxModule;
