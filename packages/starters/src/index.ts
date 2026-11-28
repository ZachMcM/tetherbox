import { fileURLToPath } from "node:url";
import {
  starterSchema,
  type SecretInjection,
  type Starter,
  type StarterCliInstall,
  type StarterInput,
} from "@tetherbox/core";
import { REX_INSTALL_SCRIPT } from "./install-rex.ts";

type StarterSecretInput = NonNullable<StarterInput["secrets"]>[number];

function proxySecret(
  key: string,
  domains: [string, ...string[]],
  inject: SecretInjection = { kind: "bearer" },
): StarterSecretInput {
  return { kind: "fixed", key, binding: { kind: "proxy", domains, inject } };
}

type PromptDomainSecretInput = Extract<StarterSecretInput, { kind: "prompt-domain" }>;

function promptDomainProxySecret(
  input: Omit<PromptDomainSecretInput, "kind" | "inject"> & { inject?: SecretInjection },
): StarterSecretInput {
  return { kind: "prompt-domain", inject: { kind: "bearer" }, ...input };
}

function npmUserInstall(packageName: string, postInstall?: string): StarterCliInstall {
  const base = `npm install -g --prefix "$HOME/.local" ${packageName}`;

  return {
    description: `Install ${packageName} into ~/.local`,
    command: ["sh", "-c", postInstall !== undefined ? `${base} && { ${postInstall}; }` : base],
  };
}

const GH_USER_INSTALL_SCRIPT = [
  "set -eu",
  'mkdir -p "$HOME/.local/bin"',
  'OS=$(uname -s | tr "[:upper:]" "[:lower:]")',
  "ARCH=$(uname -m)",
  'case "$ARCH" in x86_64|amd64) ARCH="amd64" ;; aarch64|arm64) ARCH="arm64" ;; *) echo "Unsupported arch: $ARCH" >&2; exit 1 ;; esac',
  'case "$OS" in linux) EXT="tar.gz" ;; darwin) OS="macOS"; EXT="zip" ;; *) echo "Unsupported OS: $OS" >&2; exit 1 ;; esac',
  'TAG=$(curl -fsSL https://api.github.com/repos/cli/cli/releases/latest | sed -n \'s/.*"tag_name"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p\' | head -n 1)',
  'VER="${TAG#v}"',
  "TMP=$(mktemp -d)",
  "trap 'rm -rf \"$TMP\"' EXIT",
  'URL="https://github.com/cli/cli/releases/download/${TAG}/gh_${VER}_${OS}_${ARCH}.${EXT}"',
  'curl -fsSL "$URL" -o "$TMP/gh.${EXT}"',
  'if [ "$EXT" = "tar.gz" ]; then tar -xzf "$TMP/gh.tar.gz" -C "$TMP"; else unzip -q "$TMP/gh.zip" -d "$TMP"; fi',
  'install -m 0755 "$TMP/gh_${VER}_${OS}_${ARCH}/bin/gh" "$HOME/.local/bin/gh"',
].join("; ");

const USE_SYSTEM_CHROMIUM_SCRIPT = [
  'const fs = require("node:fs"), path = require("node:path");',
  'const file = path.join(process.env.HOME, ".agent-browser", "config.json");',
  "let config = {};",
  'try { config = JSON.parse(fs.readFileSync(file, "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }',
  'if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("Expected an object in " + file);',
  "config.executablePath = process.argv[1];",
  "fs.mkdirSync(path.dirname(file), { recursive: true });",
  'fs.writeFileSync(file, JSON.stringify(config, null, 2) + "\\n");',
].join(" ");

export const templatesDir = fileURLToPath(new URL("../templates", import.meta.url));

