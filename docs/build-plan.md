# Build plan for Release 1

Tasks are done in order, one per session, branch and pull request. Each task lists the spec files to read, what to build, and how to know it is done. The task's box is ticked inside its own pull request (the `/finish-task` skill does this).

How to read the task lines:

- `01` to `17` mean the files in `docs/spec/`, and `edge/<name>` means `docs/spec/edge-cases/<name>.md`. Words in brackets name the heading to look at first; still read the whole file.
- Every task also reads `edge/00-definitions`. Every task that adds a migration also reads `edge/developer-rules`.
- "Done when" is the minimum. The definition of done in `CLAUDE.md` applies to every task from 0.8c on; before that, the parts that do not exist yet (permission guard, languages) are skipped.
- If a task is still too large for one session, split it into a, b, c in this file before starting and ask the owner to confirm.

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

- [ ] **0.7b Permission table and guard**
  - Read: the same files.
  - Build: the permission table in `packages/shared` (its shape; each later task adds the rows of its area); a server guard used by every route, with the branch of the request; the "nobody approves their own request" helper; a test harness that checks every route against every role; permission declarations for the existing routes of the own sign-in (open to every signed-in account); JSON bodies only; `Cache-Control: no-store`; the request key tied to the account.
  - Done when: the harness fails if a route has no permission declaration, and sample routes pass for all 15 roles.

- [ ] **0.8a Web shell: sign-in, layout and languages**
  - Read: `12`, `02`.
  - Build: sign-in, password change and second-step screens; the app layout; i18next with Uzbek, Russian and English; a check that fails the build when a translation key is missing in any language.
  - Done when: Playwright signs in and out in each language.

- [ ] **0.8b Web shell: shared patterns**
  - Read: `12` (One pattern everywhere, No lost work, Look and feel), `14` (Whole system).
  - Build: the shared list pattern (search, filters, column chooser, sorting, bulk actions, export, side panel); form, table, empty, loading and error patterns; Ctrl+K search (pages only for now; records are added as they are built); the feedback button; the unsent-changes banner.
  - Done when: a sample list and form use only the shared pieces.

- [ ] **0.8c Web shell: menus and home pages per role**
  - Read: `02`, `08` (Home pages by role).
  - Build: navigation per role; role switcher and branch switcher; an empty home page for each role that later tasks fill.
  - Done when: a signed-in user of each of the 15 roles sees the right menu.

- [ ] **0.9 Notifications to staff in the app**
  - Read: `10` (Notifications, and the last paragraph: staff notifications are Release 1), `edge/system-behaviour`.
  - Build: a notification record per person; the list and unread count in the top bar; delivery through a job; live arrival over Socket.IO; a helper that later tasks call for timetable changes, substitutions, locks, requests and plan windows. No SMS, no parents, no students.
  - Done when: a test event reaches the right person and nobody else.

- [ ] **0.10 Test environment and deploy pipeline**
  - Read: `13` (Hosting and data, Running cost), `edge/system-behaviour`.
  - Build: Render services for API and worker; static site for the web app; Neon database; Cloudflare R2 bucket; Sentry; Resend for the mail service; deploy from `main` by GitHub Actions; migrations run before the new version starts; a smoke test after deploy. The owner creates the accounts and enters the secrets in each provider's dashboard. Never ask for secrets in chat and never write them to a file in the repository.
  - Done when: a merged pull request reaches the test environment without manual steps and the smoke test passes.

## Phase 1. School setup

- [ ] **1.1 Branches, buildings, floors and rooms**
  - Read: `03`, `edge/timetable` (Structure).
  - Build: full branch record on top of the table from 0.4; buildings and floors; rooms with type, capacity, status and the "shared" switch; the room list.
  - Done when: the Super Admin can create and edit them and other roles are refused.

- [ ] **1.2 Divisions and departments**
  - Read: `03` (Divisions).
  - Build: the eight divisions as data with Academic built in; departments; names in three languages; archive rules.
  - Done when: Academic cannot be renamed or archived and a division with active staff cannot be archived.

- [ ] **1.3 Academic year and quarters**
  - Read: `03`, `edge/academic-year`, `edge/time-dates-calendar`.
  - Build: years with status (planned, current, closed); exactly one current year per branch; four quarters with no overlaps or gaps; the go-live start date per branch.
  - Done when: the database refuses a second current year and overlapping quarters.

