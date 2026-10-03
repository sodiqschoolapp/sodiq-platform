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
| `GET /api/health` is public | Uptime monitoring and the deploy smoke test call it without a session. It answers only `{"status":"ok"}`. |
| LF line endings through `.gitattributes` | A Windows clone otherwise gets CRLF and the Prettier check fails. |
| One ESLint config at the root; `pnpm lint` also runs the Prettier check; Prettier ignores `docs/`, `.claude/` and Markdown | One command checks everything, and the spec can never be reformatted by a tool. |
| shadcn/ui with the `nova` preset on Base UI, Lucide icons and the Geist font served from our own files | These are the CLI's current defaults. Geist has Latin and Cyrillic sets. The look is reviewed in tasks 0.8a and 0.8b. |
| NestJS tests run on Vitest's own transform, without an SWC plugin | It emits the decorator metadata NestJS needs. `apps/api/src/testing/injection.test.ts` fails if that ever stops. |
| pnpm's release-age protection stays on, with no exceptions | pnpm does not install a package version published in the last two days. When the newest version is too young, the previous one is used. |
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
