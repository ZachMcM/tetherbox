---
name: profile-jobs
description: Add, change, or remove scheduled jobs (cron/) and incoming webhooks (webhooks/) for this profile.
---

# Cron jobs and webhooks

Cron jobs and webhooks are JSON files in this profile. The daemon reads and validates them when this turn ends, then schedules the cron jobs and starts accepting the webhooks. After editing any of them, run `validate_profile` and fix what it reports before you finish the turn.

File names are lowercase slugs (`daily-digest.json`), and the name becomes the job or webhook name.

## Cron: `cron/<name>.json`

```json
{
  "schedule": "0 9 * * 1-5",
  "timezone": "America/New_York",
  "prompt": "Summarize yesterday's merged PRs and call notify if anything needs attention."
}
```

`schedule` is a five-field cron expression. `timezone` is optional and defaults to the VM's timezone. `sessionId` is optional; when omitted, each run starts a fresh session under this profile. When set to an existing session ID (such as the active `sessionId` from the prompt), runs append to that session instead. When the job fires, a new turn starts with `prompt`.

## Webhooks: `webhooks/<name>.json`

```json
{
  "prompt": "A GitHub event arrived. Summarize anything that needs my attention and call notify if urgent.",
  "verify": {
    "kind": "hmac-sha256",
    "secretKey": "GITHUB_WEBHOOK_SECRET",
    "header": "x-hub-signature-256"
  }
}
```

The webhook is served at `/hooks/<profile id>/<name>` on the daemon's public URL. Each delivery starts a new session under this profile with `prompt` and the request body.

`verify` is required:

- `hmac-sha256` checks the named header against an HMAC of the body. Use `check_secret` to confirm `secretKey` is set, and if it isn't, call `request_auth` with kind `value` and a `daemon` binding.
- `{ "kind": "public" }` accepts any request. The URL is reachable from the internet, so use it only when the user asks for it and the sender cannot sign requests.

## Removing

Delete the file. The job stops, or the webhook returns 404, once this turn ends.

## Not for one-off follow-ups

To act when something you started finishes (a coding agent session, a CI run), use `register_poll_job` instead of a cron job.