- [ ] **1.4 Calendar**
  - Read: `03`, `edge/time-dates-calendar`.
  - Build: days off and special days for the whole branch or a range of grades; each date resolves to "no lessons" or to one day template.
  - Done when: tests cover a holiday inside a week, a working Saturday and a grade-range entry.

- [ ] **1.5 Slot types and day templates**
  - Read: `03`, `06` (Model), `edge/time-dates-calendar`.
  - Build: slot types (lesson or break, length in minutes); day templates as an ordered list of slots with calculated times; default template, weekday templates, special-date templates and templates per grade range.
  - Done when: times are never typed, reordering recalculates them, and a lesson can only sit in a lesson slot.

- [ ] **1.6 Settings and the setup checklist**
  - Read: `03`, `07` (Entering data, Editing rules and locks), `06` (Teachers who work in several branches), `05` (Language of instruction), `08` (Early-warning list), `edge/academic-year`.
  - Build: settings for edit days, attendance values, early-warning thresholds, travel time between branches and languages of instruction; the fixed grade bands; the per-branch setup checklist with the items that exist so far. Later tasks add their own items to the checklist.
  - Done when: each setting has a permission test and the checklist reflects real state for Phase 1 items.

## Phase 2. Subjects and people

- [ ] **2.1 Subjects**
  - Read: `05` (Grading weights on a subject), `07` (Calculation rules), `edge/calculation`.
  - Build: subject with names in three languages, department, grades, journal type, switches (rating exam, group, language rule, demanding), daily distribution, and quarterly distribution per quarter; the subject list.
  - Done when: a graded subject cannot be saved with weights that do not total 100.

- [ ] **2.2 Staff records**
  - Read: `04` (Teacher and staff record), `03` (Divisions), `edge/people-roles-accounts` (Staff over time).
  - Build: staff record with main and further branches, main and further divisions, department, subjects with grades, languages of instruction, availability per branch, and status with dates; the staff list with the columns in the spec, filters and Excel export.
  - Done when: availability in two branches cannot overlap and status changes keep history.

- [ ] **2.3 Accounts and role assignment screens**
  - Read: `02` (Head Teachers and Senior Head Teachers, Rules), `edge/people-roles-accounts` (Who can act, Accounts and sign-in).
  - Build: Super Admin screens to create accounts and give roles per branch; Head Teacher appointments to subjects in a branch (at most one per subject per branch); Senior Head Teacher appointments to subjects across branches; subject scope in the permission guard; lock and unlock; the route for the password reset by an administrator (the service exists since 0.6b) with who may reset whom; the route for the second-step reset by a Super Admin (the service exists since 0.6c); password reset by email through a mail service that only logs locally, with the address taken from the staff record (moved from 0.6b; its routes are public and go into `PUBLIC_ROUTES`).
  - Done when: the refusals in the spec are tested, including the last Super Admin rule, and tests cover each rule of the email reset with the injected clock.

- [ ] **2.4 Student records**
  - Read: `04` (Student record, UID sets), `edge/students-classes-groups`, `edge/people-roles-accounts` (Personal data and the audit log), `16` (question 12 is open: the UID is typed by hand and must be unique; do not build automatic UIDs).
  - Build: student record with contract and scholarship fields; statuses (active, inactive, graduated) with restore; profile tabs that have data so far; the student list with columns, filters and Excel export; hidden fields shown only to allowed roles, each viewing logged; a student account created with the record and switched off until Release 2.
  - Done when: a duplicate UID is refused, including against archived records.

- [ ] **2.5 Close relatives (Parents)**
  - Read: `04` (Close relatives), `edge/close-relatives`.
  - Build: school-wide relative records unique by main phone; links to several students with relationship, main contact, portal access and "receives notices"; the "no phone of their own" case; the Parent list and page; a Parent account created with the record and switched off until Release 2.
  - Done when: a student cannot be saved without at least one relative and phone uniqueness holds across branches.

- [ ] **2.6 Audit log screen and personal data tools**
  - Read: `edge/people-roles-accounts` (Personal data and the audit log), `13` (Security).
  - Build: the audit log screen with search by person, record and date, and the reading rights per role; each user's own sign-in history; the personal data report per person; the locked support account that a Super Admin opens for at most 24 hours; export rules (limited by role, every export logged).
  - Done when: a Principal sees only the branch's log and every export leaves a log entry.

## Phase 3. Classes, groups and teaching load

