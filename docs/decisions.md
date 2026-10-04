# Technical decisions

Decisions about how the system is built, with the reason. Product rules are in `docs/spec/`, not here. Add an entry when a choice is made that a later session would otherwise question or undo.

## 4 October 2026: API foundations, database side (task 0.4b)

| Decision | Reason |
| --- | --- |
| Ids of rows are `uuid`, made by PostgreSQL 18's `uuidv7()` | `branches` is the first real table and sets the pattern. A uuid arrives as text in TypeScript, does not reveal how many rows exist, and can be made by a browser for request keys. Staff IDs and student UIDs stay separate visible numbers, as the spec says. The owner agreed on 4 October 2026. |
| The branch filter is the transaction setting `app.branch_ids` (a PostgreSQL array of uuids), read by the function `app_branch_ids()`; nothing set, or an empty value, is an empty list | Set with `set_config(..., true)`, it ends with the transaction and cannot stay on a pooled connection (developer rules, "Branch filter"). A value that is not a list of uuids is an error, never "all rows". |
| One policy for every branch table, `branch_filter`: `branch_id = any ((select app_branch_ids())::uuid[])` for reading and for writing, for `sodiq_app` only, and no other policy on the table | The inner select makes PostgreSQL read the list once per query. The cast is needed: without it `any ((select ...))` compares with the rows of the select and the policy cannot even be created. The owner of the tables (`sodiq_migrator`) is not filtered, so migrations see every row; `force row level security` is not used. |
| The filter guards against a fault of the application, not against the application user | `sodiq_app` can set `app.branch_ids` itself. The filter makes a forgotten `where` return nothing instead of another branch's rows; who may work for which branch is decided by the permission guard (0.7). |
| Every table in schema `public` is classified by a test over the catalog (`apps/api/src/database/catalog.test.ts`): `branch_id` with the standard filter, or named with a reason in the list of school-wide tables (today `schema_migrations`, `branches`, `request_keys`) | A later migration cannot forget the filter. The test also refuses a `branch_id` that may be empty, a second policy, and a `branch_filter` policy that is not the standard one. Asked for by the owner on 4 October 2026. |
| Every view is created with `security_invoker = true`; no materialized views; no `SECURITY DEFINER` function outside an allow-list with reasons (empty today), all checked by the same test | A view and a `SECURITY DEFINER` function run with the rights of their owner, who is not filtered; a materialized view holds a copy of the rows. The test shows a scratch view and a scratch function returning another branch's row. Asked for by the owner on 4 October 2026. If prepared report totals (9.3b) want a materialized view, ask the owner first. |
| `branches` has no row filter; the application user can only read it until task 1.1 | The branch names are not confidential and the branch switcher shows them. The owner agreed on 4 October 2026. |
| Business code gets its transaction from `Transactions.run(branchIds, work)`; the list of branches is a required argument | Nobody can forget the filter: forgetting shows no rows. `[]` is for work on school-wide tables only. Each id is checked as a uuid before it reaches the setting. Until 0.7 the caller passes the ids; then the guard supplies them. |
| The injection token `DATABASE` lives in `database.tokens.ts` and is exported again by `database.module.ts` | The services of the module import the token; importing it from the module would be a circular import. |
| Repeat-safe requests: the header `Idempotency-Key` (a uuid, `@RequestKey()`), the table `request_keys`, and `RequestKeys.runOnce(transaction, { key, scope, input }, work)` | The key row is written in the same transaction as the change: a request that failed leaves no key and can be tried again; a repeat finds the key and does not run the work. The primary key is the guard, so two requests at the same moment do the work once. |
| A repeat gets the same answer as the first request, from a small stored JSON result | The caller that lost the first answer needs it. The result holds ids and status only, never personal data. The owner agreed on 4 October 2026. |
| The same key for another action or with other input is refused with 409 (code `request_refused` until 0.6a adds codes) | A key belongs to one action and one input; the input is compared by a SHA-256 hash of its canonical JSON. |
| `request_keys` has no branch column; the application user may insert, read and update only the stored result, never delete | A key must be unique across the school. From 0.6a a key is also tied to the account that sent it. How long keys are kept, and the cleanup job, are decided in 8.3c with offline entry. |
| `ValidParams(schema)` checks and describes path parameters; `Body`, `Query`, `Param`, `Headers`, `Req` and `Request` of `@nestjs/common` may be imported only inside `apps/api/src/http/` (lint rule, with a test) | A route cannot read unchecked input by accident. `Request` is the other name of `Req`. The rule has no exception for tests or `src/testing`. Asked for by the owner on 4 October 2026. |

