-- 0171 Groups for one sex, and the halves of a pair of classes (the owner's
-- spec change of 17 November 2026, for the go-live of the Labzak branch).
--
-- docs/spec/05-classes-groups-subjects.md, Group: "A split divides one class,
-- or a pair of classes that do the subject together, into parts for one
-- subject (group 1 and group 2). A group may be for girls only or for boys
-- only; it takes only students of that sex. [...] Every student of the
-- classes involved must be in exactly one group for that subject that is
-- open to them: a subject whose groups in a class are all for one sex binds
-- only the students of that sex (taekwondo for the boys only)".
-- docs/spec/edge-cases/timetable.md, Structure: a mixed block's "two lessons
-- are parts of two subjects drawn from the same class, or from the same pair
-- of classes that do these subjects together".
--
-- A new nullable column: every existing group keeps no sex and behaves as
-- before. No existing row is changed or removed. Two functions of earlier
-- migrations are replaced, each narrowed only where the requirement changed
-- (Look first): `class_row_needs_groups` (0075) and `teaching_load_rows_blocks`
-- (0056). Three guards are added.

-- "For girls only or boys only (optional)": the values of `students.sex`.
alter table groups add column sex text
  constraint groups_sex_check check (sex in ('male', 'female'));

grant insert (sex), update (sex) on groups to sodiq_app;

-- The rows of a group or a student that still count for the sex rule: not
-- empty, and not ended on or before the branch's today (`branch_today`,
-- 0045). Past rows are history and are never rewritten. Without a moment (a
-- transaction of the migrator) every row that is not empty counts.
create function group_sex_row_counts(row_branch uuid, from_day date, until_day date)
returns boolean
language sql
stable
set search_path = pg_catalog, public
as $$
  select from_day < until_day
    and until_day > coalesce(branch_today(row_branch), '-infinity'::date)
$$;

grant execute on function group_sex_row_counts(uuid, date, date) to sodiq_app;

-- "It takes only students of that sex": whether the row's student may be in
-- its group; a row with no day is not checked.
create function group_row_sex_fits(row_student uuid, row_group uuid, from_day date, until_day date)
returns boolean
language sql
stable
set search_path = pg_catalog, public
as $$
  select from_day >= until_day
    or coalesce((
      select g.sex is null or g.sex = s.sex
      from groups g, students s
      where g.id = row_group and s.id = row_student
    ), true)
$$;

grant execute on function group_row_sex_fits(uuid, uuid, date, date) to sodiq_app;

-- On the insert of a group row, after `group_memberships_guard` (triggers of
-- one event run in the order of their names), which has locked the student
-- FOR SHARE and the group FOR UPDATE: the sex of each is read under those
-- locks. Also when a row is carried to another student (a merge updates
-- `student_id`, and locks both records first).
create function group_memberships_sex() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if not group_row_sex_fits(new.student_id, new.group_id, new.valid_from, new.valid_until) then
    raise exception 'group_memberships_sex'
      using errcode = 'check_violation', constraint = 'group_memberships_sex';
  end if;
  return new;
end;
$$;

create trigger group_memberships_sex
  before insert or update of student_id, group_id on group_memberships
  for each row execute function group_memberships_sex();

-- A row that takes back days (the cancel or undo of a leaving, a merge's
-- join; `group_memberships_regained`, 0062), or that a merge carries to
-- another student, passes the sex rule again at the commit, under a lock of
-- its group: a sex corrected, or a group's sex set, while the row was cut (it
-- did not count then) must not come back with it (.claude/rules/database.md,
-- the re-check of a waived rule), and a group's sex set while a carry is under
-- way waits for it or is read by it (the before trigger above holds no lock of
-- the group on an update). The group only is locked here, FOR SHARE: a sex
-- correction locks the groups of the student's rows FOR SHARE too, so it
-- waits for this commit (and then sees the row) or committed before (and is
-- read here). No student lock: a commit check that holds the group
-- (`group_memberships_regained` locks it FOR UPDATE first) never waits for a
-- student, so it never meets a correction in the other order.
create function group_memberships_sex_regained() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  now_row record;
begin
  select m.* into now_row from group_memberships m where m.id = new.id;
  if not found
    or (now_row.valid_until <= old.valid_until and now_row.student_id = old.student_id) then
    return null;
  end if;
  perform 1 from groups g where g.id = now_row.group_id for share;
  if not group_row_sex_fits(
    now_row.student_id, now_row.group_id, now_row.valid_from, now_row.valid_until
  ) then
    raise exception 'group_memberships_sex'
      using errcode = 'check_violation', constraint = 'group_memberships_sex';
  end if;
  return null;
