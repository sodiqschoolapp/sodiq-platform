# Build plan for Release 1

Tasks are done in order, one per session, branch and pull request. Each task lists the spec files to read, what to build, and how to know it is done. The task's box is ticked inside its own pull request (the `/finish-task` skill does this).

How to read the task lines:

- `01` to `17` mean the files in `docs/spec/`, and `edge/<name>` means `docs/spec/edge-cases/<name>.md`. Words in brackets name the heading to look at first; still read the whole file.
- Every task also reads `edge/00-definitions`. Every task that adds a migration also reads `edge/developer-rules`.
- "Done when" is the minimum. The definition of done in `CLAUDE.md` applies to every task from 0.8c on; before that, the parts that do not exist yet (permission guard, languages) are skipped.
- If a task is still too large for one session, the builder splits it into a, b, c in this file, in the task's own pull request, plans and builds the first part, and flags the split **Look first** on issue #42 (`docs/decisions.md`, 12 October 2026). Nothing waits for a confirmation.
- A fix task `<id>b` (for example `1.3b`) is a task the owner adds when a decision made without the owner is changed on issue #42 and code must change (`docs/decisions.md`, 11 October 2026, decision 1). It is placed first among the open tasks, so the start routine takes it next; its Read line names the decision it changes.
- Until go-live the loop does not wait for decisions (`docs/decisions.md`, 12 October 2026). The owner's reviewer prepares each phase's decided-ahead questions while the phase before it runs; answers merged under "Decided ahead" in `docs/decisions.md` before the phase starts are used, and where none came, the loop decides and flags as for any silence of the spec. One owner gate line (`> **Owner gate.** …`) is left, before Phase 10, where the live system, real data and secrets start: the first unticked task after it is not started until the owner deletes the line, after a go-live review of every Look first decision with the owner's reviewer.

## Phase 0. Foundations

- [x] **0.1 Repository skeleton**
  - Read: `13`, `CLAUDE.md`.
  - Build: the owner has created the repository with a `main` branch holding this starter pack; work on a branch from it. pnpm workspace with Turborepo; `apps/web` (Vite, React, TypeScript strict, Tailwind, shadcn/ui); `apps/api` (NestJS on Node LTS) with the module folders named in `CLAUDE.md`; `packages/calc`, `packages/timetable-rules`, `packages/shared`; ESLint, Prettier and Vitest in every package; the scripts listed in `CLAUDE.md`; setup steps in `README.md`.
  - Done when: `pnpm install`, `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm dev` work on a clean clone, and the web app shows a placeholder page that calls an API health route.

- [x] **0.2 Database, migrations and typed queries**
  - Read: `13`, `edge/developer-rules`.
  - Build: local PostgreSQL connection; a migration runner for numbered SQL files in `db/migrations`; extension `btree_gist`; separate database users for migrations and for the application; Kysely with types generated from the database; a test helper that gives each test file a clean database.
  - Done when: `pnpm db:migrate` and `pnpm db:codegen` work and a sample test writes and reads a row.

- [x] **0.3 Continuous integration**
  - Read: `14` (Whole system).
  - Build: GitHub Actions workflow that installs, lints, type-checks and runs the tests with a PostgreSQL service on every pull request.
  - Done when: a pull request shows the checks and fails when a test fails. The owner then turns on required checks for `main` in GitHub.

- [x] **0.4a API foundations: HTTP side**
  - Read: `13` (Structure, Security), `edge/developer-rules`, `edge/system-behaviour`.
  - Build: configuration loading; one error shape; request ids; input validation with shared schemas; OpenAPI document and the generated web client (`pnpm api:client`); an injected clock.
  - Done when: a sample route is validated, documented, called from the web app through the generated client and tested with a fixed clock.

- [x] **0.4b API foundations: database side**
  - Read: `13` (Structure, Security), `edge/developer-rules`, `edge/system-behaviour`.
  - Build: a minimal `branches` table; the branch filter set per transaction (a list of branch ids, normally one; nothing set shows no rows), with row-filter policies that later tables reuse; a transaction helper; repeat-safe request keys.
  - Done when: a test shows a row of another branch is invisible, the filter does not stay on a pooled connection, and a repeated request with the same key changes nothing.

- [x] **0.5a Audit log**
  - Read: `13` (Security), `edge/developer-rules`, `edge/system-behaviour`, `edge/people-roles-accounts` (Personal data and the audit log).
  - Build: append-only audit table partitioned by month, which the application user cannot update or delete; an audit service used inside transactions.
  - Done when: tests prove an audit row cannot be changed.

- [x] **0.5b Jobs**
  - Read: `13` (Security), `edge/developer-rules`, `edge/system-behaviour`, `edge/people-roles-accounts` (Personal data and the audit log).
  - Build: pg-boss with a worker entry point; jobs enqueued in the same transaction as the data change (this is the "outbox" of the developer rules, see `docs/decisions.md`).
  - Done when: a test proves that no job exists when its transaction rolls back.

- [x] **0.6a Accounts and sessions**
  - Read: `02` (Accounts and sign-in: build order), `edge/people-roles-accounts` (Accounts and sign-in), `13` (Security).
  - Build: accounts created by an administrator; generated logins; Argon2id; cookie sessions kept in the database; sign-in and sign-out; forced password change at first sign-in; the one-time server command that creates the first Super Admin.
  - Done when: each rule built here has a test, including the refusals.

- [x] **0.6b Limits, resets and idle sign-out**
  - Read: the same files, and `16` (question 41).
  - Build: attempt limiting per account and device; reset by an administrator with a one-time password (as a service; its route comes in 2.3); idle sign-out after 30 minutes, 15 for the Super Admin and Academic Vice Principal; session list and "sign out everywhere". Password reset by email and the mail service moved to 2.3: an account has no email address before the staff records of 2.2.
  - Done when: tests cover each rule with the injected clock.

- [x] **0.6c Two-step sign-in**
  - Read: the same files.
  - Build: TOTP second step with recovery codes, required for the Super Admin and Academic Vice Principal (for every account until 0.7 brings the roles); the forced steps at sign-in; the secret stored encrypted; reset of the second step by an administrator (as a service; its route comes in 2.3).
  - Done when: tests cover each rule with the injected clock, including the refusals.

- [x] **0.6d Trusted devices and account lock**
  - Read: the same files.
  - Build: "Trust this device" for 7 days with no idle sign-out (the sign-in that starts the trust still asks for the second step); every session ends 7 days after sign-in at the latest; the ways trust ends; list of trusted devices, where removing one ends that session; account lock and unlock (as a service; the routes come in 2.3).
  - Done when: tests cover trust ending on sign-out, password change, reset and account lock.

- [x] **0.7a Roles and assignments**
  - Read: `02`, `edge/people-roles-accounts` (Who can act).
  - Build: the 15 roles; assignments (account, role, branch, with a start and an end as moments; subject and class scope are added in 2.3 and 3.1) with a service to give and end them (routes come in 2.3); the first-account command writes the Super Admin assignment; the idle limit and the required second step follow the roles of the account.
  - Done when: tests cover each rule built here with the injected clock, including the refusals.

- [x] **0.7b Permission table and guard**
  - Read: the same files.
  - Build: the permission table in `packages/shared` (its shape; each later task adds the rows of its area); a server guard used by every route, with the branch of the request (header `X-Branch-Id`); the "nobody approves their own request" helper; a test harness that checks every route against every role; permission declarations for the existing routes of the own sign-in (open to every signed-in account).
  - Done when: the harness fails if a route has no permission declaration, and sample routes pass for all 15 roles.

- [x] **0.7c Request hygiene**
  - Read: `13` (Security), `edge/developer-rules` (Repeat-safe actions).
  - Build: JSON bodies only; `Cache-Control: no-store` on every answer; the request key tied to the account (migration 0010); the lint rule that keeps `createParamDecorator` and `REQUEST` inside `apps/api/src/http/` and the guard files.
  - Done when: a form-encoded body is refused, every answer carries `no-store`, and a key used by another account is refused with 409.

- [x] **0.8a Web shell: sign-in, layout and languages**
  - Read: `12`, `02`.
  - Build: sign-in, password change and second-step screens; the app layout; i18next with Uzbek, Russian and English; a check that fails the build when a translation key is missing in any language.
  - Done when: Playwright signs in and out in each language.

- [x] **0.8b-1 Web shell: lists and page states**
  - Read: `12` (One pattern everywhere, Look and feel).
  - Build: the shared table; the shared list pattern (search, filters, column chooser, sorting, checkboxes with bulk actions, export, side panel), which loads the whole list of a branch and searches, sorts and filters in the browser, with room for server paging (2.6); the page header with breadcrumbs; empty, loading and error patterns; a sample list for development. Split off from 0.8b by the owner.
  - Done when: a sample list uses only the shared pieces.

- [x] **0.8b-2 Web shell: forms**
  - Read: `12` (One pattern everywhere, No lost work, Look and feel).
  - Build: the form pattern (a Save button on record forms, each field checked as it is typed, a warning before leaving with typed changes); the confirmation dialog for actions that cannot be undone, which names what will be affected; the unsent-changes banner (typed and not saved, or a save that failed; the journal queue of 8.3c joins it); a sample form for development. Undo waits for the first action that offers it. Split off from 0.8b by the owner.
  - Done when: a sample form uses only the shared pieces.

- [x] **0.8b-3 Web shell: shell tools**
  - Read: `12` (One pattern everywhere, Look and feel), `14` (Whole system), `edge/developer-rules`.
  - Build: Ctrl+K search (pages only for now; records are added as they are built), without a further library; the feedback button, inside the layout only, with its school-wide table and route in a module `feedback` (roles from the session, never from the body; the page is the path without the query; at most 20 reports a day per account; no audit entry; the owner reads the table until a screen exists); the theme switch (light, dark, as the device), kept in the browser; the review of the look (contrast to WCAG 2.1 AA only; brand colour and logo come as a small task when the owner provides them). Split off from 0.8b-2 by the owner.
  - Done when: a feedback report reaches the table with the page and the roles of the session, and the contrast test passes in both themes.

- [x] **0.8c Web shell: menus and home pages per role**
  - Read: `02`, `08` (Home pages by role).
  - Build: navigation per role; role switcher and branch switcher; an empty home page for each role that later tasks fill.
  - Done when: a signed-in user of each of the 15 roles sees the right menu.

- [x] **0.8d Own account page**
  - Read: `edge/people-roles-accounts` (Accounts and sign-in), `12` (Language), `02`.
  - Build: the page of the own account: the session list with "sign out everywhere"; the list of trusted devices, each removable; turning the optional second step on and off; the language stored on the account (a column and a route of the own account) and taken from it at sign-in, so that 0.9 can send notices in the person's language. Split off from 0.8a by the owner.
  - Done when: Playwright removes a trusted device, signs out everywhere, and a language chosen in one browser is in use after sign-in in another.

- [x] **0.9 Notifications to staff in the app**
  - Read: `10` (Notifications, and the last paragraph: staff notifications are Release 1), `edge/system-behaviour`.
  - Build: a notification record per person; the list and unread count in the top bar; delivery through a job; live arrival over Socket.IO; a helper that later tasks call for timetable changes, substitutions, locks, requests and plan windows. No SMS, no parents, no students.
  - Done when: a test event reaches the right person and nobody else.

- [x] **0.10 Test environment and deploy pipeline**
  - Read: `13` (Hosting and data, Running cost), `edge/system-behaviour`.
  - Build: Render services for API and worker; static site for the web app; Neon database; Cloudflare R2 bucket; Sentry; Resend for the mail service; deploy from `main` by GitHub Actions; migrations run before the new version starts; a smoke test after deploy. The owner creates the accounts and enters the secrets in each provider's dashboard. Never ask for secrets in chat and never write them to a file in the repository.
  - Done when: a merged pull request reaches the test environment without manual steps and the smoke test passes.

## Phase 1. School setup

- [x] **1.1 Branches, buildings, floors and rooms**
  - Read: `03`, `edge/timetable` (Structure).
  - Build: full branch record on top of the table from 0.4; buildings and floors; rooms with type, capacity, status and the "shared" switch; the room list.
  - Done when: the Super Admin can create and edit them and other roles are refused.

- [x] **1.2 Divisions and departments**
  - Read: `03` (Divisions).
  - Build: the eight divisions as data with Academic built in; departments; names in three languages; archive rules.
  - Done when: Academic cannot be renamed or archived and a division with active staff cannot be archived.

- [x] **1.3 Academic year and quarters**
  - Read: `03`, `edge/academic-year`, `edge/time-dates-calendar`.
  - Build: years with status (planned, current, closed); exactly one current year per branch; four quarters with no overlaps or gaps; the go-live start date per branch.
  - Done when: the database refuses a second current year and overlapping quarters.

- [x] **1.5 Slot types and day templates** (built before 1.4: the calendar points at day templates)
  - Read: `03`, `06` (Model), `edge/time-dates-calendar`.
  - Build: slot types (lesson or break, length in minutes); day templates as an ordered list of slots with calculated times; default template, weekday templates, special-date templates and templates per grade range; the order in which a special date (for a grade range, then for the branch), weekday with grade range, weekday, grade range and the default decide the template of a class on a date; the table of the resulting template per weekday and grade, shown again with the changes marked as the preview when a template is saved at any level.
  - Done when: times are never typed, reordering recalculates them, and a lesson can only sit in a lesson slot.

