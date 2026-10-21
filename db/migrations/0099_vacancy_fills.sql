-- 0099 Vacancy fill: the fill and the close (task 5.7a-3a, pull request #188).
--
-- docs/spec/06-timetable.md, Changes after publishing: "Filling a vacancy.
-- When the teacher is hired, the Academic Vice Principal fills the vacancy
-- with the person from a date, tomorrow at the earliest, for all of its load
-- rows or the chosen ones. ... A vacancy with no load left is closed."
-- docs/spec/04-people.md, Vacancy: "its history lists every fill with the
-- date, the person and the rows."
--
-- The plan approved on pull request #188: decisions 5 and 6 (Look first: the
-- fill closes the vacancy from the fill date as a stored status row, and
-- `vacancy_close_holders` reads a later version's start against the close
-- day), decision 11 (the fill kept for the history), decision 15 (Look first,
-- a pinned list widened: the cause `vacancy.fill`), and the From line of
-- 5.5c-2b: "A write that puts a lesson under a staff record ... refuses a
-- closed vacancy".

-- The fills of a vacancy, insert only (decision 11): the history. A vacancy
-- and the person filling it are staff records linked to the branch; the
-- version is the one the fill published, null when it carried the change
-- into a published version that starts on the fill date (decision 4).
create table vacancy_fills (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  vacancy_id uuid not null references staff (id),
  person_id uuid not null references staff (id),
  fills_from date not null,
  version_id uuid,
  created_by uuid not null references accounts (id),
  -- Bookkeeping only; no rule reads it.
  created_at timestamptz not null default now(),
  constraint vacancy_fills_version_fkey foreign key (version_id, branch_id)
    references timetable_versions (id, branch_id),
  constraint vacancy_fills_people_check check (vacancy_id <> person_id),
  constraint vacancy_fills_id_branch_key unique (id, branch_id)
);

create index vacancy_fills_vacancy_idx on vacancy_fills (branch_id, vacancy_id, fills_from);

alter table vacancy_fills enable row level security;
create policy branch_filter on vacancy_fills for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select, insert (branch_id, vacancy_id, person_id, fills_from, version_id, created_by)
  on vacancy_fills to sodiq_app;

-- The rows a fill gave the person, by class or group and subject, as the
-- carry matches rows across versions (decision 10); the rows left are in the
-- answer and the audit entry (spec review of the plan, should-fix 3).
create table vacancy_fill_rows (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  fill_id uuid not null,
  class_id uuid,
  group_id uuid,
  subject_id uuid not null references subjects (id),
  constraint vacancy_fill_rows_fill_fkey foreign key (fill_id, branch_id)
    references vacancy_fills (id, branch_id),
  constraint vacancy_fill_rows_unit_check check ((class_id is null) <> (group_id is null)),
  constraint vacancy_fill_rows_class_fkey foreign key (class_id, branch_id)
    references classes (id, branch_id),
  constraint vacancy_fill_rows_group_fkey foreign key (group_id, branch_id)
    references groups (id, branch_id)
);

create index vacancy_fill_rows_fill_idx on vacancy_fill_rows (fill_id);

alter table vacancy_fill_rows enable row level security;
create policy branch_filter on vacancy_fill_rows for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select, insert (branch_id, fill_id, class_id, group_id, subject_id)
  on vacancy_fill_rows to sodiq_app;