- [ ] **3.1 Classes**
  - Read: `05`, `edge/students-classes-groups`, `edge/developer-rules`.
  - Build: class as grade plus name (shown as "7 Oxford"), language of instruction, Tutor, main classroom, maximum size; class membership as date ranges that cannot overlap (database constraint); class scope for Tutors in the permission guard; class cards and list.
  - Done when: the database refuses a student in two classes on one date and the Tutor language rule is enforced.

- [ ] **3.2 Groups and splits**
  - Read: `05`, `06` (Model), `edge/timetable` (Structure), `edge/students-classes-groups`.
  - Build: groups across classes and splits of one class; membership by date ranges, one group per student per subject per date (database constraint); group language rules; the bulk placement screen; the list of students not yet placed.
  - Done when: every student of the classes involved must be in exactly one group before a load row is valid.

- [ ] **3.3 Movements**
  - Read: `04` (Movements), `edge/students-classes-groups`.
  - Build: class transfer and group transfer with an effective date; leave and restore; scheduled moves; confirmation when moving between an Uzbek and a Russian class; the History tab. The effect inside journals is built in 8.6.
  - Done when: history shows each move with dates and a move into the past is handled as the spec says.

- [ ] **3.4 Teaching load**
  - Read: `05`, `06` (Building a timetable, Rules), `edge/timetable` (Structure).
  - Build: load rows (class or group, subject, one teacher, lessons per week, room needs, double lessons); checks for subject and grade in the teacher's profile, the language rule, split rules, weekly totals against slots and against the contract load across branches; the load belongs to a timetable version.
  - Done when: each blocked case in the spec has a test.

## Phase 4. Calculation module

- [ ] **4.1 Exact fractions and daily results**
  - Read: `07` (The total, Calculation rules), `edge/calculation`, `edge/developer-rules`.
  - Build in `packages/calc`: a fraction type on BigInt; percentage of a work from number and total; attendance values; daily result from the daily distribution; the rules for empty scores.
  - Done when: the worked examples in the spec pass as tests and property tests show no floating point is used.

- [ ] **4.2 Quarter and year results**
  - Read: `07` (Calculation rules), `08` (Student results), `14` (Journal), `edge/calculation`.
  - Build: quarter averages; quarter result from the quarterly distribution; rating exam handling; provisional results; grade bands; year result as the mean of exact quarter results; rounding once at the end; the folder and format for the reference journals of the quality plan, which the owner fills with hand-checked cases.
  - Done when: the boundary examples in the spec pass (for example 49.5, and the year case of 49.475) and the reference-journal test runs on at least one sample.

- [ ] **4.3 Exemptions, flags and special outcomes**
  - Read: `07` (Exemptions), `edge/exemptions`, `edge/calculation`.
  - Build: exempt lessons left out; the "Exempt" and "Not assessed" outcomes; the few-lessons flag; the attendance-only flag; start-quarter counting from the go-live date; the stored inputs and module version that go with each final result.
  - Done when: every row of the two edge-case tables has a test.

## Phase 5. Timetable

- [ ] **5.1 Data model and database constraints**
  - Read: `06` (Model), `edge/timetable`, `edge/developer-rules`, `edge/time-dates-calendar`.
  - Build: versions, pattern entries, lesson blocks, and dated lessons with their own start and end; exclusion constraints for teacher, room and class block across all branches; the shared-room trigger.
  - Done when: the database itself refuses each double booking in tests, also when application checks are bypassed.

- [ ] **5.2 Rule engine**
  - Read: `06` (Rules, Teachers who work in several branches), `05` (Language of instruction), `edge/timetable`.
  - Build in `packages/timetable-rules`: every blocked rule and warning, by clock time; travel time between branches; the language rule; a result that names the rule and the lessons involved.
  - Done when: each rule in the Rules table has passing and failing test cases.

- [ ] **5.3 Draft builder, steps 1 to 5**
  - Read: `06` (Building a timetable).
  - Build: draft versions; the steps for templates, load, teachers, rooms and rules with their "ready when" checks; pinned lessons.
  - Done when: a draft cannot move to generation while a readiness check fails.

- [ ] **5.4a Grid: board and drag**
  - Read: `06` (Editing in the grid), `12`.
  - Build: the board with Pragmatic drag and drop; move and swap; live conflict marking from the rule engine; the server refuses what the grid refuses.
  - Done when: Playwright moves a lesson, sees a blocked move refused with the rule named, and the same move is refused when the API is called directly.

