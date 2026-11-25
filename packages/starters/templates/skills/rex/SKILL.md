---
name: rex
description: Drive persistent terminal sessions and coding agents on a remote workstation through Rex over Tailscale.
---

# rex

Use the `rex` CLI to connect to the user's workstation Rex server over Tailscale or SSH and run coding agents (such as Claude Code, Codex, or OpenCode) in persistent tabs and panes that the user can open and take over in the Rex app.

## Discovering commands and server API

Run `rex __internal skill` or `rex --help` against the installed version on the VM to confirm exact subcommands and flags. Rex also exposes its server RPC API directly through the CLI:

```sh
rex -S <target> api list
rex -S <target> api describe <method>
rex -S <target> api call <method>
```

## Connecting to a remote machine

Use `starterConfig.rex.target` from `profile.json` as `<target>`:

```sh
rex -S <target> ls
rex -S <target> new --cwd <repo-path>
rex -S <target> send <pane-id> "<command>"
rex -S <target> capture <pane-id>
```

## Monitoring long runs

Launch coding agents inside a dedicated tab or pane on the workstation so the user can view or attach to the session at any time. Do not block a turn waiting for a coding run to finish. Call `register_poll_job` with a fast `rex -S <target> capture <pane-id>` or status check so a new turn wakes when the agent finishes or asks for input.
