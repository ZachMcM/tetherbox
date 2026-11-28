# tetherbox

Lean, self-hosted personal agent control plane for engineers. Code Mode by default, profile-isolated Pi sessions, webhooks, cron, and remote coding-harness dispatch.

## Development

Requires Node 24 and pnpm.

```sh
pnpm install
pnpm typecheck
pnpm build
```

### Running locally

Run the daemon in Docker to test the VM's Linux user permissions locally. The daemon runs as `tetherbox` and starts agent processes as `tetherbox-agent`. CLI installs go into the agent user's home. The container mounts runtime source and skill files read-only. Editing daemon source on the host restarts the daemon.

```sh
pnpm dev:daemon    # build and start the daemon container on 127.0.0.1:8788 (app) and :8787 (public)
pnpm dev:web       # in another terminal: Vite on http://localhost:5173, proxied to the container
pnpm dev:token     # print the app token for the login screen
```

Set `TETHERBOX_DEV_APP_PORT` or `TETHERBOX_DEV_PUBLIC_PORT` to publish the container on other host ports, and point Vite at the app port with `VITE_API_TARGET`. Daemon state, profiles, and the agent user's home live in Docker volumes. Running `docker compose -f docker/dev/compose.yaml down -v` resets them.

Run `pnpm dev:daemon` again after changing dependencies or source in `core` or `starters` to rebuild the image.

See [AGENTS.md](AGENTS.md) for the repo layout and architecture.
