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
# It never aborts: a step that fails says so and the session still starts,
# so that the first session can report what the machine looks like
# (docs/cloud-loop.md, The trial). Keep it under five minutes, or the result
# is not cached (docs: cloud environments, setup scripts).
set -uo pipefail

step() { echo; echo "== $*"; }
failed() { echo "!! $* failed"; }

step "machine"
echo "PATH=$PATH"
echo "node on PATH: $(command -v node || echo none) $(node --version 2>/dev/null || true)"
echo "pnpm on PATH: $(command -v pnpm || echo none) $(pnpm --version 2>/dev/null || true)"
ls -d /opt/node* 2>/dev/null || true

step "Node 24 from nodejs.org (needs nodejs.org in the environment's network list)"
# The VM has Node 20, 21 and 22 under /opt. Node 24 goes to /opt/node24.
install_node24() {
  local version
  version=$(curl -fsSL https://nodejs.org/dist/index.json \
    | python3 -c 'import json,sys; print(next(v["version"] for v in json.load(sys.stdin) if v["version"].startswith("v24.")))') || return 1
  echo "latest 24: $version"
  curl -fsSL "https://nodejs.org/dist/$version/node-$version-linux-x64.tar.xz" -o /tmp/node24.tar.xz || return 1
  rm -rf /opt/node24 "/opt/node-$version-linux-x64"
  tar -xJf /tmp/node24.tar.xz -C /opt || return 1
  ln -sfn "/opt/node-$version-linux-x64" /opt/node24
  rm -f /tmp/node24.tar.xz
}
install_node24_npm() {
  # Fallback without nodejs.org: the npm package "node" carries the binary.
  npm install -g --prefix /opt/node24 node@24
}
if install_node24; then
  echo "installed from nodejs.org"
elif install_node24_npm; then
  echo "installed from the npm registry"
else
  failed "Node 24 install"
fi
if [ -x /opt/node24/bin/node ]; then
  echo "/opt/node24/bin/node is $(/opt/node24/bin/node --version)"
  echo 'export PATH=/opt/node24/bin:$PATH' > /etc/profile.d/node24.sh
  for bin in node npm npx corepack; do
    [ -e "/opt/node24/bin/$bin" ] && ln -sfn "/opt/node24/bin/$bin" "/usr/local/bin/$bin"
  done
  export PATH=/opt/node24/bin:$PATH
else
  failed "no /opt/node24/bin/node"
fi

step "PostgreSQL 18 image (pulled now so it is in the cache)"
(service docker start || true) >/dev/null 2>&1
docker pull postgres:18 >/dev/null 2>&1 &
PULL=$!

step "warm the pnpm store with the dependencies of main"
# pnpm reads "packageManager" from package.json and switches to that version
# by itself. The clone is thrown away; only the store is kept.
rm -rf /opt/warm
if git clone --depth 1 https://github.com/sodiqschoolapp/sodiq-platform /opt/warm >/dev/null 2>&1; then
  (cd /opt/warm && pnpm install --frozen-lockfile >/dev/null 2>&1) || failed "warm-up install (the session start installs instead)"
  rm -rf /opt/warm
else
  failed "clone for the warm-up (the session start installs instead)"
fi

wait "$PULL" && docker image ls postgres:18 || failed "docker pull postgres:18"

step "setup done"
exit 0
