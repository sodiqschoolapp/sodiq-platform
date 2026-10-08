# Sodiq School platform

The school's own platform for timetable, journal, results and lesson plans. Release 1 is being built.

- What the system must do: `docs/spec/` (start at `docs/spec/00-index.md`)
- What is built next: `docs/build-plan.md`
- What was done last: `docs/progress.md`
- Rules for working in this repository with Claude Code: `CLAUDE.md`
- The owner's step-by-step guide: `docs/START-HERE.md`

## Setup

Install once:

- Git
- Node.js 24, version 24.7 or later (passwords are hashed with Node's own Argon2). `node --version` must print `v24`; `pnpm install` refuses any other major version and an older 24. `winget install OpenJS.NodeJS.LTS` installs 24 only while 24 is the newest long-term-support line; once a newer line takes over, download 24 from https://nodejs.org/en/download instead.
- pnpm 12 (`npm install -g pnpm`)
- PostgreSQL 18, running on this machine on port 5432 (installer from postgresql.org). Remember the password you give the `postgres` user.

Then, in the repository folder:

```
pnpm install
pnpm --filter @sodiq/web exec playwright install chromium
```

The second command downloads the browser for `pnpm test:e2e` (about 115 MB, once per machine).

Then the database, once per machine:

```
psql -U postgres -f db/setup/local.sql
copy .env.example .env
pnpm db:migrate
```

The first command asks for the `postgres` password. It creates two database users and the database `sodiq_dev`: `sodiq_migrator` owns the tables and runs the migrations; `sodiq_app` is what the API connects as and has only the rights the migrations give it. Their passwords are public and only for a PostgreSQL on your own machine; the file says so at the top. `.env` is never committed.

## Daily use

```
pnpm dev
```

- Web app: http://localhost:5173
- API: http://127.0.0.1:3000/api/health
- Jobs worker: no address; it logs "The jobs worker is running."

The web app opens on the sign-in page; `pnpm auth:first-account` creates the first account. In development the web server forwards `/api` to the API, so the browser uses one address.

The API and the worker need the migrations applied (`pnpm db:migrate`): both stop at start when the job queue's schema is missing or belongs to another pg-boss version.

The API checks its configuration when it starts and stops with the names of the variables that are missing or wrong. It answers only on this machine (`127.0.0.1`) unless `HOST` says otherwise; `.env.example` lists the variables.

To stop it on Windows, press Ctrl+C twice. After the first press the servers are already stopped, but each task's `cmd.exe` wrapper asks "Terminate batch job (Y/N)?" where nobody can answer, and Turborepo repeats "5 tasks shutting down..." for as long as it waits. The second press ends them and gives the prompt back. Typing Y does nothing.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Runs the web app, the API and the jobs worker, and rebuilds the shared packages on change. |
| `pnpm lint` | ESLint in every package, then the Prettier check. |
| `pnpm format` | Rewrites code files in the Prettier style. Docs and Markdown are never touched. |
| `pnpm typecheck` | Type-checks every package. |
| `pnpm test` | Unit and API tests (Vitest). The API tests need the local PostgreSQL. Each test file gets its own database, copied from a template that is built from `db/migrations` at the start of the run; nothing touches `sodiq_dev`. |
| `pnpm test:e2e` | Browser tests (Playwright). Starts an API and a web app of their own (ports 3001 and 5174) on the database `sodiq_e2e`, which is dropped and built again from the migrations at every run. `sodiq_dev` is not touched, and a running `pnpm dev` is not in the way. |
| `pnpm build` | Builds every package. |
| `pnpm db:migrate` | Applies the SQL files of `db/migrations` that `sodiq_dev` does not have yet, in number order. Refuses to run if an applied file was edited. |
| `pnpm db:codegen` | Writes the Kysely types of `sodiq_dev` to `apps/api/src/database/types.generated.ts`. Run it after `pnpm db:migrate` and commit the file; a test fails if it is out of date. |
| `pnpm api:client` | Writes the OpenAPI document of the API routes to `apps/api/openapi.generated.json` and the typed web client to `apps/web/src/api/schema.generated.ts`. Run it after changing a route or a shared schema and commit both files; two tests fail if they are out of date. |
| `pnpm auth:first-account -- --first-name <name> --last-name <name>` | Creates the first account in `sodiq_dev` and makes it Super Admin, once: it refuses while a Super Admin exists. Prints the generated login and the first password, which is stored nowhere, is valid for 7 days and must be changed at the first sign-in. Names in Latin letters. |

## Continuous integration

`.github/workflows/ci.yml` runs on every pull request and on every push to `main`. It has two jobs, each with its own PostgreSQL 18:

- `checks`: `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, `pnpm test`.
- `e2e`: `pnpm db:migrate`, then `pnpm test:e2e` in Chromium, on the database `sodiq_e2e` that the tests build themselves. When it fails or runs longer than 10 minutes, the Playwright traces are kept for 7 days as the artifact `playwright-traces` of the run.

Both jobs create the database users with `db/setup/local.sql` and use the values of `.env.example`, so a failure is reproduced locally with the same commands. The actions are pinned to a commit; to update one, replace the commit and the version in the comment beside it.

To do once, by the owner, after the workflow's first run on `main`: protect `main` in GitHub (Settings, Branches) and require the status checks `checks` and `e2e`. From then on a pull request can be merged only when both are green.

## Test environment and deploy

A merge to `main` reaches the test environment at `https://app-test.sodiqschool.uz` by itself: after `checks` and `e2e`, the job `deploy-test` applies the migrations to the test database on Neon, asks Render to deploy the API and the jobs worker at that commit, waits until both are live, and runs a smoke test through the real name. The API serves the web app's built files on its own origin (`WEB_FILES`), so web app, API and the live connection share one address. `docs/deploy.md` has the owner's one-time setup (Neon, Render, Sentry, Cloudflare R2, Resend, the GitHub environment `test`), how to take a release back, and what to read when a run fails. `render.yaml` declares the services; `db/setup/server.sql` creates the two database users of a server.

## Layout

```
apps/web                 React single-page app (Vite, Tailwind CSS, shadcn/ui)
apps/api                 NestJS API; one folder per module in src/modules
packages/calc            calculation module, no dependencies
packages/timetable-rules timetable rule engine
packages/shared          code used by both the web app and the API
db/migrations            numbered SQL migrations, never edited after merge
db/setup                 one-time setup of a local PostgreSQL
```

The shared packages compile to `dist`; Turborepo builds them before anything that depends on them. Technical decisions and their reasons are in `docs/decisions.md`.