-- Decision 6 (Look first): what holds a vacancy for a close from `from_day`.
-- As 0083, with one change: a published version's rows no longer hold once a
-- published version later in its chain starts on or before `from_day` (0083:
-- "has started", that is on or before today). For a close from today the two
-- are the same; for a close from a later day the earlier version runs only
-- until then. A withdraw that brings it back reopens the vacancy first
-- (decision 7), and `lessons_vacancy_closed` below refuses any lesson under
-- the vacancy on a closed day. This reverses, for a close from a later day,
-- review correction 3 of 5.5c-2b ("the close day bounds the lessons only,
-- never the versions").
create or replace function vacancy_close_holders(record_id uuid, branch_ref uuid, from_day date)
returns table (version_id uuid, version_number integer, lesson_date date)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  zone text;
  today date;
  bound date;
begin
  if session_user is distinct from current_user and not (
    vacancy_close_holders.branch_ref = any (public.app_branch_ids())
    and exists (
      select 1 from public.staff s
      join public.staff_branches b on b.staff_id = s.id
      where s.id = vacancy_close_holders.record_id
        and s.kind = 'vacancy'
        and b.branch_id = vacancy_close_holders.branch_ref
    )
  ) then
    raise exception 'vacancy_not_in_branch'
      using errcode = 'check_violation', constraint = 'vacancy_not_in_branch';
  end if;
  select br.time_zone into zone
    from public.branches br
    where br.id = vacancy_close_holders.branch_ref;
  today := (public.class_tutors_moment() at time zone zone)::date;
  -- The later of the close day and today; without a moment, the close day.
  bound := greatest(vacancy_close_holders.from_day, coalesce(today, vacancy_close_holders.from_day));

  return query
    select v.id, v.number::integer, null::date
    from public.timetable_versions v
    join public.academic_years y on y.id = v.academic_year_id
    where v.branch_id = vacancy_close_holders.branch_ref
      and exists (
        select 1 from public.teaching_load_rows r
        where r.version_id = v.id and r.teacher_id = vacancy_close_holders.record_id
      )
      and (
        v.status = 'draft'
        or (
          v.status = 'published'
          and y.status <> 'closed'
          and not coalesce(y.end_date < today, false)
          and not exists (
            select 1 from public.timetable_versions w
            where w.branch_id = v.branch_id
              and w.academic_year_id = v.academic_year_id
              and w.status = 'published'
              and (w.starts_on > v.starts_on or (w.starts_on = v.starts_on and w.number > v.number))
              and w.starts_on <= bound
              -- Without a moment nothing has started (0083).
              and today is not null
          )
        )
      )
    order by v.number, v.id;

  return query
    select null::uuid, null::integer, min(l.lesson_date)
    from public.lessons l
    where l.branch_id = vacancy_close_holders.branch_ref
      and l.teacher_id = vacancy_close_holders.record_id
      and l.lesson_date >= vacancy_close_holders.from_day
      and coalesce(l.lesson_date > today, true)
    having min(l.lesson_date) is not null;
end;
$$;

revoke execute on function vacancy_close_holders(uuid, uuid, date) from public;
grant execute on function vacancy_close_holders(uuid, uuid, date) to sodiq_app;

-- The From line of 5.5c-2b: a lesson is never written under a vacancy that is
-- closed on the lesson's date, by an insert, a change of its teacher or a
-- change of its date (a calendar move cascades from its block). The status
-- is read as the invoker: the writer of a lesson of the branch sees the
-- vacancy's statuses (a vacancy has one branch).
create function lessons_vacancy_closed() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.teacher_id is not null and exists (
    select 1 from staff_statuses st
    where st.staff_id = new.teacher_id
      and st.status = 'closed'
      and st.valid_from <= new.lesson_date
      and (st.valid_until is null or st.valid_until > new.lesson_date)
  ) then
    raise exception 'lesson_vacancy_closed'
      using errcode = 'check_violation', constraint = 'lesson_vacancy_closed';
  end if;
  return new;
end;
$$;

create trigger lessons_vacancy_closed
  before insert or update of teacher_id, lesson_date on lessons
  for each row execute function lessons_vacancy_closed();

-- The draft a fill copies takes an id made from its branch, year and number
-- (`vacancy-fills.service.ts`, `draftIdOf`), the same in the check and in the
-- fill, so the keys of the publish that name the draft match between them.
grant insert (id) on timetable_versions to sodiq_app;

-- Decision 15 (Look first, a pinned list widened by a requirement): a fill
-- carried into a published version that starts on the fill date marks every
-- open draft of the branch and year (`06`: "an open draft is marked out of
-- date"). The check of 0082 gains the action and nothing else changes.
alter table timetable_version_out_of_date_causes
  drop constraint timetable_version_out_of_date_causes_action_check;

alter table timetable_version_out_of_date_causes
  add constraint timetable_version_out_of_date_causes_action_check check (
    action in (
      'timetable_version.publish',
      'timetable_version.withdraw',
      'vacancy.fill',
      'calendar_entry.create',
      'calendar_entry.edit',
      'calendar_entry.archive',
      'calendar_entry.restore',
      'slot_type.length_change',
      'day_template.version_create',
      'day_template_assignment.set',
      'day_template_assignment.end',
      'staff.availability_set',
      'staff.availability_end',
      'room.edit'
    )
  );
