---
name: rex
description: Drive persistent terminal sessions and coding agents on a remote workstation through Rex over Tailscale.
---

# rex

Use the `rex` CLI to connect to the user's workstation Rex server over Tailscale or SSH and run coding agents (such as Claude Code, Codex, or OpenCode) or other processes in persistent tabs and panes that the user can open and take over in the Rex app.

## Discovering commands and server API

Run `rex __internal skill` first to read the full command guide for the installed `rex` version on the VM. Use `rex <command> --help` for flags on individual subcommands. Rex also exposes its server RPC API directly through the CLI:

```sh
rex -S <target> api list
rex -S <target> api describe <method>
rex -S <target> api call <method>
```

## Connecting to a remote machine

Pass `-S <target>` using `starterConfig.rex.target` from `profile.json`:

```sh
rex -S <target> ls --json
rex -S <target> new <session-name> -c <repo-path> --json
rex -S <target> window new <tab-name> -s <session-id> -c <repo-path> --json -- <command...>
rex -S <target> send -b <pane-id> "<command>" && rex -S <target> send-key -b <pane-id> enter
rex -S <target> capture -b <pane-id> --trim --unwrap
```

Pass `-- <command...>` to `new`, `window new`, `run`, or `split` to launch a process directly in a new pane. For interactive agents or dev servers the user may stop and restart, open a shell pane without `-- <command...>` and start the program with `send` and `send-key enter` so the shell prompt stays open if the process exits.

## Monitoring long runs

Launch coding agents inside a dedicated tab or pane on the workstation so the user can view or attach to the session at any time. Do not block a turn waiting for a coding run to finish. Call `register_poll_job` with a fast `rex -S <target> capture -b <pane-id> --trim` or `rex -S <target> block call -b <pane-id> process` check so a new turn wakes when the agent finishes or asks for input.
