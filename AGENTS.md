# Tetherbox

Tetherbox is a self-hosted personal assistant for engineers. It runs on a user's Linux VM, talks to users through Slack, and runs each turn in a Pi SDK session with Code Mode enabled.

## Layout

| Path                | What it is                                                                                                                          |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `apps/daemon`       | Always-on service. Owns secrets, Slack, the public and internal Hono servers, cron, the background poller, and spawning agent runs. |
| `apps/agent`        | Pi SDK runner. The daemon spawns one process per turn as an unprivileged OS user. Ships the built-in tools and skills.              |
| `apps/cli`          | `tetherbox` CLI that runs on the user's machine and drives the VM over an SSH alias.                                                |
| `packages/core`     | Shared zod schemas, branded ids, the TS module contract, and the typed Unix socket RPC app and client.                              |
| `packages/starters` | Opt-in skills and TS modules copied into a profile when enabled. They use the same format as agent-written ones.                    |

## Process model and trust boundaries

- The daemon runs as the `tetherbox` OS user and is the only process that can read secrets, OAuth tokens, or provider credentials.
- Agent runs get their input as JSON on stdin and print one `TurnResult` JSON document on stdout. Nothing secret goes through their environment.
- Agent runs reach the daemon only through the internal Unix socket, authenticated by a per-run token. `createInternalApi` in `packages/core` defines those routes, and the daemon supplies the handlers.
- Secrets leave the daemon only through the secret proxy (`/proxy/<host>/...`), which injects a secret when the target host is one of its pinned domains. LLM calls go through `/llm/<provider>/...` the same way, using either an API key or an OAuth login that the daemon refreshes (both set with `tetherbox llm login`). For OAuth, the agent gets only a placeholder token shaped like the real one.
- The public server listens on localhost and is exposed through Tailscale Funnel. Treat every route on it as internet-facing.
- The daemon never imports or runs code from a profile. Profile modules load only inside agent runs.

## Profiles

A profile is a git-backed directory under the profiles root, mapped 1:1 to a Slack channel or DM. Files are the source of truth, and `profileLayout` in `packages/core` names them:

```
profile.json          name, Slack channel, model, enabled starters
MEMORY.md             memory index, loaded into every turn (capped at 8 KB)
memory/               topic files; folders get an INDEX.md
skills/<name>/SKILL.md
modules/<name>/index.ts
cron/<name>.json      schedule and prompt
webhooks/<name>.json  prompt and verification, served at /hooks/<profileId>/<name>
```

The daemon validates these files with the schemas in `packages/core` at startup and reloads a profile after each of its runs exits. Files hold what a user would want versioned. Short-lived runtime state, such as poll jobs, goes through RPC and lives in the daemon's data dir. Profile modules run under Node's type stripping outside any package, so they may only `import type` from `@tetherbox/core` and get everything else from `ModuleContext`.

## Built-in vs starters

Every profile gets the agent's built-in tools (`send_message`, `add_reaction`, `check_secret`, `fetch_with_secret`, `validate_profile`, and the poll-job tools) and the built-in skills in `apps/agent/skills/` (memory, cron and webhook files, writing modules, wrapping CLIs, reverse-engineering APIs). They describe the Tetherbox contract and change with the runtime, so they are never copied into profiles.

`packages/starters` holds opt-in, profile-specific skills and modules (CLIs, coding harnesses, integrations). Enabling one copies it into the profile so the agent can patch it.

## Commands

```sh
pnpm install
pnpm typecheck     # tsc across the monorepo
pnpm build         # tsdown across the monorepo
pnpm lint          # oxlint
pnpm format        # oxfmt
```

CI runs `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, and `pnpm build`. There is no test suite yet.

Internal imports use `.ts` extensions so `node src/main.ts` runs without a build step. Packages that other workspaces import (`core`, `starters`) build to `dist/`, and turbo builds them before dependents typecheck.

## Engineering principles

- Keep the core runtime small: Slack transport, reply and fallback handling, the secret proxy, OAuth, webhooks, cron, and the poller. Integrations and harnesses belong in starters.
- Validate input once at the boundary with zod, then pass typed values inward.
- Model variants as discriminated unions instead of objects full of optional fields.
- Prefer a CLI skill over an SDK dependency when a tool has a clean headless CLI.
- Make small, focused changes with clear names over clever abstractions.
- Apply the `typescript-best-practices` skill from pstack when reading or editing `.ts` files.

## Docs and comments

- Docs explain and instruct. Do not use them to log decisions, history, or rationale.
- Skip code comments unless the reader needs outside knowledge the code cannot show. Rewrite unclear code instead of explaining it.
- `TODO:` comments mark stubbed behavior. Remove the TODO when the behavior lands.
