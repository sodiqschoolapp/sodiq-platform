-- LOCAL DEVELOPMENT AND CI ONLY. NEVER RUN THIS AGAINST A SERVER.
--
-- The passwords below are public: they are in this repository. They are for a
-- PostgreSQL that only listens on your own machine or inside a CI job.
-- The users of a server database are created with SQL too (db/setup/server.sql,
-- never in the provider's console: a console role bypasses the row filters);
-- their passwords are never written to a file here.
--
-- Run once per machine, as the PostgreSQL superuser:
--
--   psql -U postgres -f db/setup/local.sql
--
-- Running it again changes nothing.

\set ON_ERROR_STOP on

do $$
begin
  -- Owns the database and every table; runs the migrations. May create
  -- databases because the tests build one clean database per test file.
  if not exists (select from pg_roles where rolname = 'sodiq_migrator') then
    create role sodiq_migrator login createdb password 'sodiq_migrator_local';
  end if;

  -- The API and the jobs worker. Owns nothing; each migration grants it its
  -- rights table by table.
  if not exists (select from pg_roles where rolname = 'sodiq_app') then
    create role sodiq_app login password 'sodiq_app_local';
  end if;
end
$$;

select 'create database sodiq_dev owner sodiq_migrator'
where not exists (select from pg_database where datname = 'sodiq_dev')
\gexec
