import { fileURLToPath } from "node:url";

export type StarterCategory = "cli" | "harness" | "integration";

export type Starter =
  | { kind: "skill"; id: string; category: StarterCategory; path: `skills/${string}` }
  | { kind: "module"; id: string; category: StarterCategory; path: `modules/${string}` };

export const templatesDir = fileURLToPath(new URL("../templates", import.meta.url));

export const starters = [
  { kind: "skill", id: "git", category: "cli", path: "skills/git" },
  { kind: "skill", id: "gh", category: "cli", path: "skills/gh" },
  { kind: "skill", id: "claude", category: "harness", path: "skills/claude" },
  { kind: "skill", id: "opencode", category: "harness", path: "skills/opencode" },
  { kind: "skill", id: "t3code", category: "harness", path: "skills/t3code" },
  { kind: "skill", id: "antigravity", category: "harness", path: "skills/antigravity" },
  { kind: "module", id: "codex", category: "harness", path: "modules/codex" },
  { kind: "module", id: "slack", category: "integration", path: "modules/slack" },
  { kind: "module", id: "gcal", category: "integration", path: "modules/gcal" },
  { kind: "module", id: "gmail", category: "integration", path: "modules/gmail" },
  { kind: "module", id: "linear", category: "integration", path: "modules/linear" },
  { kind: "module", id: "notion", category: "integration", path: "modules/notion" },
] as const satisfies readonly Starter[];

export type StarterId = (typeof starters)[number]["id"];
