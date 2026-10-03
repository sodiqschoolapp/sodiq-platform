# Progress log

Newest entry first. Each finished task adds an entry: what was built, what was left out, and what the next session must know. A session that stops half-way writes where it stopped.

## 4 October 2026: task 0.2 Database, migrations and typed queries

Built:

- `db/setup/local.sql` (run once per machine as `postgres`): the users `sodiq_migrator` and `sodiq_app` and the database `sodiq_dev`. `.env.example` with `DATABASE_URL` (application user) and `DATABASE_MIGRATION_URL` (migration user). Both files are for local machines and CI only and say so.
- `db/migrations/0001_foundations.sql`: extension `btree_gist`; only the migration user may create objects; `sodiq_app` may read `schema_migrations`.
- The migration runner `apps/api/src/database/migrate.ts` and `pnpm db:migrate`: files `NNNN_short_name.sql` in number order, each in its own transaction, one runner at a time. It refuses an applied file that was edited (line endings do not count), renamed or removed, a duplicate number, a lower number than the last applied, a bad name, and a file with its own `begin`, `commit` or `rollback`.
- Kysely: `createDatabase` and the global `DatabaseModule` (token `DATABASE`), connecting as `sodiq_app`. `pnpm db:codegen` writes `apps/api/src/database/types.generated.ts`. A `date` column is the text `YYYY-MM-DD` in TypeScript.
- Test helper `apps/api/src/testing/test-database.ts`: `createTestDatabase()` gives a test file its own copy of a template built from the real migrations, with an `app` connection (as `sodiq_app`) and a `migrator` connection (owner). 54 API tests pass.
- Outside the task, asked for by the owner: `/next-task` first checks that `main` is up to date; `README.md` says how to stop `pnpm dev` on Windows (Ctrl+C twice).

Left out, with the task that brings it:

- Branch filter per transaction, row-filter policies, a transaction helper, configuration loading: 0.4. Today two environment variables are read in `apps/api/src/database/config.ts`.
- CI: 0.3. Users and databases on Neon, migrations before a deploy: 0.10.
- Migrations outside a transaction (`create index concurrently`): the runner cannot run them yet. Change the runner with the first migration that needs one.
- How `bigint` and `numeric` columns arrive in TypeScript: decide with the first table that has one (phase 4 or 9).
- The health route does not query the database.

The next sessions must know:

- The API does not start without `DATABASE_URL`. `pnpm dev` and `pnpm test` need the local PostgreSQL 18 and `.env` (README, Setup).
- Every migration grants `sodiq_app` its rights table by table (`.claude/rules/database.md`). After a migration: `pnpm db:migrate`, `pnpm db:codegen`, commit the generated file; `codegen.test.ts` fails otherwise.
- Tests that reach the database: `const database = await createTestDatabase()` in `beforeAll`, `await database.destroy()` in `afterAll`. Use `database.app` for the code under test, so a missing grant fails the test. Route tests: `createTestApp({ database: database.app })`; without it every query fails on purpose. Closing the application closes that connection.
- `sodiq_migrator` owns the tables, so row filters do not apply to it: row-filter tests (0.4) must use `database.app`.
- A test needs a scratch table? Create it in the test database as `database.migrator` and grant it; never add a sample table to `db/migrations`.
- 0.3: CI runs `db/setup/local.sql` against a PostgreSQL 18 service on localhost (`psql -U postgres -f db/setup/local.sql`) and sets the two variables of `.env.example`. The tests refuse a database host other than localhost. `pnpm db:codegen` reads `../../.env`, which CI does not have; CI does not need to run it, the verify test covers it. Turborepo: `apps/api/turbo.json` makes `db/migrations`, `.env` and the two variables part of the test cache key.
- 0.5: pg-boss creates its own schema when it starts, and `sodiq_app` cannot create anything. The schema must be installed by the migration user and granted. The same holds for the monthly audit partitions: the application user cannot create them.
- 0.5 and 0.4: `sodiq_app` still has PostgreSQL's default right to create temporary tables and to connect to any database on the server. Harmless for the append-only rule; decide in 0.10 whether to revoke it on Neon.
- 0.10: `sodiq_migrator` and `sodiq_app` must exist on Neon before the first migration (`0001` names `sodiq_app`). The runner holds a session lock, so `DATABASE_MIGRATION_URL` must be Neon's direct connection, not the pooled one. The compiled runner is `apps/api/dist/database/cli.js migrate`; it looks for `db/migrations` four folders above itself, check that this holds in the deployed layout. A second runner waits for the first without a time limit.
- The runner talks to PostgreSQL through `pg` directly, an exception to "Kysely only" that is written in `docs/decisions.md`.
- On Windows `pnpm dev` stops with Ctrl+C twice. Do not build shell commands with a quoted heredoc that contains an apostrophe in Git Bash here; write a script file instead.