## 4 October 2026: API foundations, HTTP side (task 0.4a)

| Decision | Reason |
| --- | --- |
| Task 0.4 is split: 0.4a is the HTTP side, 0.4b the database side (branches, branch filter, request keys) | Two smaller reviews; the migration and the row filter are reviewed on their own. The owner chose this. |
| `zod` is the schema library, in `packages/shared`, the API and (through `packages/shared`) the web app | One schema checks the input on the server, describes it in the OpenAPI document and can check an answer in the browser. The owner approved it on 4 October 2026, with `@nestjs/swagger`, `openapi-typescript` and `openapi-fetch`. |
| Validation and schema description are our own code (`apps/api/src/http/`): `SchemaPipe`, and the decorators `@ValidBody`, `@ValidQuery` and `@Returns` | `nestjs-zod` 5.5.0 supports NestJS 10 and 11 only; we are on 12. `@ValidBody(schema)` both checks the body and puts the same schema into the document, so the two cannot differ. The owner chose this over installing an unsupported package. |
| `@nestjs/swagger` builds the OpenAPI document; its schemas come from `z.toJSONSchema` with the target `openapi-3.0` | The package emits OpenAPI 3.0, and JSON Schema of a newer dialect is not valid there. |
| The OpenAPI document is a committed file (`apps/api/openapi.generated.json`) and is not served over HTTP; there is no Swagger page | Serving it would be a new public route. A test fails when the file is out of date. |
| `openapi-typescript` 7.13.0 writes the client types although it declares TypeScript 5 only; `openapi-fetch` is the client | It generates correctly on TypeScript 6.0, and `apps/web/tooling/api-types.test.ts` generates again on every test run and compares. If a later version of either breaks it, that test fails; then ask the owner (`@hey-api/openapi-ts` declares TypeScript 6). `pnpm peers check` shows this one warning. |
| The install script of `@scarf/scarf` is refused (`allowBuilds` in `pnpm-workspace.yaml`) | It comes with the Swagger UI files inside `@nestjs/swagger` and only sends install statistics. |
| One error shape: `{ "error": { "code", "message", "requestId", "details"? } }` (`apiErrorSchema` in `packages/shared`) | `code` is stable and is what the web app translates into three languages from task 0.8a. `message` is English for the developer and is never shown to a user. The owner agreed on 4 October 2026. |
| The text of an error answer is always ours; the message of the thrown error is never sent | A parser's or a library's message can repeat what was sent or name internals. Only the status and, for validation, the details are taken from the error. Today the code follows from the status (401, 403, 409 and 429 are all `request_refused`). The first task that needs a code of its own (0.6a) adds it to `ERROR_CODES` and adds the way to throw it; nothing is built ahead. |
| `@Returns(schema)` is applied to the answer before it is sent (`ResponseSchemaInterceptor`): unknown fields are dropped, and an answer that does not fit is a 500 that names the field and the kind in the log, never the value | The document says what the browser gets, so the server must send exactly that. A query that returns one column too many must not leak it. Found by the review. A route without `@Returns` is not checked; the harness of 0.7 should require it on every route. |
| Validation details hold the path, a code and a fixed message per code, never a submitted value; a path segment that is not a plain field name becomes `*` | An answer must not repeat personal data that was typed. Decided by the owner on 4 October 2026. Limit: an input schema must not use caller-chosen keys (a record) whose keys look like field names; no schema does. |
| A fault of the server (500) is logged with the request id and the error's name, message and stack only | Other fields of an error, for example the detail of a database error, can hold values of a row. Sentry in 0.10 must keep to the same rule. |
| Every request gets an id from the server (`X-Request-Id`, also inside every error answer); an id sent by the client is ignored | The id ties an answer to the log. A caller must not be able to write into the log or reuse an id. |
| The request id is kept on the response, not in `AsyncLocalStorage` | Nothing deeper than the error answer needs it yet, and the context can be lost behind the body parser. Look again when request logging arrives (0.10). |
| Unknown paths outside `/api` and errors that NestJS does not see are answered by two Express handlers added after the routes (`initApp`) | NestJS handles only its own prefix; without them Express answers with an HTML page. `main.ts` and the tests both start the application through `initApp`. |
| CORS stays off | Web app and API share one origin (decision of 0.1), so no other site may read an answer. A test checks that a request with another `Origin` gets no `Access-Control-Allow-Origin`. Decided by the owner on 4 October 2026. |
| Configuration is read once at start by `loadConfig` (zod over the environment) and injected as `CONFIG`; no configuration library | Three variables today. A missing or wrong one stops the API with the names of all of them and never a value. `.env` is still read by `process.loadEnvFile` first. |
| The API listens on `HOST`, default `127.0.0.1`; Vite forwards `/api` to `127.0.0.1:3000` | On a developer machine the API is not reachable from the network. Render needs `HOST=0.0.0.0` (0.10). The owner agreed on 4 October 2026. |
| The request body limit stays at Express's default of 100 kB | "All present" for a class and bulk actions fit; files will go to R2. The owner agreed on 4 October 2026. |
| The clock: `Clock` (type) in `packages/shared`; `CLOCK` token, `SystemClock` and `ClockModule` in `apps/api/src/clock`; `FixedClock` in `src/testing`, which refuses a text without an offset (`+05:00` or `Z`) | A moment without an offset means another moment in CI (UTC) than in Tashkent. Business code is given the time (developer rules, Time-based state). The pure packages keep receiving moments as arguments. |
| ESLint refuses `Date.now()`, `new Date()` without arguments and `Date()` in `apps/api/src` and `packages/*/src`, except tests, `src/testing` and `system-clock.ts`; also `Date.now` without a call and `globalThis.Date` | The rule is checked by a test. `performance.now()` and `process.hrtime()` are not refused: they measure durations and cannot give the date or time of day. The web app is not covered yet: decide with its first code that has a time rule (8.3c). |
| A moment that a business rule compares (locks, windows, exemption ends, lesson times) is written from the injected clock, never from SQL `now()` or `current_timestamp`; `default now()` only for bookkeeping columns that no rule reads | Otherwise a test with a fixed clock would compare its moment with a moment of the database server, and the rule could not be tested at 23:59 and 00:00. Decided by the owner on 4 October 2026; also in `.claude/rules/database.md`. |
| The sample route of the build plan exists only in tests (`src/testing/sample.controller.ts`); the web app calls `GET /api/health` through the generated client | Nothing throwaway ships and no public route is added before the permission guard of 0.7. The owner chose this. |

