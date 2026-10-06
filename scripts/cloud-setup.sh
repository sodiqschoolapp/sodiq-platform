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
# Known from the first runs: the machine has no GitHub credentials while this
# script runs (no git clone here), and Docker's daemon needs a few seconds
# after it is started. The script never aborts: a step that fails says so and
# the session still starts, so that the first session can report what the
# machine looks like (docs/cloud-loop.md, The trial). Keep it under five
# minutes, or the result is not cached.
set -uo pipefail

step() { echo; echo "== $*"; }
failed() { echo "!! $* failed"; }

step "machine"
echo "cwd=$(pwd)"
echo "PATH=$PATH"
echo "node on PATH: $(command -v node || echo none) $(node --version 2>/dev/null || true)"
echo "pnpm on PATH: $(command -v pnpm || echo none) $(pnpm --version 2>/dev/null || true)"
ls -d /opt/node* 2>/dev/null || true

step "Node 24"
# The VM has Node 20, 21 and 22 under /opt. The npm package "node" carries the
# official binary and comes from the npm registry, which the default network
# list allows (this worked on the first run). nodejs.org is the fallback.
install_node24_npm() { npm install -g --prefix /opt/node24 node@24 >/dev/null 2>&1; }
install_node24_dist() {
  local version
  version=$(curl -fsSL https://nodejs.org/dist/index.json \
    | python3 -c 'import json,sys; print(next(v["version"] for v in json.load(sys.stdin) if v["version"].startswith("v24.")))') || return 1
  curl -fsSL "https://nodejs.org/dist/$version/node-$version-linux-x64.tar.xz" -o /tmp/node24.tar.xz || return 1
  rm -rf /opt/node24 "/opt/node-$version-linux-x64"
  tar -xJf /tmp/node24.tar.xz -C /opt || return 1
  ln -sfn "/opt/node-$version-linux-x64" /opt/node24
  rm -f /tmp/node24.tar.xz
}
if install_node24_npm; then
  echo "installed from the npm registry"
elif install_node24_dist; then
  echo "installed from nodejs.org"
else
  failed "Node 24 install"
fi
if [ -x /opt/node24/bin/node ]; then
  echo "/opt/node24/bin/node is $(/opt/node24/bin/node --version)"
  echo 'export PATH=/opt/node24/bin:$PATH' > /etc/profile.d/node24.sh
  ln -sfn /opt/node24/bin/node /usr/local/bin/node
  export PATH=/opt/node24/bin:$PATH
else
  failed "no /opt/node24/bin/node"
fi

step "Docker daemon"
(service docker start || true) >/dev/null 2>&1
for _ in $(seq 1 30); do
  if docker info >/dev/null 2>&1; then break; fi
  sleep 1
done
if docker info >/dev/null 2>&1; then
  echo "docker is running"
  step "PostgreSQL 18 image (pulled now so it is in the cache)"
  docker pull postgres:18 >/dev/null 2>&1 && docker image ls postgres:18 || failed "docker pull postgres:18"
else
  failed "docker daemon did not start (the session start tries again)"
fi

step "warm the pnpm store"
# The repository is cloned before this script runs. If this is its directory,
# install once so the pnpm store is in the cache; the session start installs
# again, fast. pnpm reads "packageManager" from package.json and switches to
# that version by itself.
if [ -f pnpm-lock.yaml ]; then
  pnpm install --frozen-lockfile >/dev/null 2>&1 && echo "store warmed" || failed "pnpm install (the session start installs instead)"
else
  echo "not in the repository directory; the session start installs"
fi

step "setup done"
exit 0
