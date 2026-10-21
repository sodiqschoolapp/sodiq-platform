-- 0102 Substitutions from an absence or a vacancy (task 5.7b-2, pull request #192).
--
-- docs/spec/06-timetable.md, Changes after publishing: "Substitution. ... It
-- can be started from a single lesson (pick a substitute for it) or from a
-- teacher (mark them absent for one or more dates)." edge-cases/timetable.md,
-- After publishing: "One substitute can be assigned per journal for the whole
-- absence in one action, each date still being checked. Shortening the
-- absence returns future lessons to the teacher."
--
-- The plan approved on pull request #192: `source` stays the start point
-- (spec review should-fix 3): `absence` is the per-journal action from an
-- absence, `journal` the per-journal action of a vacancy's journal.
-- `absence_id` names the absence a substitution was made for, whatever its
-- start point (decision 4); only those are returned by a shortening.
-- `relaxed` is decided per date (decision 3), so it is kept per lesson.

alter table substitutions drop constraint substitutions_source_check;
alter table substitutions add constraint substitutions_source_check check (
  source in ('lesson', 'correction', 'absence', 'journal')
);

alter table substitutions
  add column absence_id uuid references absences (id),
  add column journal_id uuid,
  add constraint substitutions_journal_fkey foreign key (journal_id, branch_id)
    references journals (id, branch_id),
  -- An absence only for a substitution of a lesson or of an absence's journal;
  -- required for the second.
  add constraint substitutions_absence_check check (
    case source
      when 'absence' then absence_id is not null
      when 'lesson' then true
      else absence_id is null
    end
  ),
  -- A journal exactly for the two per-journal actions.
  add constraint substitutions_journal_check check (
    (journal_id is not null) = (source in ('absence', 'journal'))
  );

create index substitutions_absence_idx on substitutions (absence_id)
  where absence_id is not null;

grant insert (absence_id, journal_id) on substitutions to sodiq_app;

-- The exception "no teacher of the subject is free" of each lesson, written
-- with the row (decision 3); the rows of 0101 take their record's value.
alter table substitution_lessons add column relaxed boolean;
update substitution_lessons r
  set relaxed = s.relaxed
  from substitutions s
  where s.id = r.substitution_id;
alter table substitution_lessons alter column relaxed set not null;

grant insert (relaxed) on substitution_lessons to sodiq_app;

-- `returned`: the absence the substitution was made for no longer covers the
-- lesson (decision 2).
alter table substitution_lessons drop constraint substitution_lessons_end_cause_check;
alter table substitution_lessons add constraint substitution_lessons_end_cause_check check (
  end_cause in ('withdrawn', 'replaced', 'corrected', 'dropped', 'returned')
);

-- The branches holding a row in force of a substitution made for the absence
-- on a lesson that has not started at the transaction's moment, ids only
-- (decision 1, Look first; review correction 1). Nothing unless the absence's
-- person is linked to `request_branch`, a branch of the transaction's filter: the
-- route has checked the absence against the branch of the request first.
create function absence_substitution_branches(absence uuid, request_branch uuid)
returns table (branch_id uuid)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
#variable_conflict use_column
declare
  moment timestamptz := nullif(current_setting('app.now', true), '')::timestamptz;
begin
  if moment is null
    or not (absence_substitution_branches.request_branch = any (public.app_branch_ids()))
    or not exists (
      select 1 from public.absences a
      join public.staff_branches b on b.staff_id = a.staff_id
      where a.id = absence_substitution_branches.absence
        and b.branch_id = absence_substitution_branches.request_branch
    ) then
    return;
  end if;
  return query
    select distinct r.branch_id
    from public.substitutions s
    join public.substitution_lessons r on r.substitution_id = s.id
    join public.lessons l on l.id = r.lesson_id
    where s.absence_id = absence_substitution_branches.absence
      and r.ended_at is null
      and l.teacher_id = s.substitute_id
      and l.starts_at > moment
    order by r.branch_id;
end;
$$;

revoke execute on function absence_substitution_branches(uuid, uuid) from public;
grant execute on function absence_substitution_branches(uuid, uuid) to sodiq_app;