## 4 October 2026: continuous integration (task 0.3)

| Decision | Reason |
| --- | --- |
| One workflow with two jobs: `checks` (lint, type-check, unit and API tests) and `e2e` (Playwright) | The pull request shows which kind of check failed, and the browser tests do not wait for the others. The owner chose to run the browser tests on every pull request (spec `14`, Whole system). |
| The workflow runs on pull requests and on pushes to `main` | `main` has its own result after each merge; the deploy of task 0.10 can depend on it. On `main` the concurrency group is the commit, so a later merge never cancels or replaces an earlier run; on a pull request a newer push stops the older run. |
| CI creates its users and database with `db/setup/local.sql` and uses the public values of `.env.example` | One way to set up a database, on a developer machine and in CI. The PostgreSQL service lives only inside the job. |
| Actions are pinned to a full commit, with the version in a comment | A tag can be moved to other code; a commit cannot. |
| The PostgreSQL service is `postgres:18`, the official image, not pinned to a digest | CI should follow the minor releases of version 18, as the developer machines and Neon do. The image runs only the throwaway database of a job and never sees the repository token. |
| The superuser password of the service is given only to the `psql` step | No other step needs it, and `pg` would quietly use it for a connection string without a password. |
| The workflow's token may only read the repository (`permissions: contents: read`) | Nothing in CI writes to GitHub. |
| No Turborepo remote cache | A whole run takes minutes at this size. Look again if CI becomes slow. |
| A variable that a Turborepo task reads from the environment is named in that package's `turbo.json` (`DATABASE_URL` and `PORT` for the API's `dev`) | Turborepo passes a task only the variables it names. With `.env` the API reads the file itself, so the gap shows only where there is no `.env`: in CI the API did not start under `pnpm dev` until this was added. |
| In CI Playwright prints the output of the servers it starts | Otherwise a server that fails to start shows only as a timeout. |
| `pnpm db:codegen` does not run in CI | `codegen.test.ts` already fails when the generated types are out of date. |

## 4 October 2026: database, migrations and typed queries (task 0.2)

