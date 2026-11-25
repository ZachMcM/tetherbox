import { fileURLToPath } from "node:url";
import {
  secretBindingSchema,
  secretKeySchema,
  type SecretBinding,
  type SecretKey,
} from "@tetherbox/core";

export type StarterCategory = "cli" | "harness" | "integration";

export interface StarterSecret {
  readonly key: SecretKey;
  readonly binding: SecretBinding;
}

function proxySecret(key: string, domains: [string, ...string[]]): StarterSecret {
  return {
    key: secretKeySchema.parse(key),
    binding: secretBindingSchema.parse({
      kind: "proxy",
      domains,
      inject: { kind: "bearer" },
    }),
  };
}

export type Starter =
  | {
      kind: "skill";
      id: string;
      category: StarterCategory;
      path: `skills/${string}`;
      secrets: readonly StarterSecret[];
    }
  | {
      kind: "module";
      id: string;
      category: StarterCategory;
      path: `modules/${string}`;
      secrets: readonly StarterSecret[];
    };

export const templatesDir = fileURLToPath(new URL("../templates", import.meta.url));

export const starters = [
  { kind: "skill", id: "git", category: "cli", path: "skills/git", secrets: [] },
  { kind: "skill", id: "gh", category: "cli", path: "skills/gh", secrets: [] },
  { kind: "skill", id: "claude", category: "harness", path: "skills/claude", secrets: [] },
  { kind: "skill", id: "opencode", category: "harness", path: "skills/opencode", secrets: [] },
  { kind: "skill", id: "t3code", category: "harness", path: "skills/t3code", secrets: [] },
  {
    kind: "skill",
    id: "antigravity",
    category: "harness",
    path: "skills/antigravity",
    secrets: [],
  },
  { kind: "module", id: "codex", category: "harness", path: "modules/codex", secrets: [] },
  {
    kind: "module",
    id: "slack",
    category: "integration",
    path: "modules/slack",
    secrets: [proxySecret("SLACK_BOT_TOKEN", ["slack.com"])],
  },
  { kind: "module", id: "gcal", category: "integration", path: "modules/gcal", secrets: [] },
  { kind: "module", id: "gmail", category: "integration", path: "modules/gmail", secrets: [] },
  {
    kind: "module",
    id: "linear",
    category: "integration",
    path: "modules/linear",
    secrets: [proxySecret("LINEAR_API_KEY", ["api.linear.app"])],
  },
  {
    kind: "module",
    id: "notion",
    category: "integration",
    path: "modules/notion",
    secrets: [proxySecret("NOTION_API_KEY", ["api.notion.com"])],
  },
] as const satisfies readonly Starter[];

export type StarterId = (typeof starters)[number]["id"];

const startersById = new Map<string, Starter>(starters.map((starter) => [starter.id, starter]));

export function getStarter(id: string): Starter | undefined {
  return startersById.get(id);
}

export function collectStarterSecrets(ids: readonly string[]): StarterSecret[] {
  const seen = new Set<SecretKey>();
  const required: StarterSecret[] = [];

  for (const id of ids) {
    const starter = startersById.get(id);

    if (starter === undefined) {
      throw new Error(`unknown starter "${id}"`);
    }

    for (const secret of starter.secrets) {
      if (!seen.has(secret.key)) {
        seen.add(secret.key);
        required.push(secret);
      }
    }
  }

  return required;
}
