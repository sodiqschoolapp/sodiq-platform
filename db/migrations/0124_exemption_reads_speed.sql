-- 0124 The readers of exemptions, kept to the speed targets (task 8.5, pull
-- request #223).
--
-- docs/spec/12-ux-standards.md, Speed targets: "Open a journal for a
-- quarter: under 1 second". 0123 made `lesson_student_expected` ask
-- `lesson_student_exemption` for every member of every lesson, and that asked
-- `lesson_kept_out_students`, which works out the whole lesson, once per
-- member. The real-size run (task 5.12c) opened a quarter in 5.6 seconds.
--
-- Same names, arguments and answers as 0123; only the work changes:
-- - PL/pgSQL, so each statement's plan is kept for the session (a SQL function
--   with `set search_path` is never inlined);
-- - no span of the student: not exempt, without a join of the lesson;
-- - no kept-block source for the lesson's block or group on its date (a bulk
--   cancel kept, a class out for an exam, a group block kept on a day off):
--   nobody taken out, without working out the members. The test is wider than
--   the rule of `lesson_kept_out_students` (no time, no state of the exam), so
--   it only skips work that would find nobody.

create or replace function lesson_student_exemption_kind(lesson_ref uuid, student_ref uuid) returns text
language plpgsql
stable
set search_path = pg_catalog, public
as $$
declare
  kind text;
begin
  if not exists (
    select 1 from exemption_spans s where s.student_id = student_ref and s.live
  ) then
    return null;
  end if;
  select case when bool_or(e.kind = 'full') then 'full' when count(*) > 0 then 'temporary' end
  into kind
  from lessons l
  join branches b on b.id = l.branch_id
  join exemption_spans s
    on s.student_id = student_ref
    and s.live
    and s.subject_key in ('00000000-0000-0000-0000-000000000000'::uuid, l.subject_id)
    and s.span && tsrange(l.starts_at at time zone b.time_zone, l.ends_at at time zone b.time_zone, '[)')
  join exemptions e on e.id = s.exemption_id
  where l.id = lesson_ref
    and not exists (
      select 1 from exemption_skips k where k.exemption_id = e.id and k.lesson_id = l.id
    );
  return kind;
end
$$;

-- Whether a kept block may take somebody out of the lesson (a fast test, wider
-- than `lesson_kept_out_students`).
create function lesson_kept_out_possible(lesson_ref uuid) returns boolean
language plpgsql
stable
set search_path = pg_catalog, public
as $$
begin
  return exists (
    select 1 from lessons l
    where l.id = lesson_ref
      and l.cancel_cause is null
      and (
        exists (
          select 1 from bulk_cancel_blocks k
          where k.block_id = l.block_id and k.lesson_date = l.lesson_date and k.choice = 'keep'
        )
        or exists (select 1 from lesson_block_class_outs o where o.block_id = l.block_id)
        or exists (
          select 1 from calendar_group_block_groups g
          join calendar_group_blocks k on k.id = g.block_id and k.choice = 'keep'
          where g.group_id = l.group_id and g.lesson_date = l.lesson_date
        )
      )
  );
end
$$;

create or replace function lesson_student_exemption(lesson_ref uuid, student_ref uuid) returns text
language plpgsql
stable
set search_path = pg_catalog, public
as $$
declare
  kind text;
begin
  kind := lesson_student_exemption_kind(lesson_ref, student_ref);
  if kind is not null then
    return kind;
  end if;
  if not lesson_kept_out_possible(lesson_ref) then
    return null;
  end if;
  if exists (select 1 from lesson_kept_out_students(lesson_ref) o(student_id) where o.student_id = student_ref) then
    return 'temporary';
  end if;
  return null;
end
$$;

create or replace function lesson_student_expected(lesson_ref uuid, student_ref uuid) returns boolean
language plpgsql
stable
set search_path = pg_catalog, public
as $$
begin
  if not exists (
    select 1 from lessons l
    where l.id = lesson_ref
      and (
        exists (
          select 1 from class_memberships m
          where l.class_id is not null
            and m.class_id = l.class_id
            and m.student_id = student_ref
            and m.valid_from <= l.lesson_date
            and l.lesson_date < m.valid_until
        )
        or exists (
          select 1 from group_memberships m
          where l.group_id is not null
            and m.group_id = l.group_id
            and m.student_id = student_ref
            and m.valid_from <= l.lesson_date
            and l.lesson_date < m.valid_until
        )
      )
  ) then
    return false;
  end if;
  return lesson_student_exemption(lesson_ref, student_ref) is null;
end
$$;

grant execute on function lesson_kept_out_possible(uuid) to sodiq_app;

-- Same answer as 0108: the members on the lesson's date who are expected. A
-- member with no live span, of a lesson no kept block may touch, is expected
-- without asking for each.
create or replace function lesson_expected_students(lesson_ref uuid) returns setof uuid
language plpgsql
stable
set search_path = pg_catalog, public
as $$
declare
  kept boolean := lesson_kept_out_possible(lesson_ref);
begin
  return query
  select s.student_id
  from (
    select m.student_id from lessons l
      join class_memberships m on m.class_id = l.class_id
        and m.valid_from <= l.lesson_date and l.lesson_date < m.valid_until
      where l.id = lesson_ref
    union
    select m.student_id from lessons l
      join group_memberships m on m.group_id = l.group_id
        and m.valid_from <= l.lesson_date and l.lesson_date < m.valid_until
      where l.id = lesson_ref
  ) s
  where (
    (not kept and not exists (
      select 1 from exemption_spans x where x.student_id = s.student_id and x.live
    ))
    or lesson_student_exemption(lesson_ref, s.student_id) is null
  );
end
$$;