end;
$$;

create constraint trigger group_memberships_sex_regained
  after update on group_memberships
  deferrable initially deferred
  for each row
  when (new.valid_until > old.valid_until or new.student_id <> old.student_id)
  execute function group_memberships_sex_regained();

-- A group set to one sex holds no row that still counts of a student of the
-- other sex. The group row is locked by the update itself, before this
-- trigger; no student is locked here (the order everywhere is the student,
-- then the group). A member insert locks the group FOR UPDATE and waits for
-- this change, or committed before and is read here; a sex correction locks
-- the student's groups FOR SHARE (below) and so waits for this change, or
-- committed before and is read here: each statement of this function reads
-- what committed before it.
create function groups_sex_members() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.sex is null or new.sex is not distinct from old.sex then
    return new;
  end if;
  if exists (
    select 1
    from group_memberships gm
    join students s on s.id = gm.student_id
    where gm.group_id = new.id
      and group_sex_row_counts(gm.branch_id, gm.valid_from, gm.valid_until)
      and s.sex <> new.sex
  ) then
    raise exception 'groups_sex_members'
      using errcode = 'check_violation', constraint = 'groups_sex_members';
  end if;
  return new;
end;
$$;

create trigger groups_sex_members
  before update of sex on groups
  for each row execute function groups_sex_members();

-- A student's sex is corrected only while no row that still counts holds
-- them in a group of the other sex. The student row is locked by the update;
-- a group row insert locks it FOR SHARE first (`group_memberships_guard`), so
-- it waits for this change and reads the new sex. The groups of the student's
-- rows are locked FOR SHARE in the order of their id, then read in a
-- statement of their own: a group's sex change either committed before and is
-- read, or waits for this change. Student, then group, as every path.
-- The rows are read through the branch filter: a student's rows are rows of
-- their branch, except before the date of an accepted move to another branch.
create function students_sex_groups() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.sex is not distinct from old.sex then
    return new;
  end if;
  perform 1 from groups g
  where g.id in (
    select gm.group_id from group_memberships gm
    where gm.student_id = new.id
      and group_sex_row_counts(gm.branch_id, gm.valid_from, gm.valid_until)
  )
  order by g.id
  for share;
  if exists (
    select 1
    from group_memberships gm
    join groups g on g.id = gm.group_id
    where gm.student_id = new.id
      and g.sex is not null
      and g.sex <> new.sex
      and group_sex_row_counts(gm.branch_id, gm.valid_from, gm.valid_until)
  ) then
    raise exception 'students_sex_groups'
      using errcode = 'check_violation', constraint = 'students_sex_groups';
  end if;
  return new;
end;
$$;

create trigger students_sex_groups
  before update of sex on students
  for each row execute function students_sex_groups();

-- 0075 with one change (Look first, the requirement changed): a stretch of a
-- subject binds the class row only when one of its groups is open to the
-- student, a group with no sex or of the student's sex. A subject whose
-- groups are all for the other sex leaves the student free of it; a subject
-- with any group open to the student still needs a group row over every day,
-- as before. Runs as the invoker.
create or replace function class_row_needs_groups(membership_ref uuid, class_ref uuid, from_day date)
returns boolean
language sql
stable
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from class_group_subject_runs(class_ref) run
    where exists (
        select 1
        from groups g
        join class_memberships m on m.id = membership_ref
        join students s on s.id = m.student_id
        where g.id = any (run.group_ids)
          and (g.sex is null or g.sex = s.sex)
      )
      and not isempty(
        coalesce(
          class_row_gaps(membership_ref, run.subject_id, class_row_needs_groups.from_day),
          '{}'::datemultirange
        )
          * datemultirange(daterange(run.from_day, run.until_day))
      )
  )
