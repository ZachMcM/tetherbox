import { fileURLToPath } from "node:url";
import {
  secretBindingSchema,
  secretInjectionSchema,
  secretKeySchema,
  type OAuthPresetId,
  type SecretInjection,
  type SecretKey,
  type StarterCategory,
  type StarterConfigField,
  type StarterSecret,
} from "@tetherbox/core";

export type { StarterCategory, StarterConfigField, StarterSecret };

export interface StarterConfigEntry {
  readonly starterId: string;
  readonly field: StarterConfigField;
}

export interface StarterCliInstall {
  readonly target: "agent" | "system";
  readonly description: string;
  readonly command: readonly [string, ...string[]];
}

export interface StarterCliAuth {
  readonly checkCommand?: readonly [string, ...string[]];
  readonly loginCommand: readonly [string, ...string[]];
}

export interface StarterCli {
  readonly binary: string;
  readonly install?: StarterCliInstall;
  readonly auth?: StarterCliAuth;
}

export interface StarterCliEntry {
  readonly starterId: string;
  readonly cli: StarterCli;
}

export interface StarterCliAuthEntry {
  readonly starterId: string;
  readonly cli: StarterCli & { readonly auth: StarterCliAuth };
}

function proxySecret(
  key: string,
  domains: [string, ...string[]],
  inject: SecretInjection = { kind: "bearer" },
): StarterSecret {
  return {
    kind: "fixed",
    key: secretKeySchema.parse(key),
    binding: secretBindingSchema.parse({
      kind: "proxy",
      domains,
      inject,
    }),
  };
}

interface PromptDomainProxySecretInput {
  readonly key: string;
  readonly inject?: SecretInjection;
  readonly domainPrompt: string;
  readonly domainPlaceholder: string;
  readonly fromConfigUrl?: { readonly starterId: string; readonly key: string };
}

function promptDomainProxySecret({
  key,
  inject = { kind: "bearer" },
  domainPrompt,
  domainPlaceholder,
  fromConfigUrl,
}: PromptDomainProxySecretInput): StarterSecret {
  return {
    kind: "prompt-domain",
    key: secretKeySchema.parse(key),
    inject: secretInjectionSchema.parse(inject),
    domainPrompt,
    domainPlaceholder,
    ...(fromConfigUrl !== undefined ? { fromConfigUrl } : {}),
  };
}

function npmUserInstall(packageName: string): StarterCliInstall {
  return {
    target: "agent",
    description: `Install ${packageName} into ~/.local`,
    command: ["sh", "-c", `npm install -g --prefix "$HOME/.local" ${packageName}`],
  };
}

