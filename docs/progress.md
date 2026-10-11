# Progress log

Newest entry first. Each finished task adds an entry: what was built, what was left out, and what the next session must know. A session that stops half-way writes where it stopped.

## 11 October 2026: the loop runs without the owner (process change, no task)

- Decided by the owner: when the spec is silent, a session decides, writes the reading under "Decided without the owner" and flags it on issue #42; only the five things under "Stop and wait for the owner" in `CLAUDE.md` stop a task. The reviewer confirms or changes every decision in its approval, merges at `[review] ready to merge` with green checks, and stops a task after three rounds (`needs-owner`). The ten decisions and the owner's 24 answers for tasks 1.3 to 1.6 are in `docs/decisions.md`, 11 October 2026.
- Changed: `CLAUDE.md`; the skills `next-task`, `finish-task` and `review-pr`; `.claude/agents/spec-reviewer.md` (four checks from the 1.2 review); `.claude/rules/web.md` (the text rule of issue #39); `docs/cloud-loop.md` (the review routine and the start routine with their full prompts); `docs/build-plan.md` (1.5 before 1.4, an owner gate before every phase from Phase 2 on, the fix-task convention); `docs/recipes/record-type.md` (the recipe for a new record type, from the code of 1.1 and 1.2).
- New: `pnpm test:changed` (the tests touched by the files changed since `origin/main`, with a build of the shared packages first; a session runs it instead of the full suite, which CI runs on the pull request) and the PostToolUse hook `scripts/hooks/format-written-file.mjs`, which runs Prettier on every file a session writes.
- A report now has "What to look at", "What the browser test proved" and "Decided without the owner"; the owner hand-tests on the test environment after the merge and answers issue #42 each morning.
- From the review of pull request #43 (the owner's second audit of the method): the reviewer merges only the sha it reviewed and never auto-merges, one start per task, three red CI runs stop a task, a task pull request may not change the loop's own rules, a stalled task is resumed by the start routine, the routines run hourly, `@abbosc` on every comment that needs the owner, `pnpm format` first, `forceRerunTriggers` for the shared sources, CI checks merged migrations and audits the dependencies, progress entries of at most 15 lines, "Texts to read" on every pull request that changes a locale file.
- The next task is 1.3; the order is 1.3, 1.5, 1.4, 1.6. The owner gate before Phase 2 stops the start routine after 1.6.

## 10 October 2026: task 1.2 Divisions and departments

Plan approved by the owner on pull request #40 (`[review] approved`, with the answers to the eight questions: the active-staff refusal moves to 2.2; the missing Russian and Uzbek names as proposed, Academic's Russian name `Учебный отдел`; two school-wide tables; departments archived and restored with their division, never moved; the permission area `divisions` with the view of the Principal and the Academic Vice Principal; names unique per language among active records; Tutors is plain data; the trigger; and one correction: an explicit `position` column for the order of both lists). The decisions are in `docs/decisions.md`, 10 October 2026 (task 1.2). Nothing under `docs/spec/` was touched.

Built:

- `db/migrations/0015_divisions_departments.sql`: `divisions` (three names, `built_in`, `position`, `archived_at`) and `departments` (`division_id`, three names, `position`, `archived_at`), both school-wide; three partial unique indexes per table on the lowered trimmed names of active rows and one on the position; the trigger `divisions_built_in_guard` (`before update`, refuses a change of Academic's names or `archived_at` for every user with `restrict_violation`); grants `select`, `insert` of the names and the position, `update` of the names and `archived_at`, no delete; the seed of the eight divisions and fourteen departments of `03`, one insert each in the spec's order. Types regenerated.
- `packages/shared`: `namesSchema`, `divisionRecordSchema`, `departmentRecordSchema`, `divisionSchema`, `departmentSchema`, `divisionListSchema`, `DIVISION_NAME_MAX_LENGTH` in `setup.ts`; the error code `built_in`; the area `divisions` of `PERMISSIONS`.
- API (`modules/setup/`): `divisions.service.ts` and `divisions.controller.ts` with nine routes (`GET /api/setup/divisions` bound to the branch of the request; `POST /divisions`, `PUT /divisions/:id`, `POST /divisions/:id/archive|restore|departments`, `PUT /departments/:id`, `POST /departments/:id/archive|restore` as school-wide work with entries in `audit_log_school`); `ApiException` carries optional `details`, which `sendError` answers; `refusingDuplicates` maps the violated unique index to the field in `details`. `ROUTE_ACCESS`, the OpenAPI path list, the public-routes list and `SCHOOL_WIDE_TABLES` extended; the web client regenerated.
- Web (`features/setup/`): `divisions-page.tsx` (the list with the name in the chosen language, active departments and status; filter by status; bulk Archive and Restore naming the refused rows; "Add division" above the list), `division-panel.tsx` (`NamesForm` with the three name fields and the taken name shown beside its field; `DivisionPanel` with Academic's names read-only and the built-in line, archive and restore, the departments table with rename, archive, restore and "Add department"), `setup-api.ts` (`divisionsQuery`, `divisionsKey`, `invalidateDivisions` over every branch's list, `nameOf`); `ApiFailure.details`; the link on the setup page, the route, the page in the Ctrl+K index. Texts `setup.divisions.*`, `setup.divisionsLink*` and `errors.built_in` in uz, ru, en.
- Browser test in `e2e/setup.spec.ts` with a seeded `divisions` Super Admin account: Academic shown as built in without a rename form or an archive button; a division added with a department; the department renamed; the division archived with its department.
- Tests: shared `setup.test.ts` and `permissions.test.ts`; API `setup.database.test.ts` (the seed in the spec's order, the trigger for the application and the migrator, no write of `built_in`, no delete, no move or reorder, the unique names per language with a Cyrillic duplicate that differs in case only, the foreign key, the checks, the unique position), `divisions.test.ts` (the list and its readers, every route for the Super Admin with the audit entries naming the assignment and the request, `built_in`, `archived_record`, `already_exists` with the language in `details`, the cascade archive and restore, the refusals of the Principal, the Academic Vice Principal and a Teacher on every writing route, validation), `route-permissions`, `openapi`, `public-routes`, `catalog`; web `divisions-page.test.tsx` (14, including the Russian names and the invalidation of every branch's list), `setup-page.test.tsx`.

Left out, with the task that brings it:

- The refusal of an archive while an active staff member is in the division (409 `archive_refused`), and the staff counts per division: 2.2, noted on its Build line in the build plan. This is the second half of 1.2's "done when".
- Subjects grouped by departments and the refusal of an archive while a subject is in a department: 2.1. The division and department columns and filters of the staff list: 2.2. Export of the list: 2.2. Forced delete: 2.6.
- The setup checklist of `edge/academic-year` lists "departments" per branch while the list is school-wide: 1.6 decides what the per-branch item means.
- A reordering control for divisions and departments: none asked for.

Open, for the owner:

- The Russian division names and the Uzbek and Russian department names are the owner's starting values from the plan; nobody else reviewed them. Academic's cannot be changed in the app (a migration that disables the trigger for its statement can).
- The Uzbek and Russian wording of `setup.divisions.*` and `errors.built_in` was not reviewed by anybody.

The next sessions must know:

- `divisions` and `departments` have no branch: a service reads and writes them in `transactions.run([], ...)` or in any branch's transaction alike; their audit entries go to `audit_log_school` (`branchId: null`).
- Academic is the row with `built_in`; `sodiq_app` cannot write that column, and the trigger refuses a change of its names or `archived_at` for the migrator too (`alter table divisions disable trigger divisions_built_in_guard` for one statement when a migration must).
- A new division or department takes `max(position) + 1` over every row, archived ones included; the divisions rows are read `for update` first, and the division row for a department.
- `ApiException(code, status, retryAfterSeconds?, details?)`: a refusal about one field names it in `details` as a validation failure does; `refusingDuplicates(work, { <unique index>: '<path>' })` fills them from the constraint name. In the web app `ApiFailure.details` carries them; `takenNameOf` in `division-panel.tsx` reads the language.
- A record with names in three languages is one `NamesForm` with the fields `uz`, `ru`, `en` and `namesSchema` as the form's schema (the form hook reads issues by the first path element, so the schema of a form is flat); the route body is `{ names }`.
- A query of a list that is the same in every branch keeps the branch in its key (the call carries the header) and is invalidated by its prefix (`invalidateDivisions`).

The next task is 1.3.

## 10 October 2026: task 1.1 Branches, buildings, floors and rooms

Plan approved by the owner on pull request #37 (`[review] approved`, with the answers to the nine questions: contacts are one phone and one email; Monday to Friday by default; the time zone fixed to Asia/Tashkent; no archiving of a branch; the Academic Vice Principal views both areas; room names unique per branch; buildings and floors archived only when every room on them is closed, rooms never archived; a bulk "Change status" on the room list; the typed bounds as proposed). The decisions are in `docs/decisions.md`, 10 October 2026. Nothing under `docs/spec/` was touched.

Built:

- `packages/shared/src/setup.ts`: the schemas and constants of the branch record (`branchRecordSchema`, `workingWeekdaysSchema`, `WEEKDAYS`, `DEFAULT_WORKING_WEEKDAYS`, `DEFAULT_TIME_ZONE`), of buildings, floors and rooms (`ROOM_TYPES`, `ROOM_STATUSES`, the capacity and shared-room bounds, `roomRecordSchema` with the shared rule), the answer schemas and `setupIdParamsSchema`. Four error codes: `already_exists`, `archive_refused`, `floor_archived`, `archived_record`. The first two areas of `PERMISSIONS`: `branches` and `rooms`.
- `db/migrations/0014_branches_buildings_floors_rooms.sql`: `branches` gets `address`, `phone`, `email`, `working_weekdays` (default Monday to Friday), `time_zone` (default Asia/Tashkent, not updatable by `sodiq_app`), a name check and a unique index on the lowered trimmed name; `buildings`, `floors`, `rooms` as branch tables with the `branch_filter` policy, the composite foreign keys `(building_id, branch_id)` and `(floor_id, branch_id)`, the checks of the lists (equal to the constants, compared by a test), the partial unique indexes on active names (rooms: over every room of the branch), `archived_at` on buildings and floors, grants without delete. Types regenerated.
- API (`modules/setup/`): `Branches` (create as school-wide work with an entry in `audit_log_school`; read and edit of the branch of the request), `Buildings` (list with floors and room counts; create, rename, archive, restore of buildings and floors; archive refused while a room is in use or under repair; a building's archive takes its active floors and its restore brings back exactly those; no rename of an archived record; a floor not restored while its building is archived), `Rooms` (list with floor and building names; create and edit, the floor share-locked and required active; a room on an archived floor can only be moved), `setup-refusals.ts` (`refusingDuplicates`: 409 `already_exists` from the unique index; `changesOf` for the audit entries). Fifteen routes under `/api/setup` (`POST /branches` with `branch: 'none'`; `GET`/`PUT /branch`; `GET`/`POST /buildings`, `PUT /buildings/:id`, `POST /buildings/:id/archive|restore|floors`, `PUT /floors/:id`, `POST /floors/:id/archive|restore`; `GET`/`POST /rooms`, `PUT /rooms/:id`), every change audited with the assignment and the changed fields old and new. OpenAPI and the web client regenerated; `ROUTE_ACCESS`, the OpenAPI path list and the public-routes list extended; `SAMPLE_PERMISSIONS` now includes the real table.
- Web (`features/setup/`): `setup-page.tsx` (the entry of the menu item, links per area the role may view), `branch-page.tsx` (`BranchForm` with `CheckboxGroupField` for the weekdays named by `Intl`; read-only details for the Principal and the Academic Vice Principal; "New branch" with the switch of the tab to the new branch), `buildings-page.tsx` and `building-panel.tsx` (the list; the panel with rename, floors, add floor, archive and restore; bulk archive and restore that name the refused ones), `rooms-page.tsx` and `room-form.tsx` (the room list with filters by building, floor, type and status; the form with building then floor, the shared switch showing the number of lessons; "Add room" switched off without an active floor; bulk status changes that name the rooms on archived floors), `setup-api.ts` (queries keyed by branch, `activeFloorsOf`, `weekdayName`). `CheckboxField` and `CheckboxGroupField` in `components/field.tsx`; `branchHeader()` in `api/client.ts`; `SETUP_PAGES` and `indexedPages` in `page-index.ts` for the Ctrl+K search; `BUILT_PAGES.setup`; the four routes. Texts `setup.*` and the four `errors.*` in uz, ru, en.
- Browser test `e2e/setup.spec.ts` with the seeded `superAdmin` account (the test sets up the second step): the branch's Saturday saved, a building, a floor and a room created, the floor's archive refused while the room is in use and done once it is closed.
- Tests: shared `setup.test.ts` and the table rows in `permissions.test.ts`; API `setup.database.test.ts` (filter, composite keys, checks, unique indexes, rights), `branches.test.ts`, `buildings.test.ts`, `rooms.test.ts` (the rules above, the refusals of the Principal, the Academic Vice Principal and a Teacher on every writing route and in another branch, the audit entries with the assignment, the two lock tests); web `setup-page.test.tsx`, `branch-page.test.tsx`, `buildings-page.test.tsx`, `rooms-page.test.tsx`. Full run here: lint, typecheck, `pnpm test` (API 65 files, 1323 tests; web 26 files, 388 tests; shared 93), and `pnpm test:e2e` (14 browser tests) since `apps/web/e2e/` changed.

Reviewed by the spec reviewer (`not ready`, one must-fix and four should-fix, all applied) and the permission reviewer (`ready`, four notes, three applied). Fixed from the reviews: the floor of a room is read with a share lock, so a save of a room and the archive of its floor or building wait for each other (two tests hold the lock and show the other call waits); 409 `floor_archived` instead of "not found" for an archived floor, and the bulk status change names the rooms it could not change; 409 `archived_record` for a rename of an archived building or floor (the partial unique indexes cover active names only) and for a floor restored while its building is archived, and the panel shows no rename form for an archived building; the `branch: 'none'` question left by 0.7b is decided (such a route only for an action whose row names school-wide roles; the harness proves it per route); explicit refusals of the Academic Vice Principal on every writing route of buildings and floors, other-branch ids on the four routes that lacked them, the assignment asserted on every audit action. Earlier, from the database test: the check of a shared room said nothing about `null` and passed one; it says `is not null` now.

Left out, with the task that brings it:

- The setup checklist per branch in a fixed order, and "an action whose prerequisite is missing is switched off" beyond "Add room" (`edge/academic-year`): with the academic year (1.3).
- The go-live start date of a branch: 1.3 or 10.4, as the owner names it.
- Dated room closures, "needs a room", "move all to room R", the main classroom of a class, travel time between branches, the capacity of a shared room checked against all its lessons: the timetable tasks (3.1, 5.x). The status `under_repair` is the room's state as typed, not a dated closure.
- The export of the room and building lists: 2.2. Forced delete: 2.6. Record search in Ctrl+K: the task that adds it. Undo of an edit: the first action that offers it (restore is the undo of an archive).
- A field for the time zone of a branch: the first task that needs another value.

Open, for the owner:

- Migration 0014 changed after it was applied to `sodiq_dev` (the check `rooms_shared_check` says `is not null` now). The tests build their databases from the files and are unaffected; `sodiq_dev` keeps the first version of the check until the owner re-applies it (drop and add the constraint, or reset the database); nothing in it depends on the difference.
- The Uzbek and Russian wording of `setup.*` and the four error texts was not reviewed by anybody.
- Whether `Intl.DateTimeFormat('uz')` names the weekdays in Latin script in the school's browsers (ICU's default for `uz` is Latin; the tests check Russian and English names).

The next sessions must know:

- `working_weekdays` can hold a repeated day at the database level (the check keeps the range and the count only); the shared schema refuses repeats and the reads dedupe. The first task that reads the column in SQL (the calendar, 1.3) adds the constraint or stores seven booleans.
- A room on an archived floor can only be moved (decided by the owner at the code review of 1.1): `PUT /api/setup/rooms/:id` answers `floor_archived` unless the new floor is active; a floor added to an archived building, a rename of an archived building or floor and a restore of a floor in an archived building answer `archived_record`.
- A route bound to a branch is called from the web with `params: { header: branchHeader() }` (`api/client.ts`), which the generated client requires; the middleware sets the same header. The queries of a feature carry `branchId` of `useView()` in their keys.
- A record form that is not yet in a list (a new branch, building or room) lives in a section above the page or the list, opened by the header's button, with a Cancel that asks through `useLeave().leave()`; the side panel of `ListPage` opens existing rows only.
- `CheckboxField` holds `CHECKED` (`'on'`) or empty; `CheckboxGroupField` holds the ticked values joined by commas (`listValue`, `listValues`); the form reads them in `read`.
- A new error code needs its line in `apps/api/src/http/error-response.ts` as well as the three locale files; the API build fails otherwise.
- A test that signs in a Super Admin or an Academic Vice Principal and moves the clock keeps within the 15-minute idle limit.
- A `POST` that is not a creation says `@HttpCode(200)`; NestJS answers 201 otherwise.
- `SAMPLE_PERMISSIONS` of the test controllers spreads `PERMISSIONS`: the application's routes answer as in the application beside the sample routes.

The next task is 1.2.

## 10 October 2026: task 0.10, follow-up from the first run of `docs/deploy.md`

- `db/setup/server.sql` asks the passwords with `\prompt` and `create role … password` again: Neon refuses psql's `\password` ("Neon only supports being given plaintext passwords"); the header and step 1.3 of `docs/deploy.md` say so, that the typed password shows (close the terminal), and that it is letters and digits only because it goes into an address.
- `render.yaml` runs the pinned pnpm through `npx -y pnpm@<version>` in every command of both builds: Render's build machine has a read-only global npm folder, so `npm install -g` fails with EROFS; `render-blueprint.test.ts` keeps the version equal to `packageManager` in the npx form, and step 3.3 of `docs/deploy.md` describes it.

## 9 October 2026: task 0.10 Test environment and deploy pipeline

Plan approved by the owner on pull request #35 (`[review] approved`, with the answers to the six questions and six corrections). The decisions are in `docs/decisions.md`, 9 October 2026. Answer 1 is a spec change: the API serves the web app's built files on its own origin (no Render static site, which cannot carry the WebSocket of 0.9); the owner corrects `13` (Web app row, Hosting bullet, the cost table) with `/spec-change` after this merge. Nothing under `docs/spec/` was touched here.

Built:

- Configuration (`config.ts`): `TRUST_PROXY` (`0`/`1`), `WEB_FILES` (a directory, or none), `SENTRY_DSN` (or none), `SENTRY_ENVIRONMENT` (default `development`), `RENDER_GIT_COMMIT` as the release; in `.env.example` (commented, server only), `apps/api/turbo.json` (`dev`, `dev:worker`) and `apps/web/turbo.json` (`build`: `VITE_SENTRY_DSN`, `VITE_SENTRY_ENVIRONMENT`, `RENDER_GIT_COMMIT`). `createTestApp({ config })` overrides them in a test.
- One origin behind a proxy: `ownOriginOf(request, trustProxy)` in `same-site.ts` serves the cross-site middleware (`sameSiteMiddleware(trustProxy)`) and the Socket.IO handshake; `configureApp` sets Express's `trust proxy` to the same. Without trust a forged `X-Forwarded-Proto` is ignored.
- The web app served by the API (`http/web-files.ts`): every GET/HEAD outside `/api` is the web app (a file, or `index.html`); `/assets/*` immutable for a year, the rest `no-cache`; a climbing path gets `index.html`; other methods fall to the API's 404; nothing is served when `WEB_FILES` is unset. The API's answers keep `no-store`.
- Graceful stop: `main.ts` calls `enableShutdownHooks()`; the listener, the sockets (closed without `session.ended`), the queue and the pool close in order; `ReportingModule` (last of `SHARED_MODULES`) closes Sentry with a 2 s limit at the end.
- Error reports (`apps/api/src/reporting/`, `apps/web/src/reporting/`): `@sentry/node` and `@sentry/browser` 11.5.0 (11.6.0 was a day old; pnpm's release-age protection stays on, as decided in 0.1). `startReporting` in both entry points before the application, every default integration off, no tracing or breadcrumbs, `beforeSend` as an allow-list (`reportedEvent`: id, timestamp, platform, level, environment, release, SDK, the exception without frame variables, the tags `request_id`/`job`/`part`; the web app also the page's path without query and hash). `reportFault(error, tags)` beside every logged fault: the 500, a failed job, the queue's errors, the listener, the socket server; it never awaits. An uncaught exception or an unhandled rejection is reported and ends the process within the limit (`shutdownTimeout`). The web app's root reports render faults through React 19's root options (`rootOptions`); `vite.config.ts` defines `VITE_RELEASE` from `RENDER_GIT_COMMIT`.
- Deploy commands (`apps/api/src/deploy/`, compiled with the API): `render.ts` (`deployServices`: one deploy per service at the commit through Render's API, a look every 15 s, at most 80 looks, no clock read; a failed status names the service and the deploy), `smoke.ts` (`smokeTest`: health with `no-store` and no `x-powered-by`; the web page with `no-cache` and the root element; `GET /api/auth/session` 401 in the error shape with a request id; a form body 415; a WebSocket upgrade of `/api/socket` without a cookie refused `not_signed_in`, read from the Socket.IO packets with Node's own `WebSocket`), `cli.ts` (`deploy --commit <sha> <services>`, `smoke <url>`; `RENDER_API_KEY` from the environment, never printed).
- `.github/workflows/ci.yml`: the job `deploy-test` (push to `main` only, `needs: [checks, e2e]`, GitHub environment `test`, concurrency `deploy-test` without cancelling, job-level `DATABASE_MIGRATION_URL` from the secret with the two local values emptied): `pnpm db:migrate`, `deploy` with `RENDER_API_KEY` and the two service ids, `smoke` against `TEST_URL`.
- `render.yaml`: `sodiq-test-api` (web, Frankfurt, 2 × `0.5c-512mb`, build with the pinned pnpm then API and web, `node --enable-source-maps apps/api/dist/main.js`, `healthCheckPath /api/health`, `autoDeployTrigger: off`, `maxShutdownDelaySeconds 30`, the domain `app-test.sodiqschool.uz`, `HOST`, `TRUST_PROXY`, `WEB_FILES`, the environments) and `sodiq-test-worker` (worker, same size); `DATABASE_URL`, `SECOND_STEP_KEY`, `SENTRY_DSN`, `VITE_SENTRY_DSN` as `sync: false` per service. `render-blueprint.test.ts` keeps the pnpm version equal to `packageManager` and the secrets as `sync: false`.
- `db/setup/server.sql`: the two roles of a server database with SQL (`\prompt` for the passwords; `sodiq_migrator` without `createdb`; `revoke connect from public`), run once by the owner against Neon. The headers of `local.sql` and `.env.example` and the 0.2 line of `docs/decisions.md` no longer say "in the provider's dashboard".
- `docs/deploy.md`: how a deploy runs, the two rules of a release (migrations work with the running version; fix forward), the queue of deploys, taking a release back, what to read when a run fails, the owner's one-time steps in order (Neon, Sentry, Render with the Blueprint and the DNS record, R2, GitHub environment `test`, Resend, the first deploy and the first account), the rare cases (damaged oldest second-step row, lost key, migrations 0006/0008, an uncaught exception, Sentry unreachable). `README.md` points to it.
- Tests: `config.test.ts` (the new variables), `proxy.test.ts` (an HTTPS origin behind a trusted hop for a POST and the handshake, the wrong protocol and another site refused, a forged header ignored without trust, the first value of an appended header), `live.test.ts` (a forged header while no proxy is trusted), `web-files.test.ts` (12), `shutdown.test.ts` (the listener's connection gone, the socket closed with `transport close` and no `session.ended`, the session kept), `reporting.test.ts` (the allow-list keys exactly, the frames without variables, the tags, nothing of a person or a request, the 500 with its request id and without the row's values, nothing for a refused request, a failed job with its name, a listener fault as `live`, a network that never answers delays no answer and no caller, the stop within the limit, the exit after an uncaught exception within the limit), `deploy/render.test.ts` (success, the five failing statuses, the poll limit, a refusal and a non-deploy answer, the key never printed), `deploy/smoke.test.ts` (every check against the test app with web files, the failures named, nothing answering), `render-blueprint.test.ts`; web `reporting.test.ts` (the allow-list, the page without query and hash, the frames, nothing of a person or a browser, `pageOf`, the root options). Full run here: lint, typecheck, `pnpm test` (API 61 files, 1249 tests; web 22 files, 348 tests; shared 65). `apps/web/e2e/` unchanged, so the browser tests were left to CI.

Reviewed by the spec reviewer (no new route: no permission review) and by the owner's reviewer at the code review (`[review] changes needed`, nine items, all applied: the Blueprint test walks the lines by index and covers `VITE_SENTRY_DSN`; `server.sql` asks the passwords with psql's `\password` and the guide uses the console role's address without its password; `WEB_FILES` is checked at start (`checkWebFiles`: no `index.html`, no start), so a broken web build never takes traffic; `waitForDeploy` judges the last look too; `rootOptions` prints the fault beside the report; `immutable` is decided from the resolved file, the API prefix is matched without case, files go through `pipeline`; the deploy job passes its values through `env`; the Blueprint's Auto-Sync is turned off after creation; a download the browser abandons mid-transfer is neither logged nor reported). Fixed from the spec review: `docs/deploy.md` says the first start after the Blueprint's creation fails until the migrations of step 7 (the job queue's schema is missing) and that only the build must succeed there; `shutdownTimeout: STOP_LIMIT_MS` on `Sentry.init` with the exit-path test; `shutdown.test.ts`; the comment on an appended `X-Forwarded-Proto` (Render sets the header itself; the first value is read as Express does, and a wrong claim only fails the check); `ReportingModule` last in `SHARED_MODULES`, so its shutdown hook runs after the pool's; the key of a rollback read with `read -s`; `\prompt` echoes, so the terminal is cleared.

