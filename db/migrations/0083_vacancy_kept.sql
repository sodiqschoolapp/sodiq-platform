-- 0083 The vacancy closed and kept (task 5.5c-2b, pull request #157).
--
-- docs/spec/04-people.md, Vacancy: "A vacancy cannot be closed while a load
-- row names it or a future lesson is under it. One that never held a load can
-- be deleted; one that did is closed and kept."
--
-- The plan approved on pull request #157: decision 1 (Look first, a trigger
-- narrowed by a requirement; the spec read against its own text) and decision
-- 9 (Look first, the allow-list entry of the close replaced) with review
-- corrections 1 to 3. The close of 0055 refused while any load row of any
-- version named the vacancy, so a vacancy that held a published load could
-- never be closed. It now refuses while a row of a draft, or of a published
-- version that can still run, names it, or a lesson dated after today is
-- under it. `vacancy_delete` (0055) is unchanged: refused while any load row
-- of any version names the vacancy, and the rows of a published or archived
-- version are never deleted (`load_version_draft`).

-- What still holds a vacancy for a close from `from_day`, past the row filter:
-- one row per version that holds it (`lesson_date` null), and one row with the
-- first date of the lessons under it (the version null). A vacancy has one
-- branch; an application caller gets an error for a record that is not a
-- vacancy of a branch of its transaction (review correction 1). The owner (the
-- migrator, and the fixtures of the tests) passes the row filter anyway.
--
-- "Today" is the branch's, read from the moment of the transaction (`app.now`)
-- as `timetable_version_not_started` reads it (decision 2):
-- - a draft's rows always hold;
-- - a published version's rows hold in a year not closed until a published
--   version later in its chain (a later start, or the same start and a higher
--   number, the order of 0076) has started, or the year's last day has
--   passed: a started version can never be withdrawn or replaced
--   (`version_archive_started`), so the earlier one can never run again,
--   while a later one that has not started can still be withdrawn and bring
--   it back;
-- - an archived version's rows never hold;
-- - a lesson holds when it is dated after today, cancelled or not, as 0080
--   reads future lessons (decision 4), and on or after `from_day`. The close
--   day bounds the lessons only, never the versions (review correction 3).
-- Without a moment nothing has started and no year has passed, so every
-- published row and every lesson from `from_day` holds.
create function vacancy_close_holders(record_id uuid, from_day date)
returns table (version_id uuid, version_number integer, lesson_date date)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  zone text;
  today date;
begin
  if session_user is distinct from current_user and not exists (
    select 1 from public.staff s
    join public.staff_branches b on b.staff_id = s.id
    where s.id = vacancy_close_holders.record_id
      and s.kind = 'vacancy'
      and b.branch_id = any (public.app_branch_ids())
  ) then
    raise exception 'vacancy_not_in_branch'
      using errcode = 'check_violation', constraint = 'vacancy_not_in_branch';
  end if;
  select br.time_zone into zone
    from public.staff_branches b
    join public.branches br on br.id = b.branch_id
    where b.staff_id = vacancy_close_holders.record_id
    order by b.branch_id
    limit 1;
  today := (public.class_tutors_moment() at time zone zone)::date;

  return query
    select v.id, v.number::integer, null::date
    from public.timetable_versions v
    join public.academic_years y on y.id = v.academic_year_id
    where exists (
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
              and coalesce(w.starts_on <= today, false)
          )
        )
      )
    order by v.number, v.id;

  return query
    select null::uuid, null::integer, min(l.lesson_date)
    from public.lessons l
    where l.teacher_id = vacancy_close_holders.record_id
      and l.lesson_date >= vacancy_close_holders.from_day
      and coalesce(l.lesson_date > today, true)
    having min(l.lesson_date) is not null;
end;
$$;

revoke execute on function vacancy_close_holders(uuid, date) from public;
grant execute on function vacancy_close_holders(uuid, date) to sodiq_app;

-- The deferred refusal of a closed row of 0055, its guard kept (review
-- correction 2): a closed row with an empty range (withdrawn) is never
-- refused; one in force is refused while anything holds the vacancy from its
-- first day.
create or replace function staff_statuses_vacancy_load() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if (new.valid_until is null or new.valid_until > new.valid_from)
    and exists (select 1 from vacancy_close_holders(new.staff_id, new.valid_from)) then
    raise exception 'vacancy_has_load'
      using errcode = 'check_violation', constraint = 'vacancy_has_load';
  end if;
  return null;
end;
$$;

drop function vacancy_load_rows(uuid);