- [ ] **5.4b Grid: panels and views**
  - Read: `06` (Editing in the grid, Teachers who work in several branches, Views and outputs).
  - Build: views by class, teacher and room on a clock axis; the "to place" panel; the conflict panel; grey "busy in another branch" blocks; the warning when another branch's draft uses the same teacher.
  - Done when: every item of the "Editing in the grid" list is present.

- [ ] **5.4c Grid: locks and the draft edit lock**
  - Read: `06` (Editing in the grid, Auto-generation), `edge/timetable` (Generator and editing).
  - Build: locks on a lesson, class, teacher or day; undo; the edit lock on a draft that is released after 5 minutes without activity.
  - Done when: a second Academic Vice Principal can take over a draft and the first is told.

- [ ] **5.5a Publish: preview and checks**
  - Read: `06` (Changes after publishing, How surprises are prevented), `edge/timetable` (Versions and drafts).
  - Build: the impact preview; start date rules; the out-of-date draft check; one publish per branch at a time; a publish that fails changes nothing.
  - Done when: two publishes at the same moment are tested.

- [ ] **5.5b Publish: dated lessons**
  - Read: `06` (What a change does to existing data, How surprises are prevented), `edge/timetable` (Versions and drafts), `edge/time-dates-calendar`.
  - Build: generation of dated lessons from the start date to the end of the academic year, following the calendar and day templates; no change to any lesson dated today or earlier; stored one-day changes applied again after a publish.
  - Done when: a version that starts mid-week and a holiday inside a week are tested.

- [ ] **5.5c Publish: journals, notices and withdraw**
  - Read: `06` (How surprises are prevented), `07` (first paragraph), `edge/timetable` (Versions and drafts), `edge/developer-rules`.
  - Build: the journal record (one per class or group and subject per year) created or closed at publish, without cells; notices to affected teachers through 0.9; the "changed" mark for a week; withdraw before the start date.
  - Done when: publishing a load with a new subject creates exactly one journal and removing it closes that journal.

- [ ] **5.6a One-day changes**
  - Read: `06` (Changes after publishing), `edge/timetable` (After publishing).
  - Build: move, room change, cancel and restore, extra lesson, bulk cancel, and correction of a past lesson by the Academic Vice Principal with a reason.
  - Done when: each row of the "After publishing" table that concerns these actions has a test.

- [ ] **5.6b Calendar and template changes after publishing**
  - Read: `edge/time-dates-calendar`, `06` (What a change does to existing data).
  - Build: what happens to existing dated lessons when a day off is added or removed, a day template changes, or quarter dates change.
  - Done when: every row of the edge-case table has a test.

- [ ] **5.7a Teacher absence**
  - Read: `06` (Changes after publishing, Teachers who work in several branches), `edge/timetable` (After publishing), `edge/people-roles-accounts` (Staff over time).
  - Build: an absence entered once for the person, covering every branch; "needs a teacher" and "unresolved" lessons on the Academic Vice Principal's home page; what happens when a teacher goes inactive or leaves, or a room is closed.
  - Done when: an absence entered in one branch reaches the Academic Vice Principal of the other.

- [ ] **5.7b Substitution**
  - Read: `06` (Changes after publishing), `edge/timetable` (After publishing).
  - Build: the one Substitution action, started from a lesson or from an absent teacher; suggestions ordered by subject, department and language; the substitution record; the substitute's rights on that lesson.
  - Done when: the exception "no teacher of the subject is free" works as the edge case says.

- [ ] **5.7c Free now board**
  - Read: `06` (Free now board), `edge/timetable` (After publishing).
  - Build: the board by clock intervals with travel time; filters; acting from the board for the Academic Vice Principal; read-only view for Head Teachers and Senior Head Teachers.
  - Done when: a teacher with a lesson in another branch within the travel time is not shown as free.

- [ ] **5.8 Protection and version history**
  - Read: `06` (Protection).
  - Build: a dated lesson with data cannot be deleted or change its class, group or subject; forced delete by the Super Admin with a reason and 30-day restore; version history, comparison of two versions, reopening an old version as a new draft.
  - Done when: each of the four Protection rules has a test.

- [ ] **5.9 Timetable views, print and export**
  - Read: `06` (Views and outputs), `edge/system-behaviour`.
  - Build: teacher, class, room and branch views; the teacher home page with today's lessons from all branches; the version number and "valid from" on prints; PDF and Excel export.
  - Done when: exported PDFs show Uzbek Latin and Cyrillic correctly.

