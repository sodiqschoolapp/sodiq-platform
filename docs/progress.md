# Progress log

Newest entry first. Each finished task adds an entry: what was built, what was left out, and what the next session must know. A session that stops half-way writes where it stopped.

## 4 October 2026: task 0.4b API foundations, database side

Built:

- `db/migrations/0002_branches_branch_filter_request_keys.sql`: the minimal `branches` table (id, name), the function `app_branch_ids()`, the `request_keys` table, and the policy pattern `branch_filter` as a comment for every later branch table.
- Branch filter: the transaction setting `app.branch_ids`, a list of branch ids. Nothing set shows no rows; a value that is not a list of uuids is an error. Rows of another branch cannot be read, written, moved or deleted.
- `Transactions.run(branchIds, work)` (`apps/api/src/database/transactions.ts`): the one place a transaction with the filter is opened. It refuses a database user that is not subject to row security.
- Repeat-safe requests: `@RequestKey()` (header `Idempotency-Key`, a uuid) and `RequestKeys.runOnce(transaction, { key, scope, input }, work)`. A repeat does not run the work and gets the stored answer; the same key for another action, other input or other branches is a 409; work that fails leaves no key.
- `ValidParams` for path parameters, described in OpenAPI like body and query.
- Lint rules, each with a test: raw request decorators of `@nestjs/common` only inside `apps/api/src/http/`; the name `app.branch_ids` only in `transactions.ts`.
- Catalog test (`apps/api/src/database/catalog.test.ts`): every table is branch-filtered in the standard way or named with a reason as school-wide; every view has `security_invoker = true`; no materialized view; no `SECURITY DEFINER` function outside the allow-list; `sodiq_app` is subject to row security; `public` is the only schema.
- The sample route of the build plan exists only in tests: `apps/api/src/testing/keyed-sample.controller.ts`. No route was added to the running application.
- Reviewed by the spec reviewer and the permission reviewer; their findings are fixed or listed below.

Left out, with the task that brings it:

- The branch list from the signed-in user: 0.6a (session) and 0.7 (guard). Today the caller of `Transactions.run` passes it.
- A request key tied to the account that sent it, and an error code of its own for the 409: 0.6a.
- Jobs that carry the branch, audit in the transaction: 0.5.
- The full branch record and the right to create and edit branches: 1.1. The application user can only read `branches`.
- How long request keys are kept, and the cleanup job: 8.3c. The application user has no delete right on `request_keys`.
- A time limit for a repeat that waits for the first request with the same key (it waits until that one commits or rolls back): decide with publish, 5.5a.
- A lint rule that stops business code from importing `src/testing` (still open from 0.4a).
- Not fixed from the review, by choice: the application user may rewrite the stored answer of a key (a database rule against it would need a trigger); `request-key.test.ts` has tests that build on the row of the first test; `import x = require(...)` and an inline `eslint-disable` are not refused by the import rule.

Open, for the owner:

- 0.10: check that the database user created for the application on Neon is not a superuser, has no BYPASSRLS and does not own the tables. The reviewer recalls that users made in Neon's console join a role with BYPASSRLS; this was not looked up. With such a user the API now refuses every transaction instead of showing all branches.
- 0.7: whether `createParamDecorator` and `REQUEST` of `@nestjs/core` are also kept inside `apps/api/src/http/`.

The next sessions must know:

