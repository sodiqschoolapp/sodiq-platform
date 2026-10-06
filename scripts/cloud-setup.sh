#!/usr/bin/env bash
# Setup script of the Claude Code cloud environment for this repository.
#
# It is pasted into the environment's "Setup script" field at claude.ai/code
# (docs/cloud-loop.md says where). The copy there must equal this file.
# It runs as root on the fresh VM before Claude starts, and its result is
# cached for about a week, so it only prepares the machine: Node 24, pnpm of
# the pinned version, PostgreSQL 18, and a warm pnpm store. What belongs to
# the clone of the repository (database roles, install, migrations) is done
# at every session start by scripts/cloud-session-start.sh.
#
# Known from the first runs (docs/cloud-loop.md, The trial):
# - the machine has no GitHub credentials while this script runs;
# - Docker has no daemon in this VM, so PostgreSQL is installed from
#   apt.postgresql.org and runs as a service;
# - /opt/node22/bin comes first on the session's PATH, so the environment
#   sets PATH with /opt/node24/bin in front;
# - the pnpm that pnpm installs for itself from "packageManager" is a stub
#   without a shebang, which turbo cannot run; pnpm is installed with npm.
# The script never aborts: a step that fails says so and the session still
# starts, so that the session can report it. Keep it under five minutes, or
# the result is not cached.
set -uo pipefail

step() { echo; echo "== $*"; }
failed() { echo "!! $* failed"; }

step "machine"
echo "cwd=$(pwd)"
echo "PATH=$PATH"
echo "node on PATH: $(command -v node || echo none) $(node --version 2>/dev/null || true)"
ls -d /opt/node* 2>/dev/null || true

step "Node 24"
# The VM has Node 20, 21 and 22 under /opt. The npm package "node" carries the
# official binary and comes from the npm registry (this worked on the first
# run); nodejs.org is the fallback.
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
  export PATH=/opt/node24/bin:$PATH
else
  failed "no /opt/node24/bin/node"
fi

step "pnpm of the pinned version"
# npm runs pnpm's install step, so the real binary lands in /opt/node24/bin.
# The preinstalled pnpm under /opt/node22/bin points there too, so the right
# pnpm is found even on a PATH that has not been changed.
PNPM_VERSION=$(python3 -c 'import json; print(json.load(open("package.json"))["packageManager"].split("@")[1])' 2>/dev/null || echo 12.8.1)
if npm install -g --prefix /opt/node24 "pnpm@$PNPM_VERSION" >/dev/null 2>&1 && [ -x /opt/node24/bin/pnpm ]; then
  echo "/opt/node24/bin/pnpm is $(/opt/node24/bin/pnpm --version): $(head -c 2 "$(readlink -f /opt/node24/bin/pnpm)" | od -An -c | tr -d ' ')"
  [ -e /opt/node22/bin/pnpm ] && ln -sfn /opt/node24/bin/pnpm /opt/node22/bin/pnpm
else
  failed "pnpm $PNPM_VERSION install"
fi

step "PostgreSQL 18 from apt.postgresql.org"
# Needs apt.postgresql.org and www.postgresql.org in the environment's
# network list. The preinstalled 16 is removed first, so 18 takes port 5432.
export DEBIAN_FRONTEND=noninteractive
install_pg18() {
  apt-get update -qq >/dev/null 2>&1 || true
  apt-get install -y -qq postgresql-common >/dev/null 2>&1 || return 1
  if command -v pg_lsclusters >/dev/null 2>&1; then
    pg_lsclusters --no-header 2>/dev/null | awk '{print $1, $2}' | while read -r v name; do
      [ "$v" = "18" ] || pg_dropcluster --stop "$v" "$name" >/dev/null 2>&1 || true
    done
  fi
  /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y >/dev/null 2>&1 || return 1
  apt-get install -y -qq postgresql-18 >/dev/null 2>&1 || return 1
  if ! pg_lsclusters --no-header | grep -q '^18 '; then
    pg_createcluster 18 main --port 5432 >/dev/null 2>&1 || return 1
  fi
  pg_ctlcluster 18 main stop >/dev/null 2>&1 || true
  pg_lsclusters
}
install_pg18 || failed "PostgreSQL 18 install"

step "warm the pnpm store"
# The repository is cloned before this script runs. If this is its directory,
# install once so the pnpm store is in the cache; the session start installs
# again, fast.
if [ -f pnpm-lock.yaml ]; then
  pnpm install --frozen-lockfile >/dev/null 2>&1 && echo "store warmed" || failed "pnpm install (the session start installs instead)"
else
  echo "not in the repository directory; the session start installs"
fi

step "setup done"
exit 0