- [ ] **5.10 Solver service**
  - Read: `06` (Auto-generation, Rules), `13`, `edge/timetable` (Generator and editing).
  - Build: `apps/solver` in Kotlin with Timefold Solver Community Edition; hard constraints equal to the blocked rules and soft constraints from the preferences table; pinned lessons kept; a time limit of 5 minutes with a first draft in about a minute.
  - Done when: on sample data of one branch the solver returns a draft that the TypeScript rule engine accepts with zero blocked rules.

- [ ] **5.11 Generation in the product**
  - Read: `06` (Auto-generation, Building a timetable), `edge/timetable` (Generator and editing).
  - Build: step 6 of the builder; the run as a background job on a snapshot; variants with score and comparison; regenerate with locks; generate for chosen classes; place the remaining lessons; lessons not placed listed with the blocking rule named by the rule engine.
  - Done when: a variant from older inputs is marked "inputs changed" and re-checked before use.

- [ ] **5.12 Timetable end-to-end tests**
  - Read: `14` (Timetable).
  - Build: the named cases of the quality plan as automated tests, including simultaneous actions.
  - Done when: all named cases pass in CI.

## Phase 6. Journal: model, grid and attendance

- [ ] **6.1 Cells and history**
  - Read: `07`, `edge/journal`, `edge/developer-rules`.
  - Build: cells unique on lesson, student and work, each with a version number; history per cell; who is expected in a lesson on its date.
  - Done when: a stale save is refused and history records who changed what.

- [ ] **6.2 Journal grid**
  - Read: `07` (Opening a journal, Layout, Who can do what), `12`.
  - Build: the AG Grid Community grid with pinned student columns, lesson columns grouped by date, scroll to the nearest date, summary columns from `packages/calc`, the bottom row, student search, and lesson mode for today's lesson.
  - Done when: the grid meets the speed targets in `12` with a full quarter of data.

