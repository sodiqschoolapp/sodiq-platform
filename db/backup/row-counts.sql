-- The rows of every table of the platform, one line `schema.table|count`
-- (task 10.2a): run by .github/workflows/backup.yml against production and
-- against the restored copy, so the two can be compared. A partitioned table
-- is counted once, through its parent. Prints names and numbers, never a row.
select format(
  'select %L || ''|'' || count(*) from %I.%I',
  n.nspname || '.' || c.relname, n.nspname, c.relname
)
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname in ('public', 'pgboss')
  and c.relkind in ('r', 'p')
  and not c.relispartition
order by n.nspname, c.relname
\gexec

-- Whether the connection reads a read-only compute (task 10.2b, plan review of #261,
-- corrections 1 and 2): `pg_is_in_recovery()` is true on Neon's read replica only, and no
-- session setting can make a primary answer true. The comparison refuses a dump of production
-- read where it could write (`compareCounts`); the restored copy answers 0 and is not compared.
select '~read-only|' || pg_is_in_recovery()::int;
