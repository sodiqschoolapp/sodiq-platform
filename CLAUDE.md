# Sodiq School platform

A school management web platform for Sodiq School (Uzbekistan): three branches, about 200 staff users, 2,000 students. One developer builds and runs it. Release 1 is the academic core: setup, people, classes and subjects, timetable (with automatic generation), journal, results, lesson plans.

## What matters most

1. The timetable and the journal must be correct. A wrong mark or a double-booked teacher is the worst possible bug. When speed of delivery and correctness pull apart, choose correctness.
2. The spec in `docs/spec/` is the source of truth. Read the files a task names before planning. Do not work from memory of the spec and do not invent rules. If the spec is silent or unclear, stop and ask.
3. Never change files under `docs/spec/` on your own. If a rule should change, stop and tell the owner; the owner runs the `/spec-change` skill.

## Rules that are never broken

- **Calculation in one place.** Every percentage, average, result and grade comes from `packages/calc`. No page, report or SQL query calculates a result on its own.
- **Exact arithmetic.** Results are exact fractions (BigInt numerator and denominator) from typed numbers to the final result, rounded once at the end. No floating point in calculations. Typed scores and totals are whole numbers.
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

TypeScript (strict) everywhere. Web: React, Vite, TanStack Router, TanStack Query, Tailwind CSS, shadcn/ui, AG Grid Community (journal), Pragmatic drag and drop (timetable board), i18next, Dexie (offline queue). Server: Node.js LTS, NestJS, REST described in OpenAPI with a generated client, Socket.IO, own sign-in module (Argon2id, cookie sessions, TOTP). Data: PostgreSQL, hand-written SQL migrations, Kysely with generated types, pg-boss for jobs. Solver: Timefold Solver Community Edition in Kotlin, a separate service. Tests: Vitest, Playwright, fast-check. Details and reasons: `docs/spec/13-technology.md`. Do not add or swap a library without asking.

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
docs/build-plan.md       ordered tasks with checkboxes
docs/progress.md         short log of what was done and what is next
docs/decisions.md        technical decisions and their reasons
docs/spec-changes.md     log of approved spec changes
```

API code is grouped by module in `apps/api/src/modules/<module>/`, and web code by feature in `apps/web/src/features/<feature>/`, with the same names: `auth`, `access`, `audit`, `notifications`, `setup`, `people`, `classes`, `timetable`, `journal`, `plans`, `results`.

## Commands

Task 0.1 creates these scripts. Update this list if a name changes.

```
pnpm install          install dependencies
pnpm dev              run web, api and worker locally
pnpm lint             lint all packages
pnpm typecheck        type-check all packages
pnpm test             unit and API tests
pnpm test:e2e         browser tests (Playwright)
pnpm db:migrate       apply SQL migrations to the local database
pnpm db:codegen       regenerate Kysely types from the database
pnpm api:client       regenerate the web API client from OpenAPI
pnpm auth:first-account -- --first-name <name> --last-name <name>
                      create the first Super Admin, once (prints login and first password)
```

## How to work on a task

1. One task from `docs/build-plan.md` per session and per branch. Start from an up-to-date `main`. Branch name: `task/<id>-<short-name>`.
2. Read the task, the spec files it lists, and `docs/progress.md`. Look at the existing code before proposing anything.
3. Write a plan first: files to change, database changes, tests to add, open questions. Wait for the owner's approval before editing code.
4. Write the tests with the code. For `packages/calc`, `packages/timetable-rules`, permissions and database constraints, write the failing test first.
5. Run `pnpm lint`, `pnpm typecheck` and `pnpm test` and fix every failure. Never skip, delete or weaken a test to get to green. If a test is wrong, say so and ask.
6. When the work is ready, stop and tell the owner. The owner runs the `/finish-task` skill: independent review, update of the plan and progress files, pull request.

## Conventions

- No `any`, no `@ts-ignore`, no non-null assertions without a comment that explains why it is safe.
- Validate every API input with a schema from `packages/shared`. The API returns one error shape everywhere.
- Database access through Kysely only. Raw SQL belongs in migrations and in named query files.
- A migration is a new numbered file. Never edit one that is merged. Changes that could lock a large table are done in two steps.
- Dates of lessons are stored as moments with time zone; school dates as dates. The branch time zone is a setting.
- Money, marks and totals are integers. Percentages shown to users are derived, never stored as typed input.
- Each feature folder holds its own components, hooks, API calls and tests. Shared UI goes in `apps/web/src/components`.
- Commit messages: short imperative subject, task id first, for example `1.3 Add calendar with days off`.

## Definition of done for a task

- The behaviour matches the listed spec files, including their edge cases.
- Tests cover the rules added, including refusals. Lint, type-check and tests pass locally and in CI.
- Permission tests exist for every new or changed route.
- New user-facing text exists in all three languages.
- The audit log records the new kinds of change.
- `docs/build-plan.md` is ticked in the same pull request, `docs/progress.md` has a dated entry, and anything left undone is written there.

Before task 0.8c some of these do not exist yet (permission guard, languages); skip only those.

## Ask before you do any of these

Adding a dependency, changing the database schema outside the task, changing a rule in `packages/calc` or the permission table, deleting data or tests, touching deployment or secrets, or anything the spec does not cover.
