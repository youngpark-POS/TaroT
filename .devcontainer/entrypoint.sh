#!/bin/sh
set -eu

# Named volumes are created as root. Hand only the dependency mount points to
# the unprivileged development user before running the container command.
for directory in \
  /pnpm/store \
  /workspace/node_modules \
  /workspace/apps/api/node_modules \
  /workspace/apps/web/node_modules \
  /workspace/apps/worker/node_modules \
  /workspace/packages/agents/node_modules \
  /workspace/packages/content/node_modules \
  /workspace/packages/contracts/node_modules \
  /workspace/packages/database/node_modules \
  /workspace/packages/domain/node_modules \
  /workspace/packages/runtime/node_modules
do
  mkdir -p "$directory"
  chown node:node "$directory"
done

export HOME=/home/node
export USER=node
export LOGNAME=node

exec setpriv --reuid=node --regid=node --init-groups "$@"
