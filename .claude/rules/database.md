---
paths:
  - "db/migrations/**"
---

# Migrations

Read `docs/spec/edge-cases/developer-rules.md` before writing a migration.

- A migration is a new numbered SQL file. Never edit a migration that is already merged.
- Never drop or weaken a constraint, index or trigger named in the developer rules. Ask first.
- A change that rewrites or locks a large table is split into two steps.
- Each migration grants `sodiq_app` its rights table by table; no default privileges.
- After a migration, run `pnpm db:migrate` and `pnpm db:codegen` and commit the generated types.
- A moment that a business rule compares (locks, windows, exemption ends, lesson times) is written from the injected clock, never from SQL `now()` or `current_timestamp`. `default now()` is allowed only for bookkeeping columns that no rule reads.
- Audit and history tables are append-only: the application user has no update or delete rights on them.
- Every table in schema `public` is classified. Either it belongs to a branch: `branch_id uuid not null references branches (id)`, row security on, and exactly the `branch_filter` policy written in `db/migrations/0002_branches_branch_filter_request_keys.sql`, with no other policy. Or it is school-wide and is named, with a one-line reason, in `SCHOOL_WIDE_TABLES` in `apps/api/src/database/catalog.test.ts`. A table in neither group fails that test. A school-wide table that names a branch all the same (today only `assignments`) is also named in `SCHOOL_WIDE_WITH_BRANCH` there: its `branch_id` references `branches (id)` and it has no policy. Adding a table to either list is a decision for the owner: ask first.
- Views and functions must not bypass the branch filter. Every view is created `with (security_invoker = true)`. No materialized views. No function is `SECURITY DEFINER` unless it is named with a reason in the allow-list in `catalog.test.ts`; ask first.
- Business code gets its transaction from `Transactions.run(branchIds, work)` (`apps/api/src/database/transactions.ts`), which sets the branch filter for that transaction only. Never set `app.branch_ids` anywhere else, and never with `set` or with `set_config(..., false)`; a lint rule refuses the name outside `transactions.ts`.
- Foreign keys and unique constraints are not filtered by branch. A unique constraint on a branch table includes `branch_id`, and an id that arrives in a request is checked against the branch before it is used in a foreign key.
- To re-apply an unmerged migration locally, ask the owner before dropping or resetting anything in sodiq_dev, even when the tables are empty.
- A check that a row was written by the current transaction (`xmin` compared with `pg_current_xact_id()`) also matches a row the transaction only updated; when the rule is "inserted by this transaction", also compare its `default now()` column with `now()`, the start of the transaction (an identity check, not a moment a business rule compares) (found by the spec review of task 1.6 on `Transactions.enterCreatedBranch`).
- A row lock taken in a query with a condition (`... where status = 'closed' for share`) locks only the rows that meet the condition: a guard that must make a concurrent change wait locks the row first, whatever its state, and reads the state afterwards (found by the spec review of task 2.1 on the closed-year guard of `subject_quarter_weights`).
- A counter or round that decides which rows count (`weights_round` of `subjects`) is guarded in the database: it only grows, and the rows it decides are written only in the current value, so that no old row comes back into force without new values and an audit entry (found by the spec review of task 2.1).
- A rule that a check waives for rows out of service (a person who left, an archived record) is checked again when the row comes back into service (a re-hire, a restore), under the same row locks as the check that waived it (found by the spec review of task 2.2a: a subject lost a grade while its teacher had left, and the re-hire brought the teacher back with it).
  - The re-check covers every rule the waiver skipped, not only one of them (found by code round 1 of the review of pull request #53: a re-hire checked the subjects but not the archived divisions and departments).
  - A row out of service today with a return to service planned after today counts as in service for the checks that waive it, or the return escapes every check made before its date (same round: "out of the school" became `staff_out_for_good`).
  - A function that tells whether a row is out of service must not depend on what the membership filter lets the request see (same round: the main branch link of a person was invisible from a further branch).
- A condition on another table read in the statement that waits for a row lock (`select … for update` with `exists (…)`) keeps the snapshot of before the wait: PostgreSQL re-checks the locked row only when it was updated. A change that removes the other row without updating the locked one (a branch link removed under the record's lock) slips past it; read the other row again after the lock, in a statement of its own, `for share` when it must stay (found by the spec review of task 2.2b).
- A read of `assignments`, the school-wide table that names a branch and has no policy, keeps in code to `access.branchIds` and to the rows with no branch for every reader who is not the Super Admin; the branch filter does not do it there (found by code round 1 of task 2.3a).
- A rule that the database also compares with `app.now` (a start, an end, a role in force) reads the moment from `transactionMoment(transaction)` (`apps/api/src/database/transactions.ts`) in code, never from `clock.now()`, so that the code and the database compare the same moment (found by code round 1 of task 2.3a).
- A row inserted under a savepoint (`Assignments.give`) carries the id of the subtransaction in `xmin`, also after the savepoint is released, so `xmin = pg_current_xact_id()` never matches it: "inserted by this transaction" is a column `xid8 default pg_current_xact_id()` (`day_template_versions.created_xact`, `assignments.written_xact`), which gives the top-level id inside a savepoint too and does not change on an update (found by the plan review of pull request #63).
- Two writes that can claim the same unique value (a create and a correction of a UID) take the index entries in the same order, the one both meet first written first, so that the second waits and is refused rather than deadlocked; the pair is tested in both directions (found by the spec review of task 2.4a).
