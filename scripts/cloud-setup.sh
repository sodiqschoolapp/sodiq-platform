#!/usr/bin/env bash
# Setup script of the Claude Code cloud environment for this repository.
#
# It is pasted into the environment's "Setup script" field at claude.ai/code
# (docs/cloud-loop.md says where). The copy there must equal this file.
# It runs as root on the fresh VM before Claude starts, and its result is
# cached for about a week, so it only prepares the machine: Node 24, the
# PostgreSQL 18 image, and a warm pnpm store. What belongs to the clone of
# the repository (install, database, migrations) is done at every session
# start by scripts/cloud-session-start.sh.
#
# Keep it under five minutes, or the result is not cached (docs: cloud
# environments, setup scripts).
set -euo pipefail

echo "== Node 24"
# The VM has Node 20, 21 and 22. The npm package "node" carries the official
# binaries and comes from the npm registry, which the default network list
# allows; nodejs.org itself is not on that list.
npm install -g --prefix /opt/node24 node@24
ln -sfn /opt/node24/bin/node /usr/local/bin/node
echo 'export PATH=/opt/node24/bin:$PATH' > /etc/profile.d/node24.sh
export PATH=/opt/node24/bin:$PATH
node --version

echo "== PostgreSQL 18 image (pulled now so it is in the cache)"
(service docker start || true) >/dev/null 2>&1
docker pull postgres:18 &
PULL=$!

echo "== Warm the pnpm store with the dependencies of main"
# pnpm reads "packageManager" from package.json and switches to that version
# by itself. The clone is thrown away; only the store is kept.
rm -rf /opt/warm
git clone --depth 1 https://github.com/sodiqschoolapp/sodiq-platform /opt/warm
(cd /opt/warm && pnpm install --frozen-lockfile) || echo "warm-up failed; the session start installs instead"
rm -rf /opt/warm

wait "$PULL"
docker image ls postgres:18
echo "== Setup done"
