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

export interface StarterCliAuth {
  readonly binary: string;
  readonly checkCommand?: readonly [string, ...string[]];
  readonly loginCommand: readonly [string, ...string[]];
}

export interface StarterCliAuthEntry {
  readonly starterId: string;
  readonly cliAuth: StarterCliAuth;
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

interface StarterBase {
  readonly id: string;
  readonly category: StarterCategory;
  readonly secrets: readonly StarterSecret[];
  readonly cliAuth?: StarterCliAuth;
}

export type Starter =
  | (StarterBase & {
      readonly kind: "skill";
      readonly path: `skills/${string}`;
    })
  | (StarterBase & {
      readonly kind: "module";
      readonly path: `modules/${string}`;
    });

export const templatesDir = fileURLToPath(new URL("../templates", import.meta.url));

export const starters = [
  { kind: "skill", id: "git", category: "cli", path: "skills/git", secrets: [] },
  {
    kind: "skill",
    id: "gh",
    category: "cli",
    path: "skills/gh",
    secrets: [],
    cliAuth: {
      binary: "gh",
      checkCommand: ["gh", "auth", "status"],
      loginCommand: ["gh", "auth", "login", "--web", "--git-protocol", "https"],
    },
  },
  {
    kind: "skill",
    id: "claude",
    category: "harness",
    path: "skills/claude",
    secrets: [],
    cliAuth: {
      binary: "claude",
      checkCommand: ["claude", "auth", "status"],
      loginCommand: ["claude", "auth", "login"],
    },
  },
  {
    kind: "skill",
    id: "opencode",
    category: "harness",
    path: "skills/opencode",
    secrets: [],
    cliAuth: {
      binary: "opencode",
      loginCommand: ["opencode", "auth", "login"],
    },
  },
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

export function listCliAuthStarters(): StarterCliAuthEntry[] {
  const entries: StarterCliAuthEntry[] = [];

  for (const starter of startersById.values()) {
    if (starter.cliAuth !== undefined) {
      entries.push({ starterId: starter.id, cliAuth: starter.cliAuth });
    }
  }

  return entries;
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

export function collectStarterCliAuth(ids: readonly string[]): StarterCliAuthEntry[] {
  const seen = new Set<string>();
  const required: StarterCliAuthEntry[] = [];

  for (const id of ids) {
    const starter = startersById.get(id);

    if (starter === undefined) {
      throw new Error(`unknown starter "${id}"`);
    }

    if (starter.cliAuth !== undefined && !seen.has(starter.id)) {
      seen.add(starter.id);
      required.push({ starterId: starter.id, cliAuth: starter.cliAuth });
    }
  }

  return required;
}
