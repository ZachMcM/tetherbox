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
pnpm dev           # start the daemon container and Vite together
pnpm dev:token     # in another terminal, print the app token for the login screen
```

Open http://localhost:5173. Vite proxies API requests to the daemon on port 8788. Public routes use port 8787. To run the services separately, use `pnpm dev:daemon` and `pnpm dev:web`.

Set `TETHERBOX_DEV_APP_PORT` or `TETHERBOX_DEV_PUBLIC_PORT` to publish the container on other host ports (`pnpm dev` forwards `TETHERBOX_DEV_APP_PORT` to Vite automatically; set `VITE_API_TARGET` when running `pnpm dev:web` separately). Daemon state, profiles, and the agent user's home live in Docker volumes. Running `docker compose -f docker/dev/compose.yaml down -v` resets them.

After changing dependencies or source in `core` or `starters`, restart `pnpm dev` to rebuild the daemon image.

See [AGENTS.md](AGENTS.md) for the repo layout and architecture.
