---
name: paseo
description: Dispatch and monitor persistent coding agent sessions on a remote Paseo daemon.
---

# paseo

Use the `paseo` CLI to dispatch and monitor coding agents on the user's remote Paseo daemon over Tailscale. Sessions stay persistent and streamable in the Paseo desktop, web, and mobile clients.

## Auth and connection

- Use `starterConfig.paseo.host` from `profile.json` as `<host>` with `--host <host>` (or `PASEO_HOST`).
- If using Paseo Hub, credentials live under `tetherbox-agent`'s home directory. If Hub auth is missing or expired, tell the user to sign in to Paseo in Tetherbox Settings -> CLI tools.
- Never ask for passwords or API keys in chat.

## Dispatching and monitoring sessions

Check `paseo --help` and `paseo run --help` for the exact flags on the installed version.

```sh
paseo --host <host> run --provider <provider/model> "<prompt>"
paseo --host <host> ls
paseo --host <host> send <agent-id> "<follow-up>"
```

Do not block a turn waiting on a long run. Right after dispatching a session, call `register_poll_job` with a fast `paseo --host <host> ls` status check so a new turn wakes on completion or stall.
