---
name: write-module
description: Write a TypeScript module for this profile against the Tetherbox module contract.
---

# Writing a TypeScript module

Write a module at `modules/<name>/index.ts` when integrating an HTTP API, when credentials must stay hidden from the agent behind the daemon's domain-pinned secret proxy, or when you need typed tools instead of shell commands.

## Runtime rules

- Each module lives at `modules/<name>/index.ts`, where `<name>` is a lowercase slug.
- Modules load with Node's built-in type stripping outside any npm package.
- Only use `import type` from `@tetherbox/core`. Do not add runtime npm imports; use Node built-ins and `ModuleContext` instead.
- Tool names are registered as `<module.name>_<tool.name>`.
- New or edited modules take effect on the next turn after this turn ends.

## Module shape

```ts
import type { TetherboxModule } from "@tetherbox/core";

const SECRET_KEY = "EXAMPLE_API_KEY";

export default {
  name: "example",
  description: "Read and update Example resources.",
  requiredSecrets: [SECRET_KEY],
  tools: [
    {
      name: "list_items",
      description: "List items from Example.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number" },
        },
        additionalProperties: false,
      },
      async execute(params, ctx) {
        if (!(await ctx.hasSecret(SECRET_KEY))) {
          return {
            kind: "text",
            text: `Missing ${SECRET_KEY}. Call request_auth to ask the user for it, pinned to api.example.com.`,
          };
        }

        const { limit = 20 } = (params ?? {}) as { limit?: number };
        const response = await ctx.fetchWithSecret(
          SECRET_KEY,
          `https://api.example.com/v1/items?limit=${encodeURIComponent(String(limit))}`,
        );

        if (!response.ok) {
          throw new Error(`Example API returned ${response.status}: ${await response.text()}`);
        }

        return { kind: "json", value: await response.json() };
      },
    },
  ],
} satisfies TetherboxModule;
```

`execute(params, ctx)` returns either `{ kind: "text", text: string }` or `{ kind: "json", value: unknown }`.

## Auth and secrets

Secrets never enter the agent process. The daemon injects them on the Unix socket proxy only when the target host matches the secret's pinned domains.

1. Call `check_secret` with the secret key before relying on it.
2. Confirm both that the secret exists and that its binding kind is `proxy` or `oauth` (not `daemon` or `llm`).
3. If it is missing or has the wrong binding kind, never ask for the value in chat. Call `request_auth` and end your turn:
   - API keys or tokens: kind `value` with the exact key name and a `proxy` binding giving the pinned API hostname (`api.host`) and injection mode (`bearer`, `header` `<Header-Name>`, or `query` `<param>`).
   - Built-in OAuth2 preset (`gcal`, `gdrive`, `gmail`): kind `oauth` with the preset id.
   - Custom OAuth2 provider: `request_auth` cannot set these up. Tell the user to add it in Tetherbox Settings -> Integrations -> Add custom, with the exact secret key, auth/token URLs, pinned API hostname, and scopes.
4. Pin the narrowest API hostname needed (for example `api.linear.app`, not `linear.app`).
5. Inside tool handlers, call `ctx.fetchWithSecret(key, "https://<api.host>/...", init)` with an `https://` URL. Do not pass the secret manually in headers or query strings.

## Manifest

Write `modules/<name>/starter.json` next to `index.ts`. It describes what the module needs so other profiles can enable it from the web app. Do not include `id` or `kind`; the directory path sets both.

```json
{
  "name": "Example",
  "category": "integration",
  "secrets": [
    {
      "kind": "fixed",
      "key": "EXAMPLE_API_KEY",
      "binding": {
        "kind": "proxy",
        "domains": ["api.example.com"],
        "inject": { "kind": "bearer" }
      }
    }
  ]
}
```

- `category` is `integration`, `harness`, or `cli`.
- List every secret the module reads. `inject` is `{ "kind": "bearer" }`, `{ "kind": "header", "name": "<Header-Name>" }`, or `{ "kind": "query", "name": "<param>" }`.
- Use `"oauthPreset": "gcal" | "gdrive" | "gmail"` instead of a secret for a built-in OAuth preset.
- When the user picks the API host (a self-hosted instance, for example), declare it as a config field and use a `prompt-domain` secret that reads its domain from that field:

```json
{
  "name": "Example",
  "category": "integration",
  "configFields": [
    {
      "key": "baseUrl",
      "kind": "url",
      "prompt": "Example base URL",
      "placeholder": "https://example.com"
    }
  ],
  "secrets": [
    {
      "kind": "prompt-domain",
      "key": "EXAMPLE_TOKEN",
      "inject": { "kind": "bearer" },
      "domainPrompt": "Hostname for your Example instance",
      "domainPlaceholder": "example.com",
      "fromConfigUrl": { "starterId": "<name>", "key": "baseUrl" }
    }
  ]
}
```

- Add `"setupNote"` for any manual step the user must do outside Tetherbox.

## Validate before finishing

1. Verify the module parses cleanly under Node (for example `node --input-type=module -e 'import("./modules/<name>/index.ts")'`).
2. Run `validate_profile` and fix any reported issues, including ones in `starter.json`.
3. Commit the module and its manifest in the profile repository.
