# Sodiq School platform

A school management web platform for Sodiq School (Uzbekistan): three branches, about 200 staff users, 2,000 students. One developer builds and runs it. Release 1 is the academic core: setup, people, classes and subjects, timetable (with automatic generation), journal, results, lesson plans.

## What matters most

1. The timetable and the journal must be correct. A wrong mark or a double-booked teacher is the worst possible bug. When speed of delivery and correctness pull apart, choose correctness.
2. The spec in `docs/spec/` is the source of truth. Read the files a task names before planning. Do not work from memory of the spec and do not invent rules. If the spec is silent or unclear, take the most reasonable reading (the spec's own lines, the standing decisions, the way the school works), write it in the plan under "Decided without the owner" with the reason, and go on; the reviewer confirms or changes it when it approves the plan, and the owner confirms or changes it afterwards on issue #42. Only the things under "Stop and wait for the owner" stop a task.
3. Never change files under `docs/spec/` on your own. If a rule should change, or two rules contradict each other, it does not stop the task: follow the most reasonable reading, flag it **Look first** on issue #42 with the wording a `/spec-change` should give, and go on; the owner runs the `/spec-change` skill when they agree.

## Rules that are never broken

- **Calculation in one place.** Every percentage, average, result and grade comes from `packages/calc`. No page, report or SQL query calculates a result on its own.
- **Exact arithmetic.** Results are exact fractions (BigInt numerator and denominator) from typed numbers to the final result, rounded once at the end. The one exception is the year result: the exact mean of the quarter results as published, rounded once more for the year (owner, 15 October 2026; `07`, rule 11). No floating point in calculations. Typed scores and totals are whole numbers.
- **The database guards the rules.** Double booking of a teacher, room or class, overlapping memberships and duplicate cells are prevented by PostgreSQL constraints listed in `docs/spec/edge-cases/developer-rules.md`, not only by application code. Never weaken or remove one to make a test pass.
- **Permissions on the server.** Every API route checks role, branch and scope (subjects, class, own lessons). Hiding a button is not a permission check. Every route has allow and refuse tests.
- **Every change is audited.** Changes to timetable, journal, results, people and settings write to the append-only audit log in the same transaction.
- **One rule engine for the timetable.** `packages/timetable-rules` is used by the API, the grid and to re-check whatever the solver returns. Clash checks use real clock time, never slot numbers.
- **Time is injected.** Business code never reads the system clock directly. A clock is passed in so tests can set it.
- **Jobs in the same transaction.** A background job is enqueued in the same transaction as the data change that causes it.
- **Branch on every row.** Every table that belongs to a branch has a branch column and the row filter from task 0.4. A query never returns another branch's rows.
- **State from stored moments.** Locks, windows and exemption ends are stored as moments and compared with the clock on each request. A timed job never flips them.
- **Archive, do not delete.** Records that have data are archived and can be restored. Only the Super Admin's forced delete removes, with a reason.
- **Exports follow the role.** An export contains only what the role may see, and every export is logged.
- **No real personal data** in code, tests, seeds, logs, error reports or commit messages. Use invented names.
- **Three languages.** Every user-facing text goes through i18n keys with Uzbek, Russian and English values. No hard-coded strings in components.

## Stack

TypeScript (strict) everywhere. Web: React, Vite, TanStack Router, TanStack Query, Tailwind CSS, shadcn/ui, AG Grid Community (journal), Pragmatic drag and drop (timetable board), i18next, Dexie (offline queue). Server: Node.js LTS, NestJS, REST described in OpenAPI with a generated client, Socket.IO, own sign-in module (Argon2id, cookie sessions, TOTP). Data: PostgreSQL, hand-written SQL migrations, Kysely with generated types, pg-boss for jobs. Solver: Timefold Solver Community Edition in Kotlin, a separate service. Tests: Vitest, Playwright, fast-check. Details and reasons: `docs/spec/13-technology.md`. Adding or swapping a library is a **Look first** decision ("Stop and wait for the owner", below), not a stop.

## Repository layout

```
apps/web                 React single-page app
apps/api                 NestJS API and the jobs worker (two entry points)
apps/solver              Kotlin timetable solver service
packages/calc            calculation module, pure TypeScript, no dependencies
packages/timetable-rules timetable rule engine, pure TypeScript
packages/shared          shared types, validation schemas, roles and permission table
db/migrations            SQL migrations, numbered, never edited after merge
docs/spec                the spec (read only)
docs/recipes             how to build a recurring shape of task, from the code so far
docs/design-system.md    the look of every screen: tokens, sizes, parts, brand moments
docs/handbook            what the platform does, feature by feature, in plain words, for the school
docs/build-plan.md       ordered tasks with checkboxes
docs/progress.md         short log of what was done and what is next
docs/decisions.md        technical decisions and their reasons
docs/spec-changes.md     log of approved spec changes
```

API code is grouped by module in `apps/api/src/modules/<module>/`, and web code by feature in `apps/web/src/features/<feature>/`, with the same names: `auth`, `access`, `audit`, `notifications`, `setup`, `people`, `classes`, `timetable`, `journal`, `plans`, `results`, `feedback`.

## Commands

Task 0.1 creates these scripts. Update this list if a name changes.

```
pnpm install          install dependencies
pnpm dev              run web, api and worker locally
pnpm lint             lint all packages
pnpm typecheck        type-check all packages
pnpm test             unit and API tests (the whole suite; CI runs it on every pull request)
pnpm test:changed     the tests touched by the files changed since origin/main, in the
                      packages that changed and in those that depend on them
pnpm test:e2e         browser tests (Playwright)
pnpm db:migrate       apply SQL migrations to the local database
pnpm sync             switch to main, pull, install, migrate (before a hand test)
pnpm db:codegen       regenerate Kysely types from the database
pnpm api:client       regenerate the web API client from OpenAPI
pnpm security:checklist  write the generated tables of docs/security/permission-checklist.md again
pnpm auth:first-account -- --first-name <name> --last-name <name>
                      create the first Super Admin, once (prints login and first password)
```

## How to work on a task

1. One task from `docs/build-plan.md` per session and per branch. Start from an up-to-date `main` (`pnpm sync`). Branch name: `task/<id>-<short-name>`. The owner or the start routine runs `/next-task`; it does steps 2 and 3.
2. Read the task, the spec files it lists, `docs/progress.md` and the standing decisions in `docs/decisions.md`. Look at the existing code before proposing anything.
3. Write a plan first, for the whole task: splitting a task is not advised, and is done only when one session truly cannot build it (`next-task` step 7). The plan names files to change, database changes, tests to add, the decisions made without the owner and what needs the owner. Have the `spec-reviewer` agent check it, then open a draft pull request with the plan and wait in the same session for the plan review (up to 15 minutes; without a review in that time, stop). Build only after a `[review] approved` comment on the pull request; follow its corrections. `[review] owner decision needed` is for the stop list only ("Stop and wait for the owner") and waits for the owner.
4. Write the tests with the code. For `packages/calc`, `packages/timetable-rules`, permissions and database constraints, write the failing test first.
5. Run `pnpm lint`, `pnpm typecheck` and `pnpm test:changed` and fix every failure. CI runs the whole suite on the pull request and is the gate; a red CI is fixed before a review is asked for. Never skip, delete or weaken a test to get to green. If a test is wrong because a requirement or a decision changed, fix it, give the reason in the report and flag it **Look first**.
6. When the work is ready, run `/finish-task`: independent review, update of the plan and progress files, push, pull request marked ready with the report (what to look at, what the browser test proved, the decisions made without the owner). Then wait in the session for the `[review]` comment (up to 45 minutes, `finish-task` step 9): fix what `changes needed` lists; `ready to merge`: the reviewer merges; nothing is left for you.

The whole loop, the review routine and the cloud environment are described in `docs/cloud-loop.md`. A reviewer uses `/review-pr`.

## Conventions

- No `any`, no `@ts-ignore`, no non-null assertions without a comment that explains why it is safe.
- Validate every API input with a schema from `packages/shared`. The API returns one error shape everywhere.
- Database access through Kysely only. Raw SQL belongs in migrations and in named query files.
- A migration is a new numbered file. Never edit one that is merged. Changes that could lock a large table are done in two steps.
- Dates of lessons are stored as moments with time zone; school dates as dates. The branch time zone is a setting.
- Money, marks and totals are integers. Percentages shown to users are derived, never stored as typed input.
- Each feature folder holds its own components, hooks, API calls and tests. Shared UI goes in `apps/web/src/components`.
- Commit messages: short imperative subject, task id first, for example `1.3 Add calendar with days off`.
- No Python on the owner's laptop: a scripted edit uses Node or the Edit tool.

## Definition of done for a task

- The behaviour matches the listed spec files, including their edge cases.
- Tests cover the rules added, including refusals. Lint, type-check and tests pass locally and in CI.
- Permission tests exist for every new or changed route.
- New user-facing text exists in all three languages.
- The audit log records the new kinds of change.
- `docs/build-plan.md` is ticked in the same pull request, `docs/progress.md` has a dated entry, and anything left undone is written there.
- Every decision made without the owner is in the report and on issue #42.

Before task 0.8c some of these do not exist yet (permission guard, languages); skip only those.

## Stop and wait for the owner, even when nobody is watching

Until go-live (task 10.4) nothing the loop builds is used by real people, holds real data or spends money, so every mistake can be corrected afterwards (owner, 12 October 2026). Only two things stop a task. For these the session posts `[review] owner decision needed` (or says what it needs in the pull request) and stops:

1. Secrets, accounts with a provider, anything that costs money, and production (the live system, its data, its address).
2. A task pull request that changes the loop's own rules beyond the added check lines `review-pr` allows.

From the pilot on production (task 10.4, from 28 October 2026) real people and real data are on the live system, and three more things stop a task in the same way (owner, 26 October 2026):

3. A migration that changes or removes existing rows.
4. Any change to `packages/calc`.
5. Any change to permissions: `packages/shared/src/permissions.ts`, the permission guard, or what a route lets a role do.

No session connects to the production database or reads production logs or data. Production is reached only by the deploy job, which the owner starts by hand, after 18:00 or at the weekend, Tashkent time.

Two brakes are failures, not decisions, and stay: three review rounds without agreement, and three red CI runs in a row.

Everything else (a new permission area for new routes, a schema detail, a name, a default, a UI choice, and the kinds below) is decided, written under "Decided without the owner" in the plan and the report, confirmed or changed by the reviewer, and posted on issue #42. The weightiest decisions carry the mark **Look first** and come first in the task's #42 comment:

- a test, constraint, index or trigger deleted or weakened, or a pinned list widened: only when a requirement or a decision changed, never to make failing code pass, with the reason named; a merged migration is still never edited;
- a reading of a `packages/calc` or journal calculation rule (the exact-arithmetic rule is never broken);
- a new dependency: free licence, maintained, no audit finding, all three checked by the reviewer;
- widening what an existing role may already do;
- personal data readable across branches;
- a spec contradiction, or a spec text that should change, with the proposed `/spec-change` wording;
- a task split into a, b, c.

Before go-live the owner and the owner's reviewer go through every Look first decision again, and the owner tightens this list for the live system.