- A new branch table: `branch_id uuid not null references branches (id)`, then the two statements of the policy pattern in migration 0002, exactly. The cast `::uuid[]` in the policy is needed. `catalog.test.ts` fails until the table is right. A school-wide table goes into `SCHOOL_WIDE_TABLES` in that test, with a reason, after asking the owner.
- Foreign keys and unique constraints are not filtered: a unique constraint on a branch table includes `branch_id`; an id from a request is checked against the branch first, or the error would tell whether the id exists in another branch (`.claude/rules/database.md`).
- A query outside `Transactions.run` sees no branch rows. Tests of branch tables: `new Transactions(database.app)`; helpers in `apps/api/src/testing/branch-filter-sql.ts` (`addBranchFilter`, `insertBranch`). The migrator sees everything and is refused by `Transactions`.
- A changing route that must be repeat-safe: `@RequestKey() key`, then `requestKeys.runOnce` inside `transactions.run`. `input` holds every path parameter and the body; the result is small JSON with ids and status, never personal data. Permission and scope checks come before `runOnce`.
- `runOnce` uses a savepoint named `request_key`; work that throws is undone even when the caller catches the error.
- 0.5: pg-boss brings its own schema: the catalog test "keep everything in schema public" will fail and the checks must be extended to that schema. Each monthly audit partition is a table of its own for the catalog test, and a partition read directly is not covered by the policy of its parent.
- 0.7: the guard is the only source of the branch list; a branch id in a path is compared with the person's assignments first. The filter knows branches only: subject, class and own-lesson scope are the guard's work. A Super Admin gets the list of every branch id; there is no "all" value. `branchIdSchema` accepts upper-case letters: compare ids in lower case. The raw `DATABASE` connection is still injectable; it sees school-wide tables without any filter. The harness must also put the guard on test controllers.
- 0.10: the API and the worker must never connect as `sodiq_migrator`.
- To re-apply an unmerged migration locally, ask the owner before changing anything in `sodiq_dev` (`.claude/rules/database.md`).
- In Git Bash here a heredoc breaks on apostrophes (again in this task): write a script file with the editor tools and run it.

The next task is 0.5.

## 4 October 2026: task 0.4a API foundations, HTTP side

Task 0.4 was split by the owner: 0.4a is the HTTP side, 0.4b the database side.

Built:

- Configuration (`apps/api/src/config`): `HOST` (default `127.0.0.1`), `PORT`, `DATABASE_URL`, checked at start, injected as `CONFIG`. A wrong variable stops the API with its name, never its value.
- One error shape (`apiErrorSchema` in `packages/shared`): `{ error: { code, message, requestId, details? } }`, also for unknown paths inside and outside `/api`, a body that is not JSON and a body over 100 kB. The text is always ours.
- Request ids: `X-Request-Id` made by the server on every answer and repeated in every error body.
- Validation (`apps/api/src/http`): `@ValidBody`, `@ValidQuery`, `@Returns` with zod schemas. The same schema checks and documents. `@Returns` also drops fields the schema does not know before the answer is sent. Validation details never repeat a submitted value.
- Clock: `Clock` type in `packages/shared`; `CLOCK`, `SystemClock`, `ClockModule` in the API; `FixedClock` for tests; the lint rule against reading the system clock in `apps/api/src` and `packages/*/src`.
- OpenAPI: `pnpm api:client` writes `apps/api/openapi.generated.json` and `apps/web/src/api/schema.generated.ts`; the placeholder page calls the health route through `apps/web/src/api/client.ts`. Two tests fail when a generated file is out of date.
- The sample route of the build plan exists only in tests: `apps/api/src/testing/sample.controller.ts`.
- Reviewed by the spec reviewer and the permission reviewer; their findings are fixed or listed below.

Left out, with the task that brings it:

- Branches table, branch filter, row policies, transaction helper, repeat-safe request keys: 0.4b.
- Error codes of their own for 401, 403, 409, 429 and the way to throw them: 0.6a (first use).
- Application version on every request: 8.3a. TanStack Query and Router: 0.8a. Request logging, Sentry: 0.10.
- `NODE_ENV` in the configuration: nothing reads it yet.
- The clock lint rule for `apps/web`: with its first code that has a time rule (8.3c).
- A lint rule that stops business code from importing `src/testing` (advice of the permission reviewer; today only tests import it and the build leaves the folder out).

Open, for the owner:

- A 500 is logged with the message and stack of the error. PostgreSQL puts a typed value into the message of a few errors (for example "invalid input syntax for type date"). Input validation stops such values before a query, but the log rule itself allows it. Decide in 0.10 with Sentry whether messages of database errors are cut.

The next sessions must know:

- A new route: `@ValidBody(schema)` / `@ValidQuery(schema)` on the parameter, `@Returns(schema)` on the method, schemas in `packages/shared`. Then `pnpm api:client` and commit both generated files. `sample.controller.ts` is the example.
- Route tests: `createTestApp({ clock: new FixedClock('2026-10-05T23:59:00+05:00'), controllers: [...] })`. `FixedClock` refuses a text without an offset.
- Query schemas: `z.coerce.number()` also accepts `0x50` and `1e3`, and reads an empty value as 0. Real query schemas (first in the lists of 0.8b) should use a strict whole-number text instead of copying the sample.
- An input schema must not use a record whose keys the caller chooses and that look like field names; such a key would appear in `details[].path` (`docs/decisions.md`).
- Errors that Node answers before Express (malformed HTTP, headers too large, request timeout) cannot have the error shape.
- NestJS turns every `SyntaxError` and `URIError` that reaches its Express error handler into a 400. 0.6a: middleware that parses stored data (sessions) must catch its own parse errors, or a server fault would be answered as `malformed_request` without a log line.
- 0.6a: cookie sessions need the SameSite setting and CSRF protection decided there. CORS is off and must stay off (`docs/decisions.md`).
- 0.7: 0.4a added no route to the running application. The guard must decide how test-only controllers passed to `createTestApp({ controllers })` declare access, without letting undeclared routes through. The two Express fallbacks (`initApp`) run outside NestJS, where no guard runs: nothing that serves data may be mounted there. The harness should also require `@Returns` on every route.
- 0.4b: decided already: the branch filter is a list of branch ids, normally one; nothing set shows no rows. Moments that rules compare come from the clock, not SQL `now()` (`.claude/rules/database.md`).
- 0.10: `HOST=0.0.0.0` on Render; a new variable goes into `config.ts`, `.env.example`, `apps/api/turbo.json` and `ci.yml`. Sentry must not send more of an error than the log does.
- `pnpm peers check` shows one known warning: `openapi-typescript` wants TypeScript 5. The install script of `@scarf/scarf` is refused on purpose (`pnpm-workspace.yaml`).
- In Git Bash on this machine a heredoc breaks on apostrophes and can lose backslashes: write files with the editor tools, not with shell text.

The next task is 0.4b.

## 4 October 2026: task 0.3 Continuous integration

Built:

- `.github/workflows/ci.yml`, on every pull request and every push to `main`. Job `checks`: install, `pnpm lint`, `pnpm typecheck`, `pnpm test`. Job `e2e`: `pnpm db:migrate`, Chromium, `pnpm test:e2e`; Playwright traces are kept 7 days when it fails. Each job has its own PostgreSQL 18 service, set up with `db/setup/local.sql` and the values of `.env.example`.
- Proof on a throwaway pull request (number 3, closed without merging, branch deleted): both jobs green, then `checks` red at "Unit and API tests" with a deliberately failing test.
- `apps/api/turbo.json`: the `dev` task names `DATABASE_URL` and `PORT`. Without this the API did not start under `pnpm dev` in CI.
- `apps/web/playwright.config.ts`: in CI the output of the servers is printed.
- `README.md` (Continuous integration) and `docs/decisions.md`.

Left out, with the task that brings it:

- Required checks for `main`: the owner turns them on in GitHub after the merge (`checks` and `e2e`).
- Deploy, migrations before a deploy, smoke test: 0.10. Solver build and tests: 5.10. Nightly simulation: 9.5c. Speed tests: 10.1.
- Turborepo remote cache: not needed yet.

The next sessions must know:

- Turborepo passes a task only the environment variables that the package's `turbo.json` names for it. A new variable read by the API, the worker or a test (0.4 configuration loading, 0.5 worker, 0.6 mail, 0.10) must be added there for `dev` and `test`, or it is missing wherever there is no `.env`. CI is where this shows first.
- A new environment variable that the tests or `pnpm dev` need also goes into the `env` block of `ci.yml` and into `.env.example`.
- The names of the jobs (`checks`, `e2e`) are what the branch protection requires. Renaming a job means changing the protection in GitHub too, or no pull request can be merged.
- Actions are pinned to a commit. To update one: new commit and new version in the comment.
- The review fixes of this task (concurrency group per commit on `main`, the superuser password only on the `psql` step, the 10-minute limit on the browser tests) ran for the first time on the task's own pull request, not on the throwaway one.
- 0.5: the worker joins `pnpm dev`; the `e2e` job then starts it too and it needs its variables (first note).
- 0.8a: more Playwright tests make `e2e` longer; the limits are 10 minutes for the step and 15 for the job.
- 0.10: the deploy can depend on the run of `ci.yml` on `main`; each commit on `main` has its own run that a later merge does not cancel.

The next task is 0.4.

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
