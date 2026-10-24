-- 0126 What code round 1 of the review of task 8.5 found (pull request #223).
--
-- ---------------------------------------------------------------------------
-- The students a kept block takes out of a held lesson (review findings 1
-- and 2). Same name, argument and answer shape as 0123; two matches change:
--
-- 1. The kept group block of a day off is found by the group, the date and the
--    lesson block's weekly start (`pattern_blocks.start_minutes`, what
--    `calendar_group_block_groups.start_minutes` copies; `dated.ts`,
--    `groupChoiceOn(..., block.start)`), never by the lesson's own start on
--    the date: a stored slot choice or a special-day template moves the kept
--    lesson off its weekly start (edge/time-dates-calendar, "A day off for
--    grade 9 only": "keep them and exempt the students of the grade that is
--    off"; From 5.6b-3).
-- 2. "A lesson fed by the chosen classes alone" (From 6.1b-2, decision 11) is
--    decided by the lesson's feeder classes (its class, or the classes of its
--    group), as the bulk cancel's `chosenOnly` and the exam's shared block
--    decide it, never by the members on the date: a group fed by a chosen and
--    a non-chosen class whose members all are of the chosen class is kept as a
--    shared block, and its members of the chosen class are taken out
--    (edge/timetable, the 7 Oxford and the 10 Brown rows: "exempt the
--    students of the chosen classes for those slots"). A lesson with no feeder
--    class is never fed by them alone, as `chosenOnly` reads it.

create or replace function lesson_kept_out_students(lesson_ref uuid) returns setof uuid
language sql
stable
set search_path = pg_catalog, public
as $$
  with lesson as (
    select l.*, b.time_zone from lessons l join branches b on b.id = l.branch_id
    where l.id = lesson_ref and l.cancel_cause is null
  ),
  members as (
    select m.student_id from lesson l
      join class_memberships m on m.class_id = l.class_id
      where m.valid_from <= l.lesson_date and l.lesson_date < m.valid_until
    union
    select m.student_id from lesson l
      join group_memberships m on m.group_id = l.group_id
      where m.valid_from <= l.lesson_date and l.lesson_date < m.valid_until
  ),
  class_of as (
    select x.student_id, m.class_id, c.grade
    from members x
    cross join lesson l
    join class_memberships m on m.student_id = x.student_id
      and m.valid_from <= l.lesson_date and l.lesson_date < m.valid_until
    join classes c on c.id = m.class_id
  ),
  out_classes as (
    select sp.class_id from lesson l
      join bulk_cancel_blocks k on k.block_id = l.block_id and k.lesson_date = l.lesson_date
        and k.choice = 'keep'
      join bulk_cancel_spans sp on sp.bulk_cancel_id = k.bulk_cancel_id
        and sp.starts_at < l.ends_at and l.starts_at < sp.ends_at
    union
    select o.class_id from lesson l
      join lesson_block_class_outs o on o.block_id = l.block_id
      join exams x on x.id = o.exam_id and x.cancel_cause is null
        and x.starts_at < l.ends_at and l.starts_at < x.ends_at
      where exists (
        select 1 from exam_room_classes r where r.exam_id = x.id and r.class_id = o.class_id
      )
  ),
  off_grades as (
    select e.grade_from, e.grade_to from lesson l
      join lesson_blocks lb on lb.id = l.block_id
      join pattern_blocks pb on pb.id = lb.pattern_block_id
      join calendar_group_block_groups g on g.group_id = l.group_id
        and g.lesson_date = l.lesson_date
        and g.start_minutes = pb.start_minutes
      join calendar_group_blocks k on k.id = g.block_id and k.choice = 'keep'
      join calendar_entries e on e.id = k.calendar_entry_id
  ),
  taken as (
    select c.student_id from class_of c where c.class_id in (select class_id from out_classes)
    union
    select c.student_id from class_of c
      join off_grades o on c.grade between coalesce(o.grade_from, 0) and coalesce(o.grade_to, 99)
  ),
  feeders as (
    select l.class_id from lesson l where l.class_id is not null
    union
    select gc.class_id from lesson l join group_classes gc on gc.group_id = l.group_id
  ),
  left_out as (
    select class_id from out_classes
    union
    select f.class_id from feeders f
      join classes c on c.id = f.class_id
      join off_grades o on c.grade between coalesce(o.grade_from, 0) and coalesce(o.grade_to, 99)
  )
  select t.student_id from taken t
  where not exists (select 1 from feeders)
    or exists (select 1 from feeders f where f.class_id not in (select class_id from left_out))
$$;

-- ---------------------------------------------------------------------------
-- The give-back of a leaving (review finding 3). edge/students-classes-groups,
-- row 16, with the undo; .claude/rules/api.md: a change that cancels another
-- gives back every row it cut. A started full exemption that an End cut before
-- the year's end, cut further by a leaving, comes back to its end before the
-- leaving when the leaving is cancelled or undone: that write clears the
-- leaving fields and sets `end_date` to `end_before_leaving`, and passes the
-- third `exemption_full_end` check. The rest of the function is 0125's.

create or replace function exemptions_write() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  moment timestamptz;
  year_row academic_years;
  today date;
begin
  moment := class_tutors_moment();
  if moment is null then
    raise exception 'exemption_moment'
      using errcode = 'check_violation', constraint = 'exemption_moment';
  end if;
  -- A merge carries the exemption to the kept record and changes nothing else
  -- (From 3.3d): no check of its year, also a closed one, and no new version.
  if tg_op = 'UPDATE' and new.student_id is distinct from old.student_id then
    if not student_merge_here(old.student_id, new.student_id)
      or (to_jsonb(new) - 'student_id') is distinct from (to_jsonb(old) - 'student_id') then
      raise exception 'exemption_student'
        using errcode = 'check_violation', constraint = 'exemption_student';
    end if;
    return new;
  end if;
  select * into year_row from academic_years y
    where y.id = new.year_id and y.branch_id = new.branch_id
    for share;
  if year_row.status = 'closed' then
    raise exception 'exemption_closed_year'
      using errcode = 'check_violation', constraint = 'exemption_closed_year';
  end if;
  if new.start_date < year_row.start_date or new.end_date > year_row.end_date then
    raise exception 'exemption_outside_year'
      using errcode = 'check_violation', constraint = 'exemption_outside_year';
  end if;
  today := exemption_today(new.branch_id, moment);
  if tg_op = 'INSERT' then
    new.version := 1;
    new.granted_at := moment;
    if new.kind = 'full' and new.end_date <> year_row.end_date then
      raise exception 'exemption_full_end'
        using errcode = 'check_violation', constraint = 'exemption_full_end';
    end if;
  else
    -- A void is final, but the void of a leaving is given back by its cancel
    -- or undo (decision 14): void and leaving fields only.
    if old.voided_at is not null
      and (to_jsonb(new) - 'student_id') is distinct from (to_jsonb(old) - 'student_id')
      and not (
        old.void_cause = 'leaving' and new.voided_at is null and new.leaving_id is null
        and (to_jsonb(new) - array['student_id', 'voided_at', 'voided_by', 'void_cause', 'leaving_id', 'end_before_leaving'])
          = (to_jsonb(old) - array['student_id', 'voided_at', 'voided_by', 'void_cause', 'leaving_id', 'end_before_leaving'])
      ) then
      raise exception 'exemption_voided'
        using errcode = 'check_violation', constraint = 'exemption_voided';
    end if;
    if new.student_id is distinct from old.student_id
      and not student_merge_here(old.student_id, new.student_id) then
      raise exception 'exemption_student'
        using errcode = 'check_violation', constraint = 'exemption_student';
    end if;
    if old.start_date <= today and (
      new.kind, new.all_subjects, new.start_date, new.start_time, new.end_time,
      new.category, new.detail
    ) is distinct from (
      old.kind, old.all_subjects, old.start_date, old.start_time, old.end_time,
      old.category, old.detail
    ) then
      raise exception 'exemption_started'
        using errcode = 'check_violation', constraint = 'exemption_started';
    end if;
    if new.kind = 'full' and old.start_date > today and new.end_date <> year_row.end_date
      and new.end_cause is null and new.leaving_id is null then
      raise exception 'exemption_full_end'
        using errcode = 'check_violation', constraint = 'exemption_full_end';
    end if;
    if new.kind = 'full' and old.start_date <= today and new.end_date > old.end_date
      and new.end_date <> year_row.end_date
      and not (
        old.leaving_id is not null and new.leaving_id is null
        and new.end_date = old.end_before_leaving
      ) then
      raise exception 'exemption_full_end'
        using errcode = 'check_violation', constraint = 'exemption_full_end';
    end if;
    new.version := old.version + 1;
  end if;
  new.changed_at := moment;
  return new;
end;
$$;
