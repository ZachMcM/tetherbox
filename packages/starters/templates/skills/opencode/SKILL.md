---
name: opencode
description: Dispatch and monitor OpenCode sessions headlessly.
---

# opencode

Use the `opencode` CLI to run headless coding sessions on the VM.

## Auth

OpenCode stores its provider credentials in the `tetherbox-agent` user's home directory, not in the daemon's secret store.

- Check configured accounts with `opencode auth list`.
- If the needed provider is missing or expired, never ask for API keys or tokens in chat. Tell the user to run `tetherbox auth opencode` on their laptop.
- If `opencode` is not installed on the VM, tell the user to install OpenCode and then run `tetherbox auth opencode`.

## Headless dispatch

Run non-interactive tasks with `opencode run` (check `opencode run --help` for model, session, and JSON output flags on the installed version).

## Monitoring long runs

Do not block a turn waiting on a long OpenCode session. Start the run in the background capturing logs and exit status, then call `register_poll_job` right away with a status-check command so a new turn wakes when the session finishes or stalls.