const builtinStarters = [
  {
    kind: "skill",
    id: "gh",
    name: "GitHub CLI",
    category: "cli",
    cli: {
      binary: "gh",
      install: {
        description: "Download GitHub CLI into ~/.local/bin",
        command: ["sh", "-c", GH_USER_INSTALL_SCRIPT],
      },
      auth: {
        checkCommand: ["gh", "auth", "status"],
        loginCommand: ["gh", "auth", "login", "--web", "--git-protocol", "https"],
      },
    },
  },
  {
    kind: "skill",
    id: "browser",
    name: "Agent Browser",
    category: "cli",
    cli: {
      binary: "agent-browser",
      install: {
        ...npmUserInstall(
          "agent-browser",
          `CHROMIUM=$(command -v chromium || command -v chromium-browser || true); if [ -n "$CHROMIUM" ]; then node -e '${USE_SYSTEM_CHROMIUM_SCRIPT}' "$CHROMIUM"; else "$HOME/.local/bin/agent-browser" install; fi`,
        ),
        description:
          "Install agent-browser into ~/.local and use the system Chromium, or download one when none is installed",
      },
    },
  },
  {
    kind: "skill",
    id: "orca",
    name: "Orca",
    category: "harness",
    configFields: [
      {
        key: "target",
        kind: "string",
        prompt:
          "Orca workstation SSH target (Tailscale MagicDNS host from `tailscale status` or user@host)",
        placeholder: "workstation.tailnet.ts.net",
      },
    ],
    connectionCheck: {
      kind: "command",
      command: [
        "ssh",
        "-o",
        "BatchMode=yes",
        "-o",
        "ConnectTimeout=5",
        "--",
        "{{target}}",
        'PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH" orca worktree list --json',
      ],
    },
    setupNote:
      "Keep either the Orca desktop app or `orca serve` running on your workstation, and ensure `tetherbox-agent` on the VM can SSH into it over Tailscale.",
  },
  {
    kind: "skill",
    id: "rex",
    name: "Rex",
    category: "harness",
    cli: {
      binary: "rex",
      install: {
        description: "Install the Rex remote client into ~/.local/bin",
        command: ["node", "--input-type=module", "-e", REX_INSTALL_SCRIPT],
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
    connectionCheck: {
      kind: "command",
      command: ["rex", "-S", "{{target}}", "ls", "--json"],
    },
  },
  {
    kind: "skill",
    id: "paseo",
    name: "Paseo",
    category: "harness",
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
    connectionCheck: {
      kind: "command",
      command: ["paseo", "--host", "{{host}}", "ls"],
    },
  },
  {
    kind: "skill",
    id: "opencode",
    name: "OpenCode",
    category: "harness",
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
    connectionCheck: {
      kind: "http",
      urlField: "serverUrl",
    },
    setupNote:
      "Keep `opencode serve` running on your workstation over Tailscale (for example via launchd on macOS or systemd --user on Linux) so Tetherbox can reach it.",
  },
  {
    kind: "skill",
    id: "claude",
    name: "Claude Code",
    category: "harness",
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
    name: "T3 Code",
    category: "harness",
    configFields: [
      {
        key: "endpointUrl",
        kind: "url",
        prompt: "T3 Code /mcp endpoint URL (from 'Use T3 Code in another app (MCP)')",
        placeholder: "https://<environment-host>/mcp",
      },
    ],
    connectionCheck: {
      kind: "http",
      urlField: "endpointUrl",
    },
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
    name: "Cursor",
    category: "harness",
    secrets: [proxySecret("CURSOR_API_KEY", ["api.cursor.com"])],
  },
  {
    kind: "module",
    id: "devin",
    name: "Devin",
    category: "harness",
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
    name: "Slack",
    category: "integration",
    secrets: [proxySecret("SLACK_BOT_TOKEN", ["slack.com"])],
  },
  {
    kind: "module",
    id: "gcal",
    name: "Google Calendar",
    category: "integration",
    oauthPreset: "gcal",
  },
  {
    kind: "module",
    id: "gdrive",
    name: "Google Drive",
    category: "integration",
    oauthPreset: "gdrive",
  },
  {
    kind: "module",
    id: "gmail",
    name: "Gmail",
    category: "integration",
    oauthPreset: "gmail",
  },
  {
    kind: "module",
    id: "sentry",
    name: "Sentry",
    category: "integration",
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
    connectionCheck: {
      kind: "http",
      urlField: "apiBaseUrl",
    },
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
    name: "Jira",
    category: "integration",
    configFields: [
      {
        key: "siteUrl",
        kind: "url",
        prompt: "Jira site URL",
        placeholder: "https://your-site.atlassian.net",
      },
    ],
    connectionCheck: {
      kind: "http",
      urlField: "siteUrl",
    },
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
    name: "Linear",
    category: "integration",
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
    name: "Notion",
    category: "integration",
    secrets: [proxySecret("NOTION_API_KEY", ["api.notion.com"])],
  },
] satisfies StarterInput[];

export const starters: readonly Starter[] = builtinStarters.map((starter) =>
  starterSchema.parse(starter),
);

const startersById = new Map<string, Starter>(starters.map((starter) => [starter.id, starter]));

export function getStarter(id: string): Starter | undefined {
  return startersById.get(id);
}
