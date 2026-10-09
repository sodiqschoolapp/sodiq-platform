# Technology

> Part of the Sodiq School platform spec, baseline of 3 October 2026 (document revision 88).
> Index and reading order: `docs/spec/00-index.md`. Where an edge-case file is more specific than a module file, the edge-case file applies.

The choice is made for correctness first, then speed, then simplicity for one developer to build and run. One language, TypeScript, is used from the browser to the server, so the calculation rules and data types are written once and shared. Every piece below is a mainstream tool with a free or low-cost plan that covers a school of this size: about 200 staff users, 2,000 students and three branches. The stack was checked against current alternatives and prices in October 2026.

| Layer | Choice | Why |
| --- | --- | --- |
| Language | TypeScript everywhere, strict mode | One set of types for browser and server; a class of bugs is caught before the code runs. |
| Web app | React single-page app: Vite, TanStack Router, TanStack Query | The whole app is behind sign-in, so server rendering adds nothing. The built files are served by the server on the same address as the API, so that the cookie session, the cross-site check and the live connection share one origin; there is no separate web server or CDN to keep. The mobile apps can reuse logic later. |
| Design system | Tailwind CSS with shadcn/ui components | Accessible building blocks, one consistent look, fast to build. |
| Journal grid | AG Grid Community (free) | Built for large editable tables: fixed columns, column groups, keyboard entry, undo, smooth scrolling over hundreds of columns. Selecting a range of cells, copying and pasting ranges and the fill handle need one Enterprise licence ($999, paid once). It is bought only if teachers ask for those. |
| Timetable board | Custom board with Pragmatic drag and drop | Drag and drop with live conflict marking, fitted to our rules. It stays smooth with more than a thousand drop cells on one board. |
| Server | Node.js (current long-term-support version) with NestJS; REST API described in OpenAPI, with the browser's API client generated from it; Socket.IO for live updates | Clear module boundaries, a documented API for the future mobile apps, live journals and timetables. With a generated client the browser and the server cannot disagree about a field. |
| Sign-in | The platform's own small module: Argon2id passwords, cookie sessions kept in the database, two-step codes, trusted devices | The needs are narrow and fixed by this spec. No outside sign-in service, no fee per user, and no account data leaves the platform. |
| Database | PostgreSQL. Migrations are hand-written SQL; queries use Kysely with types generated from the database | Rules enforced by the database itself: no double booking of a teacher, room or class; typed numbers, totals and exact results stored as whole numbers; each branch sees only its own rows. These rules are plain SQL that schema tools cannot express, so SQL is the single source and Kysely adds type checking on top. |
| Background jobs | pg-boss, a job queue inside PostgreSQL. No Redis | A job is saved in the same transaction as the data change that caused it, so it cannot be lost. One service fewer to run and pay for. At this size no separate cache is needed. |
| Files | Cloudflare R2 (S3-compatible object storage) | Photos, lesson materials, exports. About $1.50 a month per 100 GB, with no download fees. |
| Timetable auto-generation | Timefold Solver Community Edition (free, open source), written in Kotlin, as a separate service that runs only while generating | An established constraint solver with a ready school-timetabling model. It keeps locked lessons and improves a draft over time. The explanation of a lesson that cannot be placed comes from the platform's own rule engine, because Timefold's own explanation feature is paid. Fallback if the free edition is narrowed further: Google OR-Tools CP-SAT. |
| Exports | PDF by headless Chromium (Playwright) on the server with embedded fonts; Excel by ExcelJS | Correct Uzbek Latin and Cyrillic in PDFs; real numbers and dates in Excel. |
| Offline entry | TanStack Query with a saved queue in the browser (Dexie) | Unsent entries survive a reload and a restart. |
| Interface languages | i18next | Three languages; the same texts can be reused by the mobile apps. |
| Email | Resend | Password resets and notices. Free up to 3,000 emails a month. |
| Messages to parents (Release 2) | Proposed: a Telegram bot for notices, Telegram Gateway for sign-in codes, SMS only for numbers without Telegram | A Telegram notice is free and a sign-in code costs $0.01. An SMS to Uzbekistan through a global provider costs $0.13 to $0.46. |
| Mobile apps (Release 3) | React Native with Expo | Shares types and logic with the web app. |
| Monitoring | Sentry for errors; Grafana Cloud for speed, load, logs and the sign-in-and-save check every 5 minutes; UptimeRobot for uptime; alerts go to Telegram | Problems are seen before users report them. All three have free plans that cover this size. |
| Code and releases | One GitHub repository (pnpm workspaces, Turborepo); GitHub Actions runs the tests and makes the releases | Web app, server, solver and the shared calculation module change together and are tested together. |
| Tests | Vitest, Playwright, fast-check | Unit tests, browser tests as each role, and property tests for the calculation module. |

