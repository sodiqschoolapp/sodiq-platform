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
