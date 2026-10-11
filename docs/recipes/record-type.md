# Recipe: a new record type

How to add a record that a role creates, edits and archives: a table, its routes, a list page with a side panel, texts in three languages, and the tests. Built twice so far, and this page is taken from that code: buildings, floors and rooms (task 1.1, migration 0014) and divisions and departments (task 1.2, migration 0015). `next-task` reads this page before the code; copy the shape of the files it names, not their text. A new slot in a list below (a route, a table, a page) is a line in that list, never a second list.

## The files, in build order

### 1. Migration

`db/migrations/00NN_<name>.sql`, a new numbered file (`.claude/rules/database.md`; read `docs/spec/edge-cases/developer-rules.md` first).

- A comment block at the top quoting the spec lines the table rests on and naming the owner's decisions and the pull request.
- `id uuid primary key default uuidv7()`; names with `constraint <table>_name_check check (length(btrim(name)) between 1 and N)`, the bound equal to the constant of `packages/shared` (a test compares them); `archived_at timestamptz` written from the injected clock, empty while active; `created_at timestamptz not null default now()` as bookkeeping only.
- A branch table: `branch_id uuid not null references branches (id)`, row security on, the one policy `branch_filter` copied from `0002_branches_branch_filter_request_keys.sql` (as `0014` does for `buildings`), composite foreign keys to a parent in the same branch (`(floor_id, branch_id) references floors (id, branch_id)`). A school-wide table: no branch, no policy, and an entry with a one-line reason in `SCHOOL_WIDE_TABLES` of `apps/api/src/database/catalog.test.ts` (a decision to flag).
- Unique names among active rows: a partial unique index on `lower(btrim(name))` (per branch, or per parent) `where archived_at is null`; an explicit `position smallint` when the list has an order of its own.
- Grants table by table: `grant select, insert on … to sodiq_app`, `grant update (<the columns the application may change>) on … to sodiq_app`, never delete; a column the application may not write is left out of the grants (`built_in` in `0015`).
- Seed rows one insert each when the spec gives them, with U+02BB in Uzbek names.

Then `pnpm db:migrate` and `pnpm db:codegen`, and commit `apps/api/src/database/types.generated.ts`.

### 2. `packages/shared`

- `packages/shared/src/setup.ts` (or the file of the module): the bounds as constants (`<NAME>_MAX_LENGTH`), the record schema of what is typed (`<name>RecordSchema`; `namesSchema` for three-language names), the answer schemas (`<name>Schema`, `<name>ListSchema`), the params schema (`setupIdParamsSchema` exists). Every export by name, types too, in `packages/shared/src/index.ts`. Tests in `setup.test.ts`: the bounds and the refusals.
- A new error code: `ERROR_CODES` in `packages/shared/src/errors.ts` with a doc comment, its line in `apps/api/src/http/error-response.ts` (the API build fails without it), and its text under `errors` in the three locale files, written for the person: what happened and what to do next.
- A new permission area: an entry of `PERMISSIONS` in `packages/shared/src/permissions.ts` with a doc comment naming the spec lines, a row for each of the 15 roles, and the rows in `permissions.test.ts`. A new area for new routes is decided and flagged ("Decided without the owner"); widening what an existing role may do in an existing area stops the task (`CLAUDE.md`).

### 3. API, `apps/api/src/modules/<module>/`

- `<name>.service.ts`: `@Injectable()`; every read and write inside `this.transactions.run(access.branchIds, work)` (`[]` for school-wide work); every write with `this.audit.record(transaction, { branchId, actorId: access.accountId, assignmentId: access.assignmentId, action: '<record>.<verb>', record: { type, id }, oldValue, newValue, requestId })` in the same transaction; `refusingDuplicates(work, { '<unique index>': '<field path>' })` of `setup-refusals.ts` turns the unique index into 409 `already_exists` with `details`; an id of another branch or unknown is `notFound()`; moments come from `CLOCK`, never `new Date()`.
- `<name>.controller.ts`: `@Controller('api/setup')`; exactly one `@Requires(area, action)` per handler, `{ branch: 'none' }` only for school-wide work whose row of the table names school-wide roles; `@CurrentAccess()`, `@RequestId()`, `ValidBody` and `ValidParams` with the shared schemas; `@HttpCode(200)` on a `POST` that creates nothing (archive, restore); the OpenAPI decorators as the existing controllers have them.
- Both registered in `<module>.module.ts` (`setup.module.ts`).
- The lists, by hand: `ROUTE_ACCESS` in `apps/api/src/modules/access/route-permissions.test.ts` (every route, the roles, `branch: 'request'` or `'none'`); the path list in `apps/api/src/openapi/openapi.test.ts`; the route list in `apps/api/src/modules/auth/public-routes.test.ts`; `SCHOOL_WIDE_TABLES` in `catalog.test.ts` when the table is school-wide.
- `pnpm api:client`: regenerates `apps/api/openapi.generated.json` and `apps/web/src/api/schema.generated.ts`; commit both.

### 4. API tests

- The database test, `<module>.database.test.ts` (`setup.database.test.ts`): the branch filter and the composite keys; the checks compared with the shared constants; the unique indexes, tried with a duplicate that differs in case only (a Cyrillic one when names are in three languages); the grants: no delete, no write of a protected column; a trigger tried as the application and as the migrator.
- The route test, `<name>.test.ts` (`buildings.test.ts` for a branch table with a parent and an archive cascade; `divisions.test.ts` for a school-wide table with a trigger): every route for the allowed role, with the audit entries pinning the assignment id and the request id; the Principal, the Academic Vice Principal and a Teacher refused on every writing route, with the count of audit rows unchanged; another branch's id answered 404; validation; `already_exists` with the field in `details`; the archive and restore rules; a deterministic lock test when two writes may race (`rooms.test.ts`, the lock tests of 1.1; `divisions.test.ts`, the two creates at one moment).

