-- 0139 Backups, restore drill and alerts (task 10.2a, pull request #256).
--
-- From 8.9 on task 10.2 (pull request #227, decision 4): "the files of the
-- branch exports stay in the store under `exports/` after their 24 hours: a
-- cleanup removes the files of expired and failed exports". The cleanup is a
-- daily kind of the schedule of 0135 (plan decision 13), so the pinned list
-- of kinds grows by one, and the trigger of 0131 lets exactly one more update
-- through: the moment the files were removed (plan review, correction 1:
-- both are Look first, the requirement that changed is that From line).
--
-- No existing row changes: a new nullable column with no default, a check
-- every existing row passes, and a trigger function replaced.

-- ---------------------------------------------------------------------------
-- The daily kinds: `journal.exports_cleanup` added.

alter table scheduled_runs drop constraint scheduled_runs_kind_check;
alter table scheduled_runs add constraint scheduled_runs_kind_check check (
  kind in (
    'results.check', 'results.closing_overdue', 'results.check_missed', 'plans.reminders',
    'journal.about_to_lock', 'timetable.forced_delete_purge', 'journal.exports_cleanup'
  )
);

-- ---------------------------------------------------------------------------
-- When the files of an expired or failed export were removed from the store.
-- A failed or stale run may have left a file whose key was never stored
-- (`journal_exports_failed_check` keeps `file_key` null), so the cleanup
-- removes everything under `exports/<id>/` and then sets this moment.

alter table journal_exports add column file_removed_at timestamptz;
alter table journal_exports add constraint journal_exports_file_removed_check check (
  file_removed_at is null or status in ('ready', 'failed')
);

grant update (file_removed_at) on journal_exports to sodiq_app;

-- The moments and the one way of the status, as 0131; and one more update:
-- `file_removed_at` from null to the transaction's moment, nothing else
-- changed, on a failed row or a ready row whose link has expired (a live
-- 24-hour link keeps its file, `edge/system-behaviour`, the export row).
create or replace function journal_exports_write() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  moment timestamptz;
begin
  moment := class_tutors_moment();
  if moment is null then
    raise exception 'journal_cell_moment'
      using errcode = 'check_violation', constraint = 'journal_cell_moment';
  end if;
  if tg_op = 'INSERT' then
    new.status := 'queued';
    new.requested_at := moment;
    new.file_removed_at := null;
    return new;
  end if;
  if new.file_removed_at is distinct from old.file_removed_at then
    if old.file_removed_at is not null
      or old.status = 'queued'
      or (old.status = 'ready' and old.expires_at > moment)
      or (to_jsonb(new) - 'file_removed_at') <> (to_jsonb(old) - 'file_removed_at') then
      raise exception 'journal_export_file_removed'
        using errcode = 'check_violation', constraint = 'journal_export_file_removed';
    end if;
    new.file_removed_at := moment;
    return new;
  end if;
  if old.status <> 'queued' or new.status = 'queued' then
    raise exception 'journal_export_status'
      using errcode = 'check_violation', constraint = 'journal_export_status';
  end if;
  if new.status = 'ready' then
    new.ready_at := moment;
    new.expires_at := moment + interval '24 hours';
  else
    new.failed_at := moment;
    if new.failure = 'journal_export_stale'
      and old.requested_at > moment - interval '20 minutes' then
      raise exception 'journal_export_status'
        using errcode = 'check_violation', constraint = 'journal_export_status';
    end if;
  end if;
  return new;
end
$$;
