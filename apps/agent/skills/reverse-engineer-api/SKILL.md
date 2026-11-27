---
name: reverse-engineer-api
description: Reverse-engineer an HTTP API and call it through the secret proxy.
---

# Reverse-engineering an HTTP API

Use this workflow when a service has no starter or CLI and you need to inspect its HTTP API before encoding it as a profile module.

## Set up the secret safely

Never ask the user to paste an API key, bearer token, session cookie, or password in chat, and never put credentials into `curl` commands or files.

1. Identify the API hostname and auth scheme (Bearer token, custom header, or query parameter) from documentation, OpenAPI specs, or unauthenticated `401`/`403` error responses.
2. Call `check_secret` for the secret key you plan to use and confirm it is set with binding kind `proxy`.
3. If it is missing or has the wrong binding kind, call `request_auth` with kind `value`, the exact key name, a `proxy` binding pinned to the API hostnames, and the injection mode (`bearer`, a `header` such as `X-Api-Key` or `Cookie`, or a `query` parameter such as `api_key`). End your turn and continue when the user confirms.
4. Pin only the narrowest hostname required (for example `api.example.com`, not `example.com`).

## Probe through the secret proxy

Use the built-in `fetch_with_secret` tool to send authenticated HTTPS requests through the daemon's secret proxy without ever seeing the raw credential:

- Start with safe read-only `GET` endpoints (such as `/me`, `/viewer`, or a list endpoint with a small `limit`) before testing mutations.
- If the proxy returns `403` saying the secret is not pinned to that host or is not bound for proxy use, call `request_auth` again with the exact required hostname and injection mode.
- Inspect status codes, pagination cursors, rate-limit headers, and error payload shapes.
- Remember the proxy does not follow redirects automatically (`redirect: "manual"`), so check `3xx` `location` headers if an endpoint redirects to another host.
- Never copy response fields that contain tokens or session cookies into memory or files.

## Turn findings into a module

Once the endpoints, parameters, and response shapes are verified, move them into `modules/<name>/index.ts` calling `ctx.fetchWithSecret` as documented in the `write-module` skill, validate with `validate_profile`, and commit the module.