### 5. Web, `apps/web/src/features/<feature>/`

- `<feature>-api.ts` (`setup-api.ts`): `queryOptions` keyed `['setup', '<name>', branchId]`, `enabled: branchId !== null`, the call through the generated client with `params: { header: branchHeader() }` inside `answerOf`, the answer parsed with the shared schema; a key function and an `invalidate<Name>` that invalidates by prefix when the list is the same in every branch (`divisionsKey`, `invalidateDivisions`).
- `<name>-page.tsx`: `PageHeader`, a `ListPage` with the rows (`undefined` while loading), the columns, the filters, the bulk actions that name the refused rows and go on with the others, and the record of the side panel; "Add" as a form above the list opened by the header's button; the route gets `validateSearch: listSearch`.
- `<name>-panel.tsx` and `<name>-form.tsx`: `useRecordForm` with the shared record schema (flat: a form for three names is one `NamesForm` with `uz`, `ru`, `en`), `RecordForm`, the fields of `apps/web/src/components/field.tsx`; `useConfirm()` before an archive, naming what it touches; a field refusal read from `failure.details` (`takenNameOf` in `division-panel.tsx`); no form and no buttons for an archived record.
- The route in `apps/web/src/app/router.tsx` inside `appRoute`; the page in `SETUP_PAGES` of `apps/web/src/app/page-index.ts` (the Ctrl+K index); the link on `setup-page.tsx` with the area the page belongs to.
- The texts in `apps/web/src/i18n/locales/en.ts`, `ru.ts` and `uz.ts`: `setup.<name>.*`, the link keys `setup.<name>Link` and `setup.<name>LinkText` (a few words), `errors.<code>`. The text rule of `.claude/rules/web.md` from the first draft of the screen.
- Tests: `<name>-page.test.tsx` with `renderApp` and `fakeApi` of `apps/web/src/testing/render-app.tsx` (`divisions-page.test.tsx` as the sample, with a Russian case); `setup-page.test.tsx` for the link per role.
- The browser test: one seeded account per test in `apps/api/src/testing/e2e/seed.ts` (a key of `seeded`, added to `AccountKey` in `apps/web/e2e/accounts.ts`; a Super Admin sets up its second step in the test), the test in `apps/web/e2e/setup.spec.ts`. `pnpm test:e2e` runs locally because `apps/web/e2e/` changed; say so in the report.

### 6. Docs

`docs/decisions.md`: the decisions of the plan as the reviewer confirmed or changed them, with the reasons. `docs/progress.md`: the dated entry. `docs/build-plan.md`: the tick, and a note on a later task when half of the "done when" moves there.

## Test files to mirror

| Shape | File |
| --- | --- |
| Database: filter, keys, checks, indexes, grants, trigger | `apps/api/src/modules/setup/setup.database.test.ts` |
| Routes of a branch table with a parent and an archive cascade | `apps/api/src/modules/setup/buildings.test.ts` |
| Routes of a school-wide table with a trigger and a lock test | `apps/api/src/modules/setup/divisions.test.ts` |
| A record with a form, a share lock on its parent | `apps/api/src/modules/setup/rooms.test.ts` |
| Shared schemas and the permission rows | `packages/shared/src/setup.test.ts`, `packages/shared/src/permissions.test.ts` |
| A list page with a panel, bulk actions, a second language | `apps/web/src/features/setup/divisions-page.test.tsx`, `buildings-page.test.tsx` |
| The links of the setup page per role | `apps/web/src/features/setup/setup-page.test.tsx` |
| Browser test | `apps/web/e2e/setup.spec.ts` |

## Pitfalls met so far

- **A row the application may not write is inserted through the migrator.** A test that needs an archived row, a row of another branch or a protected column uses `database.migrator`, not the application's connection: `sodiq_app` has no grant for it, and a test that writes through the application would prove the grant wrong (`buildings.test.ts`).
- **A web test's language leaks through the session.** `renderApp(PATH, language)` starts the app in a language, but the account of the fake session carries a `language` of its own and the app switches to it after the first answer; give the fake account the language of the test (`openList` in `divisions-page.test.tsx`).
- **A field refusal travels in `details`.** 409 `already_exists` names the field (`names.ru`) in `details`, as a validation failure does; the form reads it and marks the field. The `message` of the API is for the developer and is never shown.
- **The U+02BB apostrophe.** Uzbek `oʻ` and `gʻ` take U+02BB in the locale files and in seeded data, never the keyboard's `'`; `locales.test.ts` checks the locale files, and a seeded name compares with a typed one only when both use the same character.
- **The text rule.** No sentence under a title; at most a few words under a menu link; one line only on an empty page, beside a switched-off action or under a setting whose effect is not obvious (`.claude/rules/web.md`; two review rounds were only this).
- **Lock, then aggregate.** `select … for update` and `max(position)` in one statement return the rows that were locked, not a row another transaction inserted while this one waited; the lock goes in one statement, the aggregate in a second (`createDivision` in `divisions.service.ts`).
- **`returning` has no order.** The ids of `update … returning id` are never stored, compared or shown in that order; read them ordered, and locked, before the update (`restoreDivision`).
- **Small ones.** A `POST` that creates nothing says `@HttpCode(200)`, or NestJS answers 201. A Super Admin's clock in a test moves five minutes, not an hour: the idle limit is fifteen. A route bound to a branch is called with `params: { header: branchHeader() }`; the middleware is only the safety net. A check whose result can be null passes: write `is not null` where a null must not.
