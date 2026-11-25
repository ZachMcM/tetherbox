---
name: git
description: Use git to commit profile changes, inspect how profile state changed over time, and revert broken edits.
---

# Git

This profile directory is a git repository initialized by the daemon. Every file that defines the profile (`profile.json`, `MEMORY.md`, `memory/`, `skills/`, `modules/`, `cron/`, `webhooks/`) is tracked here, so git history is the audit log of how the profile evolved.

## Committing profile changes

Commit after any meaningful edit to memory, skills, modules, cron jobs, webhooks, or `profile.json`:

1. Check `git status` and `git diff` before committing so no stray scratch files or secrets are included.
2. Stage only the files you intended to change (`git add <paths>`).
3. Write a short imperative commit message saying what changed (for example `Add weekly digest cron job` or `Update billing-v2 migration status`).
4. Run `validate_profile` before committing changes to `profile.json`, `cron/`, or `webhooks/`.

## Inspecting temporal state

Use git history when you need to know what changed, when a fact was updated, or what a file looked like before a recent edit:

- Recent profile changes: `git log -n 20 --oneline`
- History of a specific memory topic or module: `git log -p -n 5 -- memory/<topic>.md`
- Changes since a point in time: `git log --since="7 days ago" --stat`
- Compare two commits or inspect one commit: `git show <commit>`

Prefer git history over bloating `MEMORY.md` with changelogs or dated notes. Keep current truth in `MEMORY.md` and `memory/`, and rely on commits for the timeline.

## Rolling back mistakes

- Undo unstaged edits to a file: `git checkout -- <path>`
- Revert a committed change cleanly: `git revert --no-edit <commit>`
- Do not rewrite history with `git reset --hard` or force-pushes unless the user explicitly asks for it.

## Author identity

The daemon configures a repo-local `user.name` and `user.email` when creating the profile, so `git commit` works out of the box without global git config. Never commit secrets, tokens, or raw API credentials into any repository.
