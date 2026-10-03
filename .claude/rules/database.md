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
- Audit and history tables are append-only: the application user has no update or delete rights on them.
