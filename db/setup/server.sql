-- The two users of a server database (test, production), run once per
-- database by the owner (docs/deploy.md). The passwords are asked by \prompt
-- and given to Neon in the statement itself (create role ... password).
-- psql's \password cannot be used here: it sends only the hashed form (the
-- SCRAM verifier), and Neon's control plane refuses it ("Neon only supports
-- being given plaintext passwords"). So the typed password shows on the
-- screen and stays in the terminal's scrollback: close the terminal window
-- afterwards. Nothing is written to a file and nothing is on the command line.
--
-- Letters and digits only in both passwords: each goes into an address
-- (postgres://<user>:<password>@<host>/sodiq), where any other character
-- would have to be escaped. `openssl rand -base64 32 | tr -dc A-Za-z0-9`
-- gives one.
--
--   psql "postgresql://<the project's own role>@<host>/neondb?sslmode=verify-full" -f db/setup/server.sql
--
-- (without the role's password in the address: psql asks for it).
--
-- With SQL, never in Neon's console: a role made in the console is a member of
-- neon_superuser and bypasses the row filters, which the API refuses
-- (docs/progress.md, 0.4b). Running it again stops at the first thing that
-- exists; it changes nothing then.

\set ON_ERROR_STOP on

\prompt 'Password for sodiq_migrator (long and random, letters and digits only): ' migrator_password
\prompt 'Password for sodiq_app (long and random, letters and digits only): ' app_password

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
\echo 'The passwords were shown above: close this terminal window now.'
