---
name: orca
description: Dispatch and monitor persistent worktrees and coding agent sessions in Orca on a remote workstation over Tailscale SSH.
---

# orca

Use the `orca` CLI over SSH to drive the Orca runtime on the user's workstation. Sessions created through the runtime appear live in the Orca desktop app and mobile companion so the user can watch or take over at any time.

## Connecting to the workstation

Use `starterConfig.orca.target` from `profile.json` as `<target>` with `ssh <target>`.

Non-interactive SSH shells on macOS often miss Homebrew or user-local binary paths. If `ssh <target> orca --help` fails with command not found, prepend standard paths or resolve the binary once:

```sh
ssh <target> 'PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH" orca worktree list --json'
```

On Linux workstations outside an Orca-managed terminal, the binary may be named `orca-ide` instead of `orca`.

## Managing worktrees and sessions

Check `ssh <target> orca --help` and subcommand `--help` for exact flags on the installed version. Prefer `--json` output for structured inspection:

```sh
ssh <target> orca worktree list --json
ssh <target> orca worktree create --json
ssh <target> orca worktree show --worktree <selector> --json
ssh <target> orca worktree ps --json
ssh <target> orca terminal list --json
ssh <target> orca terminal close --worktree <selector> --all
```

If commands fail because no runtime is reachable, tell the user to keep either the Orca desktop app or `orca serve` running on their workstation.

## Monitoring long runs

Do not block a turn waiting on a coding session to finish. After starting work in an Orca worktree, call `register_poll_job` with a fast `ssh <target> orca worktree ps --json` check so a new turn wakes on completion or stall.
