#!/usr/bin/env bash
# SessionStart hook (see .claude/settings.json). On a laptop it does nothing.
# In a Claude Code cloud session it prepares the clone: the public local .env,
# PostgreSQL 18 in a container, the local roles and database, the
# dependencies, and the migrations. Every value here is the public local one
# of .env.example and db/setup/local.sql; nothing here is a secret.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}"
export PATH=/opt/node24/bin:$PATH

echo "== cloud session start: $(node --version), pnpm $(pnpm --version)"

echo "== .env (public local values)"
[ -f .env ] || cp .env.example .env

# The review environment sets SODIQ_REVIEW_ONLY=1: a review reads code and the
# result of CI, so it needs the dependencies but no database.
if [ "${SODIQ_REVIEW_ONLY:-}" = "1" ]; then
  echo "== review session: dependencies only"
  pnpm install --frozen-lockfile
  echo "== ready"
  exit 0
fi

echo "== PostgreSQL 18"
(service docker start || true) >/dev/null 2>&1
if ! docker ps --format '{{.Names}}' | grep -qx sodiq-pg; then
  docker rm -f sodiq-pg >/dev/null 2>&1 || true
  docker run -d --name sodiq-pg \
    -e POSTGRES_PASSWORD=postgres \
    -p 127.0.0.1:5432:5432 \
    postgres:18 >/dev/null
fi
for _ in $(seq 1 60); do
  if docker exec sodiq-pg pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec sodiq-pg pg_isready -U postgres

echo "== roles and database (db/setup/local.sql, idempotent)"
docker exec -i sodiq-pg psql -U postgres -v ON_ERROR_STOP=1 < db/setup/local.sql >/dev/null

echo "== dependencies"
pnpm install --frozen-lockfile

echo "== migrations"
pnpm db:migrate

echo "== ready"
