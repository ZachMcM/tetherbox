FROM node:24-bookworm

RUN apt-get update \
  && apt-get install -y --no-install-recommends chromium sudo \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable

RUN groupadd --system tetherbox \
  && useradd --system --gid tetherbox --home-dir /var/lib/tetherbox --shell /usr/sbin/nologin tetherbox \
  && useradd --create-home --gid tetherbox --shell /bin/bash tetherbox-agent \
  && git config --system safe.directory '*'

COPY docker/dev/sudoers /etc/sudoers.d/tetherbox
RUN chmod 0440 /etc/sudoers.d/tetherbox

COPY docker/dev/entrypoint.sh /usr/local/bin/tetherbox-dev-entrypoint

WORKDIR /workspace
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/agent/package.json apps/agent/
COPY apps/daemon/package.json apps/daemon/
COPY packages/core/package.json packages/core/
COPY packages/starters/package.json packages/starters/
RUN pnpm install --frozen-lockfile

COPY packages/core packages/core
COPY packages/starters packages/starters
RUN pnpm --filter @tetherbox/core --filter @tetherbox/starters build

ENTRYPOINT ["tetherbox-dev-entrypoint"]