interface StarterBase {
  readonly id: string;
  readonly category: StarterCategory;
  readonly secrets: readonly StarterSecret[];
  readonly oauthPreset?: OAuthPresetId;
  readonly cli?: StarterCli;
  readonly configFields?: readonly StarterConfigField[];
  readonly setupNote?: string;
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
  {
    kind: "skill",
    id: "gh",
    category: "cli",
    path: "skills/gh",
    secrets: [],
    cli: {
      binary: "gh",
      auth: {
        checkCommand: ["gh", "auth", "status"],
        loginCommand: ["gh", "auth", "login", "--web", "--git-protocol", "https"],
      },
    },
  },
  {
    kind: "skill",
    id: "browser",
    category: "cli",
    path: "skills/browser",
    secrets: [],
    cli: {
      binary: "agent-browser",
      install: npmUserInstall("agent-browser"),
    },
    setupNote:
      "Run `agent-browser install` as the agent user on the VM if headless Chromium is not yet downloaded.",
  },
  {
    kind: "skill",
    id: "orca",
    category: "harness",
    path: "skills/orca",
    secrets: [],
    configFields: [
      {
        key: "target",
        kind: "string",
        prompt:
          "Orca workstation SSH target (Tailscale MagicDNS host from `tailscale status` or user@host)",
        placeholder: "workstation.tailnet.ts.net",
      },
    ],
    setupNote:
      "Keep either the Orca desktop app or `orca serve` running on your workstation, and ensure `tetherbox-agent` on the VM can SSH into it over Tailscale.",
  },
  {
    kind: "skill",
    id: "rex",
    category: "harness",
    path: "skills/rex",
    secrets: [],
    cli: {
      binary: "rex",
      install: {
        target: "system",
        description: "Install Rex via pkgs.superlogical.com/rex/install.sh",
        command: ["sh", "-c", "curl -fsSL https://pkgs.superlogical.com/rex/install.sh | sh"],
      },
    },
    configFields: [
      {
        key: "target",
        kind: "string",
        prompt:
          "Rex remote target (Tailscale MagicDNS host from `tailscale status` or ssh://user@host)",
        placeholder: "workstation.tailnet.ts.net",
      },
    ],
  },
  {
    kind: "skill",
    id: "paseo",
    category: "harness",
    path: "skills/paseo",
    secrets: [],
    cli: {
      binary: "paseo",
      install: npmUserInstall("@getpaseo/cli"),
      auth: {
        loginCommand: ["paseo", "hub", "login"],
      },
    },
    configFields: [
      {
        key: "host",
        kind: "host-port",
        prompt: "Paseo daemon host:port (Tailscale MagicDNS host from `tailscale status`)",
        placeholder: "workstation.tailnet.ts.net:6767",
      },
    ],
  },
  {
    kind: "skill",
    id: "opencode",
    category: "harness",
    path: "skills/opencode",
    secrets: [],
    cli: {
      binary: "opencode",
      install: npmUserInstall("opencode-ai"),
    },
    configFields: [
      {
        key: "serverUrl",
        kind: "url",
        prompt: "OpenCode server URL (Tailscale MagicDNS host from `tailscale status`)",
        placeholder: "http://workstation.tailnet.ts.net:4096",
      },
    ],
    setupNote:
      "Keep `opencode serve` running on your workstation over Tailscale (for example via launchd on macOS or systemd --user on Linux) so Tetherbox can reach it.",
  },
  {
    kind: "skill",
    id: "claude",
    category: "harness",
    path: "skills/claude",
    secrets: [],
    cli: {
      binary: "claude",
      install: npmUserInstall("@anthropic-ai/claude-code"),
      auth: {
        checkCommand: ["claude", "auth", "status"],
        loginCommand: ["claude", "auth", "login"],
      },
    },
  },
  {
    kind: "module",
    id: "t3code",
    category: "harness",
    path: "modules/t3code",
    configFields: [
      {
        key: "endpointUrl",
        kind: "url",
        prompt: "T3 Code /mcp endpoint URL (from 'Use T3 Code in another app (MCP)')",
        placeholder: "https://<environment-host>/mcp",
      },
    ],
    secrets: [
      promptDomainProxySecret({
        key: "T3CODE_TOKEN",
        domainPrompt: "Hostname for your T3 Code /mcp endpoint",
        domainPlaceholder: "<environment-host>",
        fromConfigUrl: { starterId: "t3code", key: "endpointUrl" },
      }),
    ],
  },
  {
    kind: "module",
    id: "cursor",
    category: "harness",
    path: "modules/cursor",
    secrets: [proxySecret("CURSOR_API_KEY", ["api.cursor.com"])],
  },
  {
    kind: "module",
    id: "devin",
    category: "harness",
    path: "modules/devin",
    configFields: [
      {
        key: "orgId",
        kind: "string",
        prompt: "Devin organization ID (for /v3/organizations/{org_id}/sessions)",
        placeholder: "org-xxxxxxxxxxxxxxxx",
      },
    ],
    secrets: [proxySecret("DEVIN_API_KEY", ["api.devin.ai"])],
  },
  {
    kind: "module",
    id: "slack",
    category: "integration",
    path: "modules/slack",
    secrets: [proxySecret("SLACK_BOT_TOKEN", ["slack.com"])],
  },
  {
    kind: "module",
    id: "gcal",
    category: "integration",
    path: "modules/gcal",
    secrets: [],
    oauthPreset: "gcal",
  },
  {
    kind: "module",
    id: "gdrive",
    category: "integration",
    path: "modules/gdrive",
    secrets: [],
    oauthPreset: "gdrive",
  },
  {
    kind: "module",
    id: "gmail",
    category: "integration",
    path: "modules/gmail",
    secrets: [],
    oauthPreset: "gmail",
  },
  {
    kind: "module",
    id: "sentry",
    category: "integration",
    path: "modules/sentry",
    configFields: [
      {
        key: "apiBaseUrl",
        kind: "url",
        prompt:
          "Sentry base URL (https://sentry.io, https://de.sentry.io, or your self-hosted URL)",
        placeholder: "https://sentry.io",
      },
      {
        key: "orgSlug",
        kind: "string",
        prompt: "Sentry organization slug",
        placeholder: "my-org",
      },
    ],
    secrets: [
      promptDomainProxySecret({
        key: "SENTRY_AUTH_TOKEN",
        domainPrompt: "Hostname for your Sentry instance",
        domainPlaceholder: "sentry.io",
        fromConfigUrl: { starterId: "sentry", key: "apiBaseUrl" },
      }),
    ],
  },
  {
    kind: "module",
    id: "jira",
    category: "integration",
    path: "modules/jira",
    configFields: [
      {
        key: "siteUrl",
        kind: "url",
        prompt: "Jira site URL",
        placeholder: "https://your-site.atlassian.net",
      },
    ],
    secrets: [
      promptDomainProxySecret({
        key: "JIRA_AUTH",
        inject: { kind: "header", name: "Authorization" },
        domainPrompt: "Hostname for your Jira site",
        domainPlaceholder: "your-site.atlassian.net",
        fromConfigUrl: { starterId: "jira", key: "siteUrl" },
      }),
    ],
    setupNote:
      "Store `JIRA_AUTH` as the full Authorization header value, such as `Basic <base64(email:api_token)>` for Jira Cloud or `Bearer <token>` for Data Center.",
  },
  {
    kind: "module",
    id: "linear",
    category: "integration",
    path: "modules/linear",
    secrets: [
      proxySecret("LINEAR_API_KEY", ["api.linear.app"], {
        kind: "header",
        name: "Authorization",
      }),
    ],
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

export function resolveStarters(ids: readonly string[]): Starter[] {
  const seen = new Set<string>();
  const resolved: Starter[] = [];

  for (const id of ids) {
    if (seen.has(id)) {
      continue;
    }

    const starter = startersById.get(id);

    if (starter === undefined) {
      throw new Error(`unknown starter "${id}"`);
    }

    seen.add(id);
    resolved.push(starter);
  }

  return resolved;
}

function toCliAuthEntry(starter: Starter): StarterCliAuthEntry | undefined {
  if (starter.cli?.auth === undefined) {
    return undefined;
  }

  return {
    starterId: starter.id,
    cli: { ...starter.cli, auth: starter.cli.auth },
  };
}

export function getCliAuthStarter(id: string): StarterCliAuthEntry | undefined {
  const starter = startersById.get(id);

  return starter === undefined ? undefined : toCliAuthEntry(starter);
}

export function listCliAuthStarters(): StarterCliAuthEntry[] {
  const entries: StarterCliAuthEntry[] = [];

  for (const starter of starters) {
    const entry = toCliAuthEntry(starter);

    if (entry !== undefined) {
      entries.push(entry);
    }
  }

  return entries;
}

export function collectStarterSecrets(ids: readonly string[]): StarterSecret[] {
  const seen = new Set<SecretKey>();
  const required: StarterSecret[] = [];

  for (const starter of resolveStarters(ids)) {
    for (const secret of starter.secrets) {
      if (!seen.has(secret.key)) {
        seen.add(secret.key);
        required.push(secret);
      }
    }
  }

  return required;
}

export function collectStarterClis(ids: readonly string[]): StarterCliEntry[] {
  return resolveStarters(ids).flatMap((starter) =>
    starter.cli !== undefined ? [{ starterId: starter.id, cli: starter.cli }] : [],
  );
}

export function collectStarterConfigFields(ids: readonly string[]): StarterConfigEntry[] {
  return resolveStarters(ids).flatMap((starter) =>
    (starter.configFields ?? []).map((field) => ({ starterId: starter.id, field })),
  );
}

export function collectStarterOAuthPresets(ids: readonly string[]): OAuthPresetId[] {
  const seen = new Set<OAuthPresetId>();
  const presets: OAuthPresetId[] = [];

  for (const starter of resolveStarters(ids)) {
    if (starter.oauthPreset !== undefined && !seen.has(starter.oauthPreset)) {
      seen.add(starter.oauthPreset);
      presets.push(starter.oauthPreset);
    }
  }

  return presets;
}
