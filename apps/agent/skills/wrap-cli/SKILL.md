---
name: wrap-cli
description: Wrap a mature CLI as a markdown skill invoked through bash.
---

# Wrapping a CLI as a skill

Use a CLI skill (`skills/<name>/SKILL.md`) when a tool has a clean headless CLI and its credentials can live in the agent user's home directory.

If credentials must stay hidden from the agent process behind the daemon's domain-pinned secret proxy, or if the service only exposes an HTTP API, write a TypeScript module instead (see the `write-module` skill).

## Inspect the CLI first

1. Confirm the binary is available on `PATH` with `command -v <bin>`. If it is missing and can be installed in user space (such as `npm install -g --prefix "$HOME/.local" <pkg>` or placing a binary in `~/.local/bin`, which is on `PATH`), install it yourself. Only ask the user to install it on the VM when the tool requires root or a system package.
2. Read `<bin> --help` and each subcommand's `--help` instead of guessing flags.
3. Prefer non-interactive and machine-readable flags (`--json`, `--format json`, `--yes`, `--no-input`, `--non-interactive`). Avoid commands that open a pager or editor; pass `--no-pager` or set `PAGER=cat` when needed.

## Authentication and connection boundaries

External CLIs manage their own auth state under the `tetherbox-agent` user's home directory, separate from the daemon's secret store.

- Never ask the user to paste tokens, API keys, cookies, or passwords in chat.
- Never store credentials in `SKILL.md`, `profile.json`, or memory.
- Document the CLI's non-interactive status check (such as `gh auth status` or `claude auth status`) in the skill and run it when commands fail with auth errors.
- When authentication is missing or expired, give the user the exact command to run on their laptop:
  - For built-in CLI starters (`gh`, `claude`, `paseo`): `tetherbox auth <starter>`
  - For any other wrapped CLI: `tetherbox auth exec -- <login command>`
- Some CLIs (such as Tailscale- or SSH-connected tools like `rex`, `paseo`, or `opencode`) have no login step and only need a remote host or URL. Ask the user for that non-secret host or URL once, store it in `profile.json` under `starterConfig.<name>` (not in `MEMORY.md`, which gets summarized), and reference that config key in `skills/<name>/SKILL.md`.

`tetherbox auth` runs the login interactively over SSH as `tetherbox-agent` with `HOME` set to the agent user's directory, so credentials land where future turns can use them.

## Skill layout

Write `skills/<name>/SKILL.md` with YAML frontmatter and short, verified command recipes:

```markdown
---
name: <name>
description: <one-line summary of when to use this CLI>
---

# <name>

## Auth

- Check: `<bin> auth status`
- Login if missing or expired: tell the user to run `tetherbox auth exec -- <bin> auth login`

## Common commands

- ...
```

Keep recipes short and verified against the installed version on the VM. Commit the new skill to the profile repository once it works.