Left out, with the task that brings it:

- Production, its Neon project, its GitHub environment with the owner's approval (releases outside lesson hours), the go-live checklist: 10.4.
- Grafana Cloud, UptimeRobot, alerts to Telegram, the sign-in-and-save check, the daily export to R2, the restore drill, request logging: 10.2. Sentry source maps of the web app: 10.2 (the API's stack traces already name TypeScript lines with `--enable-source-maps`).
- The mail service and `RESEND_API_KEY`: 2.3 (the owner creates the Resend account now, EU region, no domain). The R2 token: the first task that stores a file (the bucket `sodiq-test-files` is created now).
- The invented data of the test environment (`13`, "a copy of real structure with invented data"): the owner names the task.
- The solver service on Render: 5.x. The application version on every request: 8.3a.

Open, for the owner:

- The one-time setup of `docs/deploy.md` (Neon, Sentry, Render, R2, GitHub, Resend, the DNS record) must be done before the first merge after this one proves the pipeline; the task's "done when" is met at that first green `deploy-test` run. Render's build image (pnpm pick-up), Neon's right to create `btree_gist`, and the custom domain are the three things only that run can prove; a failure there is a small follow-up on `render.yaml` or the guide.
- The `/spec-change` of `13` (Web app row, Hosting bullet, the cost lines: no static site; Neon Launch for the test environment; a test worker).
- Render's `X-Forwarded-Proto` is assumed to be set by Render itself (one value). If Render appended to a client's value, the first value would be the client's claim; the check would still only fail, never pass wrongly.

The next sessions must know:

- A server variable goes into `config.ts`, `.env.example`, `apps/api/turbo.json` (and `apps/web/turbo.json` for a build-time `VITE_*`), `render.yaml` and, if it is a secret, `docs/deploy.md`; `ci.yml` only for the deploy job's secrets.
- `createTestApp({ config: { trustProxy, webFiles } })` overrides the configuration of a test app. The web files are served before every API middleware; a test of a page path needs `webFiles` set.
- A fault that is logged is also reported: call `reportFault(error, { requestId | job | part })` beside the log line; nothing else calls Sentry. A report holds only what `reportedEvent` keeps; a new tag needs the allow-list and its test. Tests that need reports start them with `startReporting(config, { transport, processHandlers: false })`; closing a test app stops them (`ReportingModule`).
- `ownOriginOf(request, trustProxy)` is the one reading of the own origin; nothing else reads `request.protocol` or `socket.encrypted`.
- The deploy commands are `node apps/api/dist/deploy/cli.js deploy|smoke`; `pnpm db:migrate` builds them. The smoke test's checks are the list in `smoke.ts`; a new public behaviour worth proving after a deploy is one more entry there and in `smoke.test.ts`.
- The worker on Render starts with `node --enable-source-maps apps/api/dist/worker.js` (the Blueprint), not through pnpm.

The next task is 1.1.

## 8 October 2026: task 0.9 Notifications to staff in the app

Plan approved by the owner on pull request #32 (`[review] approved`, with the answers to the ten questions). Answer 10: the owner's `/spec-change` adds reading and marking his own notifications to the Principal's own-account changes in a pull request of its own, which merges before this one; at the end of this task it was not on `main` yet. The decisions are in `docs/decisions.md`, 8 October 2026.

Built:

- `packages/shared/src/notifications.ts`: `NOTIFICATION_KINDS` (the registry of kinds with the schema of their data; `sample.message` only), the kind format, `notificationSchema`, `notificationListSchema`, `notificationParamsSchema`, `NOTIFICATION_LIST_LIMIT` (50), the socket path `/api/socket`, the names of the messages (`notification.state`, `.new`, `.read`, `.read_all`, `session.ended`) and their schemas.
- `db/migrations/0013_notifications.sql`: `notifications` (school-wide with a `branch_id` label, in both lists of `catalog.test.ts`), with the kind format check, `read_at >= created_at`, the three indexes, `select, insert` and `update (read_at)`. Types regenerated.
- API (`modules/notifications/`): `Notifications.send` (the helper later tasks call), `list`, `markRead`, `markAllRead`; the job `notifications.deliver` (`deliver.job.ts`, the first entry of `JOB_DEFINITIONS`; its handler issues NOTIFY in chunks of 100 ids); `live/live-payload.ts` (the channel `sodiq_notifications`, the payload schema, `notifyLive`); `live/socket-server.ts` (`LiveSockets`: the Socket.IO server, the handshake, the state at connection, `tell` with the session check before every push); `live/listener.ts` (`LiveListener`: the `pg` client that listens and pushes); the three routes `GET /api/notifications`, `POST /api/notifications/:id/read`, `POST /api/notifications/read-all` (`@AnySignedIn()`). `Sessions.peek` (by token or by session ids; refuses what `resolve` refuses, writes nothing) and `owedStepOf`; `fromOwnSite` of `same-site.ts` shared with the handshake; `readSessionToken` takes any request with a `Cookie` header. `main.ts` attaches the sockets and starts the listener; `createTestApp` attaches the sockets and takes `jobsPollingIntervalSeconds`. Dependencies: `socket.io` (API), `socket.io-client` (web; devDependency of the API). OpenAPI and the web client regenerated.
- Web (`features/notifications/`): `notifications-api.ts` (the query and the cache changes), `live.ts` (`connectWithSocketIo`, `liveFollower`, kept by `createShell`, which takes a `LiveConnector`), `notifications-button.tsx` (the bell with the badge and the dialog); the Vite proxy forwards WebSockets. Texts `notifications.*` with `kinds.unknown` and `kinds.sample.message` in uz, ru, en.
- Browser tests: the API of the tests also runs the worker (`testing/e2e/server.ts`), the command `testing/e2e/notify.ts`, the seeded account `notifications`, `e2e/notifications.spec.ts` (a notification sent before sign-in, one arriving live, "Mark all as read", one marked by a click).
- Tests: shared `notifications.test.ts`; API `notifications.database.test.ts` (checks, keys, rights), `notifications.test.ts` (the helper, the rollback, the refusals, the chunked NOTIFY with 250 accounts, the second delivery, the list with the branch name and the limit, the read marks, 401 and the owed steps, no audit entry), `live.test.ts` (the state, no use of the session, the refusals of the handshake, the push to the right person and nobody else, the read marks across tabs, the state at a reconnection, the ended session told and closed, no action on a client message); `route-permissions`, `public-routes`, `catalog`, `openapi`, `worker.test.ts` (the job list beside the sample job) updated. Web `notifications.test.tsx` (15), `live.test.ts` (15), `locales.test.ts` (a text for every kind). Full run here: lint, typecheck, `pnpm test` (API 54 files, 1185 tests; web 21 files, 337 tests; shared 65), and `pnpm test:e2e` (13 browser tests, the new one included) since `apps/web/e2e/` changed.

Reviewed by the spec reviewer and the permission reviewer (the routes: ready). Fixed from the reviews: a fault while the session is read during a handshake refuses with `internal_error` instead of hanging and ending the process; after such a refusal, or a close by the server without `session.ended`, the tab opens the connection again after a wait that doubles from 5 s to 60 s (socket.io-client does not try again by itself after a refused handshake); the three owed steps are tried on every route; a locked account is tried with its session row left open; a session that newly owes a step at a push is told the step and closed; the data of a kind fills the `{{names}}` only (`replace`); the listener reads the rows once with their account; a test compared an audit count with itself.

Left out, with the task that brings it:

- Notification settings: the first task that adds a kind that may be turned off (a section of the account page of 0.8d and the rule which kinds are required); Release 2 adds the channels (owner's answer 6).
- The real kinds (timetable change, substitution, lock, unlock request, plan window, mark correction, forced delete): each with the task that raises the event, which adds the kind, its data schema and its three texts, and computes the recipients.
- A link from a notification to its record: with the first kind that has a page to open.
- A page `/notifications` with paging: a small follow-up when the owner asks (answer 9). Retention: nothing is removed (answer 8).
- SMS, Telegram, night hours, parents and students, announcements: Release 2.
- Long polling as a second transport: the owner may ask for it with sticky sessions in 0.10.

Open, for the owner:

- The spec change of answer 10 (the Principal reads and marks his own notifications) merges before this pull request; until then the three routes are ahead of the spec for the Principal.
- The Uzbek and Russian wording of `notifications.*` was not reviewed by anybody.
- Whether the school's browsers send `Sec-Fetch-Site` on a WebSocket upgrade was not checked by a person; the browser test's Chromium connects through the Vite proxy, and without the header the handshake falls back to the `Origin` rule, which browsers always send on a WebSocket upgrade, so both paths admit the own site.
- A tab whose connection the server closed without `session.ended`, or refused for a reason that is not about the session, tries again after 5 s, 10 s, … 60 s; the listener of the API reconnects after a second when its database connection drops. Neither is tested against a real outage.

The next sessions must know:

- To notify: `notifications.send(transaction, { kind, data, branchId, accountIds })` in the transaction of the change (`.claude/rules/api.md`). A new kind: `NOTIFICATION_KINDS` plus `notifications.kinds.<kind>` in the three locale files (the key path follows the dots of the kind); `locales.test.ts` fails otherwise.
- `createTestApp` attaches the sockets; a test of pushes starts `app.get(JobRunner).start()` (with `jobsPollingIntervalSeconds`) and `app.get(LiveListener).start(database.appUrl)`, as `live.test.ts`. A test that overrides `JOB_DEFINITIONS_LIST` must keep `JOB_DEFINITIONS` in the list: `NotificationsModule` names its handler at start.
- In the web tests `renderApp(path, language, theme, live)` takes a `LiveConnector`; without one no connection is opened. The bell is hidden from role queries while a dialog is open (`hidden: true`).
- The web app does not import zod: a schema of `packages/shared` is used through its `safeParse` (`MessageSchema` in `live.ts`).
- `pnpm test:e2e` builds `dist-e2e` with `notify.js`; the browser-test API runs the worker too, so a browser test may send a notification with the command.
- For 0.10: the listener's `LISTEN` needs a direct connection to the database; a pooler in transaction mode (Neon's `-pooler` host) does not carry it, so the listener gets the direct address (`LiveListener.start(connectionString)`) or a `DATABASE_URL` of its own. And `ownOriginOf` in `socket-server.ts` reads `socket.encrypted`, as the Express middleware reads `request.protocol`: behind a load balancer that ends TLS, a browser's `Origin: https://…` matches neither until `trust proxy` is set, so 0.10 sets it for both at once.

The next task is 0.10.

## 7 October 2026: task 0.8d Own account page

Plan approved by the owner on pull request #30 (`[review] approved`, with the answer to the plan's question: a language chosen in the tab before sign-in was complete is saved to the account at the first complete answer).

Built:

- `packages/shared`: `language.ts` (`LANGUAGES`, `Language`, `DEFAULT_LANGUAGE`, `languageSchema`, `isLanguage`, moved from the web, which re-exports them); `sessionResponseSchema.language`; `setLanguageSchema`.
- `db/migrations/0012_account_language.sql`: `accounts.language` (`not null default 'uz'`, `accounts_language_check`), `grant update (language)`. Types regenerated.
- API (`auth`): `PUT /api/auth/language` (`@AnySignedIn()`, refused while a step is owed; `Sessions.setLanguage` writes the change and `account.language_changed` under a lock of the account row, nothing for the same language); `ActiveSession.language` and `language` in every session answer; `Accounts.create` writes `uz`. `POST /api/auth/sign-out-everywhere` keeps the asking session, ends its trust (`auth.trust_ended`, reason `sign_out_everywhere`, cookie without `Expires`), checks after the lock that its own session is still open, and writes its entry at every call. `Sessions.endTrust` is shared with the password change. OpenAPI and the web client regenerated.
- Web: the account's language follows the session answers (`features/auth/account-language.ts`, called from `createShell(i18n, history?)`); the mark of a choice before sign-in (`language-mark.ts`, `sodiq.languageChosen` per tab); `LanguageChooser` takes `onChange`; the layout's chooser and the account page's field save to the account (`useAccountLanguage`). Routes `/account` and `/account/password` inside the layout; `/password` is the forced change and redirects a complete session. `PasswordPage` has two frames. The menu entry every role has is "Account"; the top-bar account menu has Account, Change password, Sign out; `COMMON_PAGES` has both pages. The account page (`features/auth/account-page.tsx`, `account/*`): language, password link, the sessions table with "Sign out everywhere" (asks, naming the count of other sessions and the end of this device's trust), the trusted devices with Remove (asks; the current device leads to the sign-in page), the second step (on through the stages of `SecondStepSetUp`, taken out of `SetUpPage`; off with a code; required: no button). The trust note closes for good once the device is trusted. Texts `account.*` in uz, ru, en.
- Tests: API `language.test.ts` (default, stored and said at sign-in and before the code, audit entry, no entry for the same language, validation, the three owed steps refused, 401, a lock or an end of the session after the guard), `accounts.database.test.ts` (default, the list equals `LANGUAGES`, refusals, the updatable columns), the "sign out everywhere" tests of `idle-sessions`, `trusted-devices` and `session-life` changed to the new rule (the asking session stays, its trust ends, the idle limit afterwards, the race after the guard, the entry at every call), `route-permissions` and the OpenAPI snapshot. Web `account-page.test.tsx` (19), `account-language.test.tsx` (10), the menu, search, shell and password tests updated. Browser `e2e/account.spec.ts` with the accounts `account` (three browsers: trust, the language across browsers, a device removed, sign out everywhere) and `accountSecondStep` (on and off from the page); `shell-tools.spec.ts` follows the search to `/account/password`.

