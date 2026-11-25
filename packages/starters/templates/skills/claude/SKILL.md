---
name: claude
description: Dispatch and monitor Claude Code sessions headlessly.
---

# claude

Use the `claude` CLI to run headless coding sessions on repositories on the VM.

## Auth

Claude Code manages its own login in the `tetherbox-agent` user's home directory, not in the daemon's secret store.

- Check auth with `claude auth status`.
- If `loggedIn` is `false` or a session fails with an authentication error, never ask for credentials or tokens in chat. Tell the user to run `tetherbox auth claude` on their laptop.
- For Anthropic Console API billing instead of a Claude subscription, tell the user to run `tetherbox auth claude -- --console`.
- If `claude` is not installed on the VM, tell the user to install Claude Code and then run `tetherbox auth claude`.

## Headless dispatch

Run non-interactive sessions with `-p` and structured streaming output:

```sh
claude -p "<prompt>" --output-format stream-json --verbose
```

To continue an existing session:

```sh
claude -p "<follow-up prompt>" --resume "<session-id>" --output-format stream-json --verbose
```

Check `claude --help` for permission or workspace flags needed by the task (such as working directory and allowed tools).

## Monitoring long runs

Do not block a turn waiting on a long Claude Code run. Launch the session in the background writing its output and exit status to a log file, then immediately call `register_poll_job` with a fast status-check command that inspects whether the process finished or produced new output. When the poll job triggers on completion or stall, summarize the result and send it with `send_message`.