| Decision | Reason |
| --- | --- |
| Two database users with fixed names: `sodiq_migrator` owns every table and runs the migrations; `sodiq_app` is what the API and the worker connect as | Append-only audit tables and the branch row filter only hold against a user that does not own the tables. The names are fixed because migrations name them in `grant` statements. |
| Each migration grants `sodiq_app` its rights table by table; there are no default privileges | A forgotten grant fails loudly in the first test ("permission denied"). With default privileges a forgotten revoke on an audit table would fail silently. |
| The migration runner is our own code (`apps/api/src/database/migrate.ts`), not a library | About 150 lines. It applies each file in its own transaction, takes an advisory lock so two runners cannot overlap, and refuses to run when an applied file was edited, renamed, removed or overtaken by a lower number. |
| Migrations go forward only; there are no "down" files | A migration is never edited after merge; a mistake is corrected by a new file. Restore is by backup (task 10.2). |
| The checksum of a migration ignores the difference between CRLF and LF | A Windows editor must not make an applied file look edited. |
| The runner uses the `pg` driver directly; everything else uses Kysely | It sends whole SQL files and holds a session lock on one connection. |
| `pg` is the PostgreSQL driver; `kysely-codegen` (development only) writes the types | `pg` is what Kysely and pg-boss use. The owner approved both on 4 October 2026. |
| `.env` is read with Node's own `process.loadEnvFile`, only if the file exists | No dotenv library. Variables already set win, so CI and the servers are not affected. Task 0.4 replaces this with configuration loading. |
| A `date` column arrives in TypeScript as the text `YYYY-MM-DD`; a `timestamptz` as a `Date` | The driver's default turns a date into local midnight, which becomes another day in another time zone. School dates are dates, lesson times are moments (`CLAUDE.md`, Conventions). A `date[]` arrives as an array of such texts. The generated types make a `date` column accept text only, so a `Date` cannot be written into one by mistake. How `bigint` and `numeric` arrive is decided with the first table that has one. |
| Tests: one template database per run, built by the real runner from the real migrations; each test file copies it and connects as `sodiq_app` | Copying a template takes a fraction of a second, files stay independent and can run in parallel, and a missing right fails a test instead of production. `sodiq_migrator` may create databases for this, locally and in CI only. |
| Every test database is named `sodiq_test_<start of the run>_<random>_...`; a run removes its own databases at the end and, at the start, those of runs older than an hour | Two runs at once (watch mode and `pnpm test`, or the owner and a Claude Code session) do not drop each other's databases, and an interrupted run does not leave databases for ever. |
| The tests refuse to run unless `DATABASE_MIGRATION_URL` points at localhost | They create and force-drop databases. |
| `createTestApp()` never connects to `sodiq_dev`: a test passes the `app` connection of its test database, otherwise every query fails | A route test must not read or change the developer database by accident. |
| The runner refuses a file that contains `begin;`, `commit;` or `rollback;` | Such a statement would end the runner's own transaction and could leave the file half-applied and unrecorded. A migration that cannot run in a transaction (`create index concurrently`) needs a change to the runner first; it comes with the first migration that needs one. |
| `0001` uses `create extension if not exists` | On a managed PostgreSQL the extension may already be installed by the provider; a merged migration cannot be edited to allow for that later. |
| `types.generated.ts` is committed exactly as generated; Prettier and ESLint skip it | A test runs the generator in verify mode against a freshly migrated database and fails when the file is out of date. |
| Local database passwords are in the repository (`db/setup/local.sql`, `.env.example`) | They are for a PostgreSQL on a developer machine or in a CI job only, and both files say so at the top. Test and production users are created in task 0.10 in the provider's dashboard. The owner agreed on 4 October 2026. |
| PostgreSQL 18 everywhere: developer machines, CI, Neon | One version, so a constraint behaves the same in a test and in production. |
| `pnpm dev` on Windows is stopped with Ctrl+C twice | Turborepo starts each task through `cmd.exe`, which asks "Terminate batch job (Y/N)?" after the first Ctrl+C and waits where nobody can answer. Tried in stream and in terminal-UI mode on Turborepo 2.11.7: both wait. No clean fix was found; `README.md` describes it. |

## 4 October 2026: repository skeleton (task 0.1)

