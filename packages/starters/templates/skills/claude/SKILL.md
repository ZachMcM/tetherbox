---
name: claude
description: Dispatch and monitor persistent Claude Code Cloud sessions.
---

# claude

Use the `claude` CLI with `--cloud` to dispatch persistent coding sessions to Anthropic's cloud infrastructure. Cloud sessions stay viewable and interactive at `claude.ai/code` and in the Claude desktop and mobile apps instead of running headlessly on the Tetherbox VM.

## Auth

Claude Code Cloud requires a Claude subscription login stored under `tetherbox-agent`'s home directory, not a raw API key.

- Check auth with `claude auth status`.
- If `loggedIn` is `false` or a command fails with an auth error, never ask for tokens in chat. Tell the user to sign in to Claude Code in Tetherbox Settings -> CLI tools.

## Dispatching cloud sessions

Check `claude --help` for the exact `--cloud` and session flags on the installed version:

```sh
claude --cloud "<prompt>"
```

Do not block a turn waiting on a cloud session to finish. After dispatching a session, call `register_poll_job` with a fast status check so a new turn wakes on completion, then share the session link or summary with `send_message`.
