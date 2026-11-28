# Tetherbox

Tetherbox is a self-hosted personal assistant for engineers. It runs on a user's Linux VM and runs each turn in a Pi SDK session with Code Mode enabled.

## Layout

| Path                | What it is                                                                                                                                               |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/daemon`       | Always-on service. Owns secrets, SQLite session state, the internal, app, and public Hono servers, cron, the background poller, and spawning agent runs. |
| `apps/agent`        | Pi SDK runner. The daemon spawns one process per turn as an unprivileged OS user. Ships the built-in tools and skills.                                   |
| `apps/web`          | Vite + React SPA using TanStack Router, TanStack Query, `@tetherbox/ui`, and `@tetherbox/core/app`. Served by the daemon over Tailscale Serve.           |
| `apps/cli`          | `tetherbox` CLI that runs on the user's machine and drives the VM over an SSH alias.                                                                     |
| `packages/core`     | Shared zod schemas, branded ids, the TS module contract, and the typed internal and app RPC APIs and clients.                                            |
| `packages/ui`       | Shared shadcn/ui (`base-nova`) component library and Tailwind v4 theme tokens used by `apps/web`.                                                        |
| `packages/starters` | Opt-in skills and TS modules copied into a profile when enabled. They use the same format as agent-written ones.                                         |

## Process model and trust boundaries

- The daemon runs as the `tetherbox` OS user and is the only process that can read secrets, OAuth tokens, or provider credentials.
- Agent runs get their input as JSON on stdin and stream newline-delimited `TurnStreamEvent` JSON lines on stdout. Nothing secret goes through their environment.
- Agent runs reach the daemon only through the internal Unix socket, authenticated by a per-run token. `createInternalApi` in `packages/core` defines those routes, and the daemon supplies the handlers.
- Secrets leave the daemon only through the secret proxy (`/proxy/<host>/...`), which injects a secret when the target host is one of its pinned domains. LLM calls go through `/llm/<provider>/...` the same way, using either an API key or an OAuth login that the daemon refreshes (configured in the web app). For OAuth, the agent gets only a placeholder token shaped like the real one.
- The app server listens on localhost (`TETHERBOX_APP_PORT`, default 8788), is exposed privately through Tailscale Serve, and requires the daemon's `app-token` (bearer header or `HttpOnly` cookie) on `/api/*` so unprivileged local users such as `tetherbox-agent` cannot call admin routes over loopback.
- The public server listens on localhost and is exposed through Tailscale Funnel. Treat every route on it as internet-facing.
- The daemon never imports or runs code from a profile. Profile modules load only inside agent runs.

## Profiles

A profile is a git-backed directory under the profiles root. Sessions are grouped under their profile, backed by Pi `.jsonl` files and indexed in SQLite. Files are the source of truth for profile config, and `profileLayout` in `packages/core` names them:

```
profile.json                 enabled starters and their config
MEMORY.md                    memory index, loaded into every turn (capped at 8 KB)
memory/                      topic files; folders get an INDEX.md
skills/<name>/SKILL.md
skills/<name>/starter.json   CLI install, login, and config the skill needs
modules/<name>/index.ts
modules/<name>/starter.json  secrets, OAuth preset, and config the module needs
cron/<name>.json             schedule and prompt
webhooks/<name>.json         prompt and verification, served at /hooks/<profileId>/<name>
```

Agent-written skills and modules need a `starter.json`. Copies of enabled starters do not.

The daemon validates these files with the schemas in `packages/core` at startup and reloads a profile after each of its runs exits. Files hold what the agent reads or edits and what a user would want versioned. A profile's name, model override, and buddy live in the `profiles` table in the daemon's SQLite, keyed by the profile directory name, because only the daemon and the web app use them. The daemon creates missing rows and deletes orphaned ones each time it loads profiles. Short-lived runtime state (sessions, poll jobs, reminders, push subscriptions) also lives in SQLite in the daemon's data dir. Profile modules run under Node's type stripping outside any package, so they may only `import type` from `@tetherbox/core` and get everything else from `ModuleContext`.

## Built-in vs starters

Every profile gets the agent's built-in tools (`notify`, `web_fetch`, `check_secret`, `fetch_with_secret`, `validate_profile`, `request_auth`, and the poll-job and reminder tools) and the built-in skills in `apps/agent/skills/` (memory, cron and webhook files, writing modules, wrapping CLIs, reverse-engineering APIs). They describe the Tetherbox contract and change with the runtime, so they are never copied into profiles.

`packages/starters` holds opt-in, profile-specific skills and modules (CLIs, coding harnesses, integrations). Enabling one copies it into the profile so the agent can patch it.

The starter library is a git repo at `<dataDir>/library` with the same `skills/` and `modules/` layout. After each run, the daemon copies every agent-written skill or module with a valid `starter.json` from that profile into the library, skipping copies the profile has not changed since it last synced or received them. The starter picker lists built-in and library starters together, and enabling a library starter copies it into the profile. A profile whose copy is unchanged while the library has moved on shows an update in its settings. Removing a starter from the library leaves existing copies alone, and it returns only if a profile changes its copy. Library sync state lives in `<dataDir>/library-sync.json`.

## Commands

```sh
pnpm install
pnpm typecheck     # tsc across the monorepo
pnpm build         # tsdown across the monorepo
pnpm lint          # oxlint
pnpm format        # oxfmt
pnpm dev           # daemon container and Vite dev server together
pnpm dev:daemon    # daemon and agent runs in a Linux container (docker/dev)
pnpm dev:web       # Vite dev server, proxied to the container
```

CI runs `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, and `pnpm build`. There is no test suite yet.

Internal imports use `.ts` extensions so `node src/main.ts` runs without a build step. Packages that other workspaces import (`core`, `starters`) build to `dist/`, and turbo builds them before dependents typecheck.

## Engineering principles

- Keep the core runtime small: sessions and live event streaming, the secret proxy, OAuth, webhooks, cron, reminders, and the poller. Integrations and harnesses belong in starters.
- Validate input once at the boundary with zod, then pass typed values inward.
- Model variants as discriminated unions instead of objects full of optional fields.
- Prefer a CLI skill over an SDK dependency when a tool has a clean headless CLI.
- Make small, focused changes with clear names over clever abstractions.
- Apply the `typescript-best-practices` skill from pstack when reading or editing `.ts` files.

## Docs and comments

- Docs explain and instruct. Do not use them to log decisions, history, or rationale.
- Skip code comments unless the reader needs outside knowledge the code cannot show. Rewrite unclear code instead of explaining it.
- `TODO:` comments mark stubbed behavior. Remove the TODO when the behavior lands.
