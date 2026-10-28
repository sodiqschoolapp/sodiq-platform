-- THE TEST ENVIRONMENT'S DEMO DATA ONLY (.github/workflows/demo-data.yml).
-- NEVER RUN THIS AGAINST PRODUCTION.
--
-- Removes every object the migration user owns in the schemas of the
-- application (public and pgboss), so that the dump of the demo database can
-- be loaded in their place. Each object is dropped in a transaction of its
-- own (\gexec): one transaction for all of them takes more locks than
-- PostgreSQL's lock table holds (about 2,800 tables, partitions and indexes).
-- The API and the worker are suspended while this runs; if the load after it
-- fails, the database is brought back with Neon's restore to the moment
-- before the run (docs/deploy.md, Demo data). Extensions are kept (btree_gist
-- is left out of the dump), and so are the schema public, the roles and their
-- database rights.

\set ON_ERROR_STOP on

drop schema if exists pgboss cascade;

-- Views, then tables (a partition goes with its parent), sequences no table
-- owns, routines and types, none of them part of an extension.
select format('drop view if exists %I.%I cascade', n.nspname, c.relname)
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('v', 'm') and pg_get_userbyid(c.relowner) = current_user
order by c.relkind desc
\gexec

select format('drop table if exists %I.%I cascade', n.nspname, c.relname)
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind in ('r', 'p')
  and not c.relispartition
  and pg_get_userbyid(c.relowner) = current_user
\gexec

select format('drop sequence if exists %I.%I cascade', n.nspname, c.relname)
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'S' and pg_get_userbyid(c.relowner) = current_user
\gexec

select format('drop routine if exists %s cascade', p.oid::regprocedure)
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and pg_get_userbyid(p.proowner) = current_user
  and not exists (
    select from pg_depend d
    where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'
  )
\gexec

select format('drop type if exists %s cascade', t.oid::regtype)
from pg_type t
join pg_namespace n on n.oid = t.typnamespace
where n.nspname = 'public'
  and t.typtype in ('e', 'd', 'c', 'r', 'm')
  and pg_get_userbyid(t.typowner) = current_user
  and (t.typrelid = 0 or (select c.relkind from pg_class c where c.oid = t.typrelid) = 'c')
  and not exists (
    select from pg_depend d
    where d.classid = 'pg_type'::regclass and d.objid = t.oid and d.deptype = 'e'
  )
\gexec

-- Nothing of the application is left: the load starts from an empty schema.
select count(*) as left_over
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and pg_get_userbyid(c.relowner) = current_user;