- [ ] **6.3 Attendance**
  - Read: `07` (Entering data), `edge/journal` (Entering, Attendance figures).
  - Build: attendance marks and their values; "all present"; absence reasons recorded by the Tutor; attendance-only journals (Homework slot, Ma'naviyat soati).
  - Done when: "all present" is one request with one history entry per cell.

## Phase 7. Lesson plans

- [ ] **7.1a Plans and items**
  - Read: `09` (What a plan contains), `edge/lesson-plans` (How items stay attached).
  - Build: a plan per class or group and subject; items with topic, classwork, homework and files; file limits; attachment of items to lessons in order; who can see a plan.
  - Done when: a plan fills the lessons of a quarter in order.

- [ ] **7.1b Items follow the timetable**
  - Read: `09` (When something else changes), `edge/lesson-plans` (How items stay attached).
  - Build: re-attachment of the queue when lessons are cancelled, added, moved or their number changes; the "not covered" list; prepared edit requests; the impact preview per plan.
  - Done when: every row of the "When something else changes" table has a test.

- [ ] **7.1c Shared plans**
  - Read: `09` (What a plan contains), `05` (Language of instruction).
  - Build: one plan shared by several classes of the same grade and language; separate later; copy from another plan.
  - Done when: classes of different languages cannot share a plan.

- [ ] **7.2 The plan window and edit requests**
  - Read: `09` (The plan window, Editing after the window), `02` (Head Teachers and Senior Head Teachers), `edge/lesson-plans` (The window and requests).
  - Build: the window opened per quarter by the Academic Vice Principal; edit requests after the window, with the approver setting the number of days; system-prepared requests; routing to the Head Teacher of the subject, the Senior Head Teacher and the Academic Vice Principal; notices through 0.9.
  - Done when: nothing opens without an approved request and nobody approves their own.

- [ ] **7.3 Master plans**
  - Read: `09` (Master plans), `edge/lesson-plans`.
  - Build: masters per subject, grade, language and quarter; copy to a class; the "master updated" comparison; a Senior Head Teacher's master for all branches.
  - Done when: a copied plan is independent of its master.

## Phase 8. Journal: works, rules and exemptions

- [ ] **8.1 Classwork and homework**
  - Read: `07` (Entering data, The total), `09` (In the journal), `edge/journal` (Entering), `edge/lesson-plans` (Plans and the journal).
  - Build: columns taken from the plan; works added by hand when a lesson has no plan item, flagged "unplanned"; a total per work, whole numbers only, percent shown; one classwork and one homework per lesson; homework entered on the lesson where it is checked; "not held"; no empty columns.
  - Done when: the first lesson of a journal has no homework column and every entering rule has a test.

- [ ] **8.2 Rating exam and comments**
  - Read: `07` (Entering data, Layout), `edge/journal` (Entering).
  - Build: the rating exam score per student per quarter in rating subjects, with "did not sit" and "exempt"; comments on a mark or score and notes per student per lesson, each "staff only" or "visible to parents"; keyboard entry rules.
  - Done when: a non-rating subject has no exam column.

- [ ] **8.3a Saving and stale saves**
  - Read: `07`, `12` (No lost work), `edge/journal` (Saving and working together), `edge/system-behaviour`.
  - Build: save per cell with optimistic display; refusal of stale saves with both values shown; repeat-safe saves; the application version on every request.
  - Done when: two saves of one cell from two sessions are tested.

- [ ] **8.3b Live updates**
  - Read: `edge/journal` (Saving and working together).
  - Build: Socket.IO updates between people in one journal; the "not live" state while the connection is down.
  - Done when: Playwright shows a second user's entry appearing without reload.

- [ ] **8.3c Offline entry**
  - Read: `12` (No lost work), `edge/journal` (Saving and working together), `edge/system-behaviour`.
  - Build: the unsent queue in the browser that survives reload and restart; judgement of each entry when the server receives it; the "not saved" list with reasons; lesson mode without a connection; the printable attendance sheet per class; the read-only switch.
  - Done when: an entry typed offline is saved after reconnect and one refused by a lock stays in the "not saved" list.

- [ ] **8.4 Edit period, unlocks and corrections**
  - Read: `07` (Editing rules and locks), `02` (Head Teachers and Senior Head Teachers), `edge/journal` (Locks, unlocks and corrections).
  - Build: the lock at 23:59 branch time on the lesson date plus the edit days, worked out on each request from stored moments; unlock requests routed to the Head Teacher of the subject, the Senior Head Teacher or the Academic Vice Principal; nobody approves their own; corrections by the Academic Vice Principal with a reason; branch-wide extension of the edit period.
  - Done when: tests at 23:59 and 00:00 pass with the injected clock.

- [ ] **8.5 Exemptions**
  - Read: `07` (Exemptions), `edge/exemptions`.
  - Build: exemptions entered by the Academic Vice Principal or Super Admin (temporary or full, all or chosen subjects, whole days or chosen slots); cells shown as exempt; the late-entry preview; end and void; notices to the Tutor and teachers.
  - Done when: every row of the "Problem cases" table has a test.

- [ ] **8.6 Transfers and leaving inside the journal**
  - Read: `07` (Transfers), `edge/students-classes-groups`, `edge/calculation`.
  - Build: what a journal shows and counts when a student changes class or group, joins late, leaves or returns; results that follow the student; the "result at leaving".
  - Done when: a transfer made at the same moment as a cell save is tested.

- [ ] **8.7 Lesson status, reminders and the discipline report**
  - Read: `07` (Lesson status, Reminders).
  - Build: the four lesson statuses; the reminders panel on the journal and the teacher home page; counts per teacher for Head Teachers and the Academic Vice Principal.
  - Done when: the counts on the home page match the journal.

- [ ] **8.8 Plans in the journal**
  - Read: `09` (In the journal, Reports), `edge/lesson-plans` (Plans and the journal).
  - Build: topic and titles shown in the journal; "topic not delivered" and "homework not given"; plan reports (completeness, progress, share of "not held").
  - Done when: marking a homework "not given" removes the next lesson's homework column.

- [ ] **8.9 Journal exports and the support view**
  - Read: `07` (last paragraph), `edge/journal`, `edge/system-behaviour`.
  - Build: Excel and PDF export of a journal; branch-wide export as a background job from one consistent moment; the support view of one student, journal and date showing every save and refusal.
  - Done when: an export link stops working after 24 hours and access is checked again at download.

## Phase 9. Results, closing and reports

- [ ] **9.1 Quarter results and the student results page**
  - Read: `08` (Student results), `07` (Calculation rules), `edge/calculation`.
  - Build: the Results and Attendance tabs of the student profile; quarter and year results per subject; the trace from a result to its lessons.
  - Done when: every figure shown comes from `packages/calc`.

- [ ] **9.2a Closing checklist**
  - Read: `07` (Closing a quarter), `edge/journal` (Closing and reopening), `edge/calculation`.
  - Build: the checklist with blocking items and warnings; decisions on flagged results, one by one or for a whole journal.
  - Done when: each row of the checklist table has a test.

- [ ] **9.2b Closing a quarter**
  - Read: `07` (Closing a quarter), `edge/journal` (Closing and reopening), `edge/academic-year`, `edge/system-behaviour`.
  - Build: close for the whole branch in one step; stored final results with their inputs; the start-quarter choice ("keep" or "not official").
  - Done when: closing against a simultaneous cell save is tested.

- [ ] **9.2c Reopening and the nightly check**
  - Read: `edge/journal` (Closing and reopening), `edge/system-behaviour`.
  - Build: reopen rules; the nightly job that recalculates open journals and stored results, alerts on a difference and blocks closing that journal.
  - Done when: a deliberately corrupted stored result is caught by the check in a test.

- [ ] **9.3a Rating**
  - Read: `08` (Rating).
  - Build: the rating lists with their filters, including language and branch, and Excel export.
  - Done when: students without a result are handled as the spec says.

- [ ] **9.3b Analytics**
  - Read: `08` (Analytics in Release 1).
  - Build: each report in the table with its filters and export; prepared totals with "updated at".
  - Done when: a report that is behind the journal shows "updating" and then the right figure.

- [ ] **9.4a Early-warning list**
  - Read: `08` (Early-warning list).
  - Build: the list with its thresholds and who sees it.
  - Done when: a subject with fewer than five graded works lists nobody.

- [ ] **9.4b Home pages**
  - Read: `08` (Home pages by role).
  - Build: the first screen of each role, filling the shells from 0.8c.
  - Done when: each role's first screen matches the table in the spec.

- [ ] **9.5a Closing the year**
  - Read: `edge/academic-year`.
  - Build: "Close the year" with its checklist; stored year results with class grade and name, subject and teacher as they were.
  - Done when: a renamed class still prints last year's name on last year's results.

- [ ] **9.5b Rollover**
  - Read: `04` (Movements), `edge/academic-year`.
  - Build: the rollover plan per branch (classes keep their name and move up a grade; promote, repeat, leave, graduate); what is copied and what is not; undo until a lesson of the new year holds data.
  - Done when: a second run of rollover only shows the plan.

- [ ] **9.5c Starting a year and the full-year simulation**
  - Read: `edge/academic-year`, `14` (Whole system), `edge/system-behaviour`.
  - Build: "Start year"; the nightly test that runs set-up, publish, entry, calendar change, four closings, year close and rollover with the clock moved through a year.
  - Done when: the simulation passes in CI.

## Phase 10. Before go-live

- [ ] **10.1 Speed tests**
  - Read: `12` (Speed targets), `14` (Whole system), `edge/system-behaviour`.
  - Build: a data generator for three times the estimated yearly data with invented names; automated measurement of each target.
  - Done when: every target is met or the gap is written in `docs/progress.md` with a plan.

- [ ] **10.2 Backups, restore drill and monitoring**
  - Read: `13` (Hosting and data), `14` (Whole system), `edge/system-behaviour`.
  - Build: the daily export to R2; written steps for restoring to a side copy; Sentry, Grafana Cloud and UptimeRobot alerts to Telegram; the sign-in-and-save check every 5 minutes with a test teacher account.
  - Done when: the owner has restored a backup once by following the written steps.

- [ ] **10.3 Permission and security review**
  - Read: `02`, `13` (Security), `edge/people-roles-accounts`.
  - Build: the missing route-by-role tests; a written permission checklist for the owner to sign; fixes for what the review finds.
  - Done when: the harness covers every route and the owner has signed the checklist.

- [ ] **10.4 Production and the go-live checklist**
  - Read: `13`, `edge/academic-year`, `14` (Whole system).
  - Build: the production environment; the first Super Admin; the written go-live and pilot checklists (which data to enter first, which grade pilots, how results are compared).
  - Done when: production is deployed and the checklists are approved by the owner.

## After Release 1

Release 2 (portal, SMS and Telegram notices, stipend, automatic UIDs) and Release 3 (HR, nurse, psychologist, library, mobile apps) get their own plans when Release 1 is live. Do not start them early.