- [x] **1.4 Calendar**
  - Read: `03`, `edge/time-dates-calendar`.
  - Build: days off and special days for the whole branch or a range of grades; each date resolves to "no lessons" or to one day template. From 1.3 (pull request #44, decision 6): the go-live date of the branch (`PUT /api/setup/branch/go-live`) must be a school day once the calendar can tell one (`edge/academic-year`: "Go-live can be on any school day"): refuse a go-live date that is a day off, and a day off on the go-live date, with their tests.
  - Done when: tests cover a holiday inside a week, a working Saturday and a grade-range entry.
  - From 1.5 (pull request #46): a special date names a template through the special-date input that `templateFor` of `packages/timetable-rules` already takes; a template named by a special date from today on counts as in use for its archive (`templateInUse` in `apps/api/src/modules/setup/day-template-state.ts`); the table of School setup reads no special dates yet.

- [x] **1.6 Settings and the setup checklist**
  - Read: `03`, `07` (Entering data, Editing rules and locks), `06` (Teachers who work in several branches), `05` (Language of instruction), `08` (Early-warning list), `edge/academic-year`.
  - Build: settings for edit days, attendance values, early-warning thresholds, travel time between branches and languages of instruction; the fixed grade bands; the per-branch setup checklist with the items that exist so far. Later tasks add their own items to the checklist.
  - Done when: each setting has a permission test and the checklist reflects real state for Phase 1 items.

## Phase 2. Subjects and people

- [x] **2.1 Subjects**
  - Read: `05` (Grading weights on a subject), `07` (Calculation rules), `edge/calculation`.
  - Build: subject with names in three languages, department, grades, journal type, switches (rating exam, group, language rule, demanding), daily distribution, and quarterly distribution per quarter; the subject list.
  - Done when: a graded subject cannot be saved with weights that do not total 100.

- [x] **2.2a Staff record and status** (2.2 split in three, confirmed by the owner, 12 October 2026)
  - Read: `04` (Teacher and staff record, Movements), `03` (Divisions), `02` (roles table, Rules), `edge/people-roles-accounts` (Who can act, Staff over time, Accounts and sign-in, Personal data and the audit log).
  - Build: the staff record, filtered by membership (owner's answer 2 on pull request #53), with main and further branches, main and further divisions, department, subjects with grades, languages of instruction, contract and load; the staff ID S-YYNNNN given at first save from a school-wide counter per year of first hire, with the admission date required (spec change of 12 October 2026); status with dates and history, re-hire on the same record; the link from an account to a staff record, sign-in and every request refused while the person is inactive or left, and "left" ends the roles (moved to 2.2 by the owner in 0.6a and 0.6d); the staff list with the columns in the spec, filters and search, a sticky header and the open row that leaves the list (0.8b-1). From 1.2 (decided by the owner, pull request #40, answer 1): `POST /api/setup/divisions/:id/archive` answers 409 `archive_refused` while an active staff member has the division as main or further division, with its test in `apps/api/src/modules/setup/divisions.test.ts`; this is the second half of 1.2's "done when". The bulk Archive of the Divisions page then names the rows refused with `archive_refused` and goes on with the others (`refusalOf` in `apps/web/src/features/setup/divisions-page.tsx` goes on past `built_in` only today), with its text in three languages and its test in `divisions-page.test.tsx`. The staff counts per division (1.2).
  - Done when: status changes keep history; two staff records saved at the same moment get different IDs, and a re-hired person keeps theirs; an inactive or left person's account is refused.

- [x] **2.2b Availability and vacancies**
  - Read: `04` (Teacher and staff record, Vacancy), `06` (Rules, Teachers who work in several branches), `edge/timetable` (After publishing), `edge/people-roles-accounts` (Who can act).
  - Build: availability per branch, per weekday, as time ranges valid from a date, edited by each branch's Academic Vice Principal and read only from the other branches; vacancies (a staff record for a teacher not yet hired; no account, no roles, no staff ID): create, edit, close, reopen, and delete when it never held a load; their section of the staff list.
  - Done when: availability in two branches cannot overlap on any date, and a vacancy cannot hold personal data or a staff ID.

- [x] **2.2c-1 Exports** (2.2c split in two, pull request #58, decision 1)
  - Read: `04` (Student record, Teacher and staff record, Vacancy), `edge/people-roles-accounts` (Who can act, Personal data and the audit log), `13`, `12` (Lists, Language).
  - Build: Excel export (ExcelJS, answer 1) of the staff list, of the vacancies and of the lists that waited for it (buildings, rooms, divisions, subjects): the route gets the ids (ticked rows, or every matching row), the column keys, the search and the filters, the server decides what the role may see, vacancies only from their own list, every export logged with its filters and row count.
  - Done when: an export contains only what the role may see and leaves an audit entry.

- [x] **2.2c-2 Photos** (pull request #59)
  - Read: `04` (Student record, Teacher and staff record, Vacancy), `edge/people-roles-accounts` (Personal data and the audit log), `13`.
  - Build: staff photos in the R2 bucket (answer 2), uploaded through a declared exception of `json-only.ts`, shrunk in the browser, served through the API; the photo column of the staff list.
  - From 2.2b (pull request #57, correction 2): `04` Vacancy, "nothing personal": a vacancy's photo is refused by the database (the photo column joins `staff_vacancy_check`) and the upload route answers 404 for a vacancy's id.
  - Done when: photos work with the in-memory store and refuse on their own when R2 is not configured.

- [x] **2.2d-1 Tokens, type, icons and controls** (2.2d Design system and brand split in two, pull request #60, decision 1)
  - Read: `docs/design-system.md` (all of it), `12` (Look and feel, Devices), `.claude/rules/web.md`, `docs/decisions.md` ("Decided ahead for tasks 2.2d and 2.7").
  - Build: the colour tokens of both themes in `index.css`, each new pair in `contrast.test.ts`; Golos Text (Bitter installed, drawn from 2.2d-2) in place of Geist; Material Symbols Rounded filled in place of Lucide, `lucide-react` removed; `button.tsx` with three sizes and four kinds and every use moved to them; fields, selects, checkboxes and the segmented control; corners, panels and the popover shadow; the list in a white panel with the selection bar in `--today`; the notifications count as a plain number; the type scale of `PageHeader`; the browser-tab and app icons in `index.html`.
  - Done when: the contrast test passes for every pair in both themes; no file imports `lucide-react`; no button uses a removed size or variant (a test reads the sources); the browser test signs in and opens a list with its side panel in light and dark, its screenshots in the report; the review finds none of "What we never do" in the shared parts this half restyles.

- [x] **2.2d-2 Layout shell and brand moments** (pull request #61)
  - Read: as 2.2d-1, and the "Decided without the owner" of pull request #60.
  - Build: the navy menu (on-dark logo, active item orange, counts as plain numbers, the person and sign-out at the bottom, the collapsible rail kept under `sodiq.menu`), the bottom tab bar at phone width (the role's first four items and "More"), the top bar (branch, year, quarter, search with "Ctrl K", notifications, role switch); the sign-in page as described in the design system (horizontal colour logo, language select and theme button at the top, Bitter title, fields 48 high, the large full-width primary button, "Forgot your password?" once its route exists in 2.3, the navy panel with the slogan in three languages and the hexagons, hidden at phone width); `EmptyState` and the full-page errors as brand moments; the print letterhead component; the logo in the shell; the menu icons.
  - Done when: the browser test signs in, opens a list with its side panel and an empty page, in light and dark and in uz and ru, with the Bitter letter check ("Oʻgʻil, Ўзбекистон, Қашқадарё, Ғулом, Ҳамид"), its screenshots in the report; the review finds none of "What we never do" in the shell, the sign-in page and the shared parts.

- [x] **2.3a Accounts and roles**
  - Read: `02` (Rules), `edge/people-roles-accounts` (Who can act, Staff over time, Accounts and sign-in), `docs/decisions.md` ("Decided ahead for tasks 2.1 to 2.6", answers 14 and 15).
  - Build: an account created from a staff record (the login suggestion of answer 14, changeable; the first-password slip of answer 15), `staff.account_id` written once (grant `update (account_id)` on `staff`; the trigger `staff_account_link_guard` keeps it); giving and ending roles per branch for every role that needs no subjects; the end of an assignment held by the database (0.7a); the refusal to end the role of, or to set the staff record linked to, the last active Super Admin to inactive or left (the status route of 2.2a, pull request #53, correction 5), with the banner while fewer than two exist; a re-hire forces a password change; the person's name (from the staff record linked to the account) replaces the login at the foot of the navy menu and in "More" (pull request #61, decision 6); `passwordResetBy` of the session answer becomes a name.
  - Done when: the refusals in the spec are tested, including the last Super Admin rule, and the browser test creates an account, gives a role and signs in with the slip.
  - Split from 2.3 on pull request #62 (decision 1, Look first).

- [x] **2.3b-1 Head Teacher appointments and subject scope** (pull request #63)
  - Read: `02` (Head Teachers and Senior Head Teachers, Rules), `edge/people-roles-accounts` (Who can act), the plan and review of pull request #63.
  - Build: Head Teacher appointments to subjects in a branch (at most one per subject per branch, held by a constraint); Senior Head Teacher appointments to subjects across branches (at most one per subject, decision 4 of #63); both with dates, given and changed by the Super Admin on the account section; subject scope in the permission guard (`decide` with every permitting assignment, the audit entry naming the one whose scope fits); the list of the Head Teacher appointments of a branch (route `GET access/head-teachers`, area `head_teachers`), the first route with subject scope.
  - Done when: a second Head Teacher of a subject in a branch is refused by the database and the scope is tested for a teacher of two subjects.
  - Split from 2.3b on pull request #63 (decision 1, Look first).

- [x] **2.3b-2 Head Teachers list and the Academic Vice Principal alert** (pull request #64)
  - Read: `02` (Head Teachers and Senior Head Teachers), `edge/people-roles-accounts` (Who can act), the plan of pull request #63 (the parts marked 2.3b-2, decisions 13 and 14).
  - Build: the "Head Teachers" section of People (`/people/head-teachers`) on the route of 2.3b-1, with a tab per section the role views; the alert of a branch with no active Academic Vice Principal (Who can act): a `SECURITY DEFINER` function `branches_without_vice_principal(at)` (branch ids and names only, archived branches never), the route `GET access/branches-without-vice-principal` for the Super Admin, and a banner beside the Super Admin banner.
  - Done when: the alert is tested for an Academic Vice Principal who is inactive, locked, ended or planned, and the browser test shows the list and the banner.
  - Split from 2.3b on pull request #63 (decision 1, Look first).

- [x] **2.3c-1 Locks and resets by an administrator** (pull request #65)
  - Read: `02` (Accounts and sign-in: build order), `edge/people-roles-accounts` (Who can act, Staff over time, Accounts and sign-in), the plan of pull request #65.
  - Build: lock and unlock with a reason; the refusal to lock the last active Super Admin (the check of 2.3a); the route for the password reset by an administrator (the service exists since 0.6b) with who may reset whom; the route for the second-step reset by a Super Admin (the service exists since 0.6c), which always comes with a password reset (0.6d); the Academic Vice Principal resets and locks only Teachers, Tutors, Head Teachers and the Head Tutor of the branch; the report of accounts never used.
  - Done when: the refusals of locks and resets are tested, including the last Super Admin rule and the Academic Vice Principal's limits, and the browser test locks, unlocks and resets a teacher's password.
  - Split from 2.3c on pull request #65 (decision 1, Look first).

- [x] **2.3c-2 Password reset by email and the own photo** (pull request #66)
  - Read: `02` (Accounts and sign-in: build order), `edge/people-roles-accounts` (Accounts and sign-in), `docs/decisions.md` ("Decided ahead for tasks 2.1 to 2.6", answer 16), `docs/design-system.md` (This app, Sign-in), the plan of pull request #65.
  - Build: password reset by email through a mail service that only logs locally until go-live, with the address taken from the staff record (moved from 0.6b; its routes are public and go into `PUBLIC_ROUTES`), its link and its one-time use held by stored moments and the injected clock; the link "Forgot your password?" under the large button of the sign-in page (`docs/design-system.md`, This app, Sign-in).
  - From 2.2c-2 (pull request #59): the own photo on the own account page (`edge/people-roles-accounts`: "Staff can change their own ... photo"): a route of the own account (`@AnySignedIn()`) on the staff record linked to the session's account, with the same store, byte check and audit entry as `StaffPhotos`; the Principal too.
  - From 2.2a (pull request #53): decide whether the Academic Vice Principal may change the email of their own record or a Super Admin's (the edit of 2.2a allows name, phone and email of any record of the branch).
  - Done when: tests cover each rule of the email reset with the injected clock, its public routes are the exact list of `PUBLIC_ROUTES`, and the browser test asks for a reset from the sign-in page and sets the own photo.
  - Split from 2.3c on pull request #65 (decision 1, Look first).

- [x] **2.4a Student record, UID and readers** (2.4 split in two, pull request #67, decision 1)
  - Read: `04` (Student record, UID sets), `edge/students-classes-groups`, `edge/people-roles-accounts` (Personal data and the audit log), `16` (question 12 is open: the UID is typed by hand and must be unique; do not build automatic UIDs).
  - Build: student record with contract and scholarship fields; the UID typed by hand, unique across the school for good (inactive, graduated and corrected-away UIDs included), its set warning and its correction with a reason; the duplicate checks (JSHSHIR and document number block, name and birth date warn); the field groups and their readers, the Principal's logged show; the dated status rows (every student starts active); a student account created with the record and switched off until Release 2; the student list and the profile with the tabs that have data.
  - Done when: a duplicate UID is refused, including against archived records.

- [x] **2.4b-1 Leaving, return and delete** (2.4b split in two, pull request #68, decision 1)
  - Read: `04` (Student record, Movements), `edge/students-classes-groups`, `edge/people-roles-accounts` (Personal data and the audit log), the plan of pull request #67.
  - Build: leaving (inactive, a date and a reason, scheduled when in the future, cancellable until the date), "undo leaving" with a reason, coming back from the Inactive list with a new contract, the Super Admin's restore of a graduated student with a reason; the delete of a student created twice (no data; `edge`: "A student is created twice by mistake"); "restore this student" offered on a document match of the branch; the bulk "Leave school" on ticked rows.
  - Done when: a leaving and a return keep the UID and history.

- [x] **2.4b-2 Export, photos, consent list and the "No class" counter** (split from 2.4b on pull request #68, decision 1)
  - Read: `04` (Student record), `edge/students-classes-groups`, `edge/people-roles-accounts` (Personal data and the audit log), `docs/decisions.md` ("Decided ahead for tasks 2.1 to 2.6", answers 1, 2 and 23), the plans of pull requests #58, #59, #67 and #68.
  - Build: the Excel export of the student list by readers, ticked or matching, with the groups the role reads (whole-branch contact or identity fields for the Super Admin and the Academic Vice Principal only; Tutors their own class from 3.1), and its bulk action; student photos (a second `FileRoute`, the photo column of the list); the list of active students without consent (answer 23); the "No class" counter on the Academic Vice Principal's home page.
  - Done when: an export holds only the groups the role reads.

- [x] **2.5a Relative record, links and the Parents list** (2.5 split in two, pull request #72, decision 1)
  - Read: `04` (Close relatives), `edge/close-relatives`.
  - Build: school-wide relative records unique by main phone; links to several students with relationship, main contact, portal access and "receives notices"; the "no phone of their own" case; the Parent list and page; a Parent account created with the record and switched off until Release 2.
  - Done when: a student cannot be saved without at least one relative and phone uniqueness holds across branches.
  - From 2.4a (pull request #67, decision 10): the students saved by 2.4a have no relative yet; the rule "at least one relative" refuses the edit of such a record until one is linked, and the student form of 2.4a gains the relative step.

- [x] **2.5b-1 Phone owners, merge and the notice to the other branch** (2.5b split in two, pull request #73, decision 1)
  - Read: `04` (Close relatives), `edge/close-relatives`, `edge/people-roles-accounts` (Personal data and the audit log), the plan and the decisions of pull request #72.
  - Build: on a phone match, "different person, the number has a new owner" with the earlier relative's new phone or "no valid phone" (a column of its own, `phone_invalid_since`; sign-in blocked; listed for the Academic Vice Principal while a linked student is active); "Merge" offered on a refused phone change (the Academic Vice Principal in the branch, the Super Admin across branches); a change of name or phone of a relative linked in another branch told to that branch's Academic Vice Principal (a notification kind).
  - Done when: a phone match offers the new owner and a merge, and the other branch's Academic Vice Principal is told of a change.

- [x] **2.5b-2 Extra phones, the same person and relatives in the export** (split from 2.5b on pull request #73, decision 1)
  - Read: `04` (Close relatives, Student record), `edge/close-relatives` (the foreign number and the teacher-parent rows), `edge/people-roles-accounts` (Personal data and the audit log), the plans and the decisions of pull requests #70, #72 and #73.
  - Build: extra phones of a relative (not unique, not used for a match or for sign-in; Contact); a staff record and a relative record marked as the same person (the report of marks a staff member enters for their own child comes with the journal); the relatives of a student in the student export (Contact columns for the Contact exporters only).
  - Done when: an extra phone is never unique nor used for a match, and the export holds relatives only for the Contact exporters.

- [x] **2.6a Audit log screen, reading rights and the own sign-in history** (2.6 split in two, pull request #75, decision 1)
  - Read: `edge/people-roles-accounts` (Personal data and the audit log), `13` (Security), the plan and the decisions of pull request #75.
  - Build: the audit log screen with search by person, record and date, and the reading rights per role (the school-wide entries a branch reads, the Super Admin's scopes); identity hidden in the entries with a logged show; each user's own sign-in history; export rules (limited by role, every export logged, a pinned list of export routes).
  - Done when: a Principal sees only the branch's log and every export leaves a log entry.
  - From 2.5a (pull request #72, decision 17 as changed by correction 1): the entries of a relative's record (`relative.create`, `relative.edit`, `relative.archive`, `relative.restore`) are in `audit_log_school` with the branch of the request in `details`; the link entries are in the branch's log. Decide which branches read the record entries of a relative.
  - From 2.4b-1 (pull request #68): the audit entries `student.create`, `student.edit` and `student.delete` hold the identity fields of the student; a reader without the Identity group (the Principal) sees them hidden, with a logged show, as on the record.

- [x] **2.6b The personal data report per person** (split from 2.6 on pull request #75, decision 1)
  - Read: `edge/people-roles-accounts` (Personal data and the audit log: "The Super Admin can produce a personal data report per person"), `13` (Security), "Decided ahead for tasks 2.1 to 2.6" (answer 25: a printable page, no PDF library), `docs/design-system.md` (Printouts), the plan and the decisions of pull request #75.
  - Build: for the Super Admin, the personal data report of a student, a relative or a staff member on screen as a printable page: every field of the record in every group, the links (relatives, students), the account and its roles, the photo, the consent and statuses, and the audit entries about the person; producing it is an export and leaves an audit entry.
  - Done when: the Super Admin prints the report of a student and the log holds the entry; no other role reaches it.

- [x] **2.7a "Fix first" findings, dates in the app, accessibility and wording** (2.7 split in four, pull request #77, decision 1)
  - Read: issue #39 (the hand test of 13 October 2026, findings 1–10, 23, 32–36, and the owner's answers after it, answer 38 included), `12` (Language), `docs/design-system.md` (Brand moments), `.claude/rules/web.md`, the plan and the review of pull request #77.
  - Build: the ten "Fix first" findings (sign-in sideways scroll, locked further divisions, the full-page "no access", the student panel tabs, the main contact message, one history line after a cancelled leaving, the People tabs on a phone, "You are signed out.", the "Save failed" pill); every date and time from `apps/web/src/lib/dates.ts` (Uzbek names from i18n keys, English day-first and 24-hour); the first-password slip's dates; findings 32–34; the decided Uzbek and Russian wording (35–36).
  - Done when: each of those findings is done, Uzbek dates read "8-dekabr, 2026" with the browser's `Intl` trimmed, and a lint rule keeps dates in `lib/dates.ts`.

- [x] **2.7b-1 Formats** (split from 2.7b on pull request #78, decision 1)
  - Read: issue #39 (findings 11, 15, 16, 19, 20, 24, 25, 27 and the owner's answers), `04`, `edge/close-relatives`, `edge/system-behaviour`, `docs/design-system.md`, `.claude/rules/web.md`, `docs/decisions.md` ("Decided ahead for tasks 2.2d and 2.7", item 10).
  - Build: browser names in Sessions and Trusted devices; the Shared column of the rooms export; a day past midnight shown as such; grade ranges ("5–11"); "4 of 4 not set"; phones shown and exported as "+998 90 111 22 33"; the UID set in its warning; surname first in every list and export (owner's answer to 27); the branch phone as "Decided ahead for tasks 2.2d and 2.7", item 10 says.
  - Done when: each of those findings is done, every screen and export shows phones and grades in one format, and a branch phone outside the format is refused by the database.

- [x] **2.7b-2 Smaller UX** (split from 2.7b on pull request #78, decision 1)
  - Read: issue #39 (findings 13, 14, 17, 18, 21, 22, 26, 28–31 and the owner's answers), `12`, `docs/design-system.md`, `.claude/rules/web.md`.
  - Build: the selection bar only when a row is ticked (13); the Rooms table and the top bar at 1047 px, one row and no sideways scroll (14); words beside the setup checklist icons (17); "Saved." after travel time, "Subjects and languages", availability, closing or reopening a vacancy (18); "Choose at least one grade." and "Choose at least one subject." on Save instead of the early messages (21); the photo message "Choose a JPEG or PNG photo, up to 5 MB." (22); "Keep the leaving" / "Cancel the leaving" (26); Cancel in the merge view (28); no "Leave school" form after a scheduled leaving (29); the Super Admin alerts collapsed on phones (30); "Send feedback" with its word in "More" (31).
  - Done when: each of findings 13, 14, 17, 18, 21, 22, 26, 28, 29, 30 and 31 is done or named as left out with its reason in the report.

- [x] **2.7c-1 The page sweep, the text rule and the "New branch" side panel** (split from 2.7c on pull request #80, decision 1)
  - Read: `docs/design-system.md`, `.claude/rules/web.md`, issue #39 (items 2 and 4; finding 12), `docs/decisions.md` ("Decided ahead for tasks 2.2d and 2.7"), the plan of pull request #80.
  - Build: every page of Phases 0 to 2 checked against the design system and "What we never do" and brought into line (one section title style, button sizes and kinds, a 24 gap between panels, content in white panels, the changed cell of the template table without orange, the shell); the text rule on School setup, Branch, People, Home and Account (#39 item 4); the "New branch" form in the side panel (#39 item 2, finding 12); the browser test that visits every page in light, dark and at 390 px.
  - Done when: every page passes the browser check in light, dark and at 390 px with the screenshots in the report; #39 items 1 and 5 are named as left out (2.7c-3).

- [x] **2.7c-2a New records in the side panel and checkboxes at phone width** (2.7c-2 split in two, pull request #81, decision 1)
  - Read: `docs/design-system.md` (Layout shell, Lists; Buttons; Accessibility), `.claude/rules/web.md`, the plan of pull request #80 (decisions 14 and 15), the plan of pull request #81.
  - Build: the "New …" forms that open inline above the list on Buildings, Rooms, Divisions, Years, Slot types, Day templates, Calendar, Subjects, Staff, Students (with its bulk "Leave school" form) and Vacancies move into the side panel; the saved record then opens there; checkboxes with 44 px targets at phone width.
  - Done when: every list page opens a new record in the side panel, every checkbox has a 44 px target at phone width, and `e2e/pages.spec.ts` passes again with its screenshots in the report.

- [x] **2.7c-2b-1 Record actions at the bottom of the School setup panels** (2.7c-2b split in two, pull request #83, decision 1)
  - Read: `docs/design-system.md` (Layout shell, Lists; Buttons), `.claude/rules/web.md`, the plans of pull requests #80 (decision 14), #81 and #83.
  - Build: `PanelActions`, `usePanelEditing`, Cancel in `RecordForm`, the browser check of one primary and the actions last; the panels of buildings, rooms, divisions, years, slot types, day templates, calendar, subjects, template settings and the sample read first, with their actions at the bottom and their forms behind a button.
  - Done when: every School setup side panel has its actions at the bottom, one primary in view, and `e2e/pages.spec.ts` passes again with its screenshots in the report.

- [x] **2.7c-2b-2a Record actions at the bottom of the staff and vacancy panels** (2.7c-2b-2 split in two, pull request #84, decision 1)
  - Read: `docs/design-system.md` (Layout shell, Lists; Buttons), `.claude/rules/web.md`, the plans of pull requests #81, #83 and #84, `docs/decisions.md` (task 2.7c-2b-1).
  - Build: the pattern of 2.7c-2b-1 on the staff panel (the record, the subjects, the availability, the branches, the status, the account's create, give, end and change of subjects) and the vacancy panel (the record, the availability, close, reopen and delete); the staff read view shows every field of the record.
  - Done when: the staff and vacancy side panels have their actions at the bottom, one primary in view, `people-staff` and `people-vacancies` are out of `PANEL_ACTIONS_LATER`, and `e2e/pages.spec.ts` passes again with its screenshots in the report.

- [x] **2.7c-2b-2b Record actions at the bottom of the student and parent panels** (2.7c-2b-2 split in two, pull request #84, decision 1)
  - Read: `docs/design-system.md` (Layout shell, Lists; Buttons), `.claude/rules/web.md`, the plans of pull requests #81, #83 and #84, `docs/decisions.md` (tasks 2.7c-2b-1 and 2.7c-2b-2a).
  - Build: the same pattern on the panels of students (the record, the UID correction, the five status forms, the photo, the relatives tab with the link editor and "Add relative") and parents (the record, the phone owner choices, the same-person mark).
  - Done when: every People side panel has its actions at the bottom, one primary in view, `PANEL_ACTIONS_LATER` of `e2e/pages.spec.ts` is empty, and `e2e/pages.spec.ts` passes again with its screenshots in the report.

- [x] **2.7c-3 Rooms "By floor" and the Branches list** (split from 2.7c on pull request #80, decision 1)
  - Read: `docs/design-system.md`, issue #39 (items 1 and 5), `03` (Branch: the Branches list), `04` (Teacher and staff record: Category; the teacher list), spec change of 13 October 2026, `docs/decisions.md` ("Decided ahead for tasks 2.2d and 2.7", item 11), the plan of pull request #77.
  - Build: the Rooms "By floor" view (#39 item 5); the school-wide Branches list for the Super Admin (#39 item 1) once its spec change is merged.
  - From the spec change of 13 October 2026: the Branches list under School setup (name, address, working weekdays, number of buildings and of rooms; opening a branch switches the current branch; "New branch" from the list in the side panel; no new permission, branches `view` and `create`); the category of a staff record and the teacher list's category column and filter show every role the person holds in the branch (`STAFF_CATEGORY_ROLES` widened to all nine roles), a vacancy still has none.
  - Done when: "By floor" is built; the Branches list is built, or reported as waiting for its `/spec-change` ("Decided ahead for tasks 2.2d and 2.7", item 11), which closes the item for this task; the category column and filter offer every role, with a test for a Super Admin, a Principal and a Senior Head Teacher in the list.

- [x] **2.7d The Super Admin's own staff record** (split from 2.7 on pull request #77, decision 1)
  - Read: issue #39 (the owner's answer to question 37), `04` (Teacher and staff record), `edge/people-roles-accounts`, the plan of pull request #77.
  - Build: the Super Admin creates their own staff record and links it to their existing account, so the menu, "Given by …", "Locked by …" and the Account photo show the name; the link is audited.
  - Done when: a Super Admin without a staff record links one to their account, and no other role can link a record to an existing account this way.

## Phase 3. Classes, groups and teaching load

- [x] **3.1a Classes and their Tutors** (3.1 split in three, pull request #88, decision 1)
  - Read: `05`, `edge/students-classes-groups`, `edge/developer-rules`, `edge/academic-year`, `edge/people-roles-accounts`, the plan of pull request #88.
  - Build: class as grade plus name (shown as "7 Oxford"), language of instruction, main classroom, maximum size, academic year; the list, the cards and the side panel; Tutors of a class with dates and acting Tutors (`class_tutors`), named by the Academic Vice Principal; the Tutor language rule in the database from the class, the Tutor and the staff record; the "classes" item of the setup checklist.
  - Done when: the Tutor language rule is enforced by the database from all three sides, and a Tutor row follows the end of its role.

- [x] **3.1b Class membership** (3.1 split in three, pull request #88, decision 1)
  - Read: `05`, `edge/students-classes-groups`, `edge/developer-rules`, the plan of pull request #88.
  - Build: class membership as date ranges that cannot overlap (database constraint); the maximum size as a hard limit counting scheduled joins and leaves, on every path; "Put into a class" (the bulk action of the student list and the class's Students tab); the student count of the class card; the student record's Academic block (class, Tutor, main classroom); the refusal to archive a class with members in force or planned.
  - Done when: the database refuses a student in two classes on one date.
  - From 2.4a (pull request #67): the class, groups and tutor columns and the class, group and language filters of the student list (`04`); an active student with no class is allowed only before their start date (`edge/students-classes-groups`, "A student is enrolled in August before classes are formed").
  - From 2.4b-2 (pull request #70): the `groups` and `tutor` columns join `STUDENT_EXPORT_COLUMNS` and lose `exported: false` once they hold data (3.1, 3.2); the "No class" counter (`GET people/students/no-class`) and the "No class" filter read the class memberships instead of counting every active student.

- [x] **3.1c Class scope for Tutors** (3.1 split in three, pull request #88, decision 1)
  - Read: `02`, `edge/people-roles-accounts`, `edge/students-classes-groups`, the plan of pull request #88.
  - Build: class scope for Tutors in the permission guard (`classIds` on the current assignment, from `class_tutors`; `class-scope.ts` beside `subject-scope.ts`); the Tutor's "Classes" menu item and their own classes (a decision of its own: the Tutor menu was decided at 0.8c, pull request #27).
  - Done when: a Tutor reads their own class and nothing of another class, with allow and refuse tests on every route that takes the scope.
  - From 2.4a (pull request #67): a Tutor opens the profiles of their own class and reads its Contact group (`02`; until then `GET people/students/:id` refuses a Tutor-only reader, decision 6).
  - From 2.4b-2 (pull request #70): Tutors export the students of their own class (`students` `export` with the class scope; `edge/people-roles-accounts`: "Tutors export their own class"), with a test that a Tutor's export with the consent filter is refused (`StudentExports`, unreachable while every exporter reads the Financial group).

- [x] **3.2a Groups** (3.2 split in three, pull request #91, decision 1)
  - Read: `05`, `06` (Model, Rules), `03` (Slot types and day templates), `edge/timetable` (Structure), `edge/time-dates-calendar`, `edge/students-classes-groups`, `edge/academic-year`, the plan of pull request #91.
  - Build: the group record (subject, the classes it draws from: one class is a split, several of one grade or two a group across classes; name unique per branch and year; language; maximum size; academic year), its list, cards and side panel; the group language rule; the lesson slots two grades share (`packages/timetable-rules`), shown at the save; the class's and the subject's side; the `groups` checklist item; the Head Teachers' and the Tutor's scope.
  - Done when: the database refuses a group of three grades, of a subject not taught in its grade, or of a language its one-language classes do not have, with allow and refuse tests on every route.

- [x] **3.2b Group membership** (3.2 split in three, pull request #91, decision 1)
  - Read: `05`, `04` (Student list), `edge/students-classes-groups`, `edge/developer-rules`, the plan of pull request #91.
  - Build: membership by date ranges, one group per student per subject per date (database constraint); a group row only inside a class row of one of the group's classes, checked from both sides; the maximum size as a hard limit counting scheduled joins and leaves on every path, and the lower maximum of a group edit against its members; "Put into a group" (the group panel and the bulk action of the student list); the bulk placement screen for one subject and one grade or pair of grades, with the list of students not yet placed and "Place automatically" (the smallest suitable group, tagged "placed automatically, review"); the student list's `groups` column and group filter, the Academic block's groups, the group card's student count; the Tutor reads the members of own classes only; a group's classes cannot change while it holds students of them.
  - Done when: the database refuses a student in two groups of one subject on one date.
  - From 3.3 (pull request #91, decision 13): leaving takes the student out of groups from the date: whatever ends a class row (a leaving, a withdraw of a planned placement) ends the group rows of those dates in the same transaction; the delete of a student created twice takes the group rows with it, named in its audit entry; the graduation of 9.5a and the move to another branch of 3.3 end group rows too.
  - From 2.4b-2 (pull request #70): the `groups` column joins `STUDENT_EXPORT_COLUMNS` and loses `exported: false` once it holds data.

- [x] **3.2c Groups on every class membership path** (3.2 split in three, pull request #91, decision 1)
  - Read: `05`, `edge/students-classes-groups`, the plans of pull requests #89 and #91.
  - Build: `group_placement_gaps`, the students of the classes involved who are not in exactly one group of a subject from a date; until the teaching load exists, the split or group subjects of a class are the subjects of the active groups of its year that draw from it (pull request #91, decision 18).
  - Done when: every student of the classes involved must be in exactly one group before a load row is valid (the check, tested; 3.4 calls it).
  - From 3.1b (pull request #89, decision 15): `edge/students-classes-groups`, first row, "A class membership cannot be saved without a group for every split or group subject of that class, from the same date", on every path that writes a class membership: "Put into a class" (`POST api/classes/:id/members`), the create of a student with a class, the cancel and the undo of a leaving and the replace of a scheduled leaving, which write rows back (`class_memberships`, causes `cancel` and `undo`); each places the student into the smallest suitable group with the tag "placed automatically, review"; a cancel or an undo gives back the group rows the leaving cut.

- [x] **3.2d Search over records** (pull request #91, correction 2)
  - Read: `12` (One pattern everywhere, Search), `02`, the plan of pull request #91.
  - Build: Ctrl+K over records: students, staff, classes and groups, each with the rights and the scope of the role (the record routes' own rules), beside the pages it already lists; look-alike Cyrillic letters in class and group names found by their fold.
  - Done when: a Tutor finds own class and its groups and no other, with allow and refuse tests.
  - From 3.1a (pull request #88) and 3.1c (pull request #90): "searching class records joins with groups in 3.2, so one change covers both".

- [x] **3.3a Class and group transfers, History tab** (3.3 split in four, pull request #95, decision 1)
  - Read: `04` (Movements, Student record), `05` (Language of instruction), `02` (Head Teacher, Academic Vice Principal), `edge/students-classes-groups`, `07` (Transfers), the plan of pull request #95.
  - Build: class transfer and group transfer with an effective date (tomorrow by default; today; a past date for the Super Admin and the Academic Vice Principal in an open year); scheduled moves with their badge and seat, changed or cancelled until the date; the undo of a move begun; confirmation when moving between classes of different languages; a leaving dated on or before a scheduled move cancels it; the Head Teachers' group moves (`group_transfers`); the History tab (`student_history`). The effect inside journals is built in 8.6.
  - Done when: history shows each move with dates and a move into the past is handled as the spec says.
  - From 3.2b (pull request #92, decision 8), built here: a class transfer ends the group rows of the dates the class rows lose, in the same transaction, named in the audit entry; a group transfer moves the row the placement refuses; the Head Teachers' moves between groups of own subjects under a permission of their own.
  - From 3.2c (pull request #93, decision 12), built here for the class transfer: the student is placed into the groups of the new class (`coverClassRows`).

- [x] **3.3b Return and graduate restore into a class** (3.3 split in four, pull request #95, decision 1)
  - Read: `04` (Movements), `edge/students-classes-groups`, the plan of pull request #95.
  - Build: a return places the student in a class from the return date (`04`, Movements: "is placed in a class from the return date"), the Super Admin's restore of a graduated student with a class (`edge`: "restores the student to active with a class and a reason"), each placing the groups of the class and re-checking the class rules.
  - Done when: a return and a graduate restore write a class row and its group rows, refused all or none, with allow and refuse tests.
  - From 3.2c (pull request #93, decision 12): a return and the restore of a graduate place the student into the groups of the new class (`coverClassRows` of `class-groups.ts`: the smallest suitable group, tagged "placed automatically, review"), or the database refuses the commit (`class_memberships_need_groups`, 0049, every insert of a class row).
  - From 2.4b-1 (pull request #68): a return places the student in a class from the return date (`04`, Movements) and the Super Admin's restore of a graduated student with a class (`edge`: "restores the student to active with a class and a reason"), each re-checking the class rules then (`.claude/rules/database.md`, a row back in service is checked again).
  - From 3.3a (pull request #95): a return into another class than the one left is "handled like a transfer" (`edge`: "A student returns ... Into another class: handled like a transfer").

- [x] **3.3c Move to another branch** (3.3 split in four, pull request #95, decision 1; built in pull request #97)
  - Read: `04` (Movements), `edge/students-classes-groups` ("A student moves to another branch"), `edge/exemptions`, the plan of pull request #95.
  - Build: released by the sending Academic Vice Principal, accepted by the receiving one choosing class and groups, both by the Super Admin; the record, UID, relatives and history stay the same and are readable in the new branch.
  - Done when: a release and an accept move a student with their class and group rows cut at the move date, with allow and refuse tests in both branches.
  - From 2.4a (pull request #67): leaving takes the student out of groups from the date (3.1b, pull request #89, decision 1, built it for classes; the groups moved to 3.2b and 3.2c, pull request #91, decision 13) and a return places them in a class (2.4b builds the status side); the move to another branch (`edge/students-classes-groups`, "A student moves to another branch": released by the sending Academic Vice Principal, accepted by the receiving one, both by the Super Admin) as one update of `students.branch_id` through a guarded function, the keys of 0032 carrying the child rows (decision 15); from 3.1b (pull request #89, decision 16, correction 3): the class rows keep their class's branch and their student key has no branch, so the release cuts the memberships of the old branch at the move date (the overlap constraint holds across branches and refuses the receiving class otherwise), and the History tab and the Academic block read the old branch's rows past the row filter (ids, class names and dates only), a **Look first** decision there.
  - From 3.2b (pull request #92, decision 8): a group row lies inside a class row of its group's classes, checked at the commit (`group_memberships_in_class`, 0048); the release to another branch ends the group rows of the dates the class rows lose, in the same transaction (`cutGroupRows` or a sibling of `group-membership-rows.ts`, the groups locked FOR UPDATE in the order of their id), named in the audit entry.
  - From 3.3a (pull request #95): the moves of a student (`student_moves`) keep their branch, as the class rows do; the History tab reads the old branch's moves past the row filter with the rest of its rows.

- [x] **3.3d Merge of two student records** (3.3 split in four, pull request #95, decision 1)
  - Read: `04` (Student record, UID sets), `edge/students-classes-groups` ("The Super Admin can merge two records"), the plan of pull request #95.
  - Build: the Super Admin's merge of two student records, the older UID kept; every row of the other record (statuses, contracts, class and group rows, moves, relatives) carried over or kept in the audit entry.
  - Done when: a merge keeps the older UID and every row, refused for any role but the Super Admin, with allow and refuse tests.
  - From 2.4a (pull request #67): the Super Admin's merge of two student records, the older UID kept (`edge`: "The Super Admin can merge two records").
  - From 3.3c (pull request #97): the releases to another branch (`student_branch_moves`) are rows of the record too, and the two records may be of two branches (the class and group rows of an earlier branch keep their branch; `student_rows_elsewhere` reads them).

- [x] **3.4a Draft versions and load rows** (3.4 split in three, pull request #99, decision 1)
  - Read: `05`, `04` (Teacher and staff record, Vacancy), `06` (Model, Building a timetable, Rules), `02` (Tutor), `edge/timetable` (Structure, Versions and drafts, After publishing), `edge/people-roles-accounts` (rows 13 and 15), `edge/academic-year`, the plan of pull request #99.
  - Build: the minimal draft version record; the load rows (class or group, subject, one teacher or one vacancy, lessons per week, room or room type, double lessons); the per-row blocked checks (subject and every grade in the profile, the Tutor subjects, the language rule, inactive teachers, subjects, classes, groups and closed rooms, vacancies under the same conditions, the two-grade group refusal); the copy of a version's load with the rows not copied kept on the draft; the vacancy close and delete refused while a load row names it; the load page.
  - Done when: each blocked case of a single row has a test at the route and in the database, on insert and on update.
  - Inherited: the two-grade refusal of the 3.2a line below (the group's teacher and card go to 3.4b); the 2.2b line below; from 3.1a, "Tutor subjects (3.4)".
  - From 3.2a (pull request #91, decisions 9 and 15): the load step refuses a group of two grades when no school weekday has a lesson slot with the same start and end in both grades' templates (`edge/timetable`, Structure; `sharedLessonSlots` and `twoGradeSlots` of `packages/timetable-rules`, which the group's save only shows), or when the subject is not taught in both grades; the teacher (or the vacancy) of a group is the teacher of its load row, and the group card and panel show it in place of "—".
  - From 2.2b (pull request #57, decision 7): `04` Vacancy, "A vacancy cannot be closed while a load row names it or a future lesson is under it. One that never held a load can be deleted; one that did is closed and kept." `POST /api/people/vacancies/:id/close` refuses while a load row names the vacancy (the future lessons come with 5.5b), and `vacancy_delete` of db/migrations/0025 refuses a vacancy that ever held a load, each with its test; the vacancy panel names the refusal.

- [x] **3.4b Splits, groups and weekly totals** (3.4 split in three, pull request #99, decision 1)
  - Read: `05` (Group, Teaching load), `06` (Building a timetable, step 2; Teachers who work in several branches; Weekly load), `edge/timetable` (Structure), the plan of pull request #99.
  - Build: the parts of one split have equal lessons per week and different teachers (`edge/timetable`, Structure); one version never holds both a whole-class row and a group or split row for the same class and subject (`05`, Group: "Whether a class is split for a subject is set in the teaching load"); the load as the source of the split and group subjects of a class; a group or split row whose `group_placement_gaps` is not empty has that problem, which blocks readiness (5.3) and publish (5.5a); the group card and panel show the teacher of the group's load row; the weekly totals of a class against the week's lesson slots and of a teacher against free slots and the contract load across branches.
  - Done when: each rule above has a test at the route and in the database where it is a constraint.
  - From 3.2a (pull request #91, decisions 9 and 15; here the group teacher and card, the refusal is built in 3.4a): the load step refuses a group of two grades when no school weekday has a lesson slot with the same start and end in both grades' templates (`edge/timetable`, Structure; `sharedLessonSlots` and `twoGradeSlots` of `packages/timetable-rules`, which the group's save only shows), or when the subject is not taught in both grades; the teacher (or the vacancy) of a group is the teacher of its load row, and the group card and panel show it in place of "—".
  - From 3.2c (pull request #91, decision 18): the load becomes the source of the split and group subjects of a class (`05`: "Whether a class is split for a subject is set in the teaching load"), and a load row of a group or split is valid only when `group_placement_gaps` is empty.

- [x] **3.4c The department move against the load** (3.4 split in three, pull request #99, decision 1; pull request #101)
  - Read: `edge/people-roles-accounts` (row 15), `03` (Divisions), the plan of pull request #99.
  - Build: the department move of a teacher or a subject with a start date, by the Super Admin, refused while a load would have a teacher outside the subject's department, the loads listed for reassignment. Decides whether a draft's row counts as "a teaching load" for the refusal (decision 3 of pull request #99).
  - Done when: the move is refused with the loads listed, with allow and refuse tests.
  - From 2.1 (pull request #52, decision 17): `edge/people-roles-accounts`, "A teacher moves to another department, or a subject is moved, mid-year. Both changes carry a start date and are made by the Super Admin. They are refused while a teaching load would have a teacher outside the subject's department; those loads are listed for reassignment first." Since 2.1 only the Super Admin changes `departmentId` on `PUT /api/setup/subjects/:id`; the start date and the refusal against the load come here.

- [x] **3.5a Hand test of Phase 3: wording and small screen fixes** (issue #105, Parts A and B; pull request #113)
  - Read: issue #105 (the owner's hand test of 15 October 2026; its "Decided by the owner" lines are the owner's answers), `12` (One pattern everywhere, Language, Devices, Look and feel), `docs/design-system.md`, `.claude/rules/web.md`, `02` and `edge/people-roles-accounts` (the role switcher) for H11b.
  - Build: items H1 to H21 of issue #105, H11b included: the wording in the three languages, the surname-first names of H6 and H7, the renamed audit link of H14, the role switch label of H11b, and the screen fixes H12 to H21 (empty sections hidden, a later start shown as such, tabs and bottom menu at phone and desktop width, filters folded at phone width, the class filter, the empty-state button, the refusal readable by screen readers, the teaching load as cards at phone width).
  - Done when: each of H1 to H21 and H11b is done, or named in the report as left out with its reason; the browser test opens the Students list, a student panel, the Classes page, the Parents list and the teaching load at 375 px and 1440 px in Uzbek and Russian and attaches the screenshots.

- [x] **3.5b Hand test of Phase 3: forms, refusals and messages** (issue #105, Part C; pull request #116)
  - Read: issue #105, `04` (Student record, Close relatives, Teacher and staff record, Movements), `05`, `06` (Building a timetable, step 2), `12` (One pattern everywhere, No lost work), `edge/students-classes-groups`, `edge/close-relatives`, `edge/people-roles-accounts` (Who can act, Personal data and the audit log) for H33, `.claude/rules/web.md`, `.claude/rules/api.md`.
  - Build: items H22 to H33 of issue #105: the Tutor-role hint, archive refused up front, full classes marked and the refusal naming the class and day, one phone parser for every phone field, the relative lookup before Save, the language question once per move, the panel staying on its tab, the differing values in the merge preview, the reason when no teacher can take a load row, the vacancy Subjects field with its line, the side panel closed on a branch switch, parents and their children in Ctrl+K for the readers of relatives' contacts.
  - Done when: each of H22 to H33 is done, or named in the report as left out with its reason; H25 has a test for each written form of a number; H32 has a test that no request is sent with another branch's header for the old record; H33 has allow and refuse tests for every role.

- [x] **3.5c Hand test of Phase 3: one stay in a class, and the History tab** (issue #105, Part D; pull request #117)
  - Read: issue #105 (H34 to H36, with the steps), `04` (Student record, Movements), `05`, `edge/students-classes-groups`, `edge/developer-rules`, `.claude/rules/api.md`, the plans of pull requests #89, #92, #95 and #96.
  - Build: a continuous stay of a student in one class, and in one group, is one stay for every reader (class and group panels, the student record, the History tab, free seats, exports, search, and every later reader); a cancel or an undo of a scheduled leaving, of a class move or of a group move, and a merge, give the stay back as it was before; the stays already split on the test site are joined; the History tab shows one line per stay from its first to its last day, and a changed scheduled move as one move with its changes (H34).
  - Done when: for each path of H36 (cancel of a scheduled leaving, cancel and change of a scheduled class move and of a group move, undo of a move, undo of a leaving, a merge) a route test ends with exactly one stay row in the class and in the group and one History line, and a database test shows that two adjoining stays of the same student in the same class cannot be stored, or are joined, as the plan decides; the browser test repeats the steps of H36 and reads the class panel and the History tab.

- [x] **3.6a The owner's answers of 15 October: who sees what** (issue #42, the owner's answers of 15 October 2026, items L32, L48, L50, L59, L136, L147, L157; pull request #118)
  - Read: the owner's answers comment on issue #42 (15 October 2026), the comments of the tasks it names, `02`, `04` (Student record), `edge/people-roles-accounts` (Who can act, Personal data and the audit log), `packages/shared/src/permissions.ts`, `.claude/rules/api.md`.
  - Build: a Senior Head Teacher shown by full name in every branch (L32); a Teacher reads the students they teach, Basic fields only, and no other student (L48); the diagnostic score read also by the Head Teachers and the student's class Tutor (L50); the Head Tutor reads every field group of the branch's students, the financial group included, and exports them, and the Head Teachers export the Basic fields (L59); the Tutor exports every field the Tutor reads about own class (L136); groups on every row of the student list for every reader (L147); relatives' phones searched by Ctrl+K for the Super Admin, the Principal and the Academic Vice Principal, with the relative's children listed (L157; with 3.5b H33 if that is merged first, otherwise built here).
  - Done when: each item has allow and refuse tests for every role in the permission harness and at its route, the export tests cover each new exporter's columns, and the report lists each item done.
  - From 3.5b (pull request #116, decision 3): L157 is built there: Ctrl+K finds relatives by name and main phone (`GET /api/search/relatives`, the readers of `relatives`) and a student by a live-linked relative's main phone for the same readers, the relative named on the result; this task does not build it again. The Parents list's own phone search stays for the Super Admin and the Academic Vice Principal (`holderOf(relatives, create)`), a known gap the owner may close here.

- [x] **3.6b-1 The owner's answers of 15 October: the same-person mark by phone, one phone for one adult** (issue #42, the owner's answers of 15 October 2026, item L81, and the answer of 16 October 2026; 3.6b split in three, pull request #119, decision 1)
  - Read: the owner's answers comments on issue #42 (15 and 16 October 2026), the comments of the tasks they name, `04` (Close relatives, Teacher and staff record), `edge/close-relatives`, `edge/people-roles-accounts` ("A teacher who left is hired again"), `edge/academic-year`, `edge/developer-rules`.
  - Build: the staff and relative "same person" mark set automatically by an equal main phone in both directions, the person's details taken from the existing record, no hand control to set or remove it, a corrected phone updating the mark with an audit entry, and one phone number for one adult (L81); a relative's phone that is a staff member's current phone is never given to another person, the staff phone is corrected first (the answer of 16 October).
  - Done when: each rule has a database or route test that fails without it, and L81 has tests for a new relative, a new staff member and each changed phone.

- [x] **3.6b-2 The owner's answers of 15 October: the year's dates and the return in August** (issue #42, the owner's answers of 15 October 2026, items L128 and L170; pull request #119, decision 1)
  - Read: the owner's answers comments on issue #42 (15 and 16 October 2026), the comments of the tasks they name, `04` (Movements), `edge/time-dates-calendar` ("The academic year is extended or shortened"), `edge/students-classes-groups`, `edge/developer-rules`.
  - Build: the year made longer at any time and shorter only when no lesson with data, mark, attendance or stay falls in the days cut off, refused with the list otherwise (L128); a return or restore dated the first day of the next planned year (L170).
  - Done when: each rule has a database or route test that fails without it.

- [x] **3.6b-3 The owner's answers of 15 October: the department move on its start date** (issue #42, the owner's answers of 15 October 2026, item L195; pull request #119, decision 1)
  - Read: the owner's answers comments on issue #42 (15 and 16 October 2026), the comments of the tasks they name, `04` (Teacher and staff record), `edge/people-roles-accounts` (row 15), `edge/developer-rules`.
  - Build: a department move that takes effect on its start date, with open requests moving then (L195).
  - Done when: each rule has a database or route test that fails without it, and L195 has a test on the day before and on the start date with the injected clock.

- [x] **3.6c-1 The owner's answers of 15 October: the year result and no extra lessons** (issue #42, the owner's answers of 15 October 2026, item L210 and answer 1; 3.6c split in two, pull request #124, decision 1)
  - Read: the owner's answers comments on issue #42 (15 and 16 October 2026), `07` (Calculation rules), `edge/calculation`, `06` (Changes after publishing), `edge/timetable`, `edge/time-dates-calendar`, `edge/lesson-plans`, `09`, `edge/developer-rules`, the plans of pull requests #102 and #103.
  - Build: the year result as the mean of the quarter results as published (each rounded as shown), rounded once more for the year, in `packages/calc` with its reference journal (L210; a reading of a calculation rule decided by the owner); the extra lesson, its "counts for attendance" switch and the "replaces the lesson of [date]" make-up removed from `packages/calc`, `packages/timetable-rules`, the database (every dated lesson comes from a version's pattern) and every later task line of this file that names them (a lesson moved across quarters is only cancelled).
  - Done when: the calc tests include the 50, 50, 49, 50 example giving 50, grade 3; no code or later task line names an extra lesson.

- [x] **3.6c-2 The owner's answers of 15 October: Tutor lessons follow the Tutor** (issue #42, answer 2 of the owner's answers of 15 October 2026 and answer 1 of 16 October 2026; 3.6c split in two, pull request #124, decision 1)
  - Read: the owner's answers comments on issue #42 (15 and 16 October 2026), `05` (Teaching load), `06` (Changes after publishing), `edge/timetable` (Structure, "The Homework slot and Ma'naviyat soati"), `edge/people-roles-accounts`, `edge/developer-rules`, the plans of pull requests #88 and #99.
  - Build: the Maʼnaviyat soati and Homework slot rows of a class always held by the class's Tutor in force on the lesson's date (the acting Tutor while one is set), with no teacher chosen by hand in the teaching load; the future lessons going to a new or acting Tutor from the date of the change, held lessons keeping the person who held them; the class's Tutor lessons that clash with the new Tutor's other lessons, from the appointment's start, listed in the appointment's preview and set to "needs a teacher", the appointment never refused for a clash.
  - Done when: a test gives a class a new Tutor and finds the future Tutor lessons with the new Tutor and the held ones with the old; a test of a clash finds the lesson in the preview and needing a teacher; no load route accepts a hand-picked teacher on a Tutor row.
  - From 3.6c-1 (pull request #124, decision 7): every dated lesson names its version, pattern block, load row and pattern entry (migration 0066); a database test writes them with `LessonsKit.source`.

## Phase 4. Calculation module

- [x] **4.1 Exact fractions and daily results** (pull request #102)
  - Read: `07` (The total, Calculation rules), `edge/calculation`, `edge/developer-rules`.
  - Build in `packages/calc`: a fraction type on BigInt; percentage of a work from number and total; attendance values; daily result from the daily distribution, with the classwork part as the mean of the lesson's classworks and the homework part as the mean of the homeworks checked at it; the rules for empty scores.
  - Done when: the worked examples in the spec pass as tests and property tests show no floating point is used.
  - From 1.6 (pull request #49): the attendance values of late and skipped are stored per quarter (`quarters.late_value`, `quarters.skipped_value`, 50 and 0 by default); the calculation takes the values of the lesson's quarter as input.

- [x] **4.2 Quarter and year results** (pull request #103)
  - Read: `07` (Calculation rules), `08` (Student results), `14` (Journal), `edge/calculation`.
  - Build: quarter averages; quarter result from the quarterly distribution; rating exam handling; provisional results; grade bands; year result as the mean of exact quarter results; rounding once at the end; the folder and format for the reference journals of the quality plan, which the owner fills with hand-checked cases.
  - Done when: the boundary examples in the spec pass (for example 49.5, and the year case of 49.475) and the reference-journal test runs on at least one sample.
  - From 1.6 (pull request #49, decision 5): the Settings page shows the grade bands as text of the three locale files (`setup.settings.gradeBands`); once the bands are in `packages/calc`, the page reads them from there and a test compares.

- [x] **4.3 Exemptions, flags and special outcomes** (pull request #104)
  - Read: `07` (Exemptions), `edge/exemptions`, `edge/calculation`.
  - Build: exempt lessons left out; the "Exempt" and "Not assessed" outcomes; the few-lessons flag; the attendance-only flag; start-quarter counting from the go-live date; the stored inputs and module version that go with each final result.
  - Done when: every row of the two edge-case tables has a test.

## Phase 5. Timetable

- [x] **5.1a Lessons, pattern and time claims** (split of 5.1 Data model and database constraints, pull request #107, decision 1, Look first)
  - Read: `06` (Model, Changes after publishing), `edge/timetable`, `edge/developer-rules`, `edge/time-dates-calendar`.
  - Build: pattern blocks and entries with the teacher, room and class rules per version; dated lesson blocks and lessons with their own start and end; the time claims table with the teacher, room and class-block exclusion constraints across all branches; the shared-room trigger; the constraint trigger "a student in at most one lesson of a block" on lesson writes.
  - Done when: the database refuses each double booking of lessons and of pattern entries in tests written as the application user, across two branches and two day templates by clock time.
  - From 3.4a (pull request #99, decision 15): `timetable_versions` exists (branch, year, number, status checked in draft, published, archived with no grant on `status`, `starts_on`, `from_version_id` keyed to the same branch and year, `left_rows`) with `teaching_load_rows`; this task extends it instead of creating one.

- [x] **5.1b Exams and later changes against the claims** (pull request #108)
  - Read: `06` (Changes after publishing, Exam), `edge/timetable` (Exams), `edge/developer-rules`.
  - Build: `exams`, `exam_rooms`, `exam_room_classes`, `exam_invigilators` in their own tables (`edge/developer-rules`, Exams), writing claims of the kinds `exam_room`, `exam_invigilator` and `exam_class` into `time_claims` (0058), so lessons and exams are checked by one rule; an invigilator is never a vacancy; a class sits in one room of an exam; the group that sits an exam in its own lesson's slots (`edge/timetable`, Exams, "A group sits an exam"); the re-check of the claims of future lessons when something else changes under them: a class added to or removed from a group (`group_classes`), a group or class membership that puts a student in two lessons of one block, a room's `shared` switch or `max_simultaneous_lessons` changed.
  - Done when: the database refuses an exam with a double-booked invigilator, room or class, and each of those later changes that would break a claim.
  - From 5.1a (pull request #107, decision 2): the capacity of a shared room against the students of its lessons together is checked when a claim is written, never on a membership change; the re-check on memberships is the student rule only.

- [x] **5.2 Rule engine** (pull request #109)
  - Read: `06` (Rules, Teachers who work in several branches), `05` (Language of instruction), `edge/timetable`.
  - Build in `packages/timetable-rules`: every blocked rule and warning, by clock time; travel time between branches; the language rule; a result that names the rule and the lessons involved.
  - Done when: each rule in the Rules table has passing and failing test cases.
  - From 1.5 (pull request #46): `lessonSlotProblem` and `lessonTimeProblem` exist; every lesson write calls them, so "a lesson can only sit in a lesson slot" holds on the server and not only in the engine.
  - From 1.6 (pull request #49, decision 4): travel time is `travel_times`, one row per unordered pair of branches; a pair without a row is "not set", never 0 minutes. This task decides what the rule does with an unset pair, and flags it.

- [x] **5.3a Draft builder, steps 1 to 4** (pull request #127)
  - Read: `06` (Building a timetable, Rules), `03` (Slot types and day templates), `04` (Teacher and staff record), `edge/timetable` (After publishing).
  - Build: the builder screen with its checklist of steps; step 1 (the start date with the first day of a coming quarter as a shortcut, the table of templates per weekday and grade confirmed); the readiness of steps 2 to 4; availability as dated entries, a draft checking the entry in force on its intended start date.
  - Done when: the readiness route names every failing check of steps 1 to 4, and a draft whose steps 1 to 4 pass is reported ready for them.
  - From 3.4a (pull request #99, decision 15 and correction 6): draft versions exist with their start date ("next Monday by default") and the load; this task adds the rest of step 1, the first day of a coming quarter as a shortcut, and the readiness of the load step (the problems of each row, `loadRowProblems`).
  - From 3.4b (pull request #100, decisions 4, 5 and 7): the readiness of steps 2 and 3 reads the weekly totals (`totals.ts` of `packages/timetable-rules`: each class's lessons against the lesson slots of its week, each teacher's lessons against the free slots in the branch) and blocks on `load_group_gaps` (students not placed) and the block problems (`load_block_lessons`, `load_block_teacher`, `load_block_mixed`, `load_mixed_not_split`, `load_split_and_whole`), which the load page only shows.
  - From 3.4c (pull request #101, spec review nit 8): the row trigger of 0055 reads the class Tutor of a Tutor subject on the version's start date only, while `department_move_loads` (0057) reads it on the later of the start date, the move's start and today; for a draft whose start date has passed the two differ, and readiness settles one reading for the row checks.

- [x] **5.3b-1 Draft builder, step 5: rules, weights and the gate** (pull request #128)
  - Read: `06` (Building a timetable, Auto-generation, Rules), `edge/timetable` (Generator and editing).
  - Build: step 5 of the builder: the fixed rules shown, the weight of each preference, the confirmation of step 5; the gate.
  - Done when: a draft cannot move to generation while a readiness check fails.

- [x] **5.3b-2 Draft builder, step 5: pinned lessons** (pull request #129)
  - Read: `06` (Building a timetable, Auto-generation, Rules), `edge/timetable` (Structure, the Homework slot row: "A Tutor of two classes cannot have both pinned at the same time"; Generator and editing: "the locked and pinned lessons are checked on their own").
  - Build: pinned lessons (a table per load row, weekday and slot position, its routes and form); the rule engine's input of a weekly pattern read from the database; the pins checked on their own by `checkTimetable`, a blocked result making step 5 not ready and listing the lessons; the confirmation of step 5 covering the pins.
  - Done when: a draft whose pinned lessons have a blocked conflict among themselves, or whose pins changed since the confirmation, cannot move to generation (`requireReady`).
  - From 3.4a (pull request #99, decision 15 and correction 6): the load step's list of a Tutor of two classes whose pinned lessons fall at the same time.
  - From 5.3a (pull request #127, decisions 2 and 3): readiness is `draftReady` over the steps' checks of `packages/timetable-rules/src/readiness.ts`, computed on each read by `GET api/timetable/versions/:id/readiness`. Facts are read on the dates of decision 2: templates weekday by weekday from the later of the start date and today, availability from the one entry in force on that date.
  - From 5.3b-1 (pull request #128, decisions 2, 6 and 9): step 5 is `rulesReadiness` (the weights stored against `timetable_versions.rules_confirmed`); the pins join that check and the stored confirmation, and the confirm route (`POST …/rules/confirm`, which carries what the person sees) carries the pins too. The panel is `apps/web/src/features/timetable/rules-step.tsx`.

- [x] **5.4a Grid: board and drag**
  - Read: `06` (Editing in the grid), `12`.
  - Build: the board with Pragmatic drag and drop; move and swap; live conflict marking from the rule engine; the server refuses what the grid refuses.
  - Done when: Playwright moves a lesson, sees a blocked move refused with the rule named, and the same move is refused when the API is called directly.
  - From 5.2 (pull request #109, decisions 5 and 13): the grid and its server check call `checkCandidate` and `checkTimetable` of `packages/timetable-rules` (`check.ts`) with the input `placement.ts` documents (which date each fact is read on); every lesson write calls them, and they call `lessonTimeProblem` on every lesson (the "From 1.5" line of 5.2). A result names its rule code; its texts are the i18n keys `timetable.rule.<code>`: 5.3b-1 (pull request #128, review correction 2) added those of `FIXED_RULES`, each the rule in the words of its row in `06`, Rules, with no numbers or placeholders; 5.4a adds the others the same way and reuses the key as the name of a result in the conflict list; numbers such as "26 lessons and 24 free slots" are 5.4a's own keys. `other_draft` reads the other branches' drafts the grid chooses (decision 12).

- [x] **5.4b-1 Grid: other branches and the views** (pull request #132)
  - Read: `06` (Editing in the grid, Teachers who work in several branches, Views and outputs, Rules), `edge/timetable` (Structure, Generator and editing).
  - Build: the published lessons of other branches as busy-elsewhere placements (`fixed`) in `pattern-facts.ts`, the reader every pattern check uses, and the drafts of other branches as `otherDrafts`; grey "busy in another branch" blocks; the warning when another branch's draft uses the same teacher; views by class, teacher and room on a clock axis.
  - Done when: a move onto a time when the teacher has a published lesson in another branch, or within the travel time of one, is refused in the grid and by the API with the rule named, and the teacher view shows that lesson as a grey block with the branch.
  - From 5.3b-2 (pull request #129, decision 1, Look first): `edge/timetable`, Generator and editing: "Before generating, the locked and pinned lessons are checked on their own. A blocked conflict stops the run and lists the lessons." The pins are checked among themselves in one branch for now; this task adds the published lessons of other branches as busy-elsewhere placements (`fixed`) to `pattern-facts.ts` (`apps/api/src/modules/timetable`), the reader every pattern check uses, so the pins' check of step 5 (`checkPins`) counts them and the travel time around them, and a Tutor of classes in two branches is listed too. The teacher's other branches (`branchIds`) and `otherDrafts` are read there as well.

- [x] **5.4b-2a Grid: "to place", the room picker and the conflict panel** (pull request #133)
  - Read: `06` (Editing in the grid, Building a timetable, step 7).
  - Build: the "to place" panel; the room picker; the conflict panel with a button that jumps to the lesson; step 7's readiness mark.
  - Done when: every item of the Editing in the grid list except "Suggest a place" is present: Playwright drags a block from "To place", changes a room in the picker, and a conflict's "Show" focuses the lesson.
  - From 5.4a (pull request #130, decisions 7 and 13): the room picker of a lesson ("The room picker lists only rooms that are free in that slot, best fit first") and "Suggest a place" belong to the "to place" panel built here; a new lesson takes its row's room, else a class row's main classroom, else none (`roomOfNew` of `packages/timetable-rules/src/facts-data.ts`). Step 7's readiness mark ("The conflict panel shows no errors") comes with the conflict panel: the grid answer already carries every result of the draft (`GET api/timetable/versions/:id/grid`, `results`), and numbers of a result shown there take keys of their own with plural forms. The views by teacher and room read the same answer; a block occupies a cell by clock time (`boardOf` of `apps/web/src/features/timetable/use-slot-status.ts`).
  - From 5.4b-1 (pull request #132, decisions 4 and 7): the grid answer carries the teachers' lessons in other branches (`facts.busyElsewhere`, `fixed`) and the other branches' names (`facts.branches`); results may name a lesson of another branch (`lessonIds`), which the conflict panel names by its branch and never jumps to. Every check of the pattern passes `checkedPlacements` (`packages/timetable-rules/src/pattern-place.ts`), so "Suggest a place" and the room picker count them too.

- [x] **5.4b-2b Grid: "Suggest a place"** (pull request #134)
  - Read: `06` (Editing in the grid, bullet 4: "\"Suggest a place\" on a selected lesson shows the best free slots, or a swap of two or three lessons that makes room for it"), `edge/timetable` (Structure, Generator and editing).
  - Build: "Suggest a place" on a lesson of the board or an entry of "To place": the best free slots, else a swap of two or three lessons that makes room; a route that applies a rearrangement of up to three blocks in one check and one transaction.
  - Done when: "Suggest a place" on a selected lesson shows the best free slots or a swap of two or three lessons, and applying it is checked by the rule engine and refused by the API like a move.
  - From 5.4b-2a (pull request #133, decision 1, Look first): split from 5.4b-2. "Suggest a place" belongs to the "to place" panel (From 5.4a, pull request #130, decisions 7 and 13): a new block is built as `newBlockOf` (`apps/web/src/features/timetable/use-slot-status.ts`) and its slots are marked by `cellStatus`; every check of the pattern passes `checkedPlacements` (`packages/timetable-rules/src/pattern-place.ts`), so the suggestions count the teachers' lessons in other branches (From 5.4b-1, pull request #132). A suggestion that changes a room uses `roomChange` (`packages/timetable-rules/src/rooms-pick.ts`).

- [x] **5.4c-1 Grid: the edit lock and locks** (pull request #135)
  - Read: `06` (Editing in the grid, Auto-generation), `edge/timetable` (Generator and editing).
  - Build: the edit lock on a draft, taken by the first write and released after 5 minutes without activity, with "Take over" and a notice to the earlier holder; locks on a lesson, class, teacher or day, kept by "Suggest a place" and the rearrange route and stored for "Regenerate".
  - Done when: a second Academic Vice Principal can take over a draft and the first is told.
  - From 5.4c (pull request #135, decision 1, Look first): split into 5.4c-1, 5.4c-2 and 5.4c-3.
  - From 5.4b-2b (pull request #134, decisions 8 and 9): "Suggest a place" (`suggestPlaces` of `packages/timetable-rules/src/suggest.ts`) never moves a pinned block as a blocker; it and the rearrange route (`POST …/pattern/rearrange`) must leave locked lessons in place too (`06`, Auto-generation, Locks).

- [x] **5.4c-2 Grid: undo and redo** (pull request #136)
  - Read: `06` (Editing in the grid), `edge/timetable` (Generator and editing).
  - Build: undo and redo of the session's own grid changes, each step taken back through the routes and the rule engine; an applied suggestion taken back as one step.
  - Done when: a move, a room change, a removal and an applied suggestion are undone and redone, and a step refused by the rules is shown and kept.
  - From 5.4b-2b (pull request #134, decision 8): undo takes back an applied suggestion as one step; a suggestion that created a block is taken back by removing it in the same transaction (the rearrange route, widened).
  - From 5.4c-1 (pull request #135, decision 2): every step is a draft write and runs under the edit lock (`lockDraft`).

- [x] **5.4c-3a Grid: double lessons** (pull request #137)
  - Read: `06` (Editing in the grid), `edge/timetable` (Structure: double lessons).
  - Build: double lessons placed, moved, re-roomed and removed as one; each one step of undo and redo.
  - Done when: a double lesson is placed, moved and removed as one.
  - From 5.4c-3 (pull request #137, decision 1, Look first): split into 5.4c-3a (double lessons) and 5.4c-3b (mixed pairings).

- [x] **5.4c-3b Grid: mixed pairings** (pull request #138)
  - Read: `06` (Editing in the grid), `edge/timetable` (Structure: mixed blocks).
  - Build: the pairing of the halves of a mixed split slot by slot.
  - Done when: a mixed split is placed with both pairings.
  - From 5.4c-3 (pull request #137, decision 1, Look first): split from 5.4c-3; 5.4c-3a built the double lessons. A place route body names one load row; a pairing needs the partner row too (the place route takes `double` since 5.4c-3a). A double of a mixed pairing is a pair of two such blocks whose rows all allow doubles (`double_not_allowed`).
  - From 5.4c-2 (pull request #136, decision 11): the placing, moving and removal of a mixed pairing are steps of the grid history (`apps/web/src/features/timetable/grid-history.ts`): each write records the blocks it changed (`stepOf`) and is taken back through the route of its kind (`writeOf`), so a write of two blocks together must be one step, taken back in one transaction; `stillApplies` builds a block to place again with `newBlockOf`, which knows no pairing.
  - From 5.4a (pull request #130, decisions 8, 10 and 14): the grid refuses a half of a mixed split (`pattern_mixed_block`); the pairing of mixed halves is built here on the routes of `apps/api/src/modules/timetable/pattern.service.ts`.
  - From 3.4b (pull request #100, decision 12, Look first): the halves of a split marked `mixed_block` meet in different slots; the pairing of two subjects' halves slot by slot (boys have physical education while girls have technology, and the reverse in another slot; `edge/timetable`, Structure) is placed and kept here.

- [x] **5.5a-1 Publish: the route, its checks and one at a time** (pull request #139)
  - Read: `06` (Editing in the grid, Rules, How surprises are prevented), `edge/timetable` (Versions and drafts, Generator and editing).
  - Build: the publish route and step 8 of the builder; the start date rules (tomorrow at the earliest, next Monday by default, quarter shortcuts); every check of the pattern that blocks a publish; "deliberately short" with a reason on a load row; one publish at a time; a publish that fails changes nothing; the mark "out of date" written by a publish.
  - Done when: two publishes at the same moment are tested, and a refused publish is shown to change nothing.
  - From 5.5a (pull request #139, decision 1, Look first): split into 5.5a-1 (the route, its checks and one at a time), 5.5a-2 (dated checks and the impact preview) and 5.5a-3 (out-of-date drafts and the chain).
  - From 5.4c-1 (pull request #135, decision 2 with review correction 5): publish is a draft write and takes `lockDraft`, so it is refused `draft_edit_locked` while another account holds the draft's edit lock (`06`, Editing in the grid: "one edits at a time").
  - From 2.1 (pull request #52, decisions 2, 3 and 14): the publish check of `edge/academic-year`, "Publishing is blocked unless the year has four dated quarters and every subject in the load has its journal type and, if it is graded, its daily distribution and its quarterly distribution for each quarter the version touches. Attendance-only subjects need no weights." The distributions are the branch's (`subject_daily_weights`, `subject_quarter_weights`); a row counts only in the subject's current `weights_round` and, for a quarter, when its rating exam part fits the subject's switch (as `quarterWeightsMissing` in `apps/api/src/modules/setup/subjects.service.ts` counts).
  - From 3.4b (pull request #100, decisions 1 and 4, Look first): publish blocks on every problem of a load row (`loadRowProblems`), the six of 3.4b included (`load_group_gaps` among them).
  - From 5.2 (pull request #109, decisions 1, 8, 11 and 13): publish refuses any `blocked` result of `checkTimetable`; `load_mismatch` becomes a refusal here (fewer lessons than the load unless the row is marked "deliberately short" with a reason, more lessons always), and this task stores that mark and its reason on the load row, which the engine reads as `deliberatelyShort`. An unset travel time between two branches blocks (`travel_time_not_set`).
  - From 3.6c-2 (pull request #125, decisions 1, 3 and 11): publish blocks on `load_no_tutor` and `load_tutor_row_teacher` like every other load problem; the Tutor row's teacher is the class's Tutor read by `tutorAt` (`packages/timetable-rules/src/tutors.ts`) on the later of the start date and today, as `class_tutor_on` (0067) reads it.

- [x] **5.5a-2a Publish: the dated check of every date** (pull request #140)
  - Read: `06` (Rules, Teachers who work in several branches, How surprises are prevented), `edge/timetable` (Versions and drafts, After publishing), `edge/time-dates-calendar`.
  - Build: every date of the version checked with `checkTimetable` in dated mode (special templates, the other branches' dated lessons and exams on each date, with their one-day changes); dates under a later availability entry are warnings by date; the lessons the day's template cannot hold listed; lessons that will need a teacher listed.
  - Done when: a clash with another branch's later version and a date under a later availability entry are tested.
  - From 5.5a (pull request #139, decision 1, Look first): split into 5.5a-1 (the route, its checks and one at a time), 5.5a-2 (dated checks and the impact preview) and 5.5a-3 (out-of-date drafts and the chain). Until this part, the pattern check of a publish reads each other branch's version in force on the start date only.
  - From 5.5a-2 (pull request #140, decision 1, Look first): split into 5.5a-2a (the dated check of every date), 5.5a-2b (the impact preview and the transition week) and 5.5a-2c (the readers that follow the published version).
  - From 5.2 (pull request #109, decisions 1, 8, 11 and 13): publish runs `checkTimetable` over the dated lessons it creates and refuses any `blocked` result; `teacher_unavailable_later` gives the warnings by date.
  - From 5.4b-1 (pull request #132, decision 4): a draft's checks count the other branches' published version in force on its reading date (`timetable_busy_elsewhere`, 0071). Publish checks every date of the new lessons against the version of each other branch in force on that date, and the one-day changes there (`06`, Teachers who work in several branches: "One clash check. A teacher cannot be in two lessons at once, counted across all branches by clock time"; "Busy elsewhere … the generator treats them, and the travel time around them, as fixed").

- [x] **5.5a-2b-1 Publish: the impact preview and the transition week** (pull request #142)
  - Read: `06` (How surprises are prevented, Rules), `edge/timetable` (Versions and drafts, After publishing), `edge/time-dates-calendar` ("A shortened day").
  - Build: the impact preview (teachers, classes and rooms affected, lessons created, moved and removed, who is notified, the lessons per week under each vacancy; the lessons holding data that block a removal follow in 5.5b); the transition week against the load, warnings to acknowledge.
  - Done when: a version starting on a Wednesday shows its transition week against the load and needs the acknowledgement, and the preview of a teacher change lists the teacher affected and notified.
  - From 5.5a-2 (pull request #140, decision 1, Look first): split into 5.5a-2a (the dated check of every date), 5.5a-2b (the impact preview and the transition week) and 5.5a-2c (the readers that follow the published version).
  - From 5.5a-2b (pull request #142, decision 1, Look first): split into 5.5a-2b-1 (the impact preview and the transition week) and 5.5a-2b-2 (the choice of which lessons of a shortened day are kept).

- [x] **5.5a-2b-2 Publish: the lessons kept on a shortened day** (pull request #143)
  - Read: `edge/time-dates-calendar` ("A shortened day", "A day off for grade 9 only"), `06` (How surprises are prevented), `edge/timetable` (Versions and drafts, "The pattern is valid but one date is not"), `edge/developer-rules`.
  - Build: the choice of which lessons of a shortened day are kept (`edge/time-dates-calendar`: "Lessons are matched by their order in the day. Those beyond the day's slots are created as cancelled with the reason 'not in the day's template' and listed per class in the preview. The Academic Vice Principal can choose which lessons are kept"): stored per version, date and class, with its route and its place in step 8. The choice reaches everything `datedPattern` feeds: the dated check and the cancelled list of 5.5a-2a, the impact preview and the transition week of 5.5a-2b-1, and the dated lessons of 5.5b.
  - Done when: a shortened day of 5 slots for a class with 7 lessons keeps the two lessons chosen in place of the last two, and the dated check, the cancelled list and the preview follow the choice.
  - From 5.5a-2b (pull request #142, decision 1, Look first): split into 5.5a-2b-1 (the impact preview and the transition week) and 5.5a-2b-2 (the choice of which lessons of a shortened day are kept).

- [x] **5.5a-2c Publish: the readers that follow the published version** (pull request #144)
  - Read: `05` (Group, Teaching load), `edge/students-classes-groups`, `edge/timetable` (Versions and drafts), `edge/developer-rules`.
  - Build: `class_group_subjects` and `department_move_loads` read the published version in force, as the two From lines below say.
  - Done when: a group subject of the published load binds a class membership from the version's start, and a department move counts a published version that runs past its date.
  - From 5.5a-2 (pull request #140, decision 1, Look first): split into 5.5a-2a (the dated check of every date), 5.5a-2b (the impact preview and the transition week) and 5.5a-2c (the readers that follow the published version).
  - From 3.4b (pull request #100, decisions 1 and 4, Look first): from the published version in force on a date `class_group_subjects` (0049) reads the subjects of its group rows whose groups draw from the class, in place of the active groups, so that the load is the source of the split and group subjects of a class (`05`, Group).
  - From 3.4c (pull request #101, decision 2, Look first): `department_move_loads` (0057) counts every version of a year that is not closed and ends on or after the start date of a department move; once a published version has a run of its own, a published version whose run ends before the start date no longer counts.

- [x] **5.5a-3a Publish: the chain** (pull request #145)
  - Read: `06` (How surprises are prevented, Changes after publishing: Filling a vacancy), `edge/timetable` (Versions and drafts).
  - Build: publishing before a later published version: "run until that version starts", "replace the versions that follow", "carry the change into them" (carry a teacher or room change into later versions).
  - Done when: a fix published mid-quarter before two later versions is tested with each of the three answers.
  - From 5.5a (pull request #139, decision 1, Look first): split into 5.5a-1 (the route, its checks and one at a time), 5.5a-2 (dated checks and the impact preview) and 5.5a-3 (out-of-date drafts and the chain).
  - From 5.5a-3 (pull request #145, decision 1, Look first): split into 5.5a-3a (the chain) and 5.5a-3b (out-of-date drafts).
  - From 5.5a-2a (pull request #140): the dated check of a publish runs every version to the year's end, as no publish before a later published version is allowed yet; once one is, it ends the day before the next version's start.

- [x] **5.5a-3b-1 Publish: out-of-date drafts after a change of the setup** (pull request #146)
  - Read: `06` (How surprises are prevented: "Out-of-date draft"), `edge/timetable` (Versions and drafts), `edge/time-dates-calendar`.
  - Build: the mark "out of date" from changes of templates, calendar, availability and rooms, kept as its causes; bringing a draft up to date after them (the causes and the check shown, then confirmed).
  - Done when: a calendar change marks an open draft out of date, and bringing it up to date lists the change and clears the mark.
  - From 5.5a-3b (pull request #146, decision 1, Look first): split into 5.5a-3b-1 (the marks from the setup and bringing a draft up to date after them) and 5.5a-3b-2 (bringing a draft up to date after a publish).
  - From 5.5a-3 (pull request #145, decision 1, Look first): split from 5.5a-3; 5.5a-3a built the chain.
  - From 5.5a (pull request #139, decision 1, Look first): 5.5a-1 marks drafts out of date only at publish (`timetable_versions.out_of_date_at`); a marked draft cannot be published (`draft_out_of_date`) until this part.

- [x] **5.5a-3b-2 Publish: bringing a draft up to date after a publish** (pull request #148)
  - Read: `06` (How surprises are prevented: "Out-of-date draft"), `edge/timetable` (Versions and drafts).
  - Build: for a draft marked by a publish, what changed on both sides against the version the draft started from (the draft's changes and the published version's: rows, entries, pins and blocks), the person picks, the rule engine checks the picks; the draft then names the published version as the one it started from.
  - Done when: a publish marks an open draft; bringing it up to date lists the changes of both sides and keeps the person's picks.
  - From 5.5a-3b-1 (pull request #146, decision 1, Look first): split from 5.5a-3b; 5.5a-3b-1 built the marks from the setup and bringing a draft up to date after them.
  - From 5.5a-3b-1 (pull request #146, decisions 5 and 7): the mark is its causes (`timetable_version_out_of_date_causes`, 0077; `out_of_date_at` is gone); a draft with a cause of action `timetable_version.publish` is refused `draft_out_of_date_by_publish` by `POST /api/timetable/versions/:id/up-to-date` until this part lifts it, and the builder's panel switches its button off.
  - From 5.5a-3b-1 (pull request #146, decision 6): the drafts marked before 0077 carry a publish cause with no record (`record_id` null): which version marked them is not known; this part decides what their "other side" is.

- [x] **5.5b-1 Publish: the dated lessons written** (5.5b split in two, pull request #152, decision 1)
  - Read: `06` (What a change does to existing data, How surprises are prevented), `edge/timetable` (Versions and drafts), `edge/time-dates-calendar`.
  - Build: generation of dated lessons from the start date to the end of the academic year, following the calendar and day templates; no change to any lesson dated today or earlier; an unchanged lesson keeps its identity; the dated lessons of the later versions under "run until", "replace" and "carry". Stored one-day changes applied again after a publish move to 5.6a, which stores them (decision 8).
  - Done when: a version that starts mid-week and a holiday inside a week are tested.
  - From 5.1a (pull request #107, correction 6): `lessons` and `lesson_blocks` (0058) have no delete grant: the removal of empty future lessons at publish adds it in a migration of its own, with the check that a lesson holds no data. The columns that tie a dated lesson to its version (`lesson_blocks.version_id` and `pattern_block_id`, `lessons.load_row_id` and `pattern_entry_id`) have no update grant: this task decides whether an unchanged lesson is re-pointed to the new version under a grant of its own or stays with the version that created it, read through the chain (`edge/timetable`, Versions and drafts: "An unchanged lesson keeps its identity"). The routes map `40P01` and `40001` to `timetable_busy` and pass on a constraint name only, never the detail of an exclusion error.
  - From 3.6c-2 (pull request #125, decisions 3, 4, 6 and 11): a dated lesson of a Tutor row (a Tutor subject on a class row) takes the class's Tutor in force at its start (`tutorAt`, the acting Tutor first), not the pattern entry's teacher; with no Tutor then, or a clash of time or travel with the Tutor's other lessons and exams (`checkTeacherTime` over `teacher_claims_elsewhere`), it is created "needs a teacher", as `followTutors` (`apps/api/src/modules/timetable/tutor-lessons.ts`) sets it.
  - From 5.4c-3a (pull request #137, decision 12): a dated lesson block made from a paired pattern block (`pattern_blocks.double_pair_id`) takes a `double_pair_id` of its own per date, shared with the other half of that date (0058 `lesson_blocks_double` counts a pair across all dates).
  - From 5.4c-3b (pull request #138, decisions 3 and 6): `edge/timetable`, Structure: "A mixed block is allowed: boys have physical education while girls have technology, and the reverse in another slot." A pattern block of two subjects' mixed halves (a pairing) becomes one dated lesson block with two lessons, as a split does; a double of a pairing follows the 5.4c-3a line. The pairing check of `checkBlocks` (`EngineLoadRow.block` and `partners`, `packages/timetable-rules/src/placement.ts`) is filled in dated mode here, so a dated block of rows that are neither one block of the load nor a pairing is `split_apart` with `rows`.
  - From 5.5a-2a (pull request #140, decisions 2, 7 and 11): `datedPattern` (`packages/timetable-rules/src/dated.ts`) is the expansion the dated lessons are created from, its `cancelled` lessons created as cancelled with their reason. Until this task no published version has dated lessons, so the dated check of a publish meets another branch's later version only from here: a test publishes the other branch's later version through the real route and runs the publish check of 5.5a-2a against it. The own branch's exams and stored one-day changes are not read by 5.5a-2a: `edge/timetable`, "The pattern is valid but one date is not" ("an earlier one-day change holding the room" is a blocked conflict of a date) and "A substitution and a one-day move are already recorded … The preview sorts them into kept, needs a decision and dropped. Publish waits until every 'needs a decision' item is settled" (with Exams: a lesson of an invigilator or in an exam room at that time is a "needs a decision" item). `06`, Rules, availability row: "the lessons stay flagged until it is published".
  - From 5.5a-3a (pull request #145, decision 11): the dated lessons of the later versions follow a carry (the teacher and room changes made in them, `timetable_version.carry`) and are removed with a replace (the versions archived, `timetable_version.replace`); no change to any lesson dated today or earlier.

- [x] **5.5b-2 Publish: the preview from the stored lessons** (5.5b split in two, pull request #152, decision 1)
  - Read: `06` (How surprises are prevented, What a change does to existing data), `edge/timetable` (Versions and drafts).
  - Build: the impact preview and the transition week read the dated lessons stored for the dates before and after the start; the "after" side carries the needs-a-teacher marks the write gives (a null teacher, `writeDatedLessons` in `apps/api/src/modules/timetable/dated-lessons.ts`), so the preview shows what the publish writes.
  - Done when: a preview over stored lessons of an earlier version, one of them with no teacher, lists it the same on both sides and lists no change for it.
  - From 5.5a-2b-1 (pull request #142, decisions 2 and 9): the impact preview compares the draft with the published version in force before its start expanded by `datedPattern` (`apps/api/src/modules/timetable/impact.ts`); once this task stores dated lessons, its "before" side and the transition week's dates before the start are the stored lessons (with their one-day changes), and the preview lists the lessons holding data that block a removal (`06`, How surprises are prevented, Impact preview: "any lesson holding data that blocks a removal").
  - From 5.5b-1 (pull request #152, decision 9): once 6.1 adds the cells, the preview lists the lessons holding data that a removal would leave in place.

- [x] **5.5c-1 Publish: journals at publish** (5.5c split in three, pull request #155, decision 1)
  - Read: `06` (What a change does to existing data), `07` (first paragraph), `edge/timetable` (Versions and drafts, After publishing), `edge/developer-rules`.
  - Build: the journal record (one per class or group and subject per year) created, closed and reopened at publish, without cells: its runs are the days the published chain's load has it.
  - Done when: publishing a load with a new subject creates exactly one journal and removing it closes that journal.

- [x] **5.5c-2a Publish: withdraw** (5.5c-2 split in two, pull request #156, decision 1)
  - Read: `06` (How surprises are prevented), `edge/timetable` (Versions and drafts), `edge/developer-rules`.
  - Build: withdraw before the start date; the version in force before it runs again over its dates; the journals synced again after it (`syncJournals`, `apps/api/src/modules/timetable/journals.ts`); the drafts of the branch and year marked out of date.
  - Done when: a version withdrawn before its start has no dated lessons left, the version in force before it runs again over its dates, and a journal only it opened has no run.
  - From 5.1a (pull request #107, correction 6): withdraw before the start date removes the version's dated lessons; the delete grant on `lessons` and `lesson_blocks` comes in a migration of its own.
  - From 5.5a-3a (pull request #145, decision 10): withdraw uses the transition published → archived of 0076, allowed only before the version's start.

- [x] **5.5c-2b Publish: "Classes taught" and the vacancy kept** (5.5c-2 split in two, pull request #156, decision 1)
  - Read: `04` (Teacher and staff record, Vacancy), `06` (Changes after publishing: Filling a vacancy), `edge/timetable` (After publishing: the vacancy rows), `edge/developer-rules`.
  - Build: "Classes taught" on the staff record from the published load; the vacancy closed and kept: close refused while a load row of a draft or of a published version not yet ended names it or a future lesson is under it (`04`, Vacancy: "A vacancy cannot be closed while a load row names it or a future lesson is under it. One that never held a load can be deleted; one that did is closed and kept."), the 0055 trigger `staff_statuses_vacancy_load` narrowed to the same rows, delete still refused for a vacancy that ever held a load.
  - Done when: a vacancy whose published rows have all ended and that has no future lesson can be closed and stays listed, one with a future lesson is refused, and "Classes taught" lists the classes and groups of the published load in force.
  - From 3.4a (pull request #99): `04`, Teacher and staff record, Academic, "Classes taught, filled from the teaching load", is read from the published load; a vacancy that "held a load" is closed and kept (`04`, Vacancy) once 5.5 publishes it.
  - From 3.6a (pull request #118, decision 4): the students a Teacher reads come from `taughtAt` (`apps/api/src/modules/access/taught-scope.ts`): the classes and groups of the teacher's rows in the published version in force of each year not closed, on `greatest(today, the year's start)`; "Classes taught" reads the same, and publishing makes a Teacher's Students list fill.

- [x] **5.5c-3a Publish: notices and the changed mark of a publish and a withdraw** (5.5c-3 split in two, pull request #158, decision 1)
  - Read: `06` (How surprises are prevented, Changes after publishing, Views and outputs), `edge/timetable` (After publishing, "One publish changes thousands of lessons").
  - Build: notices to affected teachers through 0.9 (one per person per event, with the week before and after; none when the week did not change), for a publish with its replace and carries, and a withdraw; the "changed" mark stored for a week (`lesson_changes`, `isMarkedChanged`).
  - Done when: a publish that changes one teacher's lessons notifies that teacher once and no teacher whose week is the same, and the changed lessons carry the mark for seven days.
  - From 5.5a-3a (pull request #145, decision 10): a carry notifies the teachers of the later versions it changed.
  - From 5.5c-2a (pull request #156, decision 8): a withdraw notifies the affected teachers, as a publish does (`06`, Views and outputs: "When a published timetable changes, the affected teachers are notified at once").

- [x] **5.5c-3b Publish: the notice and the changed mark of a Tutor change** (5.5c-3 split in two, pull request #158, decision 1)
  - Read: `06` (How surprises are prevented, Changes after publishing, Views and outputs), `edge/timetable` (After publishing, "One publish changes thousands of lessons"; Structure, the Homework slot row).
  - Build: the notice and the mark of every path that calls `followTutors` (give, end, archive, role end and its taking back, `left` and its taking back), with `snapshotWeek` and `sendWeekChanges` (`apps/api/src/modules/timetable/week-changes.ts`) or the same comparison, and a kind of its own.
  - Done when: a change of a class's Tutor that moves its Tutor lessons notifies the old and the new Tutor once each, with the week before and after, and the lessons it moved carry the mark.
  - From 3.6c-2 (pull request #125, decision 9 with review correction 5): a change of a class's Tutor that moves its dated Tutor lessons (`followTutors`) notifies the old and the new Tutor as a teacher change does, and the lessons it moved carry the "changed" mark for a week.

- [x] **5.6a-1 One-day changes: cancel and restore of one lesson** (5.6a split in five, pull request #160, decision 1)
  - Read: `06` (Changes after publishing), `edge/timetable` (After publishing, Versions and drafts).
  - Build: the stored-day check (`storedDayCheck`, `apps/api/src/modules/timetable/stored-day.ts`) that every later part runs; the one-day cancel of one lesson with a reason and its restore, every rule checked again, refused with the free rooms listed; the notice and the "changed" mark of both; the "Day changes" page.
  - Done when: a restore whose room went to another lesson is refused with another room offered, a restored lesson is checked by every rule on its date, and a cancel or a restore notifies the teacher once with the week before and after.
  - From 5.5c-3a (pull request #158, code review 1): `keyOf` (`apps/api/src/modules/timetable/week-changes.ts`) pairs the lessons before and after a publish or a withdraw by date, start, end, class or group, subject, teacher and room, and does not compare the cancel. Today no application code writes a one-day cancel (`reason`, `exam`), so it cannot matter. Once this task stores them, a lesson with a one-day cancel on one side and none on the other (re-created in another block by `writeDatedLessons` with the expansion's cause, `dated-lessons.ts`) pairs as unchanged, and its teacher gets no notice and no mark although the week changed (`edge/timetable`, After publishing: "One notice per person per event, with the week before and after. A teacher whose week did not change gets none"). This task either compares the cancel in `keyOf`, keeping the impact preview's pairing equal, or applies its stored one-day changes again before `sendWeekChanges` reads the side after.
  - From 3.6c-2 (pull request #125, decision 7): a restored Tutor lesson takes the class's Tutor in force at its start (`tutorAt`).

- [x] **5.6a-2 One-day changes: room change and move of one lesson** (5.6a split in five, pull request #160, decision 1)
  - Read: `06` (Changes after publishing), `edge/timetable` (After publishing, Versions and drafts).
  - Build: a one-day room change and a move to another slot or day, each with a reason, through `storedDayCheck`; the record of a one-day change stored on its own (what it changed from and to), so that a publish can apply it again (5.6a-5); a refused restore sent again into one of the free rooms it listed, as a room change with a reason (`edge/timetable`, After publishing: "The restore can be refused, with another room offered"; 5.6a-1 decision 7).
  - Done when: each row of the "After publishing" table that concerns a room change or a move has a test.
  - From 5.2 (pull request #109, decision 13): every one-day change calls `checkCandidate` with the lesson at its new place (`mode: 'dated'`), which calls `lessonTimeProblem`; `vacation` and `outside_year` refuse a move out of the quarters.
  - From 3.6c-2 (pull request #125, decisions 11 and 12), read in 5.6a-2 (pull request #161, decision 2, Look first): a one-day change on a Tutor lesson keeps its room and time after a later `followTutors`, which writes only the teacher, and the lesson takes the new Tutor (`edge/timetable`, Structure, the Homework slot row: the teacher "is always the class's Tutor in force on the lesson's date"); a change of Tutor dated today does not move today's lessons, which change only by a one-day change.

- [x] **5.6a-3 One-day changes: bulk cancel** (5.6a split in five, pull request #160, decision 1; pull request #162)
  - Read: `06` (Changes after publishing), `edge/timetable` (After publishing, Versions and drafts).
  - Build: a bulk cancel for an event: the chosen classes, a date and slots, with a reason (`06`, Changes after publishing, Bulk cancel); the blocks shared with classes not chosen listed, each cancelled whole or kept with the chosen classes' students exempted for those slots in the same action (`edge/timetable`, After publishing, the 7 Oxford row); what a slot that cuts a double lesson does (5.6a-1 decision 4).
  - Done when: the 7 Oxford row of the "After publishing" table has a test, both choices.

- [x] **5.6a-4 One-day changes: correction of a past lesson** (5.6a split in five, pull request #160, decision 1; pull request #163)
  - Read: `06` (Changes after publishing), `edge/timetable` (After publishing, Versions and drafts).
  - Build: the correction of a past lesson one at a time by the Academic Vice Principal with a reason (`06`, How surprises are prevented: "A past lesson can only be corrected one at a time by the Academic Vice Principal, with a reason"); an unresolved lesson cancelled with a reason or its teacher recorded (`edge/timetable`, After publishing, "The lesson time passes and nobody was assigned").
  - Done when: a past lesson is corrected only by the Academic Vice Principal, one at a time, with a reason, and an unresolved lesson never counts as held.

- [x] **5.6a-5a One-day changes kept after a publish: cancels, room changes and moves** (5.6a-5 split in two, pull request #164, decision 1)
  - Read: `06` (Changes after publishing, How surprises are prevented), `edge/timetable` (Versions and drafts).
  - Build: the stored one-day cancels of one lesson, room changes and moves applied again after a publish and after a carry; the preview sorts them into kept, needs a decision and dropped, and the publish waits until every "needs a decision" item is settled ("drop the change" or "cancel the lesson that day").
  - Done when: the Versions and drafts row "A substitution and a one-day move are already recorded for a date after the new version starts" has a test (the one-day move; the substitution is 5.7b's).
  - From 5.5b-1 (pull request #152, decision 8, Look first): "stored one-day changes applied again after a publish" moved here, where they are stored. `edge/timetable`, Versions and drafts: "A substitution and a one-day move are already recorded for a date after the new version starts. One-day changes, absences, room closures and exams are stored on their own and applied again after a publish. The preview sorts them into kept, needs a decision and dropped. Publish waits until every 'needs a decision' item is settled." and "The pattern is valid but one date is not: … an earlier one-day change holding the room". Until then a publish keeps a lesson it does not change and a cancel of cause `reason` stays on a kept lesson (`writeDatedLessons`, `apps/api/src/modules/timetable/dated-lessons.ts`); a one-day move is a lesson at another time, which the publish's pairing does not keep.
  - From 5.6a-1 (pull request #160, build decision 1): a lesson with a one-day cancel of cause `reason` that `writeDatedLessons` creates again in another block keeps the cancel (`pairDated`'s `recreated`); this task brings the moves and room changes of 5.6a-2 under the same rule.
  - From 5.6a-2 (pull request #161, decision 8): the moves and room changes are stored in `lesson_day_changes` (0085), one row per lesson per change, the one in force the newest by `changed_at`, then `id`, with what the lesson was (class or group, subject, load row, date, times, room), so a row whose lesson a publish removed (`lesson_id` null) can still be sorted. Until this task a publish that creates a moved lesson's block again at its pattern time drops the move; a move stays under the lesson's version (`move_other_version`, decision 1).

- [x] **5.6a-5b-1 One-day changes kept after a publish: bulk cancels** (5.6a-5b split in two, pull request #165, decision 1)
  - Read: `06` (Changes after publishing, How surprises are prevented), `edge/timetable` (Versions and drafts, After publishing), `edge/exemptions`.
  - Build: the bulk cancels of 5.6a-3 applied again after a publish and a carry, listed once per bulk cancel in the sorting of 5.6a-5a: the new version's lessons of the chosen classes in the spans cancelled with its reason, and a block of the new version shared with classes not chosen that has no stored choice a "needs a decision" item with the bulk cancel's own two choices.
  - Done when: a bulk cancel recorded for a date after a new version starts is applied again by its publish, with a test of a shared block of the new version.
  - From 5.6a-3 (pull request #162, decision 1 and Left out): a bulk cancel is stored in `bulk_cancels` (0086) with its classes, the time each class is away by its own day (`bulk_cancel_spans`) and the choice for each shared block (`bulk_cancel_blocks`, `block_id` set null when a publish removes the block, with what the block was).
  - From 5.6a-5a (pull request #164, decision 11): the sorting leaves out a lesson cancelled with cause `reason` that a bulk cancel of its date covers at its time (`bulk_cancel_spans` of its class); until this task the write keeps such a cancel on a lesson it keeps by its pairing, and a lesson it creates is not cancelled.

- [x] **5.6a-5b-2 One-day changes kept after a withdraw** (5.6a-5b split in two, pull request #165, decision 1)
  - Read: `06` (Changes after publishing, How surprises are prevented), `edge/timetable` (Versions and drafts, After publishing), `edge/exemptions`.
  - Build: the sorting of 5.6a-5a (`sortDayChanges`, `apps/api/src/modules/timetable/day-changes-kept.ts`) and of 5.6a-5b-1 (`sortBulkOf`, `bulk-cancels-kept.ts`) for a withdraw, which writes an earlier version over the withdrawn dates (or removes their lessons when none runs again): a withdraw check route that shows the sorting (kept, needs a decision, dropped), a body with `dayChangesKey` and `dayDecisions` as the publish's, and the withdraw dialog showing them; the changes of the lessons a withdraw removes ended or recorded again, as a publish does (`settleDayChanges`), and the bulk cancels' choices recorded on its blocks (`recordBulkBlocks`).
  - Done when: a withdraw keeps or settles the one-day changes and bulk cancels of the withdrawn dates as a publish does, with a test of a move from before the withdrawn start.
  - From 5.6a-5a (pull request #164, decision 4 and review correction 2): a withdraw (`removeDatedLessons` and `writeDatedLessons`, called by `withdraw.service.ts`) reads lessons by date, not by version: it removes or rewrites a block of an earlier version kept on a date at or after the withdrawn version's start by a move from before that start (5.6a-5a decision 7), and leaves the `lesson_day_changes` rows of the lessons it removes with no lesson and no end. This task keeps or sorts such a block and those changes as the publish does.
  - From 5.6a-5b-1 (pull request #165, decision 5): a `bulk_cancel_blocks` row whose block a withdraw removes is set null and carries nothing to the block in its place, which then needs a decision; this task asks it in the withdraw's own sorting.

- [x] **5.6b-1 Calendar entries after publishing: the lessons of the changed dates** (5.6b split in five, pull request #167, decision 1)
  - Read: `edge/time-dates-calendar`, `06` (Rules, What a change does to existing data, How surprises are prevented), `edge/timetable` (Structure, Versions and drafts).
  - Build: a calendar entry saved, edited, archived or restored over published dates writes the dated lessons of every date after today whose lesson-making part of the day it changes, from the published version in force on that date: a day off removes them, a day off taken back or a school day added creates them, a special day writes them on its template and the weekday it follows, an exam week with "no regular lessons" writes them cancelled "exam week". Each date checked with the full rule set; a blocked conflict refuses the save, listed by date; lessons the day cannot hold are created cancelled and listed; the preview shows it all; teachers told, lessons marked.
  - Done when: a day off added, taken back and shortened, a special Saturday, a shortened day and an exam week each have a test over a published version.
  - From 5.6a-3 (pull request #162, review correction 2): `edge/time-dates-calendar`, "The last week of a quarter is an exam week. The calendar entry says either 'regular lessons on this template' or 'no regular lessons', which is a bulk cancel with the reason 'exam week'." An exam week set after publishing cancels its lessons through the bulk cancel of 5.6a-3 (`apps/api/src/modules/timetable/bulk-cancels.service.ts`, `bulk_cancels`, 0086), or the same path with cause `exam_week`, whichever keeps a later publish and 5.6a-5 in step.
  - The day-off half of this line: From 5.1a (pull request #107, correction 6): a day off removes the lessons of its dates (`edge/time-dates-calendar`) under a delete grant on `lessons` and `lesson_blocks` added in a migration of its own; a quarter boundary moved over future dates changes `lesson_blocks.quarter_id`, which `lesson_block_quarter_fixed` (0059) allows only for a block dated after today in the branch's time zone and whose date does not change. `lesson_block_quarter` and `lesson_block_quarter_fixed` run only on writes to `lesson_blocks`: this task adds the guard on `quarters` itself, so that a quarter date moved over a held lesson's date, or leaving a stored quarter that no longer contains a block's date, is refused by the database (`edge/time-dates-calendar`, "Quarter dates are edited after lessons exist"; `edge/00-definitions`, Quarter of a lesson).

- [x] **5.6b-2a Calendar changes: stored one-day changes and bulk cancels sorted** (5.6b-2 split in three, pull request #168, decision 1)
  - Read: `edge/time-dates-calendar`, `edge/timetable` (Versions and drafts, After publishing), `06` (Changes after publishing).
  - Build: the stored one-day changes and bulk cancels of the dates a calendar save changes, sorted into kept, needs a decision and dropped as a publish sorts them (`sortDayChanges`, `sortBulkOf`), with `dayChangesKey` and `dayDecisions` in the calendar save and its preview; a move onto a changed date from a date after today the save does not write goes back to its old place with either choice (review correction 1).
  - Done when: a day off over a stored move and over a bulk cancel, an exam week and a shortened day over a move out of the date, and a save over two versions each has a test.
  - From 5.6b-1 (pull request #167, decision 7): until this task a calendar save whose changed dates hold a one-day change in force or a bulk cancel is refused `calendar_stored_changes` (`apps/api/src/modules/timetable/calendar-lessons.ts`); this task replaces the refusal with the sorting for those two kinds.

- [x] **5.6b-2b Calendar changes: the shortened day's choice over published dates** (5.6b-2 split in three, pull request #168, decision 1)
  - Read: `edge/time-dates-calendar` ("A shortened day has 5 lesson slots"), `edge/timetable` (Versions and drafts), `edge/developer-rules`.
  - Build: the choice of which lessons of a shortened special day over published dates are kept, taken in the calendar save and its preview for the version in force and written to `timetable_day_keeps` (0074), which today a draft only may write (`pattern_rows_draft`): a migration lets a calendar save write a published version's choice for a date after today.
  - Done when: a special shortened day over published dates keeps the two lessons chosen, with a test, and the preview and the dated lessons follow the choice.
  - From 5.6b-1 (pull request #167, decision 14): `edge/time-dates-calendar`, "A shortened day has 5 lesson slots ...: The Academic Vice Principal can choose which lessons are kept": the choice is taken in the calendar save for the version in force and written to `timetable_day_keeps` (0074).

- [x] **5.6b-2c-1 Calendar changes: exams** (5.6b-2c split in two, pull request #173, decision 1)
  - Read: `edge/timetable` (Exams, Versions and drafts), `edge/time-dates-calendar`, `06` (Changes after publishing).
  - Build: a day off cancels an exam on its date and tells the Academic Vice Principal; a special template moves an exam with its slots and refuses one that drops a slot; the exam kept over the rewrite of its date, its lessons cancelled "exam" and a class kept out of a shared block.
  - Done when: a day off over an exam, a special template moving an exam and one dropping its slot each has a test, and the exam half of the refusal `calendar_stored_changes` of 5.6b-1 is gone.
  - From 5.6b-1 (pull request #167, decision 7): a calendar save whose changed dates hold an exam not cancelled is refused `calendar_stored_changes`; this task replaces the refusal.
  - From 5.1b (pull request #108, decisions 9 and 12): a day off cancels an exam on its date with `exams.cancel_cause = 'day_off'` (final, its claims removed) and tells the Academic Vice Principal; a special template for an exam's date moves the exam with its slots (`first_slot`, `last_slot`) and rechecks it, and refuses one that drops a slot of the exam (`edge/timetable`, Exams). (The year's dates moved past an exam are 5.6b-5's.)

- [x] **5.6b-2c-2 Calendar changes: a move between two stretches** (5.6b-2c split in two, pull request #173, decision 1)
  - Read: `edge/timetable` (Versions and drafts), `edge/time-dates-calendar`, `06` (Changes after publishing).
  - Build: the stored move between two stretches of one save sorted once over both.
  - Done when: a move between two stretches has a test, and the refusal `calendar_stored_changes` of 5.6b-1 is gone.
  - From 5.6b-2a (pull request #168, decision 3): a stored move whose two places lie on lesson dates of one save in two different stretches (consecutive dates written; a weekend or an unchanged date between them parts two) is refused `calendar_stored_changes`: each stretch would settle it on its own. This task sorts it once over both stretches. Since 5.6b-2c-1 it is the only case of the refusal (the test "a move between two stretches of one save" of `calendar-lessons.test.ts`).

- [x] **5.6b-3 A calendar entry that leaves school to one grade of a two-grade group**
  - Read: `edge/time-dates-calendar` ("A day off for grade 9 only, and a group joins 9 Edinburgh and 10 Brown"), `edge/timetable` (Structure), `edge/exemptions`.
  - Build: for a group of two grades, the choice per block, once for every date of the entry: cancel its lessons "day off", or keep them and exempt the grade that is off (kept lessons take the template of the grade that has school); stored and applied again by a later publish and withdraw; a lesson of the group in a slot that does not match in both templates created cancelled "not in the day's template" and listed per group.
  - Done when: both choices and the unmatched slot have a test, and a later publish keeps the choice.
  - From 5.6b-1 (pull request #167, decision 11): until this task a calendar save over published dates writes such a block as the expansion writes it, cancelled "day off" (`blockOn`, 5.5a-2a decision 4), and the test "for grade 9 only writes a group of grades 9 and 10 cancelled 'day off' (interim, until 5.6b-3)" of `calendar-lessons.test.ts` asserts that interim outcome; this task changes it.

- [x] **5.6b-4a Day template and slot length changes after publishing: the lessons** (5.6b-4 split in two, pull request #176, decision 1)
  - Read: `edge/time-dates-calendar` ("A slot type's length or a day template is changed mid-year", the Friday row), `06` (What a change does to existing data), `edge/timetable` (Exams).
  - Build: a template, an assignment or a slot length changed from a date rechecks every future date with the new times and is refused on an overlap; future lessons take the new times, held ones keep theirs; a lesson slot used by the published timetable is not removed or reordered without a new version; exams follow their slots.
  - Done when: a length change, a template change from a date and a removed slot each have a test over a published version.
  - From 1.5 (pull request #46): a length or a template change from a date rechecks every future date with the new times and is refused on an overlap; a lesson slot used by the published timetable is not removed or reordered without a new version (`edge/time-dates-calendar`, "A slot type's length or a day template is changed mid-year"; owner's answer 12).

- [x] **5.6b-4b Day template and slot length changes after publishing: the preview dialog** (5.6b-4 split in two, pull request #176, decision 1)
  - Read: `edge/time-dates-calendar` ("A slot type's length or a day template is changed mid-year", "A shortened day"), `edge/timetable` (Exams; Versions and drafts), `06` (How surprises are prevented, Impact preview), `12`.
  - Build: the template preview dialog (`template-table.tsx`, `usePreview`) shows what the change does to the published lessons from `TemplatePreview.lessons` (removed, created, cancelled, needs a teacher, notified, blocked by date), the lesson slots in use (`slotsInUse`), the exams and the shortened special dates, reusing the calendar dialog's parts (`calendar-lessons-preview.tsx`, `calendar-exams-preview.tsx`, `calendar-shortened.tsx`, `PublishDayChanges`); the choices of the stored one-day changes, the kept lessons and the exam blocks are sent with the save in `days`; the handbook page of day templates says the rule of decision 4: lesson slots are matched by their number in the day; a used number that disappears is refused, and so is one whose slot type changes in a new version of the same template; a setting that gives a grade another template is refused only for a used number it lacks; everything else takes the new times.
  - Done when: a change over a published version shows its lessons and its refusals as lines, a change with a stored one-day change saves with the key shown, and the handbook says the rule.
  - From 5.6b-4a (pull request #176, spec review of the code must-fix 3): the four saves of `day_templates` that change times refuse `template_day_changes` while a date they write holds a stored one-day change or bulk cancel, because the sorting matches a stored change to its lesson by its times; this task makes those changes follow their lessons to the new times (a cancel stays a cancel, a room change stays, a move goes to the new times of its lesson number), sorted and sent with the save in `days` as a calendar save does, and removes the refusal.

- [x] **5.6b-5a Quarter and year dates after lessons exist: the API and the database** (5.6b-5 split in two, pull request #179, decision 1)
  - Read: `edge/time-dates-calendar` ("Quarter dates are edited after lessons exist", "The academic year is extended or shortened"), `edge/00-definitions` (Quarter of a lesson), `edge/developer-rules`.
  - Build: the guard on `quarters` in the database; a boundary moves only over future dates and moves the future blocks' `quarter_id`; a shortened year removes the future empty lessons and refuses one with data; a longer year adds lessons from the version in force; year dates past an exam refused.
  - Done when: a boundary moved over future dates, one refused over a held lesson, a shortened and a longer year each have a test.
  - The quarter half of this line: From 5.1a (pull request #107, correction 6): a day off removes the lessons of its dates (`edge/time-dates-calendar`) under a delete grant on `lessons` and `lesson_blocks` added in a migration of its own; a quarter boundary moved over future dates changes `lesson_blocks.quarter_id`, which `lesson_block_quarter_fixed` (0059) allows only for a block dated after today in the branch's time zone and whose date does not change. `lesson_block_quarter` and `lesson_block_quarter_fixed` run only on writes to `lesson_blocks`: this task adds the guard on `quarters` itself, so that a quarter date moved over a held lesson's date, or leaving a stored quarter that no longer contains a block's date, is refused by the database (`edge/time-dates-calendar`, "Quarter dates are edited after lessons exist"; `edge/00-definitions`, Quarter of a lesson).
  - From 3.6b-2 (pull request #120, decision 11): when this task lets quarter dates move, the days a shorter year cuts off remove the future empty lessons and refuse a lesson with data (the list of `year_cut_holds` gains those lessons), and a longer year adds lessons from the version in force (`edge/time-dates-calendar`, "The academic year is extended or shortened"); today no lesson can lie in the days cut off, as a lesson lies inside its quarter and the quarters inside the year.
  - The year half of this line: From 5.1b (pull request #108, decisions 9 and 12): a day off cancels an exam on its date with `exams.cancel_cause = 'day_off'` (final, its claims removed) and tells the Academic Vice Principal; a special template for an exam's date moves the exam with its slots (`first_slot`, `last_slot`) and rechecks it, and refuses one that drops a slot of the exam (`edge/timetable`, Exams); a year's dates moved past an exam's date are refused, as `exam_year` runs only on writes to `exams`.

- [x] **5.6b-5b Quarter and year dates after lessons exist: the preview dialog** (5.6b-5 split in two, pull request #179, decision 1)
  - Read: `edge/time-dates-calendar` ("Quarter dates are edited after lessons exist", "The academic year is extended or shortened"), `06` (How surprises are prevented, Impact preview), `12`.
  - Build: the quarters form opens the preview (`POST setup/academic-years/:id/quarters/preview`, `QuartersPreview`) before a save over a published timetable: the lessons removed, created and cancelled, the blocks that move to another quarter, and the refusals as lines (`pastLessons`, `exams`, `splitMoves`, each with the count of the rest), reusing the calendar dialog's parts (`calendar-lessons-preview.tsx`, `calendar-exams-preview.tsx`, `calendar-shortened.tsx`, `PublishDayChanges`); the choices of the stored one-day changes, the kept lessons and the exam blocks are sent with the save in `days`; the refusal lines of `quarter_past_lessons`, `quarter_leaves_exam` and `quarter_splits_move` (the `quarterItem` of each detail) and of `year_leaves_exam` on the year form; the handbook page of the academic year says the rules of 5.6b-5a: a boundary moves only over dates without a held lesson, lessons follow the quarter dates, a longer or shorter year adds or removes lessons through its last quarter.
  - Done when: a quarter change over a published version shows its lessons and its refusals as lines, a change with a stored one-day change saves with the key shown, and the handbook says the rules.

- [x] **5.6c-1 Exams in the timetable: the exam save** (5.6c split in three, pull request #181, decision 1)
  - Read: `06` (Changes after publishing, Rules), `edge/timetable` (Exams, Versions and drafts), `edge/developer-rules`, `edge/time-dates-calendar`.
  - Build: create, change and cancel an exam through the API (`GET`, `POST timetable/exams`, `GET`, `PUT timetable/exams/:id`, `POST timetable/exams/:id/cancel`); the classes' lessons cancelled "exam" in the same save with a link to the exam (`lesson_exam_cancels`, 0094), both halves of a double; the choice for each shared block; refusal while other lessons or exams hold the rooms or the invigilators; warnings with a tick; cancelling restores only the lessons it cancelled, by the rule for a restored lesson; notices (`timetable.exam_changed`); the calendar path on the link; a publish or withdraw over a standing exam refused (`publish_over_exam`) until 5.6c-3.
  - Done when: an exam cannot be saved with a double-booked invigilator or room, and cancelling it restores the lessons.
  - From 5.1b (pull request #108): the exam tables, their claims and checks are in 0060. The save writes the exam, then its `lesson_block_class_outs` rows (a class kept out of a block shared with classes that do not sit, with its students exempted for those lessons, 8.5), then rooms, classes or groups and invigilators, with the classes' lessons cancelled with the cause `exam` in the same transaction (or the constraints deferred). This task adds the link from a lesson to the exam that cancelled it, so that cancelling the exam restores only those lessons (decision 9); checks an active invigilator, one day template for all classes, the template's slots, "from today on and only in slots that have not started", and the warnings on availability, subject and capacity (decision 10); maps the constraint names of 0060 to error codes and `40P01`, `40001` to `timetable_busy`.
  - From 5.2 (pull request #109, decisions 7 and 16, correction 2): the exam is a placement of kind `exam` for the engine; its invigilator rules (`invigilator_vacancy`, `invigilator_inactive` blocked; `invigilator_unavailable`, `invigilator_subject` warnings with a tick) and `room_capacity` against the students of its classes come from `checkTimetable`; the consecutive slots of its own time are checked here.
  - From 5.6b-5a (pull request #179, decision 12): exams store no quarter, so a quarter boundary moved over a standing exam's date puts it in another quarter; the link of a quarter's rating exam reads the quarter of the exam's date. The exam save locks the year `for share` before it writes, as every lesson writer does, so it never reads quarter or year dates a save is changing; 0093 (`exams_year_commit`) refuses an exam outside its year at the commit. A quarter save refuses a standing exam on a date it takes out of every quarter (`quarter_leaves_exam`).

- [x] **5.6c-2 Exams in the timetable: the screens** (5.6c split in three, pull request #181, decision 1)
  - Read: `06` (Changes after publishing, Exam), `edge/timetable` (Exams), `12`.
  - Build: the exams of a date for the Academic Vice Principal: the form (date, lessons, title, subject, rooms with their classes or groups and invigilators), the check route (`POST timetable/exams/check`: what a save would do, writing nothing) and its dialog with the choices of the shared blocks, the tick of the warnings and the refusal lines; the cancel with the lessons kept cancelled and the free rooms offered; exams on the class day page marked "exam"; the notice `timetable.exam_changed` shown with the invigilation and the action.
  - Done when: an exam is made from the page over a shared block with its choice, and cancelled with a lesson kept cancelled.
  - From 5.6c-1 (pull request #181, decision 14): the check route moved here from 5.6c-1, its one user; the 409 details of the save (`exam_block_choice`, `exam_blocked`, `exam_warnings`, `exam_restore_blocked`) list the same items.
  - From 5.6c-1 (pull request #181, decision 2): the notice's text names no action today; the screen shows `action` and `invigilation` of its data in the three languages.

- [x] **5.6c-3a Exams in the timetable: the exam kept after a publish and a withdraw** (5.6c-3 split in two, pull request #183, decision 1)
  - Read: `06` (Changes after publishing, Exam), `edge/timetable` (Exams, Versions and drafts).
  - Build: the exam kept after a later publish, each carried run and a withdraw (the new version's lessons of its classes in its slots cancelled "exam" with the link, the lessons of its invigilators and rooms "needs a decision" in the preview); the out rows of a block a publish removes; `publish_over_exam` of 5.6c-1 replaced by the sorting.
  - Done when: a publish over a standing exam keeps it, with its lessons cancelled again and a clash listed as "needs a decision".
  - From 5.6c-1 (pull request #181, decision 5): until this task a publish or withdraw that would create, remove or change a lesson of a standing exam's classes at its time, or a block it keeps a class out of, is refused `publish_over_exam` (`exam-guard.ts`, called by `writeDatedLessons` and `removeDatedLessons`); this task replaces it.
  - From 5.5b-1 (pull request #152, decision 8): `edge/timetable`, Exams: "An exam is stored on its own like a one-day change and kept after a later publish: the new version's lessons of its classes in its slots are cancelled with the reason 'exam' as at creation, and a lesson of an invigilator or in an exam room at that time is a 'needs a decision' item in the preview." The publish's write (`writeDatedLessons`) keeps a cancel of cause `exam` on a lesson it keeps, but creates new lessons not cancelled, and `lesson_block_class_outs_block_fkey` (0060) has no delete action, so a publish cannot remove a block that holds an exam's class out: this task decides what a publish does with both.
  - From 5.6a-5a (pull request #164, decision 3): the exam kept after a later publish joins the sorting of 5.6a-5a (`sortDayChanges`, `apps/api/src/modules/timetable/day-changes-kept.ts`) as an item of its own (kept, needs a decision, dropped) with its choices, in the same preview and the same `dayDecisions` of the publish; the sorting already places the branch's exams of a date (`examsOn`) when it checks a kept change.

- [x] **5.6c-3b Exams in the timetable: the calendar notices, the rating-exam link** (5.6c-3 split in two, pull request #183, decision 1)
  - Read: `06` (Changes after publishing, Exam), `edge/timetable` (Exams), `edge/calculation` (the rating exam).
  - Build: the invigilators' notices on the calendar path; the rating-exam link of an exam (stored, with the journals linked and not linked, and its part of the exam form).
  - Done when: a calendar save that moves an exam tells its invigilators, and an exam linked to the rating exam lists the journals linked and not linked.
  - From 5.6c-1 (pull request #181): `edge/timetable`, Exams, "The exam is the quarter's rating exam": "An exam can be linked to the rating exam of the journals of its subject whose students all belong to its classes ... A group journal with students outside the exam is listed and not linked; its teacher sets the date by hand. The linked journals' rating exam date is the exam's date." This task stores the link and lists the journals linked and not linked; 8.2 reads the date (From line there).
  - From 5.6b-2c-1 (pull request #173, decisions 4 and 8): `06`, Exam: "It is shown on every timetable view and printout, marked 'exam', and the affected staff are notified as for a one-day change". A calendar save that cancels an exam for a day off tells the Academic Vice Principals (`timetable.exam_day_off`), and one that moves an exam with its slots tells nobody of the exam: its invigilators are told by this task's notices, on the calendar path too (`apps/api/src/modules/timetable/calendar-exams.ts`). The calendar save reads `first_slot` and `last_slot` as positions of the day's slots (`pattern_blocks.slot_position`, breaks counted), each a lesson slot; the exam save writes them the same way. The calendar save takes a class out of a shared block again by the exam's stored out row, and holds again a lesson cancelled "exam" that no standing exam covers (by cause and time, without this task's link).
  - From 5.6c-3a (pull request #183): the calendar path checks an exam with the version's facts, which name only the teachers of its rows; a publish adds the standing exams' invigilators as extra teachers (`invigilatorsOf` of `exams-kept.ts`), and the calendar path should too before it rechecks an exam whose invigilator teaches no row.

- [x] **5.7a-1 Teacher absence: absences** (5.7a split in three, pull request #185, decision 1)
  - Read: `06` (Changes after publishing, Teachers who work in several branches), `04` (Teacher and staff record), `edge/timetable` (Versions and drafts, After publishing), `edge/people-roles-accounts` (Staff over time), `07` (Closing a quarter, Who can do what), `09` (When something else changes).
  - Build: an absence entered once for the person, covering every branch; "needs a teacher" and "unresolved" lessons on the Academic Vice Principal's home page; the notice to every branch of the person; the absence kept after a publish and a withdraw.
  - Done when: an absence entered in one branch reaches the Academic Vice Principal of the other.
  - From 3.6c-2 (pull request #125, decision 11): an absence on a Tutor lesson is kept by a later `followTutors`, which must not give the lesson back to the absent Tutor; the inactive status of a Tutor sends the Tutor lessons from its date to "needs a teacher" (a `left` already does, through the end of the Tutor role).
  - From 5.6a-4 (pull request #163, decision 11): `lessonStateOf` (`packages/shared/src/timetable.ts`) is the one place of a lesson's state (upcoming, needs a teacher, held, unresolved, cancelled); this task gives it the absence: a lesson of an absent teacher with no substitute keeps its teacher and is "needs a teacher", then "unresolved" (`edge/timetable`, After publishing, "The lesson time passes and nobody was assigned": "It never counts as held, and never as 'attendance not marked' against the absent teacher"); the home page's "unresolved" list reads it. A past lesson is settled through the correction (`POST /api/timetable/lessons/:id/correction`, `day-changes.service.ts`).
  - From 5.6a-5a (pull request #164, decision 3): an absence and a room closure are stored on their own and applied again after a publish (`edge/timetable`, Versions and drafts): they join the sorting of 5.6a-5a (`sortDayChanges`) as items (kept, needs a decision, dropped), with a test of each.

- [x] **5.7a-2a Teacher absence: status, lock and the invigilator** (5.7a-2 split in two, pull request #186, decision 1)
  - Read: `06` (How surprises are prevented), `edge/people-roles-accounts` (Staff over time), `edge/timetable` (After publishing, Exams), `09` (When something else changes).
  - Build: a teacher inactive or left from a date, or whose account is locked, keeps the lessons and makes them "needs a teacher" (Staff over time: "'Lock now' ... The teacher's future lessons go to 'needs a teacher'"; the lock itself came with 2.3c-1, pull request #65); the Tutor's inactive status; the future lessons listed in every branch; "needs an invigilator" for exams, an absent invigilator included.
  - Done when: a locked teacher's future lessons are "needs a teacher" in every branch.
  - From 3.6c-2 (pull request #125, decision 11): the inactive status of a Tutor sends the Tutor lessons from its date to "needs a teacher" (a `left` already does, through the end of the Tutor role).
  - From 5.5b-1 (pull request #152, review correction 1): a leaving does not yet touch a teacher's regular lessons; a leaving that commits while a publish writes leaves the publish's regular lessons after the leaving with the teacher, and this task lists them like any other future lesson of the leaving (`06`, How surprises are prevented, "No lesson without a teacher or room"). The publish already writes a lesson after a leaving known when it runs with no teacher (`teacher_out`).
  - From 5.6c-1 (pull request #181, decision 18; the invigilator half): `edge/timetable`, Exams, "An exam room is closed, an invigilator falls ill, the date becomes a day off": "A room closure, an absence and a day off act on an exam as on a lesson: 'needs a room' and 'needs an invigilator' on the Academic Vice Principal's home page, settled from the Free now board with no journal involved."
  - From 5.7a-1 (pull request #185, decisions 3 and 7; the teacher half): an absence writes no lesson; the state of a lesson reads it through `absences_of_teachers` (0096, `absences-read.ts`), and the home page's lists are `GET /api/timetable/attention`: an inactive, left or locked teacher and an exam that needs an invigilator join those lists and `lessonStateOf` there. An absent invigilator is read the same way.

- [x] **5.7a-2b Teacher absence: room closure** (5.7a-2 split in two, pull request #186, decision 1)
  - Read: `06` (How surprises are prevented), `edge/timetable` (After publishing, Versions and drafts, Exams), `03` (the room row of the setup table), `09` (When something else changes).
  - Build: the room closure (start, end, reason); its lessons "needs a room" on the home page, in every branch that holds them; "move all to room R for the period"; the closure in the sorting of a publish and a withdraw; "needs a room" for exams; what a room's status `under_repair` or `closed` does to its lessons.
  - Done when: a closed room's lessons are "needs a room", and "move all" moves them for the period.
  - From 5.6a-5a (pull request #164, decision 3; the room-closure half): a room closure is stored on its own and applied again after a publish (`edge/timetable`, Versions and drafts): it joins the sorting of 5.6a-5a (`sortDayChanges`) as an item (kept, needs a decision, dropped), with a test of it.
  - From 5.6c-1 (pull request #181, decision 18; the room half): `edge/timetable`, Exams: "A room closure, an absence and a day off act on an exam as on a lesson: 'needs a room' ... on the Academic Vice Principal's home page, settled from the Free now board with no journal involved."
  - From 5.7a-1 (pull request #185, decisions 3 and 7; the room half): "the home page's lists are `GET /api/timetable/attention`: ... a closed room and an exam that needs a room ... join those lists and `lessonStateOf` there".
  - From 5.7a-2a (pull request #186): a person away is read through `teachers_away` (0097, `away-read.ts`); `GET /api/timetable/attention` answers `needsTeacher`, `unresolved` and `needsInvigilator`, and a "needs a room" list joins them there.

- [x] **5.7a-3a Teacher absence: vacancy fill, the fill and the close** (5.7a-3 split in three, pull request #188, decision 1)
  - Read: `06` (Changes after publishing, Filling a vacancy; What a change does to existing data; How surprises are prevented), `edge/timetable` (Versions and drafts; After publishing, the vacancy rows), `04` (Vacancy), `09` (When something else changes).
  - Build: the fill on the server: `POST /api/timetable/vacancy-fills/check` and `POST /api/timetable/vacancy-fills`, a version that differs from the live one only in the teacher of the rows published from the date (or the change carried in place into a version that starts on it), every later published version naming the vacancy changed from its own start, the rows the person cannot take left with the vacancy and listed; the vacancy closed from the fill date when nothing holds it; the fills kept for the vacancy's history.
  - Done when: a filled vacancy's lessons from the fill date have the hired teacher, and a vacancy with no load left is closed.
  - From 5.5c-2b (pull request #157, review correction 3): `06`, Filling a vacancy: "A vacancy with no load left is closed." The close reads `vacancy_close_holders` (0083) and stays as narrow as it is: a later published version counts as started only from its start day, so a fill from tomorrow cannot close the vacancy in its own step (until the fill's version starts it can still be withdrawn and the earlier rows hold); this task decides when such a vacancy is closed. A write that puts a lesson under a staff record (`lessons.teacher_id`: the fill, an absence that gives lessons back) refuses a closed vacancy; nothing in `lessons_check` reads the teacher's status today, and only a publish writes the column now, through rows that `load_teacher_status` checks.
  - From 5.7a-1 (pull request #185, decision 7): the absence half of the From line of 5.5c-2b is void: an absence writes no `lessons.teacher_id` and gives back no lesson by a write.

- [x] **5.7a-3b Teacher absence: vacancy fill, the screen** (5.7a-3 split in three, pull request #188, decision 1)
  - Read: `06` (Filling a vacancy; How surprises are prevented, Impact preview), `04` (Vacancy), `12`.
  - Build: the fill dialog on the vacancy's record: the person, the date (tomorrow at the earliest, the starts of later versions offered), all rows or the chosen ones, the check's rows with the ones left and why, the publish's impact preview, chain and stored one-day changes with their decisions, then the fill; the vacancy's history of fills (date, person, rows, withdrawn); a close planned from a later day shown on the record and in the list; the handbook page.
  - Done when: the Academic Vice Principal fills a vacancy from its record and sees the rows left and the close.
  - From 5.7a-3a (pull request #188, decisions 3, 5 and 11): the check answers `rows` (each `filled`, `reason` `blocked` or `profile`, `dates`), `rowsKey`, `inPlace`, `publish` (the publish check of the fill's run, `null` with no row filled), `closes` and `holders`; the fill takes the check's body with `rowsKey` and the publish's keys and decisions; `GET /api/people/vacancies/:id` answers `fills`, and a planned close is a `closed` status row from a later day.

- [x] **5.7a-3c Teacher absence: the acting teacher** (5.7a-3 split in three, pull request #188, decision 1)
  - Read: `edge/timetable` (After publishing, "A vacancy lasts a quarter: who writes the plan and grades?", "The plan, the journal and the reports of a vacancy's subject"), `07` (Who can do what), `09` (When something else changes).
  - Build: an acting teacher named for a vacancy's journal for a period, stored, by the Academic Vice Principal; who owns the plan, adds works and enters the rating exam in that period (read by 7.x and 8.x through From lines this task writes); the closing checklist's "no teacher" without one; the period ends at the fill date.
  - Done when: an acting teacher is named for a vacancy's journal for a period and the From lines to 7.x and 8.x say what they read.
  - From 5.7a-3a (pull request #188, decision 16): when the vacancy is filled, the hired teacher becomes the owner from the fill date (`edge/timetable`: "When the vacancy is filled, the hired teacher becomes the owner from that date"), read from `vacancy_fills` and `vacancy_fill_rows`; an acting teacher's period ends there.

- [x] **5.7b-1 Substitution: the substitution of a lesson** (5.7b split in three, pull request #191, decision 1)
  - Read: `06` (Changes after publishing), `edge/timetable` (After publishing).
  - Build: the one Substitution action started from a lesson (both halves of a double, one part of a block alone); suggestions ordered by subject, department and language; the substitution record; the exception "no teacher of the subject is free"; the withdrawal; the correction's record; the substitute's rights on that lesson through the lesson's teacher (From lines to 6.3, 7.1b, 8.4, 8.7, 8.8 and 5.7c).
  - Done when: the exception "no teacher of the subject is free" works as the edge case says.
  - From 5.2 (pull request #109, decision 17, correction 3): a substitute is a placement with `substitute: true`; `substitute_language` is a warning that needs a confirmation, `substitute_vacancy` blocks, and the option `noSubjectTeacherFree` of `checkTimetable` turns `teacher_subject`, `teacher_grade` and `teacher_unavailable` of the substitute's own lesson (`substitute: true`, `mode: 'dated'`) into warnings with a tick; every other lesson keeps them blocked, and double booking stays blocked.
  - From 3.6c-2 (pull request #125, decision 11): a substitution on a Tutor lesson is kept by a later `followTutors`; the substitute of a Tutor lesson needs the subject in the profile like any substitute (`teacherProblems` skips the profile rule for the class's Tutor only).
  - From 5.5c-2b (pull request #157, review decision 10): a substitution never puts a vacancy on a lesson (`substitute_vacancy` blocks), so it needs no check of a closed vacancy; the writes of `lessons.teacher_id` that do (a fill, an absence that gives lessons back) refuse a closed vacancy by the From line of 5.7a.
  - From 5.6a-4 (pull request #163, decision 14): the person recorded as having taught a past lesson (a correction of kind `teacher`, audit entry `lesson.correct`) becomes the lesson's teacher with no substitution record; this task brings those corrections under its records (who was replaced, by whom, why), read from the `lesson.correct` entries, and gives the person recorded the substitute's edit period for that column.

- [x] **5.7b-2 Substitution: from an absence or a vacancy** (5.7b split in three, pull request #191, decision 1)
  - Read: `06` (Changes after publishing, Substitution; Teachers who work in several branches, Absence), `edge/timetable` (After publishing).
  - Build: the substitution started from a teacher: the absence's lessons with suggestions for each, one substitute per journal for the whole absence in one action, each date still checked (blocked dates listed, the rest saved); the per-journal substitution of a vacancy's journal offered with its acting teacher in force; the absence's lesson list showing substituted lessons; shortening or withdrawing an absence returns its future substituted lessons to the teacher; the absence screen.
  - Done when: `edge/timetable`, After publishing, "A teacher is ill for weeks with no return date" has a test of each sentence: "One substitute can be assigned per journal for the whole absence in one action, each date still being checked. Shortening the absence returns future lessons to the teacher."
  - From 5.7b-1 (pull request #191, decision 6; review correction 2): until this task a substituted lesson of an absent teacher drops out of `GET /api/timetable/absences/:id/lessons` (it filters by the lesson's teacher), and shortening or withdrawing an absence leaves its substituted lessons with their substitutes. A substitution is a record of `substitutions` with its rows in `substitution_lessons` (0101; the source adds `absence` and `journal` here), its substitute written into `lessons.teacher_id`, read in force with `substitutionsInForce` and ended with `endSubstitutionRows` (`apps/api/src/modules/timetable/substitutions-read.ts`); a lesson is checked with its substitute through `storedDayCheck`'s `substitutes`, and the suggestions through its `candidates` (`TimetableSubstitutions`, `substitutions.service.ts`).
  - From 5.7a-3c (pull request #190, decision 1 with review correction 4): `edge/timetable`, After publishing, "A vacancy lasts a quarter": "names an acting teacher for the journal for a period, as a substitute per journal for an open-ended absence". Naming an acting teacher puts nobody on the lessons: until a substitute is set, the vacancy's lessons stay in `needsTeacher` of `GET /api/timetable/attention`. The per-journal substitution of a vacancy's journal is offered with its acting teacher in force (`journalOwnerOn` (`apps/api/src/modules/timetable/journal-owners.ts`: the teacher of the journal's row in the published version in force that day; under a vacancy the acting teacher in force (`journal_acting_teachers`, 0100, counted only on days the row names the vacancy and the person is active in the branch), else `none`)), each date still checked.
  - From 5.7a-1 (pull request #185, review correction 3): `edge/timetable`, After publishing, "One substitute can be assigned per journal for the whole absence in one action, each date still being checked". The absence's lessons are read through `absences_of_teachers` (0096) and `GET /api/timetable/absences/:id/lessons`; a substitute on a lesson of an absent teacher makes `lessonStateOf` give `held` / `upcoming` again (the lesson is no longer "needs a teacher").

- [x] **5.7b-3 Substitution: substitutions kept after a publish** (5.7b split in three, pull request #191, decision 1)
  - Read: `06` (Changes after publishing, Filling a vacancy), `edge/timetable` (Versions and drafts, After publishing).
  - Build: the substitution as an item of the stored one-day changes sorted by a publish, a withdraw, a vacancy fill and a calendar, template or quarter change (kept, needs a decision, dropped), with its preview lines.
  - Done when: `edge/timetable`, Versions and drafts, "A substitution and a one-day move are already recorded for a date after the new version starts" has the test of its substitution half.
  - From 5.7b-1 (pull request #191, decision 6; review corrections 1 and 2): until this task every write of dated lessons (`writeDatedLessons` and `removeDatedLessons`, `apps/api/src/modules/timetable/dated-lessons.ts`: a publish, a withdraw, a vacancy fill's publish or carry, a calendar, template or quarter change) that gives a substituted lesson another teacher or removes it ends its row of `substitution_lessons` with cause `dropped` and lists it in its audit entry (`substitutionsDropped`); the substitute is taken off with no item in the preview. This task adds what the lesson was to `substitution_lessons` (class or group, subject, load row, pattern entry and the date of its pattern block, `patternDateOf`), so a dropped or removed lesson is found again. `06`, Filling a vacancy: "lessons already held under a substitute stay recorded under the substitute"; a future substitution of a vacancy's lesson after the fill date is sorted here.
  - From 5.7b-2 (pull request #192, decisions 3 and 4): a record now carries `absence_id` (the absence it was made for) and `journal_id` (sources `absence` and `journal`), and `relaxed` is kept per lesson on `substitution_lessons` (0102); a substitution kept by a publish keeps its row's `relaxed` and its absence link, so a later shortening of the absence still returns it.
  - From 5.6a-5a (pull request #164, decision 3): `edge/timetable`, Versions and drafts, "A substitution and a one-day move are already recorded for a date after the new version starts": the substitution record joins the sorting of 5.6a-5a (`sortDayChanges`) as an item (kept when the new version has the lesson and the substitute passes the rules there, needs a decision, dropped), with the test of the substitution half of that row.

- [x] **5.8a Version history and restore** (5.8 split in three, pull request #194, decision 1, Look first)
  - Read: `06` (Protection), `03` (Quarters), `edge/timetable` (Versions and drafts), `edge/academic-year`.
  - Build: the version history of a year in the order of start dates with the version in force on the first day of each quarter; the comparison of two versions; reopening an old version as a new draft, every copy taking its pattern.
  - Done when: Protection rule 3 ("Version history shows every version in the order of their start dates, names the version in force on the first day of each quarter, compares two versions, and can reopen an old one as a new draft") has a test of each of its four parts, and a restored version with an archived teacher and a closed room lists those entries in "To place" with their reason (`edge/academic-year`).
  - From 5.4b-2a (pull request #133, decision 3): reopening an old version as a new draft ("Restore an earlier version") copies its pattern too; entries whose teacher, room, subject or class is no longer active go to the "to place" list with the reason (`edge/timetable`, Versions and drafts; `edge/academic-year`). The panel is `GridToPlace` (`apps/web/src/features/timetable/grid-to-place.tsx`); today a copy takes the load and the pins only.
  - From 5.4c-3a (pull request #137, decision 12): a pattern copied into a new draft gives each double pair a new `double_pair_id` (0058 `pattern_blocks_double` counts a pair across all versions, so a copied id is refused).
  - From 5.5a-3a (pull request #145, decision 4): every copy of a version, not only a restore, takes its pattern, so that a fix drafted from a version keeps its placement and "carry the change into them" is offered (`carryChanges`, `packages/timetable-rules/src/carry.ts`, compares entries by load row, weekday and slot position).

- [x] **5.8b Protection of dated lessons and their forced delete** (5.8 split in three, pull request #194, decision 1, Look first)
  - Read: `06` (Protection, What a change does to existing data), `edge/timetable` (After publishing), `edge/00-definitions` (Data on a lesson).
  - Build: a dated lesson's class, group and subject never change and a lesson with data is never deleted (tested in the database and through every writer of dated lessons); a teacher, room or time change of a lesson logged with who, when, before and after; the Super Admin's forced delete of a dated lesson with a typed reason, kept 30 days and restorable. Until 6.1 adds the cells no lesson holds data (`edge/00-definitions`, Data on a lesson): this task plans one place that answers "the lesson holds data", which 6.1 fills, and adds a From line to 6.1 for the cells kept by a forced delete.
  - Done when: Protection rules 1, 2 and 4 each have a test.
  - From 5.1a (pull request #107, correction 6): the forced delete of a dated lesson needs a delete grant on `lessons` and `lesson_blocks` (0058 gives none), added with its guard in a migration of its own.

- [x] **5.8c Forced delete of a building, floor or room** (5.8 split in three, pull request #194, decision 1, Look first)
  - Read: `03` (Building, floor, room), `06` (Protection).
  - Build: the Super Admin's forced delete of a building, floor or room that nothing references, with a reason, an audit entry and 30 days to restore, on the store and restore of 5.8b (not a second mechanism); a referenced one stays archive-only.
  - From 2.7 (pull request #77, decision 2; issue #39, item 6): the same forced delete for a building, floor or room that nothing references (`03`, Building, floor, room; spec change of 13 October 2026), with a reason, an audit entry and 30 days to restore; a referenced one stays archive-only.

- [x] **5.9a Timetable views** (5.9 split in three, pull request #197, decision 1, Look first)
  - Read: `06` (Views and outputs, Teachers who work in several branches, How surprises are prevented), `02`, `edge/timetable` (Structure, Exams).
  - Build: class, teacher, room and branch views by day and by week from the dated lessons, in the scope of each role; the "changed" mark; exams marked "exam"; the version in force and its "valid from"; a teacher's lessons in other branches as grey blocks; a clock axis on teacher and room views when more than one template is in force.
  - Done when: each role's scope of `06`, Views and outputs, has an allow and a refuse test, and the changed mark and an exam are shown on every view that holds the lesson or exam.
  - From 5.5c-3a (pull request #158, decision 2): the "changed" mark shown on the class, teacher, room and branch views and on the teacher home page (`06`, How surprises are prevented: "Changed lessons carry a 'changed' mark on every timetable view for a week"): a lesson is marked while `isMarkedChanged` (`packages/shared/src/timetable.ts`) is true for its `lesson_changes.changed_at` (0084) and the clock of the request.
  - From 5.6c-1 (pull request #181, decision 15): `06`, Exam: "It is shown on every timetable view and printout, marked 'exam'"; `edge/timetable`, Exams, "Who sees exams, and what they count for": "Every timetable view and print shows exams for its class, teacher or room ... Invigilations are listed in the load report apart from lessons and count for no journal, no plan and no discipline figure." The exams are read by `GET timetable/exams` (`examsOf`, `exams.service.ts`); 5.6c-2 shows them on the class day page only. The print half goes to 5.9c; the load report half to 9.3b (pull request #197, decision 3, Look first).

- [x] **5.9b Teacher home page** (5.9 split in three, pull request #197, decision 1)
  - Read: `06` (Views and outputs, Teachers who work in several branches: Home page), `08` (Home pages by role).
  - Build: the home page of every role that teaches (Teacher, Head Teacher, Senior Head Teacher, Tutor): today's lessons from all branches together in time order, each labelled with its branch (period, time, class or group, subject, room, the journal button once 6.2 exists), and the week as a table; the changed mark; exams the person invigilates. Needs one cross-branch read of the person's own lessons, which carries class, subject and room names of another branch (a `SECURITY DEFINER` function in a migration of its own).
  - Done when: a teacher of two branches sees both branches' lessons of today in time order, each with its branch, with no branch switch.

- [x] **5.9c-1 Print, PDF and Excel of the timetable views** (5.9c split in two, pull request #199, decision 1, Look first)
  - Read: `06` (Views and outputs, How surprises are prevented: One source, Exam), `edge/timetable` ("The wall timetable is out of date", Exams), `edge/system-behaviour`, `13` (Exports), `docs/design-system.md` (Printouts and PDFs).
  - Build: print, PDF and Excel of one class, one teacher, one room or the whole school by day or by week, in the scope of 5.9a; a printed day or week includes the one-day changes with an "as of" time, each day's version and "valid from", and "one-day changes not included" on a day read from its pattern; exams marked "exam"; every file logged and following the role; PDFs made on the server by headless Chromium with the Golos Text files embedded. Only the PDF library is a new dependency (Look first).
  - Done when: exported PDFs show Uzbek Latin and Cyrillic correctly.

- [x] **5.9c-2 Print of a timetable version** (5.9c split in two, pull request #199, decision 1, Look first)
  - Read: `edge/timetable` ("The wall timetable is out of date"), `06` (How surprises are prevented: One source), `docs/design-system.md` (Printouts and PDFs).
  - Build: the PDF and Excel of a version's weekly pattern from the versions page under the area `timetable`, on the renderer of 5.9c-1: a published version carries its number, "valid from", the print time and "one-day changes not included"; a draft is marked DRAFT; every file logged. The `export` action on `timetable` for the roles that view drafts is this task's own Look first decision.
  - Done when: a draft print reads DRAFT and the PDFs show Uzbek Latin and Cyrillic correctly.
  - From 5.6c-1 (pull request #181, decision 15; the print half, pull request #197): `06`, Exam: "It is shown on every timetable view and printout, marked 'exam'"; `edge/timetable`, Exams, "Who sees exams": "Every timetable view and print shows exams for its class, teacher or room". The printed views of 5.9c-1 show them; a weekly pattern holds no exam, which is dated.
  - From 5.9c-1 (pull request #199, decision 4): the test environment has no Chromium; until the owner gives it one (a larger plan or another runtime, issue #42), its PDFs answer "not available" and Excel works.

- [x] **5.12a Named cases and generated tests** (5.12 split in three, pull request #201, decision 1, Look first)
  - Read: `14` (Timetable), `edge/developer-rules`, `edge/timetable` (Structure).
  - Build: the generated test of `14` against the database (random dated lessons, pattern entries and edits; the constraints refuse exactly the clashes of a model); the publish preview checked against what the publish writes and leaves alone; the membership routes answering a student put into two lessons of one block with a code of their own; one index of the named cases of `14` and the tests that prove each.
  - Done when: the generated tests and the preview check pass in CI, and each named case of `14`, Timetable, points to a passing test.

- [x] **5.12b Simultaneous actions and the browser walk** (5.12 split in three, pull request #201, decision 1, Look first)
  - Read: `14` (Timetable, Whole system), `06` (Protection), `03` (Building, floor, room).
  - Build: a room's forced delete at the same moment as each writer that names a room (a room closure, an exam room, a load row, a class's home room, a pattern entry), in both orders, each writer answering 404 `not_found` for a room deleted while it waited; one browser run that builds a draft (load, placement), publishes it and opens the published week.
  - Done when: each pair has a test in both orders, and the browser walk passes in CI.
  - From 5.8c (pull request #196, not sure): a room's forced delete takes the publish lock first, so the writers of dated lessons and the one-day room change wait and then read the room again (404). The other writers that name a room (a room closure, an exam room, a load row, a class's home room, a pattern entry) read the room without a lock before they write its key: a forced delete of that room committed in between gives them a foreign-key error (500). A simultaneous-actions case of this task runs each against a room's forced delete and maps the error to `not_found`.

- [x] **5.12c The real-size run** (5.12 split in three, pull request #201, decision 1, Look first)
  - Read: `14` (Whole system: Speed tests), `12` (speed targets).
  - Build: the run of the owner's lines below, on invented data, by a script the report names.
  - Done when: the run's report (the board, the publish and a journal page timed; the timetable checked by the rule engine with no blocked result) is in the pull request.
  - From the owner (15 October 2026): one run at the real school's size on invented data (3 branches, about 80 classes, 200 teachers and 2,000 students, with groups, splits and teachers shared between branches): generate, check with the rule engine, publish a version and open the board; the report gives the solver's time, the lessons it could not place, and the time of the board, the publish and a journal page.
  - From the owner (20 October 2026): generation (5.10, 5.11) moved after the release of 25 October. Until then the real-size run places its timetable with a seed script on the same invented data, checks it with the rule engine and goes on from the publish; 5.11 adds the generate step and the solver's time to this run.

- [x] **5.12d The publish at the real size** (5.12c split, pull request #203, decision 9, Look first)
  - Read: `14` (Whole system: Speed tests), `edge/developer-rules` (Class in one block), `06` (Publishing).
  - Build: the publish of a branch at the school's size. The real-size run of 5.12c stops at the first publish with "out of shared memory": the deferred trigger `lessons_block_students` (0058) and `timetable_lock_block` (0060) take one advisory lock per dated lesson block, and one branch's year is about 30,000 blocks in one transaction, more than PostgreSQL's lock table holds at `max_locks_per_transaction` 64 (64 × 100 connections). Either fewer locks in a migration that keeps the rule (a block's writers still checked one after the other), or the setting raised on every database server (the owner's: production). Then the run from the publish on.
  - Done when: `REAL_SIZE=full pnpm --filter @sodiq/api exec vitest run real-size` passes (every branch published, the published boards with no blocked result, the shared teachers' travel time kept) and its report is in the pull request.

## Phase 6. Journal: model, grid and attendance

- [x] **6.1a Cells, versions and history** (6.1 split in three, pull request #205, decision 1, Look first)
  - Read: `07`, `edge/journal`, `edge/developer-rules`.
  - Build: cells unique on lesson, student and work, each with a version number; history per cell; who is expected in a lesson on its date; `lesson_holds_data` reading the cells and works; a lesson whose rows hold no data still removed.
  - Done when: a stale save is refused and history records who changed what.
  - From 2.4b-1 (pull request #68): every table of student data (cells, attendance, comments) references `students` with no action, never `on delete cascade`, so the key refuses the delete of a student with data whatever the branch filter sees; the service of the delete maps `23503` on such a key to `student_has_data` (`edge/students-classes-groups`: "A student is created twice by mistake").

- [ ] **6.1b-1 The writers of dated lessons keep lessons with data** (6.1b split in two, pull request #206, decision 1, Look first; merged before 6.3, decision 12 of #205)
  - Read: `06` (Protection, What a change does to existing data, How surprises are prevented), `edge/timetable` (After publishing, Versions and drafts), `edge/time-dates-calendar` (The academic year is extended or shortened), `edge/00-definitions` (Data on a lesson).
  - Build: `writeDatedLessons` and `removeDatedLessons` (`apps/api/src/modules/timetable/dated-lessons.ts`) with lessons that hold data (`lesson_holds_data`, 0108): kept and listed, a lesson moved in time by a rewrite of its own version changed in place.
  - Done when: every From line below has its test, with cells written by `saveCells` (`apps/api/src/modules/journal/cells.ts`).
  - From 5.5b-1 (pull request #152, decision 9): the cells' key to `lessons` has no action, so a lesson with data is never deleted; `writeDatedLessons` (`apps/api/src/modules/timetable/dated-lessons.ts`) then keeps a lesson with data that the new version would remove, and lists it in its audit entry and the preview (`06`, What a change does to existing data: "Removed, if they hold no data"; "Earlier version restored … Lessons that already hold data are kept and listed"; Protection: "A dated lesson that already has attendance or marks cannot be deleted").
  - From 5.8b (pull request #195, decision 2, Look first), the part of the writers: `lesson_holds_data(uuid)` (0105) is the one place that answers "the lesson holds data" (`edge/00-definitions`, Data on a lesson), and `lessonsHoldingData` (`apps/api/src/modules/timetable/lesson-data.ts`) reads it in code. The two route tests of 5.8b that expect `lesson_holds_data` from a withdraw and a publish (`lesson-protection.test.ts`) and the database tests with a stand-in function are replaced by "kept and listed" (the From line of 5.5b-1 above); the forced-delete database tests keep the stand-in until 6.1b-2.
  - From 5.8b (pull request #195, writer tests, Look first): a day template, slot or calendar change that moves a lesson in time removes it and creates it again with a new id (`pairDated` pairs only on the same start and end, `dated-lessons.ts`; `lesson-protection-writers.test.ts` asserts it today). Once `lesson_holds_data` reads the cells, such a change over a lesson with data would be refused (`lesson_holds_data`); `06`, Protection: "Its teacher, room and time can change, with a log entry". This task makes a lesson moved in time by those writers keep its id and change its times in place (the history writes the line), with a test that moves a lesson holding data and finds its cells on it.
  - From 5.12a (pull request #201, decision 4): `14`, Timetable, Generated tests: "after each, the tests check ... that lessons with data were not lost". The generated test of the database (`claims-generated.database.test.ts`) puts random cells on its lessons once `lesson_holds_data` reads them, and asserts after each edit that no lesson holding data was removed.

- [ ] **6.1b-2 Cancels and the forced delete over lessons with data** (6.1b split in two, pull request #206, decision 1, Look first; merged before 6.3, decision 12 of #205)
  - Read: `06` (Protection), `edge/timetable` (After publishing), `edge/time-dates-calendar` (bulk cancel), `edge/00-definitions` (Data on a lesson).
  - Build: the one-day cancel, the bulk cancel and the forced delete of a lesson that holds data (`lesson_holds_data`, 0108).
  - Done when: every From line below has its test, with cells written by `saveCells` (`apps/api/src/modules/journal/cells.ts`).
  - From 5.6a-1 (pull request #160, decision 12): `edge/timetable`, After publishing: "A lesson that already has attendance must be cancelled. Only the Academic Vice Principal, with a reason and a list of what is affected. The entries are kept, struck through and left out of every figure. Restoring the lesson brings them back." The one-day cancel of 5.6a-1 (`apps/api/src/modules/timetable/day-changes.service.ts`) lists what a lesson with data holds once cells exist.
  - From 5.6a-3 (pull request #162, decisions 8 and 15): `edge/time-dates-calendar`, "The school closes at 11:00 today, or yesterday is declared a day off afterwards. Today and past dates cannot become a day off. A bulk cancel is used instead, for the whole branch from a chosen slot. Cancelled lessons stay visible in grey with the reason. For a lesson that already has data, the Academic Vice Principal chooses 'keep as held' or 'cancel'." The bulk cancel (`apps/api/src/modules/timetable/bulk-cancels.service.ts`) cancels started and past lessons; once cells exist, its check lists each lesson in scope that holds data and the save takes the choice for each.
  - From 5.8b (pull request #195, decision 2, Look first), the part of the forced delete: the database refuses the delete of a lesson holding data (`lessons_delete_data`) except by the Super Admin's forced delete, so the forced delete takes the lesson's cells and works out first and keeps them in its store row (`forced_deletes.rows`), and its restore puts them back; the forced-delete database tests (`lesson-protection-forced.database.test.ts`, 6.1b-1) move from the stand-in function to real cells.

- [ ] **6.1c Reports over the cells** (6.1 split, pull request #205, decision 1, Look first)
  - Read: `edge/people-roles-accounts` (Accounts and sign-in), `04` (the personal data report).
  - Build: the reports of the From lines below, over `journal_cells` and `journal_cell_history` (0108).
  - Done when: each report reads the cells with a test per role that may read it.
  - From 2.3 (pull request #62): the report of entries made within 48 hours of a password reset (`edge/people-roles-accounts`, Accounts and sign-in: "A report lists entries made within 48 hours of a reset"), once cells exist.
  - From 2.6b (pull request #76, Left out): the student's marks and attendance join the personal data report (`personal-data.service.ts`), once cells exist.
  - From 2.3c-2 (pull request #66, decision 6): the report also counts a password reset by email (`auth.password_reset_by_email`), and marks one that follows an email change by somebody else (the entry's `lastEmailChange`).

- [ ] **6.2 Journal grid**
  - Read: `07` (Opening a journal, Layout, Who can do what), `12`.
  - Build: the AG Grid Community grid with pinned student columns, lesson columns grouped by date, scroll to the nearest date, summary columns from `packages/calc`, the bottom row, student search, and lesson mode for today's lesson.
  - Done when: the grid meets the speed targets in `12` with a full quarter of data.
  - From 5.9b (pull request #198, decision 7): `06`, Views and outputs: "Teacher home page: today's lessons as a list (period, time, class or group, subject, room, button to open the journal)". The home page's list is `TeachingHome` (`apps/web/src/features/timetable/teaching-home.tsx`), from `GET /api/timetable/home`; each lesson of today gets the button that opens its journal (of its own branch).
  - From 5.12c (pull request #203, decision 1, Look first): the journal page is timed on the real-size data of `real-size.database.test.ts` (`REAL_SIZE=full`): open a journal for a quarter, against `12`.
  - From 4.3 (pull request #104, row table): `edge/calculation`, "The month switch in the journal": "It shows the averages over that month's lessons. The month result uses the quarter's weights without the rating exam and is labelled so", from `packages/calc`.

- [ ] **6.3 Attendance**
  - Read: `07` (Entering data), `edge/journal` (Entering, Attendance figures).
  - Build: attendance marks and their values; "all present"; absence reasons recorded by the Tutor; attendance-only journals (Homework slot, Ma'naviyat soati).
  - Done when: "all present" is one request with one history entry per cell.
  - From 5.7b-1 (pull request #191, decision 10): `07`, Who can do what: "Substitute teacher | Enters for the substituted lesson only"; `edge/timetable`, After publishing, "A substitute wants to finish the numbers two days later": "The substitute is the teacher of that lesson and has the normal edit period for that column only. The journal's own teacher can also edit it until it locks. Every entry shows who typed it." The substitute of a lesson is its teacher (`lessons.teacher_id`) while a substitution is in force (`substitutionsInForce`, `apps/api/src/modules/timetable/substitutions-read.ts`, 0101); the person recorded by a correction of kind `teacher` (5.6a-4) is that lesson's teacher the same way. The journal's own teacher is `journalOwnerOn`.
  - From 6.1a (pull request #205, decision 11): `07`, Editing rules and locks: "Attendance and scores can be entered from the lesson's start time, not before." `saveCells` accepts a save before the start; the route refuses it. Its input schema stays within the checks of `journal_cells` (a mark 0 to 3, a whole number 0 or more; `.claude/rules/database.md`, a shared schema never wider than the check), which `saveCells` throws on.

## Phase 7. Lesson plans

- [ ] **7.1a Plans and items**
  - Read: `09` (What a plan contains), `edge/lesson-plans` (How items stay attached).
  - Build: a plan per class or group and subject; items with topic, any number of classworks and homeworks (at most 10 of each) and files; file limits; attachment of items to lessons in order; who can see a plan.
  - Done when: a plan fills the lessons of a quarter in order.

- [ ] **7.1b Items follow the timetable**
  - Read: `09` (When something else changes), `edge/lesson-plans` (How items stay attached).
  - Build: re-attachment of the queue when lessons are cancelled, added, moved or their number changes; the "not covered" list; prepared edit requests; the impact preview per plan.
  - Done when: every row of the "When something else changes" table has a test.
  - From 5.7a-3a (pull request #188, decision 16): `09`, When something else changes, "The teacher of the class changes: The plan stays with the class and the new teacher becomes its owner. It stays locked; the system prepares an edit request so that the new teacher can adjust the future lessons." A vacancy fill is such a change, read from `vacancy_fills` and `vacancy_fill_rows` (the date, the person, the rows); `edge/timetable`: "the hired teacher becomes the plan's owner".
  - From 5.7a-3c (pull request #190, decision 9; spec review of the plan, must-fix 2): the plan's owner on a day is `journalOwnerOn` (`apps/api/src/modules/timetable/journal-owners.ts`: the teacher of the journal's row in the published version in force that day; under a vacancy the acting teacher in force (`journal_acting_teachers`, 0100, counted only on days the row names the vacancy and the person is active in the branch), else `none`). The row "The teacher of the class changes" applies each time the owner passes between "no teacher", the acting teacher and the hired teacher: the plan stays with the class and locked, an edit request is prepared for the new owner, the part taught earlier stays readable. `edge/timetable`: "For that period the acting teacher owns the plan".
  - From 5.7b-1 (pull request #191, decision 10): `09`, "A substitute takes one lesson: The substitute sees the item of that lesson and cannot edit it"; `edge/lesson-plans`: "a substitute, for that lesson's item". The substitute of a lesson is its teacher (`lessons.teacher_id`) while a substitution is in force (`substitutionsInForce`, `apps/api/src/modules/timetable/substitutions-read.ts`, 0101).

- [ ] **7.1c Shared plans**
  - Read: `09` (What a plan contains), `05` (Language of instruction).
  - Build: one plan shared by several classes of the same grade and language; separate later; copy from another plan.
  - Done when: classes of different languages cannot share a plan.

- [ ] **7.2 The plan window and edit requests**
  - Read: `09` (The plan window, Editing after the window), `02` (Head Teachers and Senior Head Teachers), `edge/lesson-plans` (The window and requests).
  - Build: the window opened per quarter by the Academic Vice Principal; edit requests after the window, with the approver setting the number of days; system-prepared requests; routing to the Head Teacher of the subject, the Senior Head Teacher and the Academic Vice Principal; notices through 0.9.
  - Done when: nothing opens without an approved request and nobody approves their own.
  - From 3.6b-3 (pull request #123, decision 2, Look first): an open plan edit request is routed by the post of its subject (`02`, "Subjects, not departments", "Who approves"), read in force on each request (`edge/people-roles-accounts`, row 16), so it follows any change of the post on its date with no job; a department move changes no approver.
  - From 5.7a-3c (pull request #190, decision 9): `edge/timetable`, "The plan, the journal and the reports of a vacancy's subject": "Until an acting teacher is named or the vacancy is filled, nobody writes its plan: the plan window lists it as 'vacancy', not as overdue against anyone". The window reads the owner with `journalOwnerOn` (`apps/api/src/modules/timetable/journal-owners.ts`: the teacher of the journal's row in the published version in force that day; under a vacancy the acting teacher in force (`journal_acting_teachers`, 0100, counted only on days the row names the vacancy and the person is active in the branch), else `none`): `none` is listed as "vacancy", the acting teacher is the plan's owner in the period.

- [ ] **7.3 Master plans**
  - Read: `09` (Master plans), `edge/lesson-plans`.
  - Build: masters per subject, grade, language and quarter; copy to a class; the "master updated" comparison; a Senior Head Teacher's master for all branches.
  - Done when: a copied plan is independent of its master.

## Phase 8. Journal: works, rules and exemptions

- [ ] **8.1 Classwork and homework**
  - Read: `07` (Entering data, The total), `09` (In the journal), `edge/journal` (Entering), `edge/lesson-plans` (Plans and the journal).
  - Build: columns taken from the plan; works added by hand when a lesson has no plan item, flagged "unplanned"; a total per work, whole numbers only, percent shown; any number of classworks and homeworks per lesson (at most 10 of each), each with its own column and total; homework entered on the lesson where it is checked; "not held"; no empty columns.
  - Done when: the first lesson of a journal has no homework column and every entering rule has a test.
  - From 3.6a (pull request #118): the students of a Teacher's journal are the members of the classes and groups that `taughtAt` gives (`apps/api/src/modules/access/taught-scope.ts`), the same reading as the Students list; the journal does not build it again.
  - From 3.6b-2 (pull request #120, decision 11): when marks and attendance exist, the list `year_cut_holds` of `db/migrations/0064` gains the days with a mark or an attendance entry, and a shorter year is refused with them (L128).
  - From 5.7a-3c (pull request #190, decision 9; spec review of the plan, must-fix 1): `edge/timetable`, "A vacancy lasts a quarter": "For that period the acting teacher ... adds works" and "Without an acting teacher the lessons are attendance-only". The journal's teacher on a day is `journalOwnerOn` (`apps/api/src/modules/timetable/journal-owners.ts`: the teacher of the journal's row in the published version in force that day; under a vacancy the acting teacher in force (`journal_acting_teachers`, 0100, counted only on days the row names the vacancy and the person is active in the branch), else `none`): the acting teacher adds works and sees the journal's students as its teacher would (`taughtAt` plus the journals they act for); on a day it gives `none`, the journal's lessons take attendance only, no works and no marks, entered by the lesson's substitute (5.7b) or corrected by the Academic Vice Principal (`07`, Who can do what).
  - From 6.1a (pull request #205, decisions 6 and 11): `07`, The total: "The number typed is from 0 up to the total. A number above the total is refused" and "Numbers cannot be typed for a work until its total is set", as database checks of `journal_cells` and `journal_works` (0108 keeps `score >= 0` only) with the refusal of a total change below a number; the update grant of `total` and `not_held` with their audit; the delete of an empty work; the total kept beside the number in the cell history ("The number and the total stay visible in the journal and in the cell history"); and `edge/journal`, "The homework columns move to the next held lesson, each as long as it has no numbers yet", with the cells keyed `(work_id, lesson_id)` (0108).

- [ ] **8.2 Rating exam and comments**
  - Read: `07` (Entering data, Layout), `edge/journal` (Entering), `edge/calculation`.
  - Build: the rating exam score per student per quarter in rating subjects, with "did not sit" and "exempt"; comments on a mark or score and notes per student per lesson, each "staff only" or "visible to parents"; keyboard entry rules.
  - Done when: a non-rating subject has no exam column.
  - From 2.1 (pull request #52, decision 4; moved from 5.5c by 5.5c-1, pull request #155, decision 2 with review correction 3): `edge/calculation`, "'Rating exam' is switched off, or a subject becomes attendance only, in week 5": "These switches are stored per quarter. They are free before the quarter's first lesson." The journal stores the rating exam switch and the journal type per quarter; until now they are one school-wide value on `subjects`. Until then the publish check (`settingsRefusals`, `publish.service.ts`), the journal grid and the attendance-only journals (6.2, 6.3) read the school-wide `subjects.journal_type` and `rating_exam` and the branch's `subject_quarter_weights.rating_exam`; this task stores the switches per journal and quarter and moves those readers, which 9.1 then reads.
  - From 2.1 (pull request #52, decision 4): `edge/calculation`: "In a started quarter the change is refused while scores exist." `PUT /api/setup/subjects/:id` refuses a change of the rating exam switch or the journal type while a started quarter holds scores of the subject, with its test.
  - From 2.4b-1 (pull request #68): the tables of numbers and comments reference `students` with no action, as the line of 6.1 says, so a student with them is never deleted.
  - From 4.3 (pull request #104, row table): reads `edge/calculation`, "The rating exam" (one column per rating journal and quarter, an exam date set by the teacher or the Academic Vice Principal, whole numbers 0 to 100 from that date with the edit period and unlock of a lesson; a score, "did not sit" set by the teacher, or "exempt" set only by the Academic Vice Principal; a late sitting or a retake replaces the score with a required reason, history kept), "A student is exempt on the exam day" (the cell shows "exempt on exam day, pending"; the teacher may later enter a score, otherwise the Academic Vice Principal sets "exempt"; pending is passed to `packages/calc` as no entry) and "The exam is not held for one group this quarter" ("not held" per journal and quarter, set by the Academic Vice Principal).
  - From 5.6c-1 (pull request #181): `edge/timetable`, Exams, "The exam is the quarter's rating exam": "The linked journals' rating exam date is the exam's date." The link is stored by 5.6c-3; this task reads the date of a linked journal from its exam, the quarter of the exam's date (From line of 5.6b-5a on 5.6c).
  - From 5.6c-3b (pull request #184, review correction 1): the link is stored in `exams.rating_exam` and `exam_rating_journals` (0095, `linked` true or false); a linked journal's rating exam is the one exam with `rating_exam` and `cancel_cause is null` linking it whose date lies in the quarter (standing exams only: a cancelled exam keeps its rows as history; `edge/timetable`, Exams, "The exam is the quarter's rating exam"). The exam save and the quarter save keep one such exam per journal and quarter. The save reads the school-wide `subjects.rating_exam` (`refuseRatingSubject`, `exam-rating.ts`); this task moves that reader to the switch stored per quarter (`edge/calculation`: "These switches are stored per quarter").
  - From 5.7a-3c (pull request #190, decision 9): `edge/timetable`, "A vacancy lasts a quarter": "For that period the acting teacher ... enters the rating exam". The teacher who enters it is `journalOwnerOn` on the day of the entry (`apps/api/src/modules/timetable/journal-owners.ts`: the teacher of the journal's row in the published version in force that day; under a vacancy the acting teacher in force (`journal_acting_teachers`, 0100, counted only on days the row names the vacancy and the person is active in the branch), else `none`).
  - From 6.1a (pull request #205, decision 11): `edge/00-definitions`, Data on a lesson: "... or a comment entered by a person": `lesson_holds_data` (0108) gains the comments (`create or replace`).

- [ ] **8.3a Saving and stale saves**
  - Read: `07`, `12` (No lost work), `edge/journal` (Saving and working together), `edge/system-behaviour`.
  - Build: save per cell with optimistic display; refusal of stale saves with both values shown; repeat-safe saves; the application version on every request.
  - Done when: two saves of one cell from two sessions are tested.

- [ ] **8.4 Edit period, unlocks and corrections**
  - Read: `07` (Editing rules and locks), `02` (Head Teachers and Senior Head Teachers), `edge/journal` (Locks, unlocks and corrections).
  - Build: the lock at 23:59 branch time on the lesson date plus the edit days, worked out on each request from stored moments; unlock requests routed to the Head Teacher of the subject, the Senior Head Teacher or the Academic Vice Principal; nobody approves their own; corrections by the Academic Vice Principal with a reason; branch-wide extension of the edit period.
  - Done when: tests at 23:59 and 00:00 pass with the injected clock.
  - From 1.6 (pull request #49, decision 1): the edit days are `branch_settings.edit_days`, a plain value audited on change. The lock moment is stored per lesson; a change of the edit days re-stores the lock moments of the lessons dated after the change, in the same transaction (`edge/00-definitions`, Lock moment).
  - From 3.4c (pull request #101, decision 10), changed by 3.6b-3 (pull request #123, decision 2, Look first): an open unlock request is routed by the post of its subject (`02`, "Subjects, not departments", "Who approves"), read in force on each request (`edge/people-roles-accounts`, row 16), so it follows any change of the post on its date with no job; a department move changes no approver and moves nothing.
  - From 5.7a-3c (pull request #190, decision 9): the acting teacher of a vacancy's journal has the journal teacher's edit period and unlock path for the lessons of the period, read with `journalOwnerOn` (`apps/api/src/modules/timetable/journal-owners.ts`: the teacher of the journal's row in the published version in force that day; under a vacancy the acting teacher in force (`journal_acting_teachers`, 0100, counted only on days the row names the vacancy and the person is active in the branch), else `none`).
  - From 5.7b-1 (pull request #191, decision 10): the substitute has the normal edit period for the substituted lesson's column only, and the journal's own teacher (`journalOwnerOn`) can also edit it until it locks (`edge/timetable`, "A substitute wants to finish the numbers two days later"); the substitute of a lesson is its teacher (`lessons.teacher_id`) while a substitution is in force (`substitutionsInForce`, `apps/api/src/modules/timetable/substitutions-read.ts`, 0101), and the person recorded by a correction of kind `teacher` the same way (From 5.6a-4).

- [ ] **8.5 Exemptions**
  - Read: `07` (Exemptions), `edge/exemptions`.
  - Build: exemptions entered by the Academic Vice Principal or Super Admin (temporary or full, all or chosen subjects, whole days or chosen slots); cells shown as exempt; the late-entry preview; end and void; notices to the Tutor and teachers.
  - Done when: every row of the "Problem cases" table has a test.
  - From 2.4b-1 (pull request #68): a leaving ends the student's open exemptions on the date (`edge/students-classes-groups`: "Open exemptions end"); the exemption table references `students` with no action, as the line of 6.1 says.
  - From 3.3d (pull request #98, correction 5): a merge of two student records carries every row of the merged record or refuses the merge (`student_merges`, 0054): the exemption table, which references `students` with no action (the shape of 0033 and of the line of 2.4b-1 above), is carried by the merge (its `student_id`, and its branch with the kept record's, under a guard with the merge path of `student_merge_here`) or, where an exemption cannot be carried (two exemptions of the two records on common days), refuses it by its key; it is named in `MERGE_DOES` of `student-merges.database.test.ts` and in a list of `student-branch-moves.database.test.ts`, the two places a later table names itself.
  - From 3.3c (pull request #97, decision 19): `edge/exemptions`, "On a branch move it goes to the new branch's Academic Vice Principal to confirm or drop": an exemption in force on the date of an accepted move to another branch (`student_branch_moves`) is offered to the receiving branch's Academic Vice Principal, who confirms or drops it; the exemption rows are a branch table and go with the student (a key with the branch `on update cascade`, as 0032), or are named in `KEPT` of `student-branch-moves.database.test.ts`.
  - From 4.3 (pull request #104, decision 9): every row of `edge/exemptions` without a test in `packages/calc` (`spec-rows.test.ts` names them 8.5) gets a test here; the journal passes an exempt lesson as mark 4 or 5 with no number (`number_on_exempt_lesson` otherwise).
  - From 5.6a-3 (pull request #162, decision 1): `edge/timetable`, After publishing, the 7 Oxford row: "keep it and exempt the students of the chosen classes for those slots in the same action". A kept block is stored as a `keep` row of `bulk_cancel_blocks` and each chosen class's time as `bulk_cancel_spans` (0086); the exam's kept block as `lesson_block_class_outs` (0060). This task makes the cells of those classes' students in the kept block's lessons exempt (temporary, mark 4; `edge/exemptions`: "A slot exemption is stored as a time range on that date") from both tables, and sends the exemption notice to the Tutor and the teachers of the kept lessons.
  - From 5.6b-3 (pull request #175, decision 1): `edge/time-dates-calendar`, "A day off for grade 9 only, and a group joins 9 Edinburgh and 10 Brown": "keep them and exempt the students of the grade that is off, as for an excursion". A kept block is stored per date as a `keep` row of `calendar_group_blocks` (0090) with its groups in `calendar_group_block_groups`, keyed by the day-off entry, the date, the block's weekly start and its groups; a row of today or the past never changes. The dated expansion already lists the off grade's students in the lesson's `exemptStudentIds` (members on the date); this task makes them exempt in the journal for those lessons, as for the bulk cancel's `keep` above.
  - From 5.6c-1 (pull request #181, decision 11): `edge/timetable`, Exams: "keep it for the other classes, which takes the sitting class out of the block on that date and exempts its students from those lessons, as for an excursion". The keep is stored as the out row (`lesson_block_class_outs`, 0060) of the exam; this task makes the cells of those students exempt from it while the exam stands.
  - From 6.1a (pull request #205, decisions 4 and 11): `edge/00-definitions`, Expected student: "... and is not exempt for that lesson": `lesson_student_expected` (0108) gains the exemption, so closed cells and who is expected change in one place; marks 4 and 5 are never stored, they are shown from the exemption in force.

- [ ] **8.6 Transfers and leaving inside the journal**
  - Read: `07` (Transfers), `edge/students-classes-groups`, `edge/calculation`.
  - Build: what a journal shows and counts when a student changes class or group, joins late, leaves or returns; results that follow the student; the "result at leaving".
  - Done when: a transfer made at the same moment as a cell save is tested.
  - From 3.3a (pull request #95, decisions 4 and 10): a move dated today is allowed only if the student has no entries today in the old journals (`edge`: the "11:00" row); a move recorded late lists the entries of the old journals on or after the date, moved past or voided with a reason, and opens the new journal's held lessons as optional cells for 7 days (the "a week late" row); the undo of a move is refused once the new journals hold entries of the student (the "a mistake" row).
  - From 3.3c (pull request #97, decisions 6 and 19): a move to another branch is accepted from its date on, and a late accept cuts the old branch's class and group rows back to the date: the entries of the old journals on or after the date are listed as for a late transfer (moved past or voided with a reason); the old branch's journals keep naming a former member who moved away (the student's row is of the new branch: read past the row filter, names only).
  - From 3.3d (pull request #98, decision 4 and correction 5): the journal side of a merge of two student records (`student_merges`, 0054): the entries of the merged record are carried to the kept record with its class and group rows; two records holding entries on common days (the days a merge cuts or leaves behind) are refused or resolved, the merge listing them, as the late transfer lists its entries. The journal's tables of student data reference `students` with no action and are carried by the merge or refuse it by their key; each is named in `MERGE_DOES` of `student-merges.database.test.ts` and in a list of `student-branch-moves.database.test.ts`.
  - From 3.3b (pull request #96, decision 2): the journal side of a return (`edge`, "A student returns"): "In the same quarter and class: one row, with the gap closed. Into another class: handled like a transfer. In a later year: nothing is carried into the journals". The return writes no `student_moves` row; its class row has the cause `return`, and a return into the class left gives back the group the leaving cut.
  - From 4.3 (pull request #104, decisions 6, 10 and 12): the result at leaving is `finalQuarterRecord(…, 'at_leaving')`, stored when the student leaves the school or the branch; N of the few-lessons flag (`heldInJournals`) counts, for each school day of the quarter, the held lessons of the journal the student belonged to that day, before the first membership and in a gap the journal of the next membership, after leaving the subject or the branch nothing; class and group averages count only number outcomes of members on the reference date.

- [ ] **8.7 Lesson status, reminders and the discipline report**
  - Read: `07` (Lesson status, Reminders).
  - Build: the four lesson statuses; the reminders panel on the journal and the teacher home page; counts per teacher for Head Teachers and the Academic Vice Principal.
  - Done when: the counts on the home page match the journal.
  - From 5.6a-4 (pull request #163, decision 11): a held lesson is the one `lessonStateOf` (`packages/shared/src/timetable.ts`) calls `held`; an unresolved or cancelled lesson never counts as held, and an unresolved one never as "attendance not marked" against anyone (`edge/00-definitions`, Held lesson; `edge/timetable`, After publishing).
  - From 5.7a-1 (pull request #185, spec review should-fix 7): the `absent` that `lessonStateOf` takes is read through `absentLessons` of `apps/api/src/modules/timetable/absences-read.ts` (`absences_of_teachers`, 0096), never from the membership-filtered `absences` table, and a lesson with a `lesson_absence_taught` row is not absent.
  - From 5.7a-3c (pull request #190, decision 9): `edge/timetable`, "A vacancy lasts a quarter": the acting teacher "is counted in the discipline report; the vacancy is counted for nothing"; "Nothing is ever counted against a vacancy". The counts per teacher read the journal's owner per lesson date with `journalOwnerOn` (`apps/api/src/modules/timetable/journal-owners.ts`: the teacher of the journal's row in the published version in force that day; under a vacancy the acting teacher in force (`journal_acting_teachers`, 0100, counted only on days the row names the vacancy and the person is active in the branch), else `none`); a lesson whose owner is `none` counts for nobody (a substitute's lesson counts for the substitute).
  - From 5.7b-1 (pull request #191, decision 10): `07`, "A substituted lesson counts for the substitute on that day"; the substitute of a lesson is its teacher (`lessons.teacher_id`) while a substitution is in force (`substitutionsInForce`, `apps/api/src/modules/timetable/substitutions-read.ts`, 0101).

- [ ] **8.8 Plans in the journal**
  - Read: `09` (In the journal, Reports), `edge/lesson-plans` (Plans and the journal).
  - Build: topic and titles shown in the journal; "topic not delivered" and "homework not given"; plan reports (completeness, progress, share of "not held").
  - Done when: marking a homework "not given" removes the next lesson's homework column.
  - From 5.7b-1 (pull request #191, decision 10): `edge/lesson-plans`, "A substitute supervises the class": "On the lesson card the substitute or the teacher sets 'topic not delivered'"; the substitute of a lesson is its teacher (`lessons.teacher_id`) while a substitution is in force (`substitutionsInForce`, `apps/api/src/modules/timetable/substitutions-read.ts`, 0101).

- [ ] **8.9 Journal exports and the support view**
  - Read: `07` (last paragraph), `edge/journal`, `edge/system-behaviour`.
  - Build: Excel and PDF export of a journal; branch-wide export as a background job from one consistent moment; the support view of one student, journal and date showing every save and refusal.
  - Done when: an export link stops working after 24 hours and access is checked again at download.

## Phase 9. Results, closing and reports

- [ ] **9.1 Quarter results and the student results page**
  - Read: `08` (Student results), `07` (Calculation rules), `edge/calculation`.
  - Build: the Results and Attendance tabs of the student profile; quarter and year results per subject; the trace from a result to its lessons.
  - Done when: every figure shown comes from `packages/calc`.
  - From 1.6 (pull request #49, decision 3): a change of late or skipped on a quarter (`PUT /api/setup/quarters/:id/attendance-values`) shows the results that change first, as the preview `edge/calculation` asks for, and recalculates them in the same transaction.
  - From 2.1 (pull request #52, decision 14 and migration 0021): every reader of the weights (results, the lesson score, the journal legend) takes a distribution only in the subject's current `weights_round` and, for a quarter, only when its rating exam part fits the switch; a row of an earlier round is not a distribution.
  - From 2.1 (pull request #52, decision 4): a change of a quarterly distribution (`PUT /api/setup/subjects/:id/quarter-weights/:quarterId` and the copy) in an open quarter: `edge/calculation`, "Before saving, the system shows how many grades will change in each journal, asks for a reason and tells the subject's teachers. The journal legend shows 'changed on [date]'."; `05`: "Each change is logged and results are recalculated at once."
  - From 2.4b-1 (pull request #68): the tables of results reference `students` with no action, as the line of 6.1 says.
  - From 4.3 (pull request #104): the figures shown come from `studentQuarterOutcome` (the four result states, the flags, "based on n of N lessons", "from <date>", "left the subject on <date>"), not `quarterResult` alone; the year result takes `outcomeForYear`.

- [ ] **9.2a Closing checklist**
  - Read: `07` (Closing a quarter), `edge/journal` (Closing and reopening), `edge/calculation`.
  - Build: the checklist with blocking items and warnings; decisions on flagged results, one by one or for a whole journal.
  - Done when: each row of the checklist table has a test.
  - From 4.3 (pull request #104, decisions 3, 5 and 8, correction 1): the decisions are the `decision` of `studentQuarterOutcome`, one per student, subject and quarter, set one by one or for a whole journal; `exempt` is refused where the module would not apply it (only when the few-lessons flag is the one flag raised and (n + e) × 3 ≥ N; the attendance-only and "left the subject" rows offer keep or Not assessed); the three flags (`few_lessons`, `attendance_only`, `left_subject`) block closing while undecided, and a stored decision the module no longer applies (`staleDecision`) is a blocking item of its own, "decision outdated: clear it or decide again", one by one or for a whole journal.
  - From 5.7a-3c (pull request #190, decision 3, Look first): `edge/timetable`, "A vacancy lasts a quarter": "Without an acting teacher ... the closing checklist lists the journal as 'no teacher'". The item is a warning, not a blocking item; it lists the journals and days `journalsWithoutTeacher(transaction, branchId, from, until)` of `apps/api/src/modules/timetable/journal-owners.ts` gives for the quarter (proposed `/spec-change` on issue #42: a row of the `07` table, "A journal with days under a vacancy and no acting teacher ('no teacher') | Warning").

- [ ] **9.2b Closing a quarter**
  - Read: `07` (Closing a quarter), `edge/journal` (Closing and reopening), `edge/academic-year`, `edge/system-behaviour`.
  - Build: close for the whole branch in one step; stored final results with their inputs; the start-quarter choice ("keep" or "not official").
  - Done when: closing against a simultaneous cell save is tested.
  - From 5.8b (pull request #195, decision 3, Look first): `edge/timetable`, After publishing: a cancel of a lesson with attendance is "Not possible in a closed quarter". The Super Admin's forced delete of a dated lesson and its restore (`POST /api/timetable/lessons/:id/forced-delete`, `POST /api/forced-deletes/:id/restore`, `apps/api/src/modules/timetable/forced-deletes.service.ts`) are refused in a closed quarter, with a route test of each; today only a closed year refuses them.
  - From 1.6 (pull request #49, decision 3): a closed quarter refuses a change of its late and skipped values, in the database as `quarters_closed_year_guard` does for a closed year, also after a reopening (`edge/calculation`: "A closed quarter keeps the values it was closed with, also when reopened").
  - From 5.6b-5a (pull request #179, decision 11): `edge/time-dates-calendar`, "Quarter dates are edited after lessons exist": "A closed quarter's dates are frozen." A closed quarter refuses a change of its dates, in the database and in the quarter save (`AcademicYears.saveQuarters`).
  - From 2.1 (pull request #52, decision 12): `05`, "Weights of a quarter can change until the quarter is closed." A closed quarter refuses a write of `subject_quarter_weights`, in the database as `subject_quarter_weights_closed_year_guard` does for a closed year.
  - From 3.3a (pull request #95, decision 4): a class or group move dated in a closed quarter is refused (`edge`: "Backdating is for the Academic Vice Principal, in an open quarter").
  - From 3.3c (pull request #97, decision 9): a release to another branch dated in a closed quarter is refused, and so is its accept.
  - From 2.4b-1 (pull request #68): a leaving, an undo, a return or a graduated restore dated in a closed quarter is refused (`edge/students-classes-groups`: "A date in a closed quarter is refused"), in the database as `student_statuses_closed_year_guard` (0033) does for a closed year.
  - From 4.3 (pull request #104, decisions 8 and 13): the stored final result is `finalQuarterRecord(…, 'closing')` (format 1, inputs, outcome, `CALC_VERSION`) in a `jsonb` column; it refuses an open quarter, an undecided or stale flag, a missing rating exam entry and a student with a result at leaving (`final_record_at_leaving`: not on the checklist).
  - From 5.6a-1 (pull request #160, decision 12): `edge/timetable`, After publishing, "A lesson that already has attendance must be cancelled": "Not possible in a closed quarter." A one-day cancel or restore of a lesson in a closed quarter is refused.

- [ ] **9.2c Reopening and the nightly check**
  - Read: `edge/journal` (Closing and reopening), `edge/system-behaviour`.
  - Build: reopen rules; the nightly job that recalculates open journals and stored results, alerts on a difference and blocks closing that journal.
  - Done when: a deliberately corrupted stored result is caught by the check in a test.
  - From 4.3 (pull request #104, `edge/calculation`, "A bug is found after results were closed and exported"): the "recalculate and compare" tool over `recalculateAndCompare` (lists the differences, changes nothing; a record the current module refuses is listed with its code, `refused`, not thrown) and "apply with a reason", which keeps the old results and tells the teachers concerned; the nightly check uses the same function.
  - From 5.8b (pull request #195, decision 8; `edge/people-roles-accounts`: "after that the data is removed and a summary stays in the audit log"): a nightly job removes the rows of a forced delete whose `restore_until` (`forced_deletes`, 0105) has passed and was not restored, decided from the stored moment and the injected clock, and writes a summary entry in the audit log; the store row itself stays with its reason. 5.8b keeps the rows and only refuses their restore.

- [ ] **9.3a Rating**
  - Read: `08` (Rating).
  - Build: the rating lists with their filters, including language and branch, and Excel export.
  - Done when: students without a result are handled as the spec says.
  - From 4.3 (pull request #104, row table): reads `edge/calculation` ("Two students both show 84", "One student has 9 subjects, another 11", the result at leaving left out of the rating) and `07` Effect on totals (Rating: a student with "Exempt" is not ranked; across subjects the student is marked as having fewer subjects); only a number outcome is ranked.

- [ ] **9.4a Early-warning list**
  - Read: `08` (Early-warning list).
  - Build: the list with its thresholds and who sees it.
  - Done when: a subject with fewer than five graded works lists nobody.
  - From 1.6 (pull request #49, decision 2): the thresholds are `branch_settings.low_result`, `result_drop`, `attendance_percent` and `absences_in_row`; "five graded works" stays fixed in code here (answer 19).
  - From 4.3 (pull request #104, row table): reads `edge/calculation`, "The early-warning list compares a mid-quarter figure without the exam against last quarter's final with the exam".

- [ ] **9.4b Home pages**
  - Read: `08` (Home pages by role).
  - Build: the first screen of each role, filling the shells from 0.8c.
  - Done when: each role's first screen matches the table in the spec.
  - From 5.9b (pull request #198, decisions 4 and 7): `08`, Home pages by role, Tutor: "Own class: today's timetable, who is absent now, attendance percent for the day and week, early-warning list for the class." Since 5.9b the Tutor's home shows the Tutor's own lessons (`TeachingHome`); the timetable of the own class today and the other parts of the row come here. The Teacher, Head Teacher and Senior Head Teacher row ("Today's lessons with their status (\"3 of 5 complete\"), reminders, quick entry to each journal, early-warning list for own journals ... the requests waiting for them") is filled on the same list.

> **Owner gate.** The start routine stops here until the owner, after the go-live review of every Look first decision and the decided-ahead round for Phase 10, deletes this line.

## Phase 10. Before go-live

- [ ] **10.1 Speed tests**
  - Read: `12` (Speed targets), `14` (Whole system), `edge/system-behaviour`.
  - Build: a data generator for three times the estimated yearly data with invented names; automated measurement of each target.
  - Done when: every target is met or the gap is written in `docs/progress.md` with a plan.
  - From 5.12c (pull request #203, decisions 2 and 3): the real-size run (`apps/api/src/modules/timetable/real-size.database.test.ts`, `REAL_SIZE=full`) builds the school at its size, publishes it and times the board, a move, the publish and the published week; it runs small in CI. The measure before each release at full size and the 1,000 simultaneous users of `12` (Load) are this task's. Its full run missed two targets: the board's drag check of every slot (406 ms, target 0.2 s) and the publish check (1.2 s, target 1 s).
  - From 5.12d (pull request #204, decision 4): a dated double pair still takes one advisory lock per pair at its commit check (`lesson_blocks_double`, 0058): a branch whose year has doubles holds one lock per double lesson of the year in its publish (about 6,800 at 200 doubles a week) and can again run out of the lock table at `max_locks_per_transaction` 64. The real-size run has no doubles; adding them to it shows whether that pair lock needs the treatment 0107 gave the block lock (`created_xact`).

- [ ] **10.2 Backups, restore drill and monitoring**
  - Read: `13` (Hosting and data), `14` (Whole system), `edge/system-behaviour`.
  - Build: the daily export to R2; written steps for restoring to a side copy; Sentry, Grafana Cloud and UptimeRobot alerts to Telegram; the sign-in-and-save check every 5 minutes with a test teacher account.
  - Done when: the owner has restored a backup once by following the written steps.
  - From the owner (15 October 2026): a daily scheduled task that reads the day's error reports, slow requests and job runs of the live system and sends the owner a short report of anything unusual (a page that fails, a job that did not run, a request much slower than usual), beside the fixed alerts; it reads and reports only.

- [ ] **10.3 Permission and security review**
  - Read: `02`, `13` (Security), `edge/people-roles-accounts`.
  - Build: the missing route-by-role tests; a written permission checklist for the owner to sign; fixes for what the review finds.
  - Done when: the harness covers every route and the owner has signed the checklist.

- [ ] **10.4 Production and the go-live checklist**
  - Read: `13`, `edge/academic-year`, `14` (Whole system).
  - Build: the production environment; the first Super Admin; the written go-live and pilot checklists (which data to enter first, which grade pilots, how results are compared).
  - Done when: production is deployed and the checklists are approved by the owner.

## Deferred until after 25 October 2026

Decided by the owner on 16 October 2026: these tasks are not needed for the release on the test site on 25 October 2026 and are built after it, in this order. The start routine never reaches them before the owner gate of Phase 10. Year-end work (closing the year, rollover, a new year) is needed only in June 2027; the handbook is written once the features are finished (`docs/decisions.md`, 16 October 2026).

Decided by the owner on 20 October 2026: automatic generation (5.10 and 5.11) is built after the release too, first of this list. Until then a timetable is built in the grid by hand, with the rule engine, "Suggest a place" and the readiness check as they are; Release 1 still includes generation.

- [ ] **5.10 Solver service**
  - Read: `06` (Auto-generation, Rules), `13`, `edge/timetable` (Generator and editing).
  - Build: `apps/solver` in Kotlin with Timefold Solver Community Edition; hard constraints equal to the blocked rules and soft constraints from the preferences table; pinned lessons kept; a time limit of 5 minutes with a first draft in about a minute.
  - Done when: on sample data of one branch the solver returns a draft that the TypeScript rule engine accepts with zero blocked rules.
  - From 5.2 (pull request #109): the re-check of the solver's output is `checkTimetable` in `mode: 'pattern'`; the blocked rules of `RULE_ORDER` (every code not in `WARNINGS`) are the hard constraints to mirror in Kotlin.
  - From 5.3b-2 (pull request #129, decisions 1 and 2): `edge/timetable`, Generator and editing: "Before generating, the locked and pinned lessons are checked on their own. A blocked conflict stops the run and lists the lessons." The pins are `timetable_pins` (0070): a load row, a weekday and a slot position, breaks counted, as `pattern_blocks.slot_position`; a pin of a group row holds its whole block in that slot. The solver keeps them fixed and treats the busy-elsewhere lessons of other branches, and the travel time around them, as fixed (`06`, Busy elsewhere).
  - From 5.3b-1 (pull request #128, decisions 3 and 8): the weights of the soft constraints are the eight `weight_<code>` columns of `timetable_versions` (codes `PREFERENCES` of `packages/timetable-rules`, in the order of the preferences table of `06`), whole numbers from 0 to 10; 0 means the preference is not used.
  - From 5.4c-3a (pull request #137, decisions 2 and 11): `double_not_allowed` (a double of a load row without "double lessons allowed") is a blocked rule to mirror in Kotlin; the solver places doubles only for rows that allow them, as two blocks with one `double_pair_id` in consecutive lesson slots with the same teacher and room (`double_apart`, checked per load row).
  - From 5.4c-3b (pull request #138, decisions 3 to 6): `edge/timetable`, Structure: "A mixed block is allowed: boys have physical education while girls have technology, and the reverse in another slot." The solver places a mixed split either whole or as pairings slot by slot with a half of another subject's mixed split of the same class (`partnersIn` of `packages/timetable-rules/src/facts-data.ts`); the engine's re-check accepts exactly those blocks (`checkBlocks`: any other set of rows in one block is `split_apart` with `rows`). `subject_twice` is counted per student (decision 2, Look first).

- [ ] **5.11 Generation in the product**
  - From the owner (20 October 2026): add the generate step and the solver's time to the real-size run of 5.12c (`docs/build-plan.md`, 5.12c).
  - Read: `06` (Auto-generation, Building a timetable), `edge/timetable` (Generator and editing).
  - Build: step 6 of the builder; the run as a background job on a snapshot; variants with score and comparison; regenerate with locks; generate for chosen classes; place the remaining lessons; lessons not placed listed with the blocking rule named by the rule engine.
  - Done when: a variant from older inputs is marked "inputs changed" and re-checked before use.
  - From 5.3b-2 (pull request #129, decision 1): `edge/timetable`, Generator and editing: "Before generating, the locked and pinned lessons are checked on their own. A blocked conflict stops the run and lists the lessons." `requireReady` already reads the pins' check (step 5); once 5.4b adds the busy-elsewhere lessons to `pattern-facts.ts`, the check before a run counts them. The locks of 5.4c-1 (`timetable_locks`, `lockedBy` of `packages/timetable-rules/src/locks.ts`) join the same check before a run, and "Regenerate" changes only what they do not hold.
  - From 5.4c-1 (pull request #135, decision 2 with review correction 5): a run and the use of a variant are draft writes and take `lockDraft`, so they are refused `draft_edit_locked` while another account holds the draft's edit lock.
  - From 5.3b-1 (pull request #128, decision 6): the run route calls `requireReady` of the timetable service first, in the run's transaction (409 `draft_not_ready`, one detail per step not ready).
  - From 5.4c-3a (pull request #137, decision 8): a lock on either half of a double holds the pair; Regenerate keeps the two halves together.
  - From 5.4c-3b (pull request #138): pins of a pairing are decided here. A pin names one load row (`timetable_pins`, 0070) and step 5 still refuses a mixed half (`pin_mixed_block`); a pinned pairing would need its partner row. A placed pairing is a block, so a lock holds it like any block (`lockedBy`).

- [ ] **3.7 The handbook for what is built so far** (owner, 15 October 2026)
  - Read: `docs/handbook/README.md`, every spec file, `docs/decisions.md`, issue #42 (the task comments and the owner's answers of 15 October 2026), issues #39 and #105, `docs/progress.md`, and the code and screens of every ticked task.
  - Build: the handbook pages of `docs/handbook/README.md` for everything built by the ticked tasks of Phases 0 to 5 (sign-in and roles, school setup, people, classes and groups, the teaching load, the calculations, and what of the timetable exists), feature by feature as the README says, describing what the platform does today; where the code and the spec differ, the page says what the code does and the report lists each difference as a finding.
  - Done when: every page the ticked tasks touch exists, every role row of `02` appears in a "Who can use it" table, the spec reviewer finds no rule of the ticked tasks missing from a page, and the report lists the code-and-spec differences. The builder may split this task by page.
  - From 3.5a (pull request #113, decision 10): what a person sees changed with the hand-test fixes of issue #105, Parts A and B; the pages for sign-in and roles, people, classes and the teaching load describe it: the role switch is a menu button "Menu and home page: <role>" whose menu says the rights stay those of all the roles (H11b); an active student whose start date is ahead reads "From <date>" in the list, the record, Ctrl+K, the merge preview and the export, "Starts later" only without a status row (H13); a scheduled leaving reads "Leaves the school (last day <date>)" until its first inactive day, on the record and the History tab (H3); the audit link of the student, staff and parent panels is "Change log" (H14); below 640 px the filters of a list with two or more fold behind "Filters · <number in use>" (H17); the Students Class filter offers every class of the branch not archived and of a year not closed (H18); the empty Classes, Groups and teaching load pages offer their first action as a primary button (H19); the teaching load and its weekly totals are cards below 640 px (H21); the phone tab bar has short labels (H16); the People tabs scroll without a bar, a cut edge faded (H15); the incoming branch moves are hidden once nobody waits (H12); names are surname first under the header "Surname and name" in the Students, Staff, Never used and Parents lists and the exports (H6, H7); the refusals name the class with its grade ("7 Oxford", H8), the class or group already using a name (H4), and the two classes and their languages in a move or return question (H5).
  - From 3.5b (pull request #116, decision 11): what a person sees changed with the hand-test fixes of issue #105, Part C; the pages for people, classes and the teaching load describe it: "Give Tutor" and "Set acting" with nobody holding the Tutor role say that the Super Admin gives roles and where, with a link to Staff and no form (H22); Archive of a class or group is off while it holds a student in force or planned, with the number and "move them first" beside it (H23); the Add student class choice marks a class with no seat from the start date ("— full") or from a later day ("— no free seat from <date>"), still selectable, and a refused placement, return, restore, branch-move accept or class move names the class and the first day without a seat, or with several students how many seats are free (H24); every phone field takes a number with or without "+998", with spaces, dashes, brackets or dots, also pasted after the prefilled "+998 ", shows it grouped once left, and refuses another with "Phone: +998 and 9 digits …"; nine digits alone are an Uzbek number and "+998" with 8 or 10 digits is refused (H25); a Save pressed before the relative's phone lookup answered waits for it and links the person found as "same person" (H26); changing only the date of a scheduled class move does not ask the language question again (H27); an action started on the History tab stays on History (H28); the merge preview lists the values that differ, start date, grade, scholarship, contracts and relatives included, each of both records and what is kept (H29); the teaching load says why nobody can take a row: the subject in nobody's profile (link to Staff), a Tutor subject on a class with no Tutor, or each teacher with the subject and the reason (not active, a grade, the language, another part of the block) (H30); the vacancy form keeps its Subjects field, saying to choose a department first or that the department has no subjects yet, with a link (H31); a branch switch asks about typed changes, then closes the open record of the old branch (H32); Ctrl+K has a Parents group by name and phone for the Super Admin, the Principal and the Academic Vice Principal, and finds a child by the parent's phone, naming the parent (H33).
  - From 3.5c (pull request #117, correction 7 of the plan review): what a person sees changed with the hand-test fixes of issue #105, Part D; the pages for people and classes describe it: one continuous stay of a student in a class, or in a group, is one row in the class and group panels and the record, so a cancelled or undone leaving or move never lists the student twice nor shows "Joins on" with a Withdraw for a student already in the class (H36); a cancel or an undo gives the stay back as it was, up to a leaving or a move still standing; a move back into the class on the day of the move is refused, the earlier change is cancelled or undone instead; the History tab has one line per stay in a class and in a group, "In 7 Oxford until <last day>", "until now" while in force, "from <date>" while ahead (H35); a scheduled move that was changed is one line with each change under it ("Date changed: 16 October → 23 October", "Class changed: …"), and "moved" is said only of a move that happened: a scheduled one "moves", a cancelled one "A move from … to … was planned · Cancelled" (H34); a merge of two records whose stays in one class or group continue each other keeps one stay.
  - From 3.6a (pull request #118, decision 16): who sees what changed with the owner's answers of 15 October; the pages for sign-in and roles and for people describe it: a Teacher's Students list holds the students taught in the published timetable only, opened with the Basic fields and the groups (no phone, score, contract, relatives or history), empty with "The students of your classes and groups appear once the timetable is published" until one is published, and Ctrl+K finds only them (L48); the diagnostic test score is shown in the Overview to the Super Admin, the Principal, the Academic Vice Principal, the Head Tutor, the Head Teachers and the class Tutor (L50); the Head Tutor reads every field of the branch's students (documents, the Contract and scholarship tab, the consent filter, the reasons of a leaving) and exports every group (L59); the Head Teachers export the Basic columns of the whole list (L59); a Tutor exports the own class with the phone, the relatives and the score, and a Tutor who is also a Head Teacher writes those only in the rows of the own class (L136); groups show on every row of the Students list (L147); the Head Teachers list names every holder in full in every branch (L32); the Principal searches the Parents list by phone.
  - From 3.6b-1 (pull request #119, decision 9): the mark "same person" follows the phones; the pages for people describe it: a parent and a staff member with the same main phone are the same person, shown as "Same person as a staff member" on the Parent panel (the staff member named and linked in the branch, "a staff member of another branch" otherwise) and "Also a parent" on the staff panel; nobody marks or removes it by hand, a corrected phone changes it and the change is in the change log; a new parent typed with a staff member's phone of the branch takes the staff record's name and email, locked in the form; a new staff member with a parent's phone is asked about first and takes the parent's email when none is typed; a staff phone held by another staff record, also one who left, is refused under the phone field with that record named in the branch; "Different person, the number has a new owner" is not offered for a phone that is also a staff member's, and the line says to correct the staff record's phone first.
  - From 3.6b-3 (pull request #123): the department move on its start date; the pages for people and for school setup describe it: a move of a teacher or a subject to another department, made by the Super Admin with its start date, shows on the record, the lists, the files and the personal-data report from that date, with "Moves to <department> on <date>" on the panel until then; the subjects a teacher may take, and the teachers of a subject, already follow the new department from the save, and the panel says so; the move can be changed or cancelled (by choosing the department in force) until its date; removing the Academic division takes effect when saved.
  - From 3.6b-2 (pull request #120, decision 12): the dates of a year and the return in August; the pages for school setup and for people describe it: an academic year is made longer at any time, also after its classes hold students, and shorter only when no class or group stay starts in the days cut off or ends in them by a dated leaving, class move, group move or branch move, otherwise the save is refused with the students in the way (at most 50, then "and N more"; "a student of another branch" for a student the branch no longer holds); a stay that runs to the last day of the year follows the new last day; a return, and the Super Admin's restore of a graduate, may be dated the first day of the branch's next planned year (offered as "First day of next year (<date>)"), the student staying inactive (graduated) until then with the class of next year booked; "Cancel the return" takes it back until its date (the cancel of a restore is the Super Admin's) and gives the grade back, after which the student can be returned again or the leaving undone; the History tab shows one inactive line for a leaving and its cancelled return.

- [ ] **5.7c Free now board**
  - Read: `06` (Free now board), `edge/timetable` (After publishing).
  - Build: the board by clock intervals with travel time; filters; acting from the board for the Academic Vice Principal; read-only view for Head Teachers and Senior Head Teachers.
  - Done when: a teacher with a lesson in another branch within the travel time is not shown as free.
  - From 5.7a-1 (pull request #185, review correction 4): `06`, Free now board, "Free teacher ... not marked absent": read through `absences_of_teachers` (0096) at the slot's moment.
  - From 5.7a-2b (pull request #187, decisions 5, 7 and 10): `06`, Free now board, "Free room. In use status, with no lesson or exam in that slot": a room closed at the slot by a live closure (`room_closures`, 0098) is not free, read through `roomsOut` of `rooms-out-read.ts`; "Clicking a free room moves a lesson there for that day" settles a lesson or an exam that needs a room (`GET /api/timetable/attention`, `needsRoom` and `examsNeedRoom`), and its check passes `closures: true` to `storedDayCheck` so that `room_closed` refuses a closed room.
  - From 5.7b-1 (pull request #191, decision 10): `06`, Free now board, "Fair load. Beside each free teacher the board shows how many substitutions they have taken this month", counted from `substitution_lessons` (0101, `lesson_date`) with no end or ended `corrected`, by the substitute of its record; "Clicking a free teacher on a lesson that needs one assigns a substitute" runs `POST /api/timetable/lessons/:id/substitute`.

- [ ] **8.3b Live updates**
  - Read: `edge/journal` (Saving and working together).
  - Build: Socket.IO updates between people in one journal; the "not live" state while the connection is down.
  - Done when: Playwright shows a second user's entry appearing without reload.

- [ ] **8.3c Offline entry**
  - Read: `12` (No lost work), `edge/journal` (Saving and working together), `edge/system-behaviour`.
  - Build: the unsent queue in the browser that survives reload and restart; judgement of each entry when the server receives it; the "not saved" list with reasons; lesson mode without a connection; the printable attendance sheet per class; the read-only switch.
  - Done when: an entry typed offline is saved after reconnect and one refused by a lock stays in the "not saved" list.

- [ ] **9.3b Analytics**
  - Read: `08` (Analytics in Release 1).
  - Build: each report in the table with its filters and export; prepared totals with "updated at".
  - Done when: a report that is behind the journal shows "updating" and then the right figure.
  - From 5.9a (pull request #197, decision 3, Look first; the load report half of the From line of 5.6c-1): `edge/timetable`, Exams, "Who sees exams, and what they count for": "Invigilations are listed in the load report apart from lessons and count for no journal, no plan and no discipline figure." The exams are read by `GET timetable/exams` (`examsOf`, `exams.service.ts`).

- [ ] **9.5a Closing the year**
  - Read: `edge/academic-year`.
  - Build: "Close the year" with its checklist; stored year results with class grade and name, subject and teacher as they were.
  - Done when: a renamed class still prints last year's name on last year's results.
  - From 2.4b-1 (pull request #68): `student_statuses_closed_year_guard` refuses a status row dated in a closed year; the graduation writes its rows (cause `graduation`) before the year's status becomes `closed`, in the same transaction (`04`, Movements: "marked graduated when the year closes").
  - From 3.1b (pull request #89): `class_memberships_active` (0045) refuses at the commit a class row outside the active time; a class row ends on the day after its year's end, so a graduation that begins inside the year also ends the class rows from its first day, in the same transaction (`ended_by` lists `leaving` and `withdrawn` only: a cause of its own is a migration of that task, under the only-shrink trigger).
  - From 3.2b (pull request #92, decision 8): the graduation ends the group rows of the dates the class rows lose, in the same transaction, as a leaving does (`cutGroupRows`); `group_memberships_in_class` (0048) refuses the commit otherwise; a cause of its own for `group_memberships.ended_by` is a migration of that task.

- [ ] **9.5b Rollover**
  - Read: `04` (Movements), `edge/academic-year`.
  - Build: the rollover plan per branch (classes keep their name and move up a grade; promote, repeat, leave, graduate); what is copied and what is not; undo until a lesson of the new year holds data.
  - Done when: a second run of rollover only shows the plan.
  - From 2.1 (pull request #52): `edge/academic-year`, "What does rollover copy?": "Copied as drafts to confirm: ... subject weights for the new quarters"; the quarterly distributions of the branch, in the subject's current round.
  - From 4.3 (pull request #104, row table): reads `edge/exemptions`, "A surgery exemption runs from May to September": the rollover lists exemptions still in force as "to renew".
  - From 3.6b-2 (pull request #120, decision 12): a student may already sit in a class of the next year through a scheduled return or restore dated its first day (L170); the rollover plan reads those rows as placed and does not place the student again.

- [ ] **9.5c Starting a year and the full-year simulation**
  - Read: `edge/academic-year`, `14` (Whole system), `edge/system-behaviour`.
  - Build: "Start year" (1.3 built its core: `POST /api/setup/academic-years/:id/start`, planned → current for a branch's first year or once every earlier year is closed; this task adds what the checklist and "Close the year" need around it); the nightly test that runs set-up, publish, entry, calendar change, four closings, year close and rollover with the clock moved through a year.
  - Done when: the simulation passes in CI.

- [ ] **9.6 Role guides, and the handbook in Uzbek and Russian** (owner, 15 October 2026)
  - Read: `docs/handbook/README.md` (Role guides, Languages) and every page, `02`, `12` (Language), the Uzbek and Russian texts of the screens.
  - Build: the role guides of `docs/handbook/roles/`, one per role of `02`, as the README says; then `docs/handbook/uz/` and `docs/handbook/ru/` with every reference page and every role guide in natural Uzbek and Russian, using the words the screens use; the English pages stay the source.
  - Done when: every role of `02` has a guide whose list matches the "Who can use it" tables, each guide links every rule it touches instead of restating it, every English page has both versions with the same headings, rules and cases; the owner corrects the wording afterwards. The builder may split this task.

## After Release 1

Release 2 (portal, SMS and Telegram notices, stipend, automatic UIDs) and Release 3 (HR, nurse, psychologist, library, mobile apps) get their own plans when Release 1 is live. Do not start them early.
