-- 0001 Foundations: what every later migration relies on.
--
-- The users sodiq_migrator (runs this file, owns everything) and sodiq_app
-- (the API and the jobs worker) must exist before the first migration.

-- Exclusion constraints that combine "the same teacher, room or class" with
-- "overlapping time" need this (docs/spec/edge-cases/developer-rules.md).
create extension btree_gist;

-- Only the migration user creates objects. The application user gets its
-- rights table by table, in the migration that creates the table.
revoke create on schema public from public;
grant usage on schema public to sodiq_app;

-- The application may read which migrations are applied, never change them.
grant select on schema_migrations to sodiq_app;