$$;

-- 0056 with the split read as the group's set of classes (Look first, the
-- requirement changed: "A split divides one class, or a pair of classes that
-- do the subject together"; `sameSplit` of packages/timetable-rules). A group
-- of one class or of two may be marked; a group of three classes or more
-- still answers `load_mixed_not_split`. The halves that agree on the mark and
-- that may share a teacher are the rows whose groups draw from the same one
-- or two classes. Every other rule, lock and order as in 0056.
create or replace function teaching_load_rows_blocks() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  current_row teaching_load_rows%rowtype;
  own_classes uuid[];
  lessons_change boolean;
  teacher_change boolean;
  mixed_change boolean;
begin
  select * into current_row from teaching_load_rows r where r.id = new.id;
  if not found then
    return null;
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended('teaching_load_rows_blocks:' || current_row.version_id::text, 0)
  );

  -- 05, Group: a version never holds both a whole-class row and a group row
  -- for one class and subject. The unit and the subject never change
  -- (teaching_load_rows_fixed), so on an insert only.
  if tg_op = 'INSERT' then
    if current_row.class_id is not null and exists (
      select 1
      from teaching_load_rows r
      join group_classes gc on gc.group_id = r.group_id
      where r.version_id = current_row.version_id
        and r.subject_id = current_row.subject_id
        and gc.class_id = current_row.class_id
    ) then
      raise exception 'load_split_and_whole'
        using errcode = 'check_violation', constraint = 'load_split_and_whole';
    end if;
    if current_row.group_id is not null and exists (
      select 1
      from teaching_load_rows r
      join group_classes gc on gc.class_id = r.class_id
      where r.version_id = current_row.version_id
        and r.subject_id = current_row.subject_id
        and gc.group_id = current_row.group_id
    ) then
      raise exception 'load_split_and_whole'
        using errcode = 'check_violation', constraint = 'load_split_and_whole';
    end if;
  end if;

  if current_row.group_id is null then
    return null;
  end if;

  lessons_change := tg_op = 'INSERT' or new.lessons_per_week is distinct from old.lessons_per_week;
  teacher_change := tg_op = 'INSERT' or new.teacher_id is distinct from old.teacher_id;
  mixed_change := tg_op = 'INSERT' or new.mixed_block is distinct from old.mixed_block;

  -- Sorted and distinct (`load_group_classes`, 0056), as `b.classes`. Only a
  -- split (one class or a pair) has halves.
  select g.classes into own_classes from load_group_classes(current_row.group_id) g;
  if cardinality(own_classes) not between 1 and 2 then
    own_classes := null;
  end if;

  if mixed_change and current_row.mixed_block and own_classes is null then
    raise exception 'load_mixed_not_split'
      using errcode = 'check_violation', constraint = 'load_mixed_not_split';
  end if;

  -- The halves of one split (the same classes) agree on the mark.
  if mixed_change and own_classes is not null and exists (
    select 1 from load_block_rows(current_row.id) b
    where b.id <> current_row.id
      and b.classes = own_classes
      and b.mixed_block <> current_row.mixed_block
  ) then
    raise exception 'load_block_mixed'
      using errcode = 'check_violation', constraint = 'load_block_mixed';
  end if;

  -- "All parts have equal lessons per week."
  if lessons_change and exists (
    select 1 from load_block_rows(current_row.id) b
    where b.id <> current_row.id and b.lessons_per_week <> current_row.lessons_per_week
  ) then
    raise exception 'load_block_lessons'
      using errcode = 'check_violation', constraint = 'load_block_lessons';
  end if;

  -- "And different teachers", except the halves of a mixed split; a cleared
  -- mark is checked as a teacher change.
  if (teacher_change or mixed_change) and exists (
    select 1 from load_block_rows(current_row.id) b
    where b.id <> current_row.id
      and b.teacher_id = current_row.teacher_id
      and not (
        current_row.mixed_block and b.mixed_block
        and own_classes is not null and b.classes = own_classes
      )
  ) then
    raise exception 'load_block_teacher'
      using errcode = 'check_violation', constraint = 'load_block_teacher';
  end if;

  return null;
end;
$$;
