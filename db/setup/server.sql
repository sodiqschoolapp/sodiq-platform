-- The two users of a server database (test, production), run once per
-- database by the owner (docs/deploy.md). It asks the passwords when it runs;
-- nothing is written to a file and nothing is on the command line:
--
--   psql "<the address of the Neon project's own role>" -f db/setup/server.sql
--
-- With SQL, never in Neon's console: a role made in the console is a member of
-- neon_superuser and bypasses the row filters, which the API refuses
-- (docs/progress.md, 0.4b). Running it again stops at the first thing that
-- exists; it changes nothing then.

\set ON_ERROR_STOP on

\prompt 'Password for sodiq_migrator (long and random): ' migrator_password
\prompt 'Password for sodiq_app (long and random): ' app_password

-- Owns the database and every table; runs the migrations from the deploy job
-- only. No createdb: no test database is ever built on a server.
create role sodiq_migrator login password :'migrator_password';

-- The API and the jobs worker. Owns nothing; each migration grants it its
-- rights table by table. It may create temporary tables, as any role may.
create role sodiq_app login password :'app_password';

-- The creator must be a member of the owner to hand over the database.
grant sodiq_migrator to current_user;
create database sodiq owner sodiq_migrator;

-- Only the two users may connect.
revoke all on database sodiq from public;
grant connect, temp on database sodiq to sodiq_app;
grant all on database sodiq to sodiq_migrator;

\echo 'Done. Address of the migrations: postgres://sodiq_migrator:<password>@<host>/sodiq?sslmode=verify-full'
\echo 'Address of the application:     postgres://sodiq_app:<password>@<host>/sodiq?sslmode=verify-full'
