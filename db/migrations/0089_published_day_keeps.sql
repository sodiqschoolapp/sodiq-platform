-- 0089 A published version's choice of the lessons kept on a shortened day
-- (task 5.6b-2b, pull request #171).
--
-- docs/spec/edge-cases/time-dates-calendar.md, "A shortened day has 5 lesson
-- slots and a class has 7 lessons that weekday": "The Academic Vice Principal
-- can choose which lessons are kept." A calendar entry that shortens a date
-- of a published version takes that choice in its save, stored for the
-- version in force on the date in `timetable_day_keeps` (0074).
--
-- Decision 1 (Look first, a trigger widened by the task's requirement):
-- `pattern_rows_draft` lets an insert or a delete of `timetable_day_keeps`
-- through on a published version when the row's date lies after today in the
-- branch's time zone (`branch_today`, the moment of the transaction; an unset
-- moment counts as not after today). This narrows 5.5a-3a decision 3 ("pins,
-- locks, day keeps, blocks, inserts and deletes stay draft-only") for this
-- one table. Today, the past, an archived version and a closed year stay
-- refused, so a held lesson's date is never changed through it. Every other
-- case is as 0076. No constraint, index or trigger is removed.

create or replace function pattern_rows_draft() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  version_ref uuid;
  version_year uuid;
  version_state text;
  year_state text;
  carried boolean := false;
begin
  if tg_op = 'DELETE' then
    version_ref := old.version_id;
  else
    version_ref := new.version_id;
  end if;
  select v.academic_year_id into version_year from timetable_versions v where v.id = version_ref;
  if not found then
    return null;
  end if;
  perform 1 from academic_years y where y.id = version_year for share;
  perform 1 from timetable_versions v where v.id = version_ref for share;
  select v.status into version_state from timetable_versions v where v.id = version_ref;
  select y.status into year_state from academic_years y where y.id = version_year;
  -- Nested: a field of `new` is read only on pattern_entries.
  if tg_table_name = 'pattern_entries' and tg_op = 'UPDATE' and version_state = 'published'
    and timetable_version_not_started(version_ref) then
    if to_jsonb(new) - array['room_id', 'room_shared', 'teacher_id']
      = to_jsonb(old) - array['room_id', 'room_shared', 'teacher_id'] then
      carried := new.teacher_id is not distinct from old.teacher_id
        or new.teacher_id = (
          select r.teacher_id from teaching_load_rows r where r.id = new.load_row_id
        );
    end if;
  end if;
  -- Task 5.6b-2b: a published version's choice of a date after today. Nested:
  -- `kept_on` is a field of timetable_day_keeps only.
  if tg_table_name = 'timetable_day_keeps' and version_state = 'published' then
    if tg_op = 'DELETE' then
      carried := old.kept_on > coalesce(branch_today(old.branch_id), 'infinity'::date);
    else
      carried := new.kept_on > coalesce(branch_today(new.branch_id), 'infinity'::date);
    end if;
  end if;
  if version_state <> 'draft' and not carried then
    raise exception 'pattern_version_draft'
      using errcode = 'check_violation', constraint = 'pattern_version_draft';
  end if;
  if year_state = 'closed' then
    raise exception 'pattern_year_closed'
      using errcode = 'check_violation', constraint = 'pattern_year_closed';
  end if;
  return null;
end;
$$;