The next task is 0.3.

## 4 October 2026: task 0.1 Repository skeleton

Built:

- pnpm workspace with Turborepo: `apps/web`, `apps/api`, `packages/calc`, `packages/timetable-rules`, `packages/shared`.
- `apps/api`: NestJS 12 with the eleven empty modules in `src/modules` and the public route `GET /api/health`.
- `apps/web`: Vite, React, Tailwind CSS, shadcn/ui (Button only). One placeholder page calls the health route and shows "reachable" or "not reachable".
- ESLint, Prettier and Vitest in every package; Playwright with one smoke test; the root scripts named in `CLAUDE.md`. 36 unit and API tests and 1 browser test pass.
- Setup steps in `README.md`; the technical choices in `docs/decisions.md`.

Left out, with the task that brings it:

- Jobs worker in `pnpm dev`: 0.5. `pnpm db:migrate` and `pnpm db:codegen`: 0.2. `pnpm api:client`: 0.4. Until then the three scripts stop with a message.
- Continuous integration: 0.3. `apps/solver`: 5.10. Web feature folders: created with each feature.
- TanStack Router and Query, i18next, AG Grid, Pragmatic drag and drop, Dexie, Socket.IO, Kysely, pg-boss and fast-check are not installed; each comes with the first task that uses it.
- The placeholder page has hard-coded English text and a plain `fetch`. No permission tests and no translations yet (allowed before 0.8c).

The next sessions must know:

- Node 24 is pinned (`.node-version`, `engines`); `pnpm install` refuses another major version. TypeScript stays on 6.0.x. pnpm refuses package versions younger than 24 hours: take the previous version, do not add an exception.
- New shadcn/ui components: `pnpm dlx shadcn@latest add <name> -c apps/web`, then `pnpm format`.
- Do not write files with PowerShell `Set-Content`: it adds CRLF and a byte-order mark. Line endings are LF.
- 0.2: replace the two database stubs in the root `package.json`.
- 0.3: use `.node-version` and `pnpm install --frozen-lockfile`. The browser test needs `playwright install chromium`; the build plan does not say whether CI runs `pnpm test:e2e`, ask the owner. Tests are slow when all packages run at once (timeouts were raised in `apps/api/vitest.config.ts` and `apps/web/src/test-setup.ts`); watch this in CI.
- 0.4: replace `parseHealthResponse` (`packages/shared`) and the `fetch` in `apps/web/src/App.tsx` with the shared schemas and the generated client. Configuration loading replaces the read of `PORT` in `apps/api/src/main.ts` and should also set the host: today the API listens on all network interfaces. Unknown paths give three different error shapes today (NestJS JSON under `/api`, an Express HTML page outside it, the body parser's own errors). Add the lint rule against reading the system clock. If the OpenAPI document is served over HTTP, that is a new route.
- 0.4 to 0.6c add routes before the permission harness of 0.7 exists. Each must be listed for 0.7.
- 0.7: declare `GET /api/health` public on the handler, not by a list of paths (Express also matches `HEAD`, `/API/HEALTH` and `/api/health/`). The harness must find routes from the running application: the health controller is in `src/health/`, outside `modules/`. Requests to unknown paths never reach a guard. The reviewer also advises that public routes do not refresh a session's last-use time.
- Before 0.7 the owner decides one point: `docs/spec/02-roles-and-access.md` says "Every request passes one permission check on the server" and names no public route. If the health route stays public, the spec may need a line (`/spec-change`).
- 0.8a: i18n replaces the placeholder texts, the `lang` and title in `apps/web/index.html`, and the tests that look for English strings. 0.8a and 0.8b review the look (the `nova` preset and the Geist font came from the shadcn CLI).
- Turborepo's `AGENTS.md` generation is off (`agentGuidance: false` in `turbo.json`). Its anonymous telemetry is on by default on each machine; `pnpm exec turbo telemetry disable` turns it off.

The next task is 0.2.

## 3 October 2026

Repository created from the starter pack. Nothing is built yet. The next task is 0.1 in `docs/build-plan.md`.