## Structure

One application made of clear modules, not many small services: setup, people, classes and subjects, timetable, journal, results, lesson plans, notifications, audit. This is simpler to run and to test, and transactions across timetable and journal stay safe. The timetable solver is the only separate service. All code is in one repository: the web app, the server, the solver, and shared packages for data types and for the calculation module.

All result calculations live in one module with no other dependencies. The journal, reports, rating, stipend list and exports all call it. No page calculates a result on its own.

## Security

- Passwords stored with Argon2id. Sessions in secure cookies, ended after a period without use, or kept for 7 days on a trusted device; every session ends 7 days after sign-in at the latest. Sign-in attempts limited. Sign-in is the platform's own module; no outside sign-in service is used.
- Two-step sign-in for the Super Admin and Academic Vice Principal.
- Permissions are checked on the server for every request, by role, branch, subjects and own classes. The menu hides what a role cannot use, but the server is what enforces it. The few routes that work without sign-in are listed in Roles and access.
- Every change to timetable, journal, results, people and settings is written to an audit log that cannot be edited: who, when, old value, new value.
- Personal data is encrypted in transit and at rest. Passport and birth certificate numbers and medical data are shown only to roles that need them, and each viewing is logged.
- Parents see only their own children.

## Hosting and data

- [ ] Hosting is outside Uzbekistan, in Frankfurt (decided by the school). The server, the jobs worker and the solver run on Render; the web app's built files are served by the server on the same address (decided in task 0.10: Render's static sites cannot carry the WebSocket of the live notifications); the database is on Neon; files are on Cloudflare R2. From Tashkent, Frankfurt answers in about 85 ms.

* [ ] Three environments: development, test (a copy of real structure with invented data) and production.

- [ ] Two application servers behind a load balancer. The database is stored in several zones at once and its server restarts by itself, usually within a minute; there is no separate standby server.
- [ ] Backups: continuous, with restore to any minute of the last 30 days (Neon Scale plan), a daily full export kept in a second location (Cloudflare R2), and a restore test every month. A restore opens as a side copy within seconds, which is how damaged entries are repaired without rolling back the live system.
- [ ] Releases are made without stopping the service and outside lesson hours.

## Running cost

Prices for Release 1, read on each provider's own pricing page on 3 October 2026. Taxes are not included. Fixed prices are exact; usage-based items show the unit price and the expected range.

| Item | Plan and size | Price | Per month |
| --- | --- | --- | --- |
| Render workspace | Pro | $25 flat | $25 |
| Render server | 2 instances of 1 CPU, 2 GB | $25 each | $50 |
| Render jobs worker | 1 CPU, 2 GB | $25 | $25 |
| Render test environment | 2 instances of 0.5 CPU, 512 MB, and 1 jobs worker of the same size | $7 each | $21 |
| Render solver | 4 CPU, 8 GB, only while generating | $0.00405 a minute | under $5 |
| Render web app | Served by the server, no service of its own | — | $0 |
| Neon database | Scale plan, 0.5 to 2 CU, always on | $0.222 per CU-hour | $81 to $162 |
| Neon storage and restore history | About 10 GB each | $0.35 and $0.20 per GB | about $6 |
| Neon test database | Launch plan, 0.25 CU, awake all month (the test API keeps it awake) | $0.106 per CU-hour | about $19 |
| Cloudflare R2 | First 10 GB free | $0.015 per GB after that | $0 |
| Sentry | Developer | Free | $0 |
| Grafana Cloud | Free | Free | $0 |
| UptimeRobot | Free | Free | $0 |
| Resend | Free, 3,000 emails a month | Free | $0 |
| GitHub | Team, 1 user | $4 per user | $4 |
| **Total** |  |  | **about $231 to $316** |

Servers of 2 CPU and 4 GB cost $85 each instead of $25, which adds $120 a month. Later or optional: Sentry Team at $29 a month ($26 if paid yearly), Resend Pro at $20 a month for 50,000 emails, Telegram Gateway at $0.01 per delivered sign-in code, and AG Grid Enterprise at $999 once per developer.

Not chosen: AWS (about $550 to $650 a month for the same setup, and more to operate); a self-managed server at Hetzner (about $200, but one developer alone carries every database failure); Railway (no Frankfurt region and an unmanaged database).

## Moving from myss.uz

Nothing is moved from myss.uz at the start, and no import is built for now. Imports are added feature by feature, in the formats the school will give.
