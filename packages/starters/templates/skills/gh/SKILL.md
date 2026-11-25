---
name: gh
description: Use the GitHub CLI for issues, pull requests, and checks.
---

# gh

Use `gh` through bash for GitHub repositories, issues, pull requests, and CI checks.

## Auth

`gh` stores its own credentials in the `tetherbox-agent` user's home directory, not in the daemon's secret store.

- Check auth with `gh auth status`.
- If `gh` is not logged in, a token expired, or scopes are missing, never ask for a GitHub token in chat. Tell the user to run `tetherbox auth gh` on their laptop.
- For GitHub Enterprise hosts, tell the user to run `tetherbox auth gh -- --hostname <host>`.
- If `gh` is not installed on the VM, tell the user to install `gh` and then run `tetherbox auth gh`.

## Common commands

Prefer `--json` and explicit flags so commands never prompt or open an interactive editor:

- Issues: `gh issue list --json number,title,state,labels,url --limit 30` and `gh issue view <num> --json number,title,body,comments,state`
- Pull requests: `gh pr list --json number,title,headRefName,state,url` and `gh pr view <num> --json number,title,body,reviews,statusCheckRollup,mergeStateStatus`
- Checks: `gh pr checks <num>` and `gh run view <run-id> --log-failed`
- Creating PRs: `gh pr create --title "<title>" --body "<body>"` (never omit `--title` and `--body`)
- Raw API: `gh api repos/<owner>/<repo>/...`

When waiting on CI runs or long-running checks, register a poll job with `register_poll_job` instead of sleeping in bash.
