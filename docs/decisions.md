# Technical decisions

Decisions about how the system is built, with the reason. Product rules are in `docs/spec/`, not here. Add an entry when a choice is made that a later session would otherwise question or undo.

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
| Libraries that shadcn/ui components need: `@base-ui/react`, `class-variance-authority`, `tw-animate-css`, `cn`, `@fontsource-variable/geist` | The CLI installs them and its components import them. `cn` is published by the author of shadcn/ui and replaces `clsx` and `tailwind-merge`; it is below version 1.0, and the generated components import it directly, so replacing it would mean patching every component the CLI adds. |
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