Reviewed by the spec reviewer and the permission reviewer (the route: ready). Fixed from the reviews: `setLanguage` checks after its lock that the account is not locked and the session still open (as the password change does), with two tests; the mark of a choice before sign-in survives a reload of the sign-in page and goes only when a session ends; `intro` of `SecondStepSetUp` is a text property the lint rule sees; the question of "sign out everywhere" counts from a fresh list; the tests of the wait on "Turn off" and of the error states of the devices and the second step; Uzbek quotation marks and two wordings.

Left out, with the task that brings it:

- Notification settings (0.9), photo, phone, email and name (2.x), the own sign-in history on the page (2.6), the theme on the account (owner: stays in the browser), a sign-out button per session (owner).
- A readable device name from the `User-Agent` text (a parsing library; ask the owner if wanted).

Open, for the owner:

- The Uzbek and Russian wording of `account.*` was not reviewed by anybody.
- Whether `Intl.DateTimeFormat('uz')` shows Latin script in the school's browsers (ICU's default for `uz` is Latin; the tests do not pin it).

The next sessions must know:

- `createShell(i18n, history?)`: the language of the tab is passed in; `renderApp(path, language)` of the tests builds both, and `sessionOf()` answers the language of the last `renderApp`. A test of the language switch gives `language` to `sessionOf` itself.
- A session answer with a language other than the tab's switches the tab only once no step is owed; a tab that used the chooser before sign-in saves that language to the account at the first complete answer (`language-mark.ts`). `PUT /api/auth/language` is refused while a step is owed.
- "Sign out everywhere" keeps the asking session: a test that needs every session of an account gone must also sign the asking one out.
- The pages of the account are in `features/auth/account/`; a new section is an `AccountSection` with its own heading. The set-up stages are `SecondStepSetUp` with a `stage` render prop for the frame.
- The password change by choice is at `/account/password`; `/password` redirects a complete session there. `STEP_PATH.password` is still `/password`.
- Seeded browser-test accounts: `account` and `accountSecondStep` (`apps/api/src/testing/e2e/seed.ts`, `apps/web/e2e/accounts.ts`).

The next task is 0.9.

## 7 October 2026: task 0.8c Web shell: menus and home pages per role

Plan approved by the owner on pull request #27 (two `[review] approved` comments: the answers to seven questions and the menu table).

Built:

- `packages/shared`: `menu.ts` (`MENU`: the approved menu per role, at most 10 items; `visibleMenu`; `HOME_KIND` from `08`), and `assignments` and `branches` in `sessionResponseSchema`.
- API: `branchChoices` (`access/current-assignments.ts`), `ActiveSession.branches`, and `answerOf` listing assignments and branches, empty while a step is owed. OpenAPI and the generated web client regenerated. No new route.
- Web (`apps/web/src/features/access/`): `resolveView` (pure), `ViewStore` (per tab, `sessionStorage`), `useView`, the left menu and the phone menu (shared dialog), `RoleSwitcher`, `BranchSwitcher`, the home page of each kind, `menu-pages.ts` (the built pages: Home only). The top bar and layout use them; `X-Branch-Id` goes with every call; `PAGE_INDEX` became `COMMON_PAGES` plus the menu pages; sign-out and an ended session clear the choice. Texts `roles.*`, `menu.*`, `switcher.*`, `home.<kind>` in uz, ru, en.
- Tests: shared `menu.test.ts`; API `session-choices.test.ts` (11 tests: 401, none/one/several, order, ended and future, other accounts, school-wide roles, mixed accounts, owed password change, owed second step, set-up owed), the exact-answer tests of sign-in, reset and second step updated for the two new fields; web `view.test.ts`, `access.test.tsx` (15 roles with the whole table built, switchers, stale stored choice, sign-out, ended session, phone menu), the contrast pair of the menu links; browser test `e2e/access.spec.ts` with the seeded account `switchers` (Tutor and Teacher, two branches). Full run: lint, typecheck, `pnpm test` and the 10 browser tests pass here.
- Reviewed by the spec reviewer and the permission reviewer (route: ready). From the owner's reviewer (`changes needed`): the choice is also cleared when the session is read as ended and at the next sign-in (with tests); the branches are read where an answer is made, not on every request; `home.branch_summary` says "by grade" in uz and ru (sinf raqamlari, параллелям); the roles are sorted by the table of `02` on the web side too; the notes above.

Left out, with the task that brings it:

- Menu items other than Home: each task adds its page to `BUILT_PAGES`; the table is complete. The Head Tutor's Timetable item awaits the owner's `/spec-change`.
- Data on the home pages: each later task. Year and quarter in the top bar: school setup. The account page: 0.8d.
- A branch label for an account with one branch: `12`, Context, says the branch in use is always shown in the top bar, but the switcher appears only with two or more branches (as the plan said), so a one-branch account sees no branch anywhere. The owner's call for a later task (the school setup may show it with the year and quarter).

Open, for the owner:

- Uzbek and Russian wording of `roles.*`, `menu.*`, `switcher.*` and `home.*` was not reviewed by anybody (role names are my translations).
- A stored role or branch that the account does not hold is ignored but not erased, so it counts again if the account gets it back within the tab. Display only; erase it if you prefer.

The next sessions must know:

- `X-Branch-Id` is a module variable (`api/branch-in-use.ts`) set in a layout effect of `AppLayout`. Two consequences for the first branch-bound page: a route `loader` or `beforeLoad` runs before the layout mounts, so a branch-bound call made there goes without the header and is refused (make the call in a component, or change the client to read the branch from the store at request time); and the branch is in no query key, so a branch switch leaves the cached data on screen until it is fetched again (put the branch in the query keys of such pages).
- The role and the branch of the tab are cleared at sign-out, when the session is read as ended (`readSession` gives `null`), when a call is refused as `not_signed_in`, and when somebody signs in after that (`createShell` watches the session in the query cache).
- The branches of the session answer are read by `Sessions.answerOf` where an answer is made (sign-in, code, `GET /api/auth/session`), not with every request.
- A new page of the menu: add it to `BUILT_PAGES` (`menu-pages.ts`) and the route; when the task adds the permission area with the same name as the item (`setup`, `people`, `classes`, `timetable`, `journal`, `results`, `plans`, `requests`), the menu follows the table. If the area has another name, change `visibleMenu` or the item name in that task.
- Tests that need roles: `sessionOf({ assignments, branches })`, `NORTH` and `SOUTH` of `testing/render-app.tsx`; the default session holds Teacher in North.
- Browser tests in the cloud environment: the symlink trick of the 0.8b-3 entry works with the chromium directory `chrome-linux64` and the headless shell `chrome-headless-shell-linux64` built from the 1194 files (`headless_shell` linked as `chrome-headless-shell`).

The next task is 0.8d.

## 6 October 2026: task 0.8b-3 Web shell: shell tools

