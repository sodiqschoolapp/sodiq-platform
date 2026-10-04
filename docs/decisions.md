# Technical decisions

Decisions about how the system is built, with the reason. Product rules are in `docs/spec/`, not here. Add an entry when a choice is made that a later session would otherwise question or undo.

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
