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
- Node.js 24 (`winget install OpenJS.NodeJS.LTS`). `node --version` must print `v24`; `pnpm install` refuses any other major version.
- pnpm 12 (`npm install -g pnpm`)
- PostgreSQL. It is not used yet; task 0.2 connects it.

Then, in the repository folder:

```
pnpm install
pnpm --filter @sodiq/web exec playwright install chromium
```

The second command downloads the browser for `pnpm test:e2e` (about 115 MB, once per machine).

## Daily use

```
pnpm dev
```

- Web app: http://localhost:5173
- API: http://localhost:3000/api/health

The web app shows a placeholder page that says whether the API answers. In development the web server forwards `/api` to the API, so the browser uses one address.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Runs the web app and the API, and rebuilds the shared packages on change. The jobs worker joins in task 0.5. |
| `pnpm lint` | ESLint in every package, then the Prettier check. |
| `pnpm format` | Rewrites code files in the Prettier style. Docs and Markdown are never touched. |
| `pnpm typecheck` | Type-checks every package. |
| `pnpm test` | Unit and API tests (Vitest). |
| `pnpm test:e2e` | Browser tests (Playwright). Starts `pnpm dev` by itself if it is not running. |
| `pnpm build` | Builds every package. |
| `pnpm db:migrate`, `pnpm db:codegen` | Not built yet: task 0.2. They stop with a message. |
| `pnpm api:client` | Not built yet: task 0.4. It stops with a message. |

## Layout

```
apps/web                 React single-page app (Vite, Tailwind CSS, shadcn/ui)
apps/api                 NestJS API; one folder per module in src/modules
packages/calc            calculation module, no dependencies
packages/timetable-rules timetable rule engine
packages/shared          code used by both the web app and the API
```

The shared packages compile to `dist`; Turborepo builds them before anything that depends on them. Technical decisions and their reasons are in `docs/decisions.md`.