Decided at the plan: the Principal may send a feedback report (the owner changed the spec on 6 October, pull request #26: edge cases, "Who can act", and `docs/spec-changes.md`); "at most 20 reports a day" is the last 24 hours; the feedback dialog has a Send button of its own and is not a record form.

Built:

- Feedback reports: `db/migrations/0011_feedback_reports.sql` (school-wide, insert-only for the application, checks on the roles, the page and the text), the module `apps/api/src/modules/feedback/` with `POST /api/feedback` (`@AnySignedIn()`; the roles of the session each once in the order of `ROLES`, the page without the query, the trimmed text, the moment of the injected clock and the request id; at most 20 in the last 24 hours per account under a lock on the account row, the 21st `429 too_many_attempts` with `Retry-After` rounded up; no audit entry), `feedbackReportSchema` and its constants in `packages/shared/src/feedback.ts`. The dialog in the top bar (`apps/web/src/features/feedback/feedback-button.tsx`) on `useRecordForm` and the new `TextAreaField`; a text typed and not sent is kept while the dialog is closed; after a send the form is new and a status sign says so.
- The Ctrl+K search over the pages of the app (`apps/web/src/app/page-index.ts`, `apps/web/src/components/search/command-search.tsx`): Ctrl+K, Cmd+K and a button in the top bar open it; a combobox over a listbox, matched like the lists (`searchWords` of `list-state.ts` is exported now); the arrows, Enter and Escape; Escape leaves an open side panel open.
- The theme (`apps/web/src/theme/theme.ts`, `apps/web/src/components/theme-switch.tsx`): light, dark or as the device, as the device by default, kept in the browser under `sodiq.theme`, applied before the first render (`startTheme` in `main.tsx`; `App` takes the store); the switch beside the language chooser in the layout and on the pages before sign-in; `color-scheme` in `index.css`.
- The contrast review: `apps/web/src/theme/contrast.ts` and `apps/web/tooling/contrast.test.ts` check every text and control pair the components draw, with the alpha of the class list, to WCAG 2.1 AA in both themes. Changed to pass: light `--muted-foreground` 0.556 to 0.54, `--input` 0.922 to 0.65, `--ring` and `--sidebar-ring` 0.708 to 0.556, `--destructive` 0.577 to 0.53; dark `--destructive` 0.704/0.191 to 0.8/0.17, `--muted-foreground` 0.708 to 0.74; `alert.tsx` draws the destructive description at full strength; `button.tsx` hovers the default button at 90% instead of 80%, keeps the dark destructive tint at 10% with a border on hover, and leaves the focus border of every variant to the shared `border-ring`. The look was looked at in the environment's Chromium in both themes, at laptop and phone width (screenshots of the sign-in page, the home page, the sample list with its panel, the confirmation, the search and the feedback dialog).
- shadcn `dialog` and `textarea` (`apps/web/src/components/ui/`) written by hand after `alert-dialog.tsx` and `input.tsx`: the registry is not reachable from the cloud environment.
- Texts `theme.*`, `search.*`, `feedback.*` in the three languages.
- Tests: API `feedback.test.ts` (the stored row, the roles of the session, the refusals of the schema, the limit with the clock, two sends at once, the owed steps, no audit entry) and `feedback.database.test.ts` (the constraints and the rights); the route in `ROUTE_ACCESS`, the table in `catalog.test.ts`, the module and the OpenAPI path. Web `theme.test.tsx`, `command-search.test.tsx`, `feedback.test.tsx`, `tooling/contrast.test.ts`. The browser test `e2e/shell-tools.spec.ts` with the account `shellTools` (the theme before and after sign-in, Ctrl+K and Enter, the search button at phone width, a report sent); the browser tests name the language chooser (`languageChooser` in `e2e/steps.ts`), which is no longer the only select.
- Reviewed by the spec reviewer and the permission reviewer (the route: ready). Fixed from the reviews: the hover of the default button (3.91:1 in the light theme) and the focus border of the destructive button (a red border at 40%, 1.49:1) were not in the contrast test and failed AA; both are checked now and pass (hover at 90%, the shared `border-ring`), with the hovers of the other variants and `--sidebar-ring`; Ctrl+K also answers to the K key of a Cyrillic layout (`event.code`); the search dialog has a Close button for touch; the text of the limit has plural forms; a body that names another account is ignored (test); the decisions table was repaired (a replacement pattern of a script had copied the file's header into a row).

Left out, with the task that brings it:

- Search over students, staff, classes and groups: each with the task that builds the records (2.x, 3.x), with the rights of the role.
- The page index by the menu of the role: 0.8c. Every signed-in account may send a report, so the feedback button needs no hiding.
- A screen for the feedback reports: none in the plan; the owner reads the table (`select * from feedback_reports order by created_at`).
- An audit entry (owner), the application version on the report (8.3a), the UI language and the browser on the report (not asked for).
- Brand colour and logo: a small task when the owner provides them. The theme on the account: 0.8d decides the language on the account and may take the theme with it.

Decided by the owner at the plan (`[review] approved` of pull request #25): see `docs/decisions.md`, 6 October 2026.

Open, for the owner:

- The Uzbek and Russian wording of `theme.*`, `search.*` and `feedback.*` was not reviewed by anybody yet.
- The page Change password (`/password`) stands outside the layout: a signed-in person who opens it has no feedback button and no search there, while `14` puts the button on every page; the owner's "inside the layout only" was decided against the sign-in pages. Decide whether that page counts, or 0.8d moves it inside the layout.
- The light theme looks different: the border of every text field and the focus border are darker (3.2:1 and 4.7:1 where they were 1.3:1 and 2.6:1), the destructive red is deeper, muted text a little darker. The dark destructive button hovers with a border, not a stronger tint. All of it follows from WCAG 2.1 AA; say if the brand colours should settle any of it differently.

Not done from the review:

- The lock query of the limit does not check that the row of the account was found: accounts are never deleted, and the foreign key would answer with a fault. The comment of migration 0011 says the roles are written "each once": the application does that (`rolesOfReport`); the constraint checks the names, not the count, and the comment is not changed because migrations are checksummed and this one is applied here (`docs/decisions.md` says it). The permission reviewer's remark: when 0.8c brings the role switcher, the owner may want the displayed role on a report as well as the roles of the session.

The next sessions must know:

- A new page: add it to `PAGE_INDEX` (`apps/web/src/app/page-index.ts`) with the key of its title; 0.8c filters the index by the menu of the role.
- A new dialog: the shadcn `Dialog` (`components/ui/dialog.tsx`) has no close cross; name a Cancel or Close button with a translated text (`DialogClose`). Escape in a dialog does not close a side panel behind it (Base UI marks the key as handled).
- A new token or a component that draws text on a tint: add its pair to `tooling/contrast.test.ts`; the test names the ratio that fails.
- The theme: `useTheme()` and `ThemeSwitch`; `renderApp(path, language, new ThemeStore())` in a test, `fakeDevice()` of `theme.test.tsx` for the device's preference (jsdom has no `matchMedia`).
- A one-shot dialog with a form: `useRecordForm` without `RecordForm`, as `feedback-button.tsx`; keep the draft in the parent and remount the form with a `key` after a send.
- Browser tests in the cloud environment: Playwright 1.63 looks for the browser build 1243 and the environment has 1194. A directory with the 1243 names linked to the installed binaries, given as `PLAYWRIGHT_BROWSERS_PATH`, runs them: see the report of pull request #25. CI installs its own Chromium.
- A web test may take 15 s (`testTimeout` in `apps/web/vite.config.ts`): the first test of a file pays the cold start of its worker, and on a CI runner the first test of the sample list ran to 5.26 s. The 2 workers stay.
- The full run in the cloud environment: API tests 49 files, 1097 tests; web tests 15 files, 242 tests; shared 47; `pnpm test` about 1m20s with the two caches warm; browser tests 9, about 45 s.

The next task is 0.8c.

## 6 October 2026: the working loop (tooling, no task)

Changed: `/next-task` now brings `main` up to date itself, has the `spec-reviewer` check the plan, opens a draft pull request with the plan and stops for a `[review]` comment; `/finish-task` may be run by the session itself, pushes without asking, marks the pull request ready and posts the report with hand-test steps; a new `/review-pr` skill holds the reviewer's checklist and posts `[review]` verdicts. `pnpm sync` for the laptop. `scripts/cloud-setup.sh` and `scripts/cloud-session-start.sh` prepare a Claude Code cloud environment (Node 24, PostgreSQL 18 in a container, public `.env`). The standing decisions are a section at the top of `docs/decisions.md`; the loop, the cloud environment, the review routine and auto-fix are described in `docs/cloud-loop.md`. `feedback` is a module name in `CLAUDE.md`.

Next session must know: `.claude/settings.json` still has to be changed by hand on the laptop (`docs/cloud-loop.md`, setup step 1) before the hook and the new `gh` commands work without prompts; until the review routine exists, the owner's reviewer posts the `[review]` comments. Next task: 0.8b-3 Shell tools, as the trial in the cloud (setup step 3).

## 5 October 2026: task 0.8b-2 Web shell: forms

Split by the owner at the plan: 0.8b-2 is the form pattern, the confirmation dialog, the leave warning, the unsent-changes sign and the sample form; the new task 0.8b-3 has Ctrl+K, the feedback button with its table and route, the theme switch and the contrast review. Where an older entry below names 0.8b-2 for one of those four, read 0.8b-3.

Built:

- The record form (`apps/web/src/components/form/`): `useRecordForm` (schema of `packages/shared`, the typed texts, `read`, `save`) and `RecordForm` (the fields, the refusal of a save, the Save button, the sign "Saved"). A field says what to fix once it was typed into, every field after Save; Save puts the focus into the first wrong field. The texts for the kinds of issue are `form.*`; `wholeNumber` reads a number field.
- Fields (`components/field.tsx`): `Field` as before, `NumberField`, `SelectField`; the message of a field is in a live region.
- The confirmation dialog (`components/confirm-dialog.tsx`): `ConfirmProvider` in `App`, `useConfirm()`; the first 10 names and "and N more". shadcn component added: `alert-dialog`. A bulk action of a list asks when it has `confirm`.
- Unsaved changes (`components/unsent/unsent-changes.tsx`): the store of the tab, `UnsentGuard` and `UnsentBanner` in the layout, `useLeave()`. The list asks before another record is opened or the panel is closed; sign-out asks; the browser asks at reload and tab close.
- The sample: the side panel of `/dev/patterns` is a form of the row (`features/sample/sample-form.tsx`, schema `sampleRecordSchema` in `packages/shared/src/sample.ts`); `?demo=save-fails` refuses the save; "Archive" asks first.
- Tests: `record-form.test.tsx` (a save on its way, the question asked once, a refused save, Uzbek messages), `sample-form.test.tsx` (the whole app: fields, Save, the sign, leaving, sign-out, the confirmation of a bulk action), `form-messages.test.ts`, and the browser test `e2e/forms.spec.ts` with the account `forms` (keyboard entry, the Back button, the question of the browser).
- Reviewed by the spec reviewer. No route was added or changed, so no permission review. Fixed from the review: "Saved." stood beside text typed while the save was on its way; the question about leaving said "will be lost" while a save landed anyway (it now waits for the answer); saving a changed name threw the focus to the heading of the panel; the focus after "Stay" at sign-out; one question for the tab; a refused save stayed "failed" after the old values were typed back; an open question could outlive its page; field messages were not read out while typing; the Russian archive question; missing tests added.

Left out, with the task that brings it:

- Ctrl+K, the feedback button, the theme switch, the contrast review, a text-area field: 0.8b-3.
- Undo: with the first action that offers it (decided by the owner).
- Other kinds of field (date, checkbox, a choice with search): with the first form that needs them.

Decided by the owner at the plan:

- A record with typed changes: another row, closing the panel and Escape ask; a search, a filter or an order behind it does not.
- When the session ends while something is typed, the text is lost without a question. The sign-in box over the page of 8.3c may later serve record forms too.
- For 0.8b-3: the feedback code is a new module `feedback` (the owner adds the name to `CLAUDE.md`); at most 20 reports a day per account, refused with `too_many_attempts`; no audit entry; the owner reads the table until a screen exists; the button inside the layout only; the page is the path without the query; the theme is light, dark or as the device, "as the device" by default; contrast to WCAG 2.1 AA.

Open, for the owner:

- The Uzbek and Russian wording of the new texts (`form.*`, `confirm.*`, `unsent.*`, the additions to `sample.*`) was not reviewed by anybody yet.
- `.claude/rules/web.md` gained two lines (forms; confirmations and `useLeave`).
- The web tests run at most 2 files at once (`apps/web/vite.config.ts`); they take about 115 s inside `pnpm test`. The first test of the sample list is the one that ran past 5 seconds under load; it draws 100 rows in jsdom and takes 2 s alone.

Not done from the review:

- If the open row leaves the list while its form has typed changes (archived by somebody else, a reload of the rows), the panel shows "record not in the list" and the text is gone without a question. Not reachable in the sample; settle it with the first real list that edits in the panel (2.2).
- When sign-out fails after "Leave without saving", the person is still on the page and the typed text is gone; they had agreed to lose it.
- A field message that appears moves the fields below it. `12` says "never jumps" of loading; left as it is.
- The button of the unsaved-changes sign is named by its state ("Changes not saved"), not by what it does.
- A number of 16 digits or more gets the message "enter a whole number".
- Not looked at in a real browser by a person: the dialog and the form in the dark theme, the top bar with the sign at phone width. 0.8b-3 reviews the look.

The next sessions must know:

- A new form: `const form = useRecordForm({ schema, initial, read, save })`, then `<RecordForm form={form} label={name of the record}>` with `<Field label={...} {...form.bind('field')} />`. `initial` is texts; `read` turns them into what the schema checks (`wholeNumber(text)` for a number, `?? null` for an empty one). `save` throws the refusal (`answerOf`). A form for another record gets `key={id}`. Copy `sample-form.tsx`.
- The web app does not import `zod`: a schema comes from `packages/shared`, and `FormSchema` in `form-messages.ts` is what the form reads of it. A kind of issue without a text of its own gets `form.invalid`; a feature gives its own with `message`.
- Asking before an action: `if (await confirm({ title, text, names, action })) ...`. Whatever takes a form away without a change of page: `const { unsent, leave } = useLeave()`, then `if (await leave()) ...`. A navigation that must not ask passes `ignoreBlocker: true`.
- `SidePanel` needs `recordKey`. The top bar has a `role="status"` of its own: a test looks for the status of a page inside `main`, and for the top bar's in the first `header`.
- The history of the unit tests does not ask at Back and has no `beforeunload`: such a rule is tested in `e2e/`.
- A test of a save on its way: `heldSave()` in `record-form.test.tsx`.
- Page tests are faster on a narrowed list (`?q=abdullayev` draws 20 rows).
- 8.3c: the journal queue joins the store with entries of its own (`useUnsentEntry`: `label`, `state`, `discard`, `focus`, `settled`); "leave" calls `discard`, which a queue that must survive must not treat as "delete".
- The full run: API tests 47 files, 1056 tests, about 5m15s; web tests 11 files, 196 tests; browser tests 8, about 1m20s.

The next task is 0.8b-3.

## 5 October 2026: task 0.8b-1 Web shell: lists and page states

Split by the owner at the plan: 0.8b-1 is the table, the list pattern and the page states; 0.8b-2 is the form pattern, the confirmation dialog, Ctrl+K, the feedback button with its table and route, the unsent-changes banner, the theme switch and the review of the look. Where an older entry below names 0.8b, read the one of the two that has the piece.

Built:

- The list pattern (`apps/web/src/components/list/`): `ListPage` with search, filters, column chooser, sorting, checkboxes with bulk actions, an Export button and the side panel. The whole list is loaded; searching, sorting and filtering happen in the browser (`matchingRows` in `list-state.ts`). The state of a list (`ListSearch`: search, order, filters, open record) lives in the address.
- `DataTable` and its loading outline (`data-table.tsx`), `SidePanel`, `PageHeader` with breadcrumbs, `EmptyState`, `LoadingOutline`, `ErrorState` (`components/states.tsx`). `FailureAlert` moved from `features/auth` to `components/failure-alert.tsx`; the error page uses `ErrorState`.
- The sample list `/dev/patterns` (`apps/web/src/features/sample/`), with invented rows that live in the page; `?demo=empty`, `loading`, `error`, `many` show the states. The address answers "page not found" in the built app, and the rows are not in the built bundle (checked once by hand: `pnpm --filter @sodiq/web build`, then a search for a sample name in `dist`).
- Texts `list.*`, `sample.*` and `layout.breadcrumbs` in the three languages. shadcn components added: `table`, `skeleton`.
- Tests: `list-state.test.ts` (search, filters, order, the address, hidden columns), `list-page.test.tsx` (rows that change under the list, what export and a bulk action are handed, a failed load), `sample-list.test.tsx` (the whole app at `/dev/patterns`), and the browser test `e2e/patterns.spec.ts` with an account of its own (`patterns`). The steps of sign-in shared by the browser tests moved to `e2e/steps.ts`.
- Reviewed by the spec reviewer. No route was added or changed, so no permission review. Fixed from the review: the panel laid over the page on a narrow screen left the hidden list in the Tab order (now the record takes the place of the list, and the top bar stays); buttons that removed themselves dropped the keyboard focus; the page jumped when rows arrived with an open record and at the first tick; the open row was marked by colour alone; two races between the search box and the address; "Show more" was not reset by a search that came back; numbers were not written in the chosen language; an error hid rows already loaded; Escape in the search box also closed the panel; the count and "nothing matches" are now read out; missing tests added and the browser test now walks the controls with the Tab key.

Left out, with the task that brings it:

- Forms, the confirmation dialog, Ctrl+K, the feedback button, the unsent-changes banner, the theme switch, the review of contrast: 0.8b-2. `components/field.tsx` is still the small field of 0.8a.
- A real export file and its route: each list, from 2.2. Server paging with the same `ListSearch`: 2.6.
- A sticky table header: the table scrolls sideways in its own box. Decide with the first long list (2.2).
- Undo: with the first action that offers it (decided by the owner).

Decided by the owner at the plan:

- Lists load a whole branch and search, sort and filter in the browser. "Tick all" means every row that matches the search and filters. Hidden columns and (0.8b-2) the theme are kept in the browser, not on the account.
- 0.8b-2: the feedback reports go to a school-wide table through a route (roles from the session, never the body); a Save button on record forms with a warning before leaving; no `cmdk`; contrast only, brand colour and logo later.

Decided by the owner at the end (the spec is silent on each; they stay as built):

- A ticked row that a new search hides stays ticked, and the bar says "N of them are not shown by the current search and filters".
- The search also finds text of a hidden column, and a list stays sorted by a column after it is hidden.
- Closing the panel adds an entry to the history, so the Back button opens it again.

Open, for the owner:

- The Uzbek and Russian wording of the new texts was not reviewed by anybody yet.

Not done from the review:

- The lint rule for hard-coded text does not see a text inside an object (`header` of a column, `label` of a filter, a bulk action or a breadcrumb, `empty.text`). Written into `docs/decisions.md` and the comment of the rule; closing it would need a rule of our own.
- The browser test puts the focus on a row and on an item of the column menu directly, and chooses a filter value directly; its comment says so. The rest is reached with the Tab key.
- Not looked at in a real browser by a person: the height of the outline rows against real rows, the touch size of the checkboxes on a tablet, what a screen reader really says. 0.8b-2 reviews the look.

The next sessions must know:

- A new list: a route with `validateSearch: listSearch`, and a page that gives `ListPage` the rows (`undefined` while loading), `columns` and `filters` (the same arrays between renders: `useMemo`), `rowId`, `rowName`, `search` and `onSearchChange` (`navigate({ to, search: next, replace: how === 'replace' })`), `empty`, and where it has them `bulkActions`, `onExport`, `panel`. One column has `opens: true`. Copy `sample-list-page.tsx`.
- `ListPage` with `rows` and `error` together keeps the rows and shows the failure above them: hand it `query.data` and `query.error` as they are.
- A text with a number in a list: `t('key', { count, n: number.format(count) })` and `{{n}}` in the three files; `count` only chooses the plural form.
- `caption` is now a text attribute of the lint rule. A text inside an object is not seen by it: take it from `t()`.
- Tests of a page with a long table read the rows from the table (`document.querySelectorAll('tbody tr')`) and the headers from `thead th`: a query by role over hundreds of rows takes seconds in jsdom and ran into the 5-second limit of a test here. The address follows a click a moment later: wait for it. The search is written into the address 0.3 seconds after the last key.
- The top bar has a chooser named "Language": a test that looks for a filter of that name looks inside `main`.
- 0.8b-2: the sample form goes onto `/dev/patterns` (the button of the page header, or the side panel). The bar of bulk actions is where the confirmation dialog is needed first ("Archive").
- 0.8c: `PageHeader` takes the breadcrumbs; the left menu is still the empty `<nav>`.
- 2.2: the Export button hands `onExport(rows, columnKeys)`; the route gets the search, the filters and the column keys (or the ids), and the server decides what the role may see.
- `prettier --write` over `apps/web/src` rewrites `schema.generated.ts`, and `tooling/api-types.test.ts` then fails: format single folders, or use `pnpm format`.
- Browser tests: in one full run the first test stopped at the sign-in page (the language chooser was not found in time), right after lint, type-check and a build had run; the next two runs passed. A cold Vite fits (it compiles a module when a browser first asks, and prepares the libraries with a reload), though the failed run itself was not taken apart. By the owner's order the global setup (`apps/web/e2e/global-setup.ts`) now opens the sign-in page once in a browser, with up to 2 minutes, before any test runs; no check was removed. One run with Vite's cache deleted (`apps/web/node_modules/.vite`) passed 7 of 7 afterwards.
- The owner decided the three open points of this task: ticked rows stay ticked when a search hides them, hidden columns are still searched and sorted by, and closing the panel adds an entry to the history. They stay as built.
- The full run: API tests 47 files, 1056 tests, about 4m45s for everything; web tests 8 files, 163 tests, about 45 s; browser tests 7, about 1 minute.

The next task is 0.8b-2.

## 5 October 2026: task 0.8a Web shell: sign-in, layout and languages

Split by the owner at the plan: 0.8a is the sign-in flow, the layout and the languages; the new task 0.8d "Own account page" (after 0.8c, before 0.9) has the session list, the trusted devices, the optional second step and the language on the account. Where an older entry below names 0.8a for one of those, read 0.8d.

Built:

- Languages (`apps/web/src/i18n`): `i18next` with one typed file per language (`locales/uz.ts`, `ru.ts`, `en.ts`; Uzbek in Latin script). A key missing in one language fails the type-check and the build of the web app; `translationProblems` (`check.ts`, run by `locales.test.ts`) also checks empty texts, `{{names}}`, plural forms and a text for every error code. A lint rule refuses text written into a component. The choice is kept in the browser; a first visit takes the browser language if it is one of the three, else Uzbek. `<html lang>` and the title follow.
- API calls (`apps/web/src/api`): `answerOf(api.POST(...))` gives the body or throws `ApiFailure(code, retryAfterSeconds)`; `failureText(t, error)` is what a person reads. Every error code of `packages/shared` has a text in the three languages, `unsupported_media_type`, `permission_denied`, `own_request` and `account_locked` included.
- Router and session (`apps/web/src/app`, `features/auth/session.ts`): TanStack Router with routes in code, TanStack Query for the session. Pages: `/sign-in`, `/sign-in/code`, `/password`, `/second-step/set-up`, `/` inside the layout. A page opens only for the step its session stands at, in the order of the server. A call refused because the session ended or owes a step sends the tab to that step (`createShell`).
- Screens (`apps/web/src/features/auth`): sign-in with "Trust this device" (off, with its note) and the wait of `too_many_attempts`; the code page (app code or recovery code); the password page, forced and by choice, with "your password was reset by X"; the set-up of a required second step with QR picture (`qrcode.react`), key and the recovery codes.
- Layout: top bar with the language chooser and the account menu (change password, sign out), an empty left menu, an empty home page, loading outline, error page with "Try again", page for an unknown address.
- Browser tests: `pnpm test:e2e` builds an API of its own and runs it with Vite on ports 3001 and 5174 on the database `sodiq_e2e`, dropped and built from the migrations at every run (`apps/api/src/testing/e2e`, compiled into `apps/api/dist-e2e`). Playwright signs in and out in each language, sets up the required second step and signs in with a recovery code, checks the refusal of a wrong password, the session cookie and a trusted device.
- The placeholder page of 0.1 and its three tests are gone (approved by the owner). The web app no longer calls the health route.
- Reviewed by the spec reviewer. No route was added or changed, so no permission review. Fixed from the review: the recovery codes could be lost with the Back button after a minute on the page (now every move away is refused until "I have saved the codes"); the forced password page had no sign-out; a set-up refused with `second_step_already_on` left the person stuck; the note "not trusted" named the wrong reason after a password change by choice on a trusted device, and that page now says the trust ends; the lint rule let chosen and joined texts and further attributes through; an error of the app itself was shown as a lost connection; the server of the browser tests did not check that the application address is local; tests added (how often the session is asked, the three step refusals, a failed sign-out, the fourth Russian plural form, the letters of the Uzbek texts, a trusted device in the browser).

Left out, with the task that brings it:

- Session list, "sign out everywhere", trusted devices, the optional second step, the language on the account: 0.8d.
- Menus per role, role and branch switchers, branch, year and quarter in the top bar, home pages: 0.8c and phase 1. The session answer has no roles yet.
- The shared list, form, table, empty, loading and error patterns, Ctrl+K, the theme switch, the review of the look: 0.8b. `components/field.tsx` is a small labelled field for 0.8b to replace or grow.
- Password reset by email: 2.3. The application version on requests: 8.3a.
- No date is shown yet, so there is no date and number helper. The first screen that shows a moment (0.8d, the device list) builds it on `Intl` with the chosen language and Monday as the first day, and must decide between branch time and the time of the browser: no branch is known on the own account page.
- No unit test opens the account menu (the browser tests sign out through it in every test).

Not done from the review, for the owner:

- The translation check cannot see a text left in English in the Uzbek or Russian file. The owner reads the two files in the pull request.
- A key that ends in `_one`, `_other`, `_few`, `_many`, `_zero` or `_two` is read as a plural form by i18next, by `Shape` and by the check. An error code that ends so (for example `reason_other`) would need another name or a change of the check. None exists.
- The wait text ("try again in 30 seconds") does not count down; the button turns on again by itself.
- The Playwright traces of a failed run hold the typed first passwords of the seeded accounts. They belong to a database that is dropped at the next run; in CI the traces are kept 7 days.
- A reload on the recovery codes that the person confirms loses the codes: the server shows them once.
- The Uzbek and Russian wording, contrast, keyboard use and the dark theme were not reviewed by anybody yet (0.8b reviews the look).
- CI: the `e2e` job still runs `pnpm db:migrate` on `sodiq_dev` before the browser tests. They do not need it any more; it was left as it is.

Decided by the owner at the plan:

- `qrcode.react` is added. The browser tests get `sodiq_e2e`; `sodiq_dev` collects no test accounts.
- The owner reviews the Uzbek and Russian texts in the pull request.

Open, for the owner:

- The password page asks for the new password twice. The spec does not; a typing mistake would lock a person out until a reset, which has no route before 2.3.
- `.claude/rules/web.md` was extended with how to add texts, pages and tests.

The next sessions must know:

- A new text: the same key in `en.ts`, `uz.ts` and `ru.ts`; the type-check names a missing one. A text with a number: `key_one`, `key_other`, and in Russian also `key_few`, `key_many`; call `t('key', { count })`. Uzbek letters oʻ and gʻ with U+02BB, never an apostrophe (a test refuses it).
- A new error code in `packages/shared` fails the type-check of the web app until `errors.<code>` exists in the three files.
- A new page: a route in `apps/web/src/app/router.tsx`, inside `appRoute` when it needs a complete session; the component lives in its feature folder. Calls go through `answerOf` inside `useQuery` or `useMutation`; show a failure with `FailureAlert` or `failureText`.
- Nothing may call the API by itself (interval, focus, reconnect, retry): the defaults of the query client are off and a test pins them. 0.9 (unread count) and 8.3b must decide how a call on a timer avoids keeping an idle session alive (note of 0.6b) before turning any of this on.
- Page tests render the whole app: `fakeApi({ 'POST /api/auth/sign-in': () => json(...) })`, then `renderApp('/address', 'en')`; `sessionOf({...})` builds a session, `refusal(code, status, retryAfter?)` a refused call. A route that is not named fails like a lost connection. Texts are looked up in `en`, `ru`, `uz`, never typed again in the test.
- A component that takes a text under a new property name adds the name to `textAttribute` in `eslint.config.js`.
- shadcn components come from the CLI (`pnpm dlx shadcn@latest add <name> -c apps/web`, then `pnpm format`). On Base UI a trigger takes `render={<Button />}`, not `asChild`, and a `DropdownMenuLabel` must sit inside a `DropdownMenuGroup`.
- Browser tests: a test that signs in needs an account of its own in `apps/api/src/testing/e2e/seed.ts` (key, invented name) and in `AccountKey` of `apps/web/e2e/accounts.ts`; the first password is in use, so the test changes it first (`changeFirstPassword`). An account with a role that needs a branch: see `vicePrincipal` in the seed. Files run side by side: two files must not share an account. A code of the authenticator app counts once: a second sign-in in the same test uses a recovery code or waits 30 seconds.
- `pnpm test:e2e` at the root builds the API and `dist-e2e` first; `pnpm --filter @sodiq/web test:e2e` alone uses the last build. It fails at once when the ports 3001 or 5174 are taken, for example by a run that was interrupted: stop that process. `pnpm dev` may stay open.
- 0.8c: the roles and branches must come into the session answer (a change of `sessionResponseSchema` and `GET /api/auth/session`); the role and branch on display are kept per tab (edge cases), so in `sessionStorage` like the trust note, not in `localStorage`. The left menu is the empty `<nav>` of `app-layout.tsx`.
- 0.8d: the language on the account is set at sign-in from the server when the browser has no choice of its own, or always; decide there. `startI18n` is the one place that reads and stores it. The set-up page (`set-up-page.tsx`) serves the required set-up only: its route opens for the step `set_up`.
- 0.10: `apps/api/dist-e2e` must not reach a server. The web build is `pnpm --filter @sodiq/web build`; `vite.config.ts` reads `API_PROXY_TARGET` for the development proxy only.
- The full run: API tests 47 files, about 190 s; web tests 104, about 40 s; browser tests 6, about 55 s.
- In Git Bash here a heredoc also breaks on an apostrophe inside a quoted script (three times in this task): write a script file with the editor tools and run it.

The next task is 0.8b.

## 5 October 2026: task 0.7c Request hygiene

The owner added the leftovers of 0.7b to this task at the plan: the frozen table, the `@All()` route in the harness, three small guard tests.

Built:

- JSON bodies only: `apps/api/src/http/json-only.ts`, a middleware before the body parser. A request with a body whose `Content-Type` is not `application/json`, or that names no type, gets 415 `unsupported_media_type` (new error code, also for the body parser's own 415). A request without a body passes, also with `Content-Length: 0`.
- `Cache-Control: no-store` on every answer: `apps/api/src/http/no-store.ts`, the second middleware of `configureApp`. The harness checks the header on the answer of every route for every caller.
- The request key per account: `db/migrations/0010_request_key_account.sql` adds `request_keys.account_id` (references `accounts`) and the check "no account exactly when the scope begins with `job:`". `KeyedRequest.accountId` is required; the same key from another account is 409 `request_key_reused` and the work does not run. Jobs use `RequestKeys.runJobOnce`; `runOnce` refuses a scope that begins with `job:`.
- A key the database refuses is rolled back to the savepoint of `runOnce`, so the caller's transaction stays usable.
- Lint (`eslint.config.js`, tests in `route-input-imports.test.ts`): `createParamDecorator`, `assignMetadata`, `REQUEST` of `@nestjs/core` and the text `'REQUEST'` are refused outside `apps/api/src/http/`, `session.guard.ts` and `permission.guard.ts`; imports from `apps/api/src/testing/` and of `requiresInTable` are refused outside tests and `src/testing`. The two rules are built per group of files by `apiImportRule` and `apiSyntaxRule`.
- From 0.7b: `freezeTable` in `packages/shared` (`PERMISSIONS` is frozen, and the guard freezes the table it is given); the harness names an `@All()` route in `declarationProblems` and in `accessProblems` and does not call it; tests for a repeated `X-Branch-Id` header (400), HEAD on a permission route, and a Super Admin with an unknown branch (403).
- `.claude/rules/api.md` and `docs/decisions.md` have the rules and decisions of this task. No route of the application was added or changed; `ROUTE_ACCESS` is as it was.
- Reviewed by the spec reviewer and the permission reviewer. Neither found a must-fix. Fixed from the reviews: `@Inject('REQUEST')` and `assignMetadata` passed the lint rule; a route could name its scope `job:...` and store a key without an account (now two entry points); tests added for a chunked body, for the guard freezing its table, and `accessProblems` alone no longer passes over an `@All()` route.

Left out, with the task that brings it:

- The exception of JSON-only for file uploads (a short list of method and path in `apps/api/src/http/`, pinned by a test against the declaration of the route): the upload task, 7.1a. `FileInterceptor` of `@nestjs/platform-express` is not refused by lint; decide there.
- Retention and cleanup of request keys: 8.3c. The foreign key `request_keys.account_id` has no `on delete`, and the application user cannot delete keys: a forced delete of an account (Super Admin) is blocked by its keys until that cleanup exists.
- The translation of `unsupported_media_type`: 0.8a.

Not done from the reviews, for the owner:

- Known limits of the lint rules, written in `docs/decisions.md`: a dynamic `import()` or `createRequire`, `context.switchToHttp().getRequest()` in a guard, pipe or interceptor of a module, and `Requires('x' as never, ...)` are not refused. The task named two imports; closing the whole class would need a rule of our own. An area that is not in the table is refused by the guard anyway.
- A request with no body and a form content type passes the JSON-only check (there is nothing to read). A route that needs no body (sign-out) is protected from a form of another site by the cross-site check and the `SameSite=Strict` cookie, as before.
- No test proves that the harness reports a missing `no-store`: there is no application without the middleware to run it against.
- Migration 0010 carries no line about its assumption (no key of a route exists yet); it was already applied to `sodiq_dev` when the review found this, and an applied file is not edited without asking. The assumption is in `docs/decisions.md`.
- Still open from 0.7b: `{ branch: 'none' }` for any role the table permits (decide with 1.1).

The next sessions must know:

- A keyed route passes `accountId: access.accountId` (or the account of the session) to `runOnce`; the type requires it. A scope never begins with `job:`.
- A test of `runOnce` needs a real account (`request_keys.account_id` references `accounts`): see `insertAccount` in `request-keys.test.ts`.
- Tests that send a body with supertest: an object is sent as JSON. A text sent with `.send('...')` is form-encoded by supertest and is now answered 415; set `Content-Type: application/json` for a JSON text.
- A new `no-restricted-syntax` or `no-restricted-imports` rule for `apps/api/src` goes into `apiSyntaxRule` or `apiImportRule`, never into a block of its own: a later block replaces the whole rule of an earlier one.
- A route declares one method; `@All()` fails the harness.
- 0.8a: the web client must send `Content-Type: application/json` with every body (the generated client does). Answers are never cached by the browser, so TanStack Query is the only cache.
- 0.9: a Socket.IO handshake does not pass these middlewares in the same way; check `no-store` and the session there.
- 0.10: a proxy or CDN in front of the API must not add its own `Cache-Control`.
- The full run: API tests 47 files, about 180 s with `maxWorkers: 4`.

The next task is 0.8a.

## 4 October 2026: task 0.7b Permission table and guard

Task 0.7b was split by the owner at the plan: 0.7b is the table, the guard, the declarations, the own-request helper and the harness; 0.7c is JSON bodies only, `Cache-Control: no-store`, the request key per account and the lint rule for `createParamDecorator` and `REQUEST`.

Built:

- `packages/shared/src/permissions.ts`: `ACTIONS` (view, create, edit, archive, export), `PERMISSIONS` (area, role, actions; no area yet), `permits`, and `checkTable` with three fixed rules: a row for each of the 15 roles, the Principal has view and export only, the Super Admin has every action any other role has. `BRANCH_HEADER` (`X-Branch-Id`) in `branches.ts`. Error codes `permission_denied` and `own_request`.
- `apps/api/src/modules/access/`: `@AnySignedIn()`, `@Requires(area, action[, { branch: 'none' }])` (`access.decorators.ts`); the pure `decide` (`permission-check.ts`); `PermissionGuard` and `@CurrentAccess()` (`permission.guard.ts`), a second global guard after `SessionGuard`; `refuseOwnRequest` (`own-request.ts`); the token `PERMISSION_TABLE`.
- The guard: exactly one declaration per route, else 500 and the route never runs; a `@Requires` route names its branch in `X-Branch-Id` (missing or malformed: 400 `validation_failed`); no permitting assignment in that branch, or a branch that does not exist: 403 `permission_denied`, the same answer; `Access` holds the account, the assignment that allowed the action (the first by id), the role and the branch.
- The 12 own sign-in routes carry `@AnySignedIn()`; health and sign-in stay `@Public()`.
- The harness: `src/testing/routes.ts` (`routesOf`, moved out of `public-routes.test.ts`, and `expressRoutesOf`), `src/testing/route-harness.ts`, and `modules/access/route-permissions.test.ts` with the hand-written `ROUTE_ACCESS` and `STEP_ROUTES`. It runs on the application as it is and on sample routes with a sample table (`src/testing/permission-sample.controller.ts`).
- `KeyedSampleController` is now `POST /api/sample-notebooks/:notebookId/notes` with a declared permission and the branch from the guard; `request-key.test.ts` kept every check.
- `.claude/rules/api.md` says how a route declares access; `docs/decisions.md` has the section of this task.
- Reviewed by the spec reviewer and the permission reviewer. Neither found a way to a handler past the guard. Fixed from the reviews: the hand-written list now states the branch mode of a route (before, a branch route wrongly declared `branch: 'none'` would have passed the harness); a route with a permission that is also open to a session owing a step of sign-in is refused by the guard, named by the harness, and the routes with such a mark are pinned; `decide` names the two school-wide roles instead of relying on "no branch"; tests added (first by id through a request, the sample table against `checkTable`); the 403 is in OpenAPI for routes without a branch too.

Left out, with the task that brings it:

- JSON bodies only, `Cache-Control: no-store`, the request key per account (migration 0010), the lint rule for `createParamDecorator` and `REQUEST`: 0.7c.
- Rows of real areas: each task from 1.1 on. Subject scope, Head Teacher appointments, routes to give roles, who may reset or lock whom: 2.3. Class scope: 3.1. Own-lesson scope: 5.x and 6.x.
- A list of all branches for one request (the Super Admin reading every branch's log, the teacher home page): 2.6 and 5.9.
- Roles and branches in the session answer, the switchers, menus from the table, the translations of the two new codes: 0.8a and 0.8c.
- Who decides a request in place of its author: 7.2 and 8.4. No route calls `refuseOwnRequest` yet and nothing forces a deciding route to call it.
- No route passes `access.assignmentId` to `audit.record` yet: the first `@Requires` route that changes something (1.1) does.

Not done from the reviews, for the owner:

- The Principal and the spec text: settled by a spec change at the end of this task (`docs/spec-changes.md`). The edge case now names the changes to his own account as the exceptions to "changes nothing": password, language, notification settings and photo, his sessions and sign-out, his second step and his trusted devices. No code changed.
- The quality plan asks for the owner's sign-off on a written checklist for a change to permissions; that checklist is task 10.3.
- `{ branch: 'none' }` lets any role the table permits act without a branch (the sample table does it for a Head Teacher); `checkTable` has no rule that limits school-wide areas to the Super Admin and the Senior Head Teacher. Decide with the first such area (1.1).
- `PERMISSIONS` is not frozen at run time. A route with `@All()` would crash the harness instead of being named. Small tests not written: a repeated `X-Branch-Id` header (read from the code: Node joins it and it fails the uuid check), HEAD on a `@Requires` route, a Super Admin naming an unknown branch (the Senior Head Teacher is tested).

The next sessions must know:

- A new route: one declaration on the handler, then a line in `ROUTE_ACCESS` (`route-permissions.test.ts`): `'public'`, `'any_signed_in'` or `{ roles, branch: 'request' | 'none' }`, the roles written by hand. A new area: an entry in `PERMISSIONS` with a row for each of the 15 roles; `checkTable` fails otherwise. Changing the table needs the owner.
- A `@Requires` route takes `@CurrentAccess() access: Access`, runs `transactions.run(access.branchIds, ...)` and gives `access.assignmentId` to `audit.record`. Tests send `.set(BRANCH_HEADER, branchId)`.
- Test controllers with a permission: `requiresInTable('sample', action)` and `createTestApp({ permissionTable: SAMPLE_PERMISSIONS })`; `permissionRows({...})` builds a row set. In the sample table a Head Teacher may view, create and edit, a Teacher may view. A test controller without a declaration answers 500 to a signed-in caller.
- The harness callers are 15 accounts with one role each in one branch, one account without a role, and nobody. `accessProblems` needs the application made with `handlerStop: new StopBeforeHandler()`; the stop is on only while the harness runs, so no handler runs and no route needs a valid body. Scope by subject, class and own lessons is outside the harness: each route tests its own.
- `route-permissions.test.ts` takes about 46 s alone (two applications, 17 sign-ins each). The full run was 188 s for the API tests with `maxWorkers: 4`.
- 0.7c: the JSON-only middleware must leave room for a declared exception per route, because the lesson-plan file uploads of 9.x send multipart. The exception itself is not built in 0.7c (note of the owner).
- 0.7c: the lint work could also stop business code from importing `src/testing/**` and `requiresInTable` (advice of the permission reviewer; `tsconfig.build.json` leaves `src/testing` out, but an import would pull a file into `dist`).
- 2.3 and 3.1: `decide` names the first permitting assignment by role and branch. With scope, that can be the Teacher assignment when only the Head Teacher assignment covers the subject: the scope check needs every permitting assignment, and the audit entry the one whose scope fits.
- 2.2 or the profile screen, whichever builds the own photo, language and notification settings: these are routes of the own account (`@AnySignedIn()`, acting on the account of the session), not an edit in the people area. As a people-area edit the Principal could not have them: `checkTable` gives the Principal view and export only. Phone, email and name stay with the Super Admin and the Academic Vice Principal, for the Principal too.
- 2.5 (Release 2): when Parent becomes a role without a branch, it does not get every branch: `decide` names `SCHOOL_WIDE_ROLES`.
- 0.9: `APP_GUARD` also runs for Socket.IO gateways, and both guards assume an HTTP request; the gateway needs its own check at the handshake.
- The harness reads controllers and the routes of the Express router. Something mounted with `app.use(path, router)` (static files, Swagger UI) or only in `main.ts` is not seen by it: nothing of the kind exists, and nothing that serves data may be added that way.
- Fixed on this branch after CI failed: the two tests "at the same moment as a sign-in" in `account-locks.test.ts` started the held transaction and the other side together. When the other side took the row of the account first, it finished at once and nothing ever waited, so the poll saw 0 for 20 seconds (the timeout seen once in 0.7a was the same race, not load). Now `gate()` in that file lets the other side start only after the held transaction has its lock. A new test that holds a transaction and waits for the other side does the same.
- A `MaxListenersExceededWarning` in the API test output is older than this task (it shows on `main` in the auth suites).

The next task is 0.7c.

## 4 October 2026: task 0.7a Roles and assignments

Task 0.7 was split by the owner: 0.7a is the roles, the assignments and the sign-in rules that follow the roles; 0.7b is the permission table, the guard and the harness. The entry below this one is about the load of the API tests and belongs to this task.

Built:

- `packages/shared/src/roles.ts`: `ROLES` (15), `roleSchema`, `Role`, `SCHOOL_WIDE_ROLES` (Super Admin, Senior Head Teacher), `STRICT_SIGN_IN_ROLES` (Super Admin, Academic Vice Principal), `MAX_SUPER_ADMINS`.
- `db/migrations/0009_assignments.sql`: the school-wide table `assignments` (account, role, branch, `valid_from`, `valid_until`, `created_at`, `given_by`, `ended_by`). Checks: one of the 15 roles; no branch for exactly the two school-wide roles; the end not before the start. Exclusion constraint: one account holds one role in one branch once at any moment. The application user may insert, and update only `valid_until` and `ended_by`.
- `apps/api/src/modules/access/`: `Assignments.give` and `end` (service, no route) with the audit entries `assignment.given` and `assignment.ended`; `currentAssignments(transaction, accountId, now)`, `rolesOf`, `notEnded(now)`.
- `give` refuses a role without its branch or with a branch it must not have, an unknown account or branch, a role the account holds in that branch already, and a fourth Super Admin. `end` refuses an unknown or ended assignment and the own Super Admin role.
- The first-account command creates the account and its Super Admin assignment in one transaction and refuses while a Super Admin assignment that has not ended exists.
- `Sessions`: `ActiveSession.assignments`; the idle limit is 30 minutes, 15 with a strict role, by the roles read at the request (`resolve`, `list`, `writeEndsByTime`). `SecondStepRule.required(roles)`: the second step is required with a strict role only.
- `catalog.test.ts`: the list `SCHOOL_WIDE_WITH_BRANCH` (only `assignments`), decided by the owner; `.claude/rules/database.md` describes it.
- Reviewed by the spec reviewer. No route was added or changed, so no permission review. Fixed from the review: an assignment that was taken back before it began no longer holds one of the 3 Super Admin places, no longer blocks the first-account command and cannot be ended a second time; a refused `give` leaves the caller's transaction usable; the test of the wrong branch names the refusal of the row filter; tests added (the list of sessions and "sign out everywhere" with the 15-minute limit, `end` in the wrong branch and of an end that is still to come, both sides of the 30 minutes for an account without a role and a Principal).

Left out, with the task that brings it:

- Permission table, guard, the branch of a request, `assignmentId` in the audit entries of routes, the own-request helper, the harness, JSON bodies only, `Cache-Control: no-store`, the request key per account, permission declarations of the existing routes: 0.7b.
- Routes and screens to give and end roles, who may give which role, the last active Super Admin rule, subject scope and Head Teacher appointments: 2.3. Class scope: 3.1.
- Roles in the session answer for the role and branch switchers: 0.8c. The alert "branch with no active Academic Vice Principal" and the banner "fewer than two Super Admins": 0.8c and 9.4b.
- The hand test of the command against `sodiq_dev` was not run: it would leave a Super Admin whose password only the session saw. The owner runs it.

Decided by the owner:

- Release 2 (task 2.5): Parent becomes a role without a branch, by a spec change and a migration that relaxes the branch check on `assignments`; what a parent sees is decided by the children, and the branch of a request comes from the child.
- 2.3: a typed date becomes 00:00 of that day in the time zone of the branch, or of the school for the two roles without a branch; screens show dates.
- An account without a current assignment can sign in (30 minutes, no required second step); blocking sign-in is the Inactive and Left status of 2.2.

Decided by the owner after the review:

- The end of an assignment: an end that has passed is final, and a new assignment is given instead; an end that is still ahead may be moved while it is still ahead. The database does not hold this yet (`update (valid_until, ended_by)` has no condition, and only `Assignments.end` writes an end today): the trigger comes with the routes in 2.3, where the rest is decided.
- The service accepts a start in the past (`validFrom`); 2.3 decides what the screen offers.
- The idle limit is that of the roles at the request, accepted as it is. A session of an Academic Vice Principal that was idle for 20 minutes and not seen since is in force again if the role ends before its next request. A session that was idle for 20 minutes when a strict role is given ends at its next request with the moment "last use plus 15 minutes", which lies before the role began.
- A sign-in with "Trust this device" by an account that owes the set-up of a required second step, whose strict role then ends before the set-up: the session needs no second step any more and is not trusted. Accepted as it is: the person signs in again with the switch.
- The first-account tests of 0.6a used the name of a real public person; replaced by an invented one in a commit of this task.

The next sessions must know:

- A test account holds no role. `kit.giveRole(accountId, { role, branchId?, validFrom? })` gives one, `kit.endRole(assignmentId, endedBy, branchId?)` ends one, `signInKit(app, { newAccountsHold: { role, branchId } })` gives every new account one. With the Academic Vice Principal of a branch the strict sign-in holds (second step required, 15 minutes); a branch comes from `insertBranch(database.migrator, name)`. At most 3 accounts can be Super Admin, so a suite with many strict accounts uses the Academic Vice Principal.
- `OptionalSecondStep` and the `secondStepRule` option of `createTestApp` are gone.
- `Assignments.give` and `end` for a role with a branch must run in `Transactions.run([branchId], ...)`: the audit entry belongs to the branch's log, and the row filter refuses it elsewhere (code 42501).
- "Has not ended" is `notEnded(now)`, never `valid_until is null or valid_until > now` alone: an assignment that was taken back before it began has its start as its end.
- 0.7b: the guard reads `session.assignments` (`id`, `role`, `branchId`; `branchId` is `null` for the two school-wide roles) and never the table again for the same request. `TwoStep.turnOff` and `overview` already use them. `assignments` is not filtered by branch: a query on it must filter by hand.
- 0.7b: the count of Super Admins relies on read committed (`Transactions.run`); under a stricter isolation the advisory lock would not be enough.
- 2.3: the errors of `Assignments` (`AssignmentBranchError`, `AssignmentOverlapError`, `TooManySuperAdminsError`, `UnknownAssignmentError`, `AssignmentAlreadyEndedError`, `OwnSuperAdminRemovalError`, `UnknownAccountError`) become coded refusals in the route; the "last active Super Admin" check runs in the same transaction, under the lock `give` takes.
- 2.6: `assignment.given` and `assignment.ended` of the two school-wide roles are in `audit_log_school`; those of a branch role are in the branch's `audit_log`.
- A new role needs `ROLES` and a migration for `assignments_role_check`; a test compares the two.

The next task is 0.7b.

## 4 October 2026: task 0.7a, the load of the API tests (written before `/finish-task`)

The full `pnpm test` was not stable on the owner's machine (8 processors, 6 GB of memory): in each of two full runs a different test hit the 30-second limit, each one a test that creates a database inside its body. Almost every API test file creates a database of its own, starts the application and hashes passwords, and vitest ran one file per processor.

Changed:

- `apps/api/vitest.config.ts`: `maxWorkers: 4`, at most four test files at once. With the other programs open it was not faster (about 233 s for the API tests with the cap, 206 to 222 s without it); with memory free the API tests took 186 s.
- Database creation moved out of test bodies into hooks, which have 60 s: the two tests "does not start on ..." in `jobs.test.ts` and "uses the test database it is given" in `test-database.test.ts`. No check was removed and no limit raised.

Measured with the cap, full runs without the cache: four in a row passed (4m12s, 3m58s, 4m00s, 4m01s). The fifth lost three test files (40 of 43, 932 of 941 tests) with no failed test in the output, and the three runs after it did not start: Node stopped with a fatal error within seconds, in every package. At that moment the machine had about 0.2 GB of memory free and 1 GB of 21 GB virtual memory, held by other programs. The fifth run was not looked into further; lost workers for lack of memory would fit, but that is not confirmed.

After the owner closed the other programs (about 1.1 GB of memory and 9 GB of virtual memory free): lint and type-check pass, and one full run without the cache passed in 3m10s (API tests 186 s, 941 of 941). The owner decided that one clean run is enough; CI runs the suite again on the pull request.

0.7b must know:

- The cap is 4 and its reason is in the config. 0.7b adds the route-by-role harness, the heaviest suite so far: watch the time and the memory of the full run, and lower the cap before raising a time limit.
- A test that needs a database of its own creates and drops it in `beforeAll` and `afterAll`, never in the test body.
- This machine has 6 GB of memory. The full `pnpm test` needs the other programs closed (other Claude sessions, OneDrive sync, VS Code windows, the browser): without free memory test files are lost or Node does not start at all, and that is not a fault of a test. Check the free memory before looking for a cause in the code.
- Three full runs in a row were not seen on this machine; the longest row was two, twice, with the other programs open.

## 4 October 2026: task 0.6d Trusted devices and account lock

Spec change at the start, by the owner (`docs/spec-changes.md`): the sign-in that starts the trust still asks for the second step where the account has one; removing a trusted device ends its session at once.

Built:

- `db/migrations/0008_trusted_devices_account_lock.sql`: `sessions.trust_requested`, `trusted_from`, `trust_ended_at` with two checks; three new end reasons (`expired`, `account_locked`, `trusted_device_removed`); `accounts.locked_at`, `locked_by`, `lock_reason` with three checks. No new table.
- The longest life (`session-life.ts`): a session is over 7 days after `created_at`, trusted or not, worked out on each request; the end is written as `expired` with the moment it was over (`auth.session_expired`). Of the idle end and the 7 days the earlier one counts.
- Trust: `trustDevice` in the body of `POST /api/auth/sign-in` (off when left out). A trusted session has no idle sign-out. Trust begins when the session owes no step: at sign-in without a second step, at the code, or at the end of a required set-up (`Sessions.beginTrust`); never with a first or reset password. The session cookie of a trusted device carries `Expires` (7 days after the sign-in); every other one ends with the browser.
- Trust ends with the session on sign-out, sign out everywhere, a password reset, an account lock and the removal of the device. The own password change keeps the session and ends its trust (`auth.trust_ended`); it still needs the current password.
- Routes: `GET /api/auth/trusted-devices`, `DELETE /api/auth/trusted-devices/:id` (own devices only; anything else is 404 `not_found`; removing the device that asks clears the cookie). The session answers gained `trustedUntil`, the rows of `GET /api/auth/sessions` gained `trusted`.
- `AccountLocks.lock` and `unlock` (service, no route): a lock needs a reason, ends all sessions (`account_locked`) and writes `account.locked`; a locked account gets 403 `account_locked` after the right password only (`auth.sign_in_locked`); `Sessions.resolve` refuses a locked account. Lock and sign-in both take the row of the account with `select ... for update`.
- Audit actions: `auth.device_trusted`, `auth.trust_ended`, `auth.trusted_device_removed`, `auth.session_expired`, `auth.sign_in_locked`, `account.locked`, `account.unlocked`; `auth.sign_in` carries `details.trustRequested` when the switch was on.
- Reviewed by the spec reviewer and the permission reviewer. Neither found a way to another account's devices or sessions, past the 7 days, or to trust before the second step. Fixed from the reviews: the cookie of a trusted device had no end and was gone when the browser closed; a password change now checks inside its transaction that its own session is still open; `TwoStep.remove` locks the sessions in the order of `writeEndsByTime`; tests added (cookie attributes, exact keys of the device list, a device whose 7 days are over, the code and a lock at the same moment, a password change after its session ended or its account was locked, a locked account with an expired password).

Left out, with the task that brings it:

- Routes for lock and unlock, who may lock whom, the last active Super Admin rule, a shared schema for the reason, who may read `lock_reason`: 2.3.
- "The teacher's future lessons go to needs a teacher": 5.7a. Inactive and Left status that block sign-in: 2.2.
- The idle limit and the second-step rule by real roles: 0.7.
- The switch with its note "do not use on a shared computer", the device list, translations (also of `account_locked`): 0.8a.
- Own sign-in history: 2.6.

Decided by the owner after the reviews:

- A trusted session whose second step is removed keeps its trust; no spec change. Turning off where optional needs a right code. The reset by an administrator comes with a password reset at 2.3, which ends every session and so the trust. An unreadable secret is the rare single row left after the start check, and that session proved a code once already.

Open, for the owner:

- A sign-in to a locked account with the right password is not limited: each one writes an `auth.sign_in_locked` entry. Low risk; decide in 10.3.
- A code that arrives after the idle limit while a second request of the same session is in flight can end the session as idle just after its trust began. It fails on the safe side.

The next sessions must know:

- `Sessions.writeIdleEnds` is now `Sessions.writeEndsByTime`. Whatever ends all sessions of an account calls it first; it locks the open sessions of the account ordered by id.
- An `ActiveSession` has `trustedUntil`. `SignInOrigin` needs `trustDevice`; `kit.signIn(login, password, cookies, true)` signs in with the switch.
- `Sessions.changePassword` answers `{ trustEnded }`; `TwoStep.confirm` answers `{ recoveryCodes, trustedUntil }` and `TwoStep.pass` the moment a trusted session ends or `null`. A route that begins or ends trust calls `cookie.keep(until)` (`SessionCookieJar`).
- A test that holds a transaction open and waits for the other side: `waitingForALock` in `account-locks.test.ts` reads `pg_locks`; `pg_stat_activity` hides the wait of another database user. Release the held transaction in a `finally`, or a failure hangs the suite.
- 0.7: the two new routes need their permission declaration (any signed-in account, own data) and a wrong-account case in the harness. The Principal's "changes nothing" rule must decide about `DELETE /api/auth/trusted-devices/:id`: it works like sign-out; ask the owner. `SecondStepRule.required()` by roles changes when trust begins at sign-in (`Sessions.signIn`). A role that requires the second step, given to a person with a trusted session, turns that session into "set up required" while it stays trusted. Load the roles in `Sessions.resolve` beside the account, where `locked_at` is read on every request.
- 2.3: `AccountLocks.lock(transaction, { accountId, lockedBy, reason, requestId })` and `unlock(transaction, { accountId, unlockedBy, requestId })` check no roles and throw `OwnAccountLockError`, `UnknownAccountError`, `AccountAlreadyLockedError`, `AccountNotLockedError`, `LockReasonError`; the route turns them into coded refusals and takes `lockedBy` from the session. The last-Super-Admin check must run in the same transaction, after the row of the account is locked. `account.locked` and `account.unlocked` are school-wide entries: a reader of one branch's log does not see them. A second-step reset must come with a password reset: alone it ends no session and no trust. The question of trust after a second-step reset is settled by that password reset, which ends every session of the account.
- 2.6: the support account ("locked by default, opened for at most 24 hours") does not fit the lock as built: a lock needs a `locked_by` other than the account and a reason, and there is no stored moment for the 24 hours.
- 0.8a: after the password, `trustedUntil` of the answer says whether the device is trusted and until when; with a second step it is `null` until the code. The browser keeps the cookie by itself (`HttpOnly`). After a forced password change the screen says to sign in again to trust the device.
- 0.10: migration 0008 on a database with open sessions: a session older than 7 days ends at its next request. Nothing is deployed yet.
- A new end reason of a session needs a migration (`sessions_end_reason_check`), as before.

The next task is 0.7.

## 4 October 2026: task 0.6c Two-step sign-in

Task 0.6c was split by the owner: 0.6c is the second step, 0.6d is trusted devices, the longest life of a session and the account lock. Where an older entry below names 0.6c for one of those three, read 0.6d.

Spec change at the start, by the owner (`docs/spec-changes.md`): the password change always needs the current password, also on a trusted device; every session ends 7 days after sign-in at the latest.

Built:

- `db/migrations/0007_two_step.sql`: the school-wide tables `account_second_steps` (encrypted secret, moment of confirmation, last used step, count of wrong codes) and `second_step_recovery_codes` (hashes), and `sessions.second_step_passed_at`.
- `totp.ts`: the code of an authenticator app (RFC 6238) with `node:crypto`, base32 and the `otpauth://` address. A code counts for its own 30 seconds and the step before and after, once.
- `SecondStepSecrets`: the secret at rest, AES-256-GCM with `SECOND_STEP_KEY`, stored as `v1:...` with the account bound in. `SECOND_STEP_KEY` (32 bytes, base64) is checked at start; `.env.example`, `ci.yml`, `apps/api/turbo.json` and `apps/api/vitest.config.ts` hold the public local value.
- `SecondStepKeyCheck.run()`, called by `main.ts` and `worker.ts`: the start is refused when the oldest stored secret does not decrypt. Not run by `pnpm api:client`.
- `TwoStep`: set-up, confirmation with ten recovery codes, the code at sign-in, turning off where optional, the count of wrong codes per account, reset by an administrator (no route).
- `SecondStepRule`: required for every account until 0.7; `secondStepRequired(roles)` holds the rule of the spec.
- `SessionGuard`: one owed step at a time, in the order second step, forced password change, set-up of a required second step.
- Routes: `POST /api/auth/second-step`, `GET /api/auth/second-step`, `POST /api/auth/second-step/set-up`, `.../confirm`, `.../turn-off`. The answers of `POST /api/auth/sign-in` and `GET /api/auth/session` gained `secondStep` (`not_needed`, `pending`, `set_up_required`, `passed`).
- Error codes: `second_step_required`, `second_step_set_up_required`, `second_step_code_wrong`, `second_step_already_on`, `second_step_not_on`, `second_step_cannot_turn_off`.
- Audit actions: `account.second_step_started`, `account.second_step_on`, `account.second_step_off`, `account.second_step_reset`, `account.second_step_unreadable`, `auth.second_step_passed`, `auth.second_step_failed`, `auth.recovery_code_used`; `auth.sign_in` carries `details.secondStep`.
- Reviewed by the spec reviewer and the permission reviewer. Neither found a way past the second step or a stored or logged secret. Fixed from the reviews: tests of attempts at the same moment (they fail without the row lock; tried), of the 24 hours and the 15-minute cap of the count, of every route in the states "owes the code" and "passed with a reset password"; a set-up can no longer overwrite a second step in force; removing a second step empties the passed moment of every session; an unreadable started set-up leaves an audit entry; weak tests made exact.

Left out, with the task that brings it:

- Trusted devices, the longest life of a session (7 days), account lock and unlock: 0.6d.
- "Required" from real roles: 0.7. Routes for the second-step reset, who may reset whom: 2.3 (now in its build-plan line).
- Screens, the QR picture, translations: 0.8a.
- New recovery codes without a new set-up, and moving to a new phone while the old one works: the spec names neither. Today: turn off and set up again where optional, or a reset by a Super Admin.
- `Cache-Control: no-store` (already a 0.7 item from 0.6a) matters more now: the answers of set-up and confirm hold the secret and the recovery codes.

Decided by the owner after the reviews:

- 0.6d begins with a `/spec-change` for the "Trust this device" row, which still says "with no idle sign-out and no second step": the sign-in that starts the trust asks the code, and removing a device ends its session. Both are in the 0.6d line of the build plan, not yet in the spec.
- 2.3: a second-step reset by an administrator always goes with a password reset, so the one-time password handed to the person is the proof; the exact wording is decided there. Reason: after a reset of the second step alone, anybody who has the password could set up the new one, from a new sign-in or from a session that was waiting for the code.
- `Cache-Control: no-store` stays at 0.7.

Open, for the owner:

- 0.10: if the oldest stored secret is itself damaged, the API and the worker do not start until that row is removed by hand; the deploy notes should say how. The real `SECOND_STEP_KEY` is a secret of the server (`openssl rand -base64 32`), the same for API and worker, and must be kept with the backups in mind: without it no stored second step can be read.

The next sessions must know:

- Every developer machine needs the `SECOND_STEP_KEY` line of `.env.example` in `.env`; without it `pnpm dev`, `pnpm api:client` and the first-account command stop at start. The tests do not need it.
- Route tests whose accounts should sign in with a password alone: `createTestApp({ ..., secondStepRule: new OptionalSecondStep() })` (`sign-in-kit.ts`). Under the rule of the application a session of `kit.fullSession` reaches only the set-up; `kit.completeSession` also sets up a second step and returns `secret` and `recoveryCodes`. `kit.codeOf(secret)` is the code of the clock's present step; a code counts once, so advance the clock by 30 seconds before the next one.
- A new route is refused in the states "owes the code", "must change the password" and "must set up" unless it carries `@AllowedBeforeSecondStep()`, `@AllowedBeforePasswordChange()` or `@AllowedBeforeSecondStepSetUp()`. Almost no route should.
- 0.6d: trust must not start before `second_step_passed_at` is set, and nothing may be built on `known_devices`: a right password alone writes a row there. A trusted session of an account with a second step still passes it once. New end reasons need a migration (`sessions_end_reason_check`).
- 0.7: `SecondStepRule.required()` must answer `secondStepRequired(roles)` with the roles of the account; `second-step-key-check.test.ts` ("the rule of the second step in the application as it runs") and the strict expectations of `two-step.test.ts` change with it; the four suites with `OptionalSecondStep` can then drop it for accounts without the two roles. `SECOND_STEP_ROLES` is `SHORT_IDLE_ROLES`: rename both in one place. The five new routes need their permission declaration (any signed-in account, own data).
- 0.7, a role given to a person who has no second step: their open sessions fall into "set up required" at the next request, by themselves.
- 2.3: `TwoStep.resetByAdministrator(transaction, { accountId, resetBy, requestId })` throws `OwnSecondStepResetError` and `UnknownAccountError`; it ends no session. The entry `account.second_step_reset` is school-wide.
- 2.6: second-step events for the own sign-in history are found by actor (the account); `auth.second_step_failed` has the session as record.
- 0.8a: after the password, read `secondStep` of the answer: `pending` shows the code field (a recovery code goes into the same field; spaces and hyphens are ignored), `set_up_required` the set-up. `too_many_attempts` comes with `Retry-After` here too. After a forced password change the screen says to sign in again to trust the device (decided by the owner for 0.6d).
- A key change later: the new key becomes version 2 with a variable of its own in `config.ts` and `SecondStepSecrets`; version 1 stays readable until no stored secret has it. No migration.

The next task is 0.6d.

## 4 October 2026: task 0.6b Limits, resets and idle sign-out

Changed by the owner at the start: password reset by email and the mail service moved to 2.3 (`docs/build-plan.md`); an account has no email address before 2.2.

Built:

- `db/migrations/0006_sign_in_limits_idle_resets.sql`: `sessions.last_used_at` and `user_agent`, three new end reasons (`idle`, `sign_out_everywhere`, `password_reset`); `accounts.password_reset_by` and `password_reset_at`; the school-wide tables `known_devices` and `sign_in_throttle`.
- Attempt limit (`sign-in-throttle.service.ts`): per login and device; five failures, then a wait of 30 seconds that doubles up to 15 minutes; 429 `too_many_attempts` with `Retry-After`; unknown logins counted alike; forgotten after 24 hours or a right password; each attempt removes up to 50 forgotten rows. It also covers the current password of `POST /api/auth/password`.
- Device cookie `__Host-sodiq_device` (`apps/api/src/http/device-cookie.ts`), set at every successful sign-in.
- Idle sign-out in `Sessions.resolve`, from `last_used_at` and the injected clock; `idle-limit.ts` holds the rule per role.
- Routes: `GET /api/auth/sessions` and `POST /api/auth/sign-out-everywhere` (own session only). `GET /api/auth/session` and the sign-in answer gained `passwordResetBy`.
- `PasswordResets.byAdministrator` (service, no route): one-time password for 24 hours, forced change, all sessions ended, the count of failed sign-ins of the login cleared, audit entry.
- Audit actions: `auth.sign_in_failed`, `auth.password_change_failed`, `auth.session_idle`, `auth.sign_out_everywhere`, `account.password_reset`.
- Reviewed by the spec reviewer and the permission reviewer. Fixed from the reviews: the count of an attempt no longer ends as a fault when its row is removed at the same moment; sessions already over by time keep their own end when all sessions are ended; a wrong current password leaves an audit entry; the last use never moves backwards; missing tests added.
- `apps/api/src/testing/sign-in-kit.ts`: `signInKit(app)` with `newAccount`, `signIn`, `firstSession`, `fullSession`, `probe` for route tests that need a signed-in caller.

Left out, with the task that brings it:

- Password reset by email, the mail service, the route of the reset by an administrator and who may reset whom: 2.3.
- The idle limit by real roles: 0.7 (see below). Trusted devices (no idle sign-out) and the second step: 0.6c.
- The report "entries made within 48 hours of a reset" (edge cases, "Accounts and sign-in") is in no task: it belongs to 2.6 or 8.9, whichever builds audit reports. The data is there: `account.password_reset` entries in `audit_log_school`.
- A screen for the session list, the text "your password was reset by X", translations: 0.8a. Own sign-in history: 2.6.
- Ending one other session from the list: the spec names only the list and "sign out everywhere".

Decided by the owner after the reviews (nothing changed in code):

- 10.3: open risk, accepted for the pilot. All browsers that never signed in to an account share one count of failed sign-ins per login. Somebody who knows a login (they are guessable) and sends one wrong password each time the wait ends keeps every new browser out of that account, also on the first day, when no browser is known yet; a reset clears the count only until the next guess. 10.3 decides between the two candidate answers: count unknown devices per login and network address (needs a spec change, the spec says "not per network address": `/spec-change`), or a human check for unknown devices after repeated failures.
- 0.6c: a session has no longest life: used every 14 minutes it lives until a password change, a reset or "sign out everywhere". Consider a longest life of 7 days for every session, matching trusted devices.
- 10.2: `known_devices` has no cleanup: each sign-in without a device cookie adds a row. The cleanup job of 10.2 should cover it together with `sign_in_throttle`; the application user has no delete right on `known_devices` today, so that needs a migration.
- 2.3: `PasswordResets.byAdministrator` hashes the new password inside the caller's transaction, as `Accounts.create` does since 0.6a. The route should keep that transaction short.
- 0.10: migration 0006 on a database with open sessions: a session older than 15 minutes ends as idle at its next request. Nothing is deployed yet.
- The audit entry `auth.password_change_failed` stays.

The next sessions must know:

- Whatever ends all sessions of an account calls `Sessions.writeEndsByTime(transaction, accountId)` first (named `writeIdleEnds` before 0.6d) (0.6c: account lock; 2.3: lock and unlock).
- 0.7: the Principal's "changes nothing" rule must exempt `POST /api/auth/password`, sign-out and sign-out-everywhere. Load the roles in `Sessions.resolve` beside the account, so the idle limit follows a role change at once.
- 2.3: the reset entry `account.password_reset` is school-wide (`branchId: null`), so a reader of one branch's log does not see it. A `resetBy` that is no account ends as a foreign-key fault: the route passes the session's account.
- 2.6: the own sign-in history finds `auth.sign_in_failed` by its record (the account); its actor is empty. The 48-hour report can only come from the `account.password_reset` entries: `accounts.password_reset_at` is emptied by the password change.
- 0.8a: the browser name in the session list is text a caller chose: show it as plain text.
- 0.7: today every session gets the 15-minute idle limit (`Sessions.idleLimitMs`). 0.7 must make it call `idleLimitMs(roles)` with the roles of the account: 30 minutes, 15 with Super Admin or Academic Vice Principal. The test "0.7: today every session gets the 15-minute limit" in `idle-sessions.test.ts` must be changed then (29:59 and 30:00 for the other roles), and `SHORT_IDLE_ROLES` in `idle-limit.ts` must use the role names of 0.7.
- 0.7: the two new routes need their permission declaration (any signed-in account, own data). `GET /api/auth/sessions` must stay limited to the caller's account.
- 10.2: `sign_in_throttle` is cleaned only by sign-in attempts, 50 rows each. A cleanup job should take this over (rows whose `last_failure_at` is older than 24 hours).
- A test whose session must survive more than 15 minutes of clock time has to use it on the way (`advanceInUse` in `auth.test.ts`), or the session is over.
- A route that the web app calls by itself on a timer (0.9 unread count, 8.3b) is a use and would keep a session alive for ever: such a route must not go through `Sessions.resolve` as it is, or resolve needs a way to read without refreshing. Decide in 0.9.
- 0.6c: a trusted device has no idle sign-out: `Sessions.resolve` and `Sessions.list` both apply the limit. Trust is not the device cookie: `known_devices` only separates the counts of failed sign-ins and opens nothing. New end reasons need a migration again.
- 2.3: `PasswordResets.byAdministrator(transaction, { accountId, resetBy, requestId })` throws `OwnPasswordResetError` and `UnknownAccountError`; the route turns them into coded refusals and checks who may reset whom before calling. A reset clears the count of failed sign-ins of that login on every device (`SignInThrottle.forget`), in the same transaction.
- 2.2: `passwordResetBy` in the session answer is a login; with staff records it should become a name.
- 0.8a: `too_many_attempts` comes with `Retry-After` in seconds; the sign-in page should show the wait. The browser must keep the device cookie (it is `HttpOnly`; nothing to do in code).
- A new coded refusal with a wait: `new ApiException(code, 429, seconds)`.

The next task is 0.6c.

## 4 October 2026: task 0.6a Accounts and sessions

Built:

- `db/migrations/0005_accounts_sessions.sql`: `accounts` (login, Argon2id hash, forced change, expiry of the first password; no name) and `sessions` (hash of the token, start, end with reason). Both school-wide. The application user cannot delete an account, change a login, or delete or alter a session; it can only end one. A check constraint refuses a forced password change without an expiry.
- `apps/api/src/modules/auth/`: `Accounts.create` (generated login, random first password valid 7 days, shown once), `Sessions` (sign-in, resolve, sign-out, password change), `SessionGuard` (global), `AuthController`, `FirstAccount` and the command `pnpm auth:first-account -- --first-name <name> --last-name <name>`.
- Routes: `POST /api/auth/sign-in` (public), `GET /api/auth/session`, `POST /api/auth/password`, `POST /api/auth/sign-out`. `GET /api/health` is declared public on its handler.
- `apps/api/src/http/`: `ApiException(code, status)` and eight new error codes; the session cookie (`__Host-sodiq_session`, read by hand); the cross-site check for changing requests; `@RequestId()`; `@ReturnsNothing()` (204).
- Password hashing with Node's own `crypto.argon2` (no library); `engines.node` is `>=24.7 <25`.
- Spec change, by the owner: a short list of routes works without sign-in (`docs/spec-changes.md`). `public-routes.test.ts` holds the exact list.
- Reviewed by the spec reviewer and the permission reviewer. Fixed from the reviews: the public-routes test now sees inherited handlers; a first password older than 7 days is refused as the current password inside an open session; a login that cannot be a login (zero byte) no longer reaches the database; missing tests added (cross-site check with a real session, other parameters of a stored hash, two password changes at once, HEAD and other spellings of a path).
- Hand test against `sodiq_dev`: command, sign-in, forced change, sign-out. The two accounts it made were removed afterwards by the owner's order; their audit entries remain in `audit_log_school`.

Left out, with the task that brings it:

- A route and screens to create accounts, lock and unlock, the last Super Admin rule: 2.3. The Super Admin assignment written by the command, `assignmentId` in audit entries, role, branch and scope checks, the route-by-role harness: 0.7.
- Attempt limit, reset by an administrator and by email, idle sign-out, session list, "sign out everywhere", failed sign-ins as records: 0.6b. Second step and trusted devices: 0.6c.
- Link from an account to a person or staff record, "inactive cannot sign in", re-hiring: 2.2. Printed slips and the "accounts never used" report: with the staff screens.
- A request key tied to the account that sent it (noted for 0.6a in the 0.4b entry): moved to 0.7, where the guard supplies the account.
- Screens and translations: 0.8a.
- From the reviews, moved to 0.7 by the owner: accept JSON bodies only (a form-encoded body is accepted today; the cookie and the cross-site check still stand in front of it), and `Cache-Control: no-store` on API answers.
- No test reaches the re-check of the password hash inside sign-in (a password change between the check and the session); the code was read by both reviewers.

The next sessions must know:

- Every route is refused without a session unless its handler has `@Public()` (`session.guard.ts`). A new public route is a decision for the owner and must be added to `PUBLIC_ROUTES` in `public-routes.test.ts` with a reason. `@Public()` works on a handler only.
- A route gets the caller with `@CurrentSession() session: ActiveSession` (session id, account id, login). Never take an account id from the path or the body for "own" actions.
- Route tests that need a signed-in caller: see `firstSession` and `fullSession` in `auth.test.ts` (create an account through `Accounts`, sign in, send the `Cookie` header by hand). Test-only controllers need `@Public()` on each handler or a session.
- A coded refusal: add the code to `ERROR_CODES` (`packages/shared`), its text to `error-response.ts`, and throw `new ApiException(code, status)`.
- A route without a body in its answer: `@ReturnsNothing()`. Audit entries of a route carry `@RequestId()`.
- 0.6b: the attempt limit must also cover the current password of `POST /api/auth/password`. Idle sign-out goes into `Sessions.resolve`; public routes do not call it, so they do not refresh the last use. A reset must set `must_change_password` and `password_expires_at` together (24 hours). A session with an expired first password can only be read and signed out: it needs the reset. Signing in again leaves the old session of that browser open until it ends by time. `end_reason` has a check constraint: new reasons need a migration.
- 0.6b, password reset by email: its routes are public and go into `PUBLIC_ROUTES`.
- 0.7, two items from the 0.6a reviews: (1) accept only JSON bodies on the API (today a form-encoded body is parsed too, so a plain HTML form of another site can build a valid body; refuse other content types before the routes); (2) send `Cache-Control: no-store` on every API answer, so a shared classroom computer keeps no answer of a GET route.
- 0.7: the permission guard builds on `SessionGuard`; `POST /api/auth/password` must stay allowed for every role, also the Principal. `Sessions.resolve` must refuse locked accounts once that state exists. The command must also write the Super Admin assignment and then refuse by "a Super Admin exists". The harness must list routes the way `routesOf` in `public-routes.test.ts` does (inherited handlers included) and should also look at the Express router for what is not a controller.
- 0.9: a Socket.IO gateway is not behind `APP_GUARD` nor behind the cross-site check; it needs its own session check at the handshake.
- 0.8a: the web client sends JSON and needs no CSRF token. The first Playwright sign-in shows whether Chromium accepts the `__Host-` cookie with `Secure` on `http://localhost`; if not, name and `Secure` become configuration (`docs/decisions.md`). The sign-in field should switch off auto-capitalisation: a login is compared exactly.
- 0.10: Node 24.7 or later on Render. `trust proxy` must be set, or the `Origin` fallback of the cross-site check refuses HTTPS requests of browsers that send no `Sec-Fetch-Site`. The first-account command runs on the server as `node dist/modules/auth/cli.js first-account --first-name ... --last-name ...` with `DATABASE_URL` of `sodiq_app`.
- In Git Bash here a heredoc also loses backslashes (`\\u`, `\\.` arrive as `\u`, `\.`): use the editor tools for anything with a backslash.

The next task is 0.6b.

## 4 October 2026: spec change, routes that work without sign-in

Made at the start of task 0.6a (`docs/spec-changes.md`). The next sessions must know:

- 8.3a: the health check must be exempt from the rule "every request carries the application version" (`edge/system-behaviour`): the uptime monitor cannot send a version.

## 4 October 2026: task 0.5b Jobs

Built:

- `db/migrations/0004_job_queue.sql`: schema `pgboss` of pg-boss 12.36.0 (schema version 44), owned by `sodiq_migrator`, with the rights of `sodiq_app` table by table. pg-boss is pinned exactly and starts with `migrate: false, createSchema: false`; `@opentelemetry/api` 1.9.1 is declared because pg-boss cannot load without it (approved by the owner).
- `apps/api/src/jobs/`: `defineJob` and the list `job-list.ts` (empty); `Jobs.enqueue(transaction, definition, { branchIds, data })`, which writes the job in the caller's transaction; `JobRunner`, which runs a handler inside `Transactions.run(branchIds, ...)` and `RequestKeys.runOnce` with the job id as key; `JobQueue`, the one pg-boss instance, not exported.
- The worker: `apps/api/src/worker.ts` and `worker.module.ts`, the same modules as the API without HTTP. `pnpm dev` now runs web, API and worker (`dev:worker`, its own watch build in `apps/api/dist-worker`); `start:worker` for the server.
- Tests: no job after a rollback (the done-when), change, audit entry and job committed together, no job after a failed keyed work, the refusals of `enqueue`, the handler sees only the job's branches, a run that fails half-way is undone and tried again, a job delivered twice changes the data once, the stored failure holds no other field of the error, the worker entry point, and the rights of the application user in schema `pgboss`.
- `catalog.test.ts`: the schemas are exactly `public` and `pgboss`; in `pgboss` every object belongs to `sodiq_migrator`, the tables are those of pg-boss 12.36.0, the effective rights of `sodiq_app` are the listed ones, and there is no view and no `SECURITY DEFINER` function.
- Reviewed by the spec reviewer. Its must-fix is fixed: a job may only name branches of the transaction that enqueues it. No route was added, so no permission review.
- Test stability, found by repeated full runs: `destroy` of a test database waits until no session is left before the drop; the hook timeout of the API tests is 60 s; `apps/web/tooling/api-types.test.ts` has a limit of 30 s (it starts a Node process and came close to 5 s when builds ran beside the tests).

Left out, with the task that brings it:

- Any real job and handler: 0.9 (delivery of notifications) is the first.
- Scheduled jobs (`schedule: true`): 9.2c with the nightly check.
- Alerts on failed jobs, a dead-letter queue, how long failed jobs are kept: 10.2. The Render worker service: 0.10.
- Not done from the review, by choice, for the owner to confirm: the message of a failure is stored in the job row and logged as thrown (the same rule as for a 500; some PostgreSQL messages repeat a value); `sodiq_app` may update all of `pgboss.version`, not only its timestamp columns (narrowing it means editing the migration and applying it again in `sodiq_dev`); no test ties the migration file to the output of `pg-boss plans create`.

The next sessions must know:

- A new job: `defineJob({ name, data, options })` beside the code that enqueues it, add it to `JOB_DEFINITIONS` in `job-list.ts`, and name its handler with `jobRunner.handle(definition, handler)` in a provider's `onModuleInit`. The worker refuses to start while a definition has no handler. `data` holds ids only: it is readable from a transaction of any branch.
- Enqueue inside the `Transactions.run` of the change, next to `audit.record`. The job's `branchIds` must be among the branches of that transaction; a school-wide transaction (`[]`) cannot enqueue for a branch. Ask the owner before loosening this.
- A handler decides from stored moments and the injected clock, never from the fact that it was triggered: a job can run late or twice (`.claude/rules/api.md`).
- 0.9: the runner's repeat safety covers database changes only. A handler that sends something outside the database (Telegram, email) must send after its transaction commits and must be safe when the send is repeated.
- A route test whose route enqueues a job: `createTestApp({ database: database.app, jobsDatabaseUrl: database.appUrl })`. Tests of a handler: build `JobQueue`, `Jobs` and `JobRunner` as in `jobs.test.ts`, with `pollingIntervalSeconds: 0.5` and the helpers of `src/testing/sample-job.ts`.
- 10.2: a job in state `failed` does not prove that its work was not done (worker died after the commit; a run longer than 15 minutes). The request key with the job id and scope `job:<name>` is the proof. pg-boss has one retention for completed and failed jobs (`deleteAfterSeconds`, 7 days): "failed jobs for 30 days" needs every finished job kept for 30 days or a dead-letter queue.
- 0.10: the worker on Render runs `pnpm --filter @sodiq/api start:worker` from the same build as the API, with `DATABASE_URL` of `sodiq_app`. API and worker stop at start when schema `pgboss` is missing or of another version, so migrations run first.
- An upgrade of pg-boss: the new exact version and a new migration made from `pg-boss plans migrate` in one pull request; update `JOB_TABLE_RIGHTS` in `catalog.test.ts` if tables change. With `persistQueueStats` or `registerInstance` turned on, pg-boss needs rights it does not have; ask first.
- pg-boss logs a failed run as an error line; in the tests these lines (`sample.note ...: The run failed.`) are expected.
- In Git Bash here a heredoc breaks on apostrophes (again in this task): write a script file with the editor tools and run it.

The next task is 0.6a.

## 4 October 2026: task 0.5a Audit log

Task 0.5 was split by the owner: 0.5a is the audit log, 0.5b is jobs (pg-boss, the worker).

Built:

- `db/migrations/0003_audit_log.sql`: `audit_log` (belongs to a branch, standard branch filter) and `audit_log_school` (events without a branch), with the same columns: id, occurred_at, actor_id, person_id, assignment_id, action, record_type, record_id, old_value, new_value, reason, details, request_id. Both are partitioned by month (UTC borders) from October 2026 to December 2029, with a default partition each.
- Append-only: `sodiq_app` has select and insert on the two parents and no right on any partition. Tests prove that update, delete and truncate are refused, that a partition cannot be reached directly, and read the rights of every partition from the catalog.
- `Audit.record(transaction, entry)` (`apps/api/src/modules/audit/audit.service.ts`), in a global `AuditModule`: writes in the caller's transaction with the moment from the injected clock. `branchId: null` writes to `audit_log_school`.
- `catalog.test.ts`: `audit_log_school` and its partitions are listed as school-wide (names generated for the range of the migration).
- Reviewed by the spec reviewer: no must-fix finding; the weak tests it found are fixed. No route was added, so no permission review.

Left out, with the task that brings it:

- pg-boss, the worker entry point, jobs in the transaction, `pnpm dev` and CI wiring, the catalog checks for schema `pgboss`: 0.5b.
- Journal cell history (also append-only and partitioned): 6.1.
- Reading routes, rights per role, the screen, exports: 2.6.
- Foreign keys of `actor_id` and `person_id`, and a column for the system actor: 0.6a. Foreign key of `assignment_id`: 0.7. A flag for the support account: 2.6.
- No speed test at the spec's data volume: 10.1.

The next sessions must know:

- Every change to timetable, journal, results, people and settings: `await audit.record(transaction, { branchId, actorId, action, record, oldValue, newValue, ... })` inside the `Transactions.run` of the change. An entry for a branch the transaction does not work for is refused by the row filter. Left out and `null` values are stored alike; a cleared field is `{ field: null }`.
- A query on the audit log should carry a date range, or PostgreSQL opens every partition.
- A migration whose code needs the new types: `pnpm db:migrate` builds the API first and fails until the types are regenerated. Way out used here: in `apps/api`, `pnpm exec tsc -p tsconfig.build.json` (it emits despite the type errors), `node dist/database/cli.js migrate`, then `pnpm db:codegen`. Or write and apply the migration before the code that uses it.
- Adding months (before mid-2029; a test fails from 1 July 2029): a new migration that creates the partitions before those months begin and while the default partitions are empty. Creating a partition locks the parent and scans the default partition; if the default partition holds a row of the new month the migration fails. Each new `audit_log` partition needs row security and the `branch_filter` policy and no grant; extend the range in `auditSchoolPartitions()` of `catalog.test.ts`.
- 0.5b, found while planning: pg-boss is 12.36.0 (Node 22.12 or later). Its schema SQL comes from `pg-boss plans create --schema pgboss` and goes into a numbered migration (remove `begin` and `commit`: the runner refuses them); the application starts it with `migrate: false, createSchema: false`. Pin the exact version; an upgrade means a new migration from `plans migrate`. A job is sent in our transaction with `boss.send(name, data, { db: fromKysely(transaction) })` (`fromKysely` is part of pg-boss). Check first whether `createQueue` (default `partition: false`) needs more than insert rights; otherwise queues are created in the migration. Jobs carry `branchIds` and the handler opens `Transactions.run(branchIds, ...)`; payloads hold ids only. The catalog test "keep everything in schema public" must be extended. The notes of 0.2, 0.3 and 0.4b for 0.5 below still hold.
- 0.6a: sign-ins and the first Super Admin command are school-wide entries (`branchId: null`, and for the command `actorId: null` with the command named in `details`).
- 0.7: the guard supplies `assignmentId` and `requestId` for audit entries.
- 2.6: the audit screen must apply the field-group rules of people-roles-accounts ("Personal data and the audit log") to `old_value` and `new_value`, so a role that sees identity or financial fields hidden does not read them through the audit log. 2.6 also decides who reads `audit_log_school` entries (sign-ins, settings): the spec gives the Principal and Academic Vice Principal "their branch" only, and at database level any transaction can read that table. Entries about a branch's person that are school-wide (sign-ins, relatives) are not in that branch's `audit_log`.
- 0.10: `sodiq_migrator` owns the audit tables and could change them, so its password exists only in the deploy secret and is never used by the running application.

The next task is 0.5b.

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

- 0.10: the database user of the application on Neon must not be a superuser, must not have BYPASSRLS and must not own the tables. Confirmed by the owner from Neon's documentation (neon.com/docs/manage/roles): roles created in the Neon Console, CLI or API are members of `neon_superuser`, which has BYPASSRLS; roles created with SQL are not. So `sodiq_app` and `sodiq_migrator` are created with SQL (`CREATE ROLE ... LOGIN PASSWORD`) from the SQL editor or psql, never in the console. With a wrong user the API refuses every transaction instead of showing all branches.
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
