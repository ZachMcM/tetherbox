#!/bin/sh
set -eu

install -d -o tetherbox -g tetherbox -m 0700 /var/lib/tetherbox
install -d -o tetherbox -g tetherbox -m 2775 /srv/tetherbox/profiles /srv/tetherbox/sessions
install -d -o tetherbox -g tetherbox -m 0750 /run/tetherbox
chown tetherbox-agent:tetherbox /home/tetherbox-agent

umask 0002
exec setpriv --reuid=tetherbox --regid=tetherbox --init-groups \
  env HOME=/var/lib/tetherbox node --watch apps/daemon/src/main.ts serve
