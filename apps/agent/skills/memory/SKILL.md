---
name: memory
description: How this profile's memory is laid out, and how to read, add to, and tidy it. Use before changing MEMORY.md or anything in memory/.
---

# Memory

Memory is plain markdown in this profile's git repository.

## Layout

- `MEMORY.md` is the index. It is loaded into every turn, so keep it short. It holds the few facts that matter on every turn (who the user is, standing preferences) and one line per top-level file or folder in `memory/` saying what is in it.
- `memory/<topic>.md` holds the detail for one topic.
- `memory/<topic>/` groups related files once a topic needs more than one. Give the folder an `INDEX.md` with one line per file, and point to it from `MEMORY.md`.

```
MEMORY.md
  - Prefers short, direct replies.
  - memory/projects/   → one file per active project (see INDEX.md)
  - memory/routines.md → standup format, weekly review steps

memory/projects/INDEX.md
  - billing-v2.md → migration status, contacts
```

## Reading

Read the index line first, then open only the files that matter for the current request. Use `grep` across `memory/` when you are not sure where something lives.

## Writing

- Update the existing file for a topic instead of adding a new one.
- When you add, rename, or delete a file, update the index line that points to it.
- Replace facts that changed instead of appending a contradiction.
- Commit memory changes with a message that says what changed.

## Consolidating

If the turn's prompt says `MEMORY.md` was cut, move detail out of it into `memory/` until only the always-relevant facts and the index lines are left. When a folder in `memory/` passes about five files without an `INDEX.md`, add one.