| Decision | Reason |
| --- | --- |
| ES modules in every package | NestJS 12, Vite and Vitest are ES modules; browser and server code use one module system. |
| TypeScript 6.0.x, not 7.0 | The NestJS CLI requires 6.0 and typescript-eslint does not support 7 yet. Move to 7 when both do. |
| Node 24 pinned in `.node-version` and `engines` | It is the current long-term-support line. pnpm refuses to install on another major version. Look again when Node 26 becomes long-term support. |
| Shared packages compile to `dist` with `tsc`; Turborepo builds them before lint, type-check, test and dev of what depends on them | Node runs the API from compiled JavaScript, so the packages need real output. One build order serves every command and a clean clone. |
| All API routes sit under `/api`; in development Vite forwards `/api` to the API | The browser sees one origin, which cookie sessions need. How production routes it is decided in task 0.10. |
| `GET /api/health` is public | Uptime monitoring and the deploy smoke test call it without a session. It answers only `{"status":"ok"}`. Task 0.7 declares it public in the permission table. |
| The health route lives in `apps/api/src/health/`, outside `modules/` | It is plumbing, not one of the eleven product modules named in `CLAUDE.md`. |
| The API does not send the `X-Powered-By` header | An answer does not name the framework behind it. |
| LF line endings through `.gitattributes` | A Windows clone otherwise gets CRLF and the Prettier check fails. |
| One ESLint config at the root; `pnpm lint` also runs the Prettier check; Prettier ignores `docs/`, `.claude/` and Markdown | One command checks everything, and the spec can never be reformatted by a tool. |
| shadcn/ui with the `nova` preset on Base UI and the Geist font served from our own files; Lucide is the icon set and is installed with the first component that uses an icon | These are the CLI's current defaults. Geist has Latin and Cyrillic sets. The look is reviewed in tasks 0.8a and 0.8b. |
| Libraries that shadcn/ui components need: `@base-ui/react`, `class-variance-authority`, `tw-animate-css`, `cn`, `@fontsource-variable/geist` | The CLI installs them and its components import them. `cn` is published by the author of shadcn/ui and replaces `clsx` and `tailwind-merge`; it is below version 1.0, and the generated components import it directly, so replacing it would mean patching every component the CLI adds. The owner confirmed `cn`, the Geist font and `shadcn` on 4 October 2026. |
| `shadcn` is a development dependency of the web app | `src/index.css` imports its stylesheet (`shadcn/tailwind.css`) at build time; nothing of it runs in the browser. The stylesheet is maintained with the components, so it is not copied into the repository. |
| Test libraries beside Vitest and Playwright: `jsdom`, `@testing-library/react` and `@testing-library/dom` for component tests; `supertest` for API route tests | Vitest needs a browser-like environment and a way to render a component, and route tests need to call the application over HTTP without opening a port. All are the usual choices for these jobs. |
| `@nestjs/platform-express` (Express) is the HTTP layer under NestJS | It is the NestJS default. |
| Lint tooling: `typescript-eslint`, `eslint-config-prettier`, `eslint-plugin-react-hooks`, `globals` | ESLint needs them to check TypeScript and React hooks and to stay out of Prettier's way. |
| The pure packages are type-checked a second time without Node types (`tsconfig.build.json`) | Tests may read files; the source of `packages/calc`, `packages/timetable-rules` and `packages/shared` may not use Node at all. `pnpm typecheck` fails if it does. |
| NestJS tests run on Vitest's own transform, without an SWC plugin | It emits the decorator metadata NestJS needs. `apps/api/src/testing/injection.test.ts` fails if that ever stops. |
| pnpm's release-age protection stays on, with no exceptions | pnpm refuses a package version published in the last 24 hours (its default, seen when ESLint 10.12.0 was refused). When the newest version is too young, the previous one is used. |
| Turborepo does not maintain an `AGENTS.md` (`agentGuidance: false`) | Project instructions for Claude Code live in `CLAUDE.md` only. |
| Root scripts for later tasks (`db:migrate`, `db:codegen`, `api:client`) exist and stop with a message | The names are fixed from the start and nobody mistakes them for working. |

## 3 October 2026: starting decisions

| Decision | Reason |
| --- | --- |
| React single-page app with Vite, not Next.js | Everything is behind sign-in, so server rendering adds nothing; static files are simpler to host and patch. |
| NestJS with REST and OpenAPI, client generated from it | Clear modules, a documented API for the later mobile apps, and the browser and server cannot disagree about a field. |
| Own sign-in module, no outside sign-in service | Narrow needs fixed by the spec; no fee per user; no account data leaves the platform. |
| SQL migrations by hand, Kysely for queries | The database rules (exclusion constraints, partitions, row filters) are plain SQL that schema tools cannot express. |
| pg-boss, no Redis | A job is saved in the same transaction as the data change; one service fewer. The pg-boss job table is the "outbox table" that `docs/spec/edge-cases/developer-rules.md` asks for; no second outbox is built. |
| Timefold Solver Community Edition in Kotlin as a separate service | Established solver with a school-timetabling model. Its paid "score analysis" is not used: the platform's own rule engine explains blocked lessons. Fallback: Google OR-Tools CP-SAT. |
| AG Grid Community for the journal | Free and built for large editable tables. Enterprise is bought only if range copy and paste is needed. |
| Pragmatic drag and drop for the timetable board | Stays smooth with more than a thousand drop cells. |
| Hosting: Render (Frankfurt), Neon, Cloudflare R2 | Managed services, so one developer does not run servers or database backups. |
| Calculation module and timetable rule engine as pure packages | Used by server and browser alike, and testable without a database. |
