#!/usr/bin/env bash
# SessionStart hook (see .claude/settings.json). On a laptop it does nothing.
# In a Claude Code cloud session it prepares the clone: the public local .env,
# PostgreSQL 18 in a container, the local roles and database, the
# dependencies, and the migrations. Every value here is the public local one
# of .env.example and db/setup/local.sql; nothing here is a secret.
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
  *) echo "!! node is not 24: the setup script did not install it (docs/cloud-loop.md, The trial)" ;;
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
(service docker start || true) >/dev/null 2>&1
if docker info >/dev/null 2>&1; then
  if ! docker ps --format '{{.Names}}' | grep -qx sodiq-pg; then
    docker rm -f sodiq-pg >/dev/null 2>&1 || true
    docker run -d --name sodiq-pg \
      -e POSTGRES_PASSWORD=postgres \
      -p 127.0.0.1:5432:5432 \
      postgres:18 >/dev/null || failed "docker run postgres:18"
  fi
  for _ in $(seq 1 60); do
    if docker exec sodiq-pg pg_isready -U postgres >/dev/null 2>&1; then break; fi
    sleep 1
  done
  docker exec sodiq-pg pg_isready -U postgres || failed "PostgreSQL did not become ready"

  step "roles and database (db/setup/local.sql, idempotent)"
  docker exec -i sodiq-pg psql -U postgres -v ON_ERROR_STOP=1 < db/setup/local.sql >/dev/null || failed "local.sql"
else
  failed "docker is not running; no database for this session"
fi

step "dependencies"
pnpm install --frozen-lockfile || failed "pnpm install"

step "migrations"
pnpm db:migrate || failed "pnpm db:migrate"

step "ready"
exit 0
