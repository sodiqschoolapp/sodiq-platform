#!/usr/bin/env bash
# SessionStart hook (see .claude/settings.json). On a laptop it does nothing.
# In a Claude Code cloud session it prepares the clone: the public local .env,
# the PostgreSQL 18 service, the local roles and database, the dependencies,
# and the migrations. Every value here is the public local one of
# .env.example and db/setup/local.sql; nothing here is a secret.
#
# It never aborts: a step that fails says so, and the session reports it.
set -uo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}" || exit 0
export PATH=/opt/node24/bin:$PATH

step() { echo; echo "== $*"; }
failed() { echo "!! $* failed"; }

step "cloud session start"
echo "node: $(command -v node || echo none) $(node --version 2>/dev/null || true)"
echo "pnpm: $(command -v pnpm || echo none) $(pnpm --version 2>/dev/null || true)"
case "$(node --version 2>/dev/null)" in
  v24.*) ;;
  *) echo "!! node is not 24 here; the environment variable PATH must start with /opt/node24/bin (docs/cloud-loop.md, The trial)" ;;
esac

step ".env (public local values)"
[ -f .env ] || cp .env.example .env

# The review environment sets SODIQ_REVIEW_ONLY=1: a review reads code and the
# result of CI, so it needs the dependencies but no database.
if [ "${SODIQ_REVIEW_ONLY:-}" = "1" ]; then
  step "review session: dependencies only"
  pnpm install --frozen-lockfile || failed "pnpm install"
  step "ready"
  exit 0
fi

step "PostgreSQL 18"
# Installed by scripts/cloud-setup.sh as a service; the cache keeps files,
# not running processes, so it is started here.
as_postgres() {
  if [ "$(id -u)" = "0" ]; then su postgres -c "$*"; else sudo -n -u postgres "$@"; fi
}
if command -v pg_ctlcluster >/dev/null 2>&1; then
  pg_ctlcluster 18 main start >/dev/null 2>&1 || service postgresql start >/dev/null 2>&1 || true
  for _ in $(seq 1 30); do
    if pg_isready -h 127.0.0.1 -p 5432 >/dev/null 2>&1; then break; fi
    sleep 1
  done
  if pg_isready -h 127.0.0.1 -p 5432 >/dev/null 2>&1; then
    step "roles and database (db/setup/local.sql, idempotent)"
    as_postgres "psql -v ON_ERROR_STOP=1" < db/setup/local.sql >/dev/null || failed "local.sql"
  else
    failed "PostgreSQL did not become ready on 5432 (pg_lsclusters: $(pg_lsclusters --no-header 2>/dev/null | tr '\n' ';'))"
  fi
else
  failed "PostgreSQL is not installed; the setup script did not get it"
fi

step "dependencies"
pnpm install --frozen-lockfile || failed "pnpm install"

step "migrations"
pnpm db:migrate || failed "pnpm db:migrate"

step "ready"
exit 0
