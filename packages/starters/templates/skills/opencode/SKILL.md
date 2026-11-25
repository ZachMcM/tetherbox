---
name: opencode
description: Dispatch and monitor coding sessions on a remote OpenCode server over Tailscale.
---

# opencode

Use the `opencode` CLI to talk to a persistent `opencode serve` instance running on the user's workstation or dev box over Tailscale. That keeps code execution off the Tetherbox VM and lets the user run `opencode attach <serverUrl>` to watch or take over any session.

## Connecting to a remote server

Use `starterConfig.opencode.serverUrl` from `profile.json` as the remote server URL. `opencode serve` runs in the foreground by default and must be active on the user's workstation (for example under `launchd` on macOS or `systemd --user` on Linux); if connection fails, tell the user to start `opencode serve` on their machine. Check `opencode --help` and `opencode run --help` on the installed version to verify the exact remote server flags (`--attach` or server URL options).

## Monitoring long runs

Do not block a turn waiting on a coding session to finish. Dispatch the task against the remote OpenCode server and immediately call `register_poll_job` with a fast status check against that server so a new turn wakes when the session completes or stalls.
