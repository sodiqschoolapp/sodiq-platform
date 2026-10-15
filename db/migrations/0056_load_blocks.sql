-- 0056 Splits, groups and weekly totals of the teaching load (task 3.4b, pull
-- request #100).
--
-- docs/spec/edge-cases/timetable.md, Structure: "A split or a set of parallel
-- groups is one block of several lessons." "Blocked at the teaching load
-- step: all parts have equal lessons per week and different teachers. A mixed
-- block is allowed: boys have physical education while girls have
-- technology, and the reverse in another slot." docs/spec/06-timetable.md,
-- Model: parallel groups are "All groups of one subject and one grade or pair
-- of grades ... placed in the same period, each with its own teacher and
-- room." docs/spec/05-classes-groups-subjects.md, Group: "Whether a class is
-- split for a subject is set in the teaching load." 06, Teachers who work in
-- several branches, Weekly load: "The teacher's total across branches is
-- shown to both and compared with the contract load."
--
-- The plan approved on pull request #100 with corrections 1 and 2: decisions
-- 2, 3, 8, 10 and 12. The blocks are those of `loadBlocks` of
-- packages/timetable-rules (decision 2): the group rows of one subject in a
-- version linked by a shared class, or by being groups across classes of the
-- same grade or pair of grades. A later change elsewhere (a class added to a
-- group) that breaks a block is not refused (3.4a decision 3); each block
-- rule is checked only when its own field is written (decision 3).
--
-- Every refusal raised here names a constraint, which the API maps to an
-- error code (apps/api/src/modules/timetable/load-facts.ts).

-- Decision 12: the halves of a split marked as part of a mixed block meet in
-- different slots, so one teacher may take both.
alter table teaching_load_rows add column mixed_block boolean not null default false
  -- Only a group row can be a half of a split (spec review of the build, must-fix 1).
  constraint load_mixed_not_split check (not mixed_block or group_id is not null);

grant insert (mixed_block), update (mixed_block) on teaching_load_rows to sodiq_app;

-- The classes and the grades of a group (none for a group without classes).
-- Runs as the invoker.
create function load_group_classes(group_ref uuid)
returns table (classes uuid[], grades smallint[])
language sql
stable
set search_path = pg_catalog, public
as $$
  select
    coalesce(array_agg(distinct gc.class_id order by gc.class_id), '{}'),
    coalesce(array_agg(distinct c.grade order by c.grade), '{}')::smallint[]
  from group_classes gc
  join classes c on c.id = gc.class_id
  where gc.group_id = group_ref
$$;

-- Decision 2: the rows of the block of a group row in its version, the row
-- itself included; nothing for a class row. The same links as `groupsLinked`
-- of packages/timetable-rules. Runs as the invoker.
create function load_block_rows(row_ref uuid)
returns table (
  id uuid,
  group_id uuid,
  teacher_id uuid,
  lessons_per_week smallint,
  mixed_block boolean,
  classes uuid[]
)
language sql
stable
set search_path = pg_catalog, public
as $$
  with recursive parts as (
    select r.id, r.group_id, r.teacher_id, r.lessons_per_week, r.mixed_block, g.classes, g.grades
    from teaching_load_rows r
    join teaching_load_rows self on self.id = row_ref
      and self.group_id is not null
      and r.version_id = self.version_id
      and r.subject_id = self.subject_id
    cross join lateral load_group_classes(r.group_id) g
    where r.group_id is not null
  ), block(id) as (
    select row_ref
    union
    select other.id
    from block b
    join parts one on one.id = b.id
    join parts other on other.id <> one.id and (
      one.classes && other.classes
      or (cardinality(one.classes) > 1 and cardinality(other.classes) > 1
        and one.grades = other.grades)
    )
  )
  select p.id, p.group_id, p.teacher_id, p.lessons_per_week, p.mixed_block, p.classes
  from parts p
  where p.id in (select b.id from block b)
$$;

grant execute on function load_group_classes(uuid) to sodiq_app;
grant execute on function load_block_rows(uuid) to sodiq_app;

-- The block rules and the split-or-whole rule, at the commit (deferred, so
-- that the API's edit of every part of a block in one transaction passes).
-- Each rule only on an insert or when its own field changed (decision 3): a
-- block broken by a later change elsewhere refuses no edit of another field.
-- The rows are read as they stand at the commit; a row deleted later in the
-- transaction is not checked.
--
-- Two transactions that write rows of one version are checked one after the
-- other: the check first takes a transaction-level advisory lock of the
-- version, and each statement after it reads the rows committed meanwhile
-- (read committed), so the second to commit sees the first's rows and is
-- refused. A lock of the version row here would come too late: PostgreSQL
-- locks the row being updated before its triggers run, and two writers of two
-- rows would deadlock (found by the build). The API takes the version FOR
-- UPDATE before any write (`lockDraft`), so its writes never meet here. Runs
-- as the invoker.
create function teaching_load_rows_blocks() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  current_row teaching_load_rows%rowtype;
  own_classes uuid[];
  split_class uuid;
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

  select g.classes into own_classes from load_group_classes(current_row.group_id) g;
  split_class := case when cardinality(own_classes) = 1 then own_classes[1] end;

  -- Decision 12: only the halves of a split are marked.
  if mixed_change and current_row.mixed_block and split_class is null then
    raise exception 'load_mixed_not_split'
      using errcode = 'check_violation', constraint = 'load_mixed_not_split';
  end if;

  -- The halves of one split agree on the mark.
  if mixed_change and split_class is not null and exists (
    select 1 from load_block_rows(current_row.id) b
    where b.id <> current_row.id
      and b.classes = array[split_class]
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
        and split_class is not null and b.classes = array[split_class]
      )
  ) then
    raise exception 'load_block_teacher'
      using errcode = 'check_violation', constraint = 'load_block_teacher';
  end if;

  return null;
end;
$$;

create constraint trigger teaching_load_rows_blocks
  after insert or update of teacher_id, lessons_per_week, mixed_block on teaching_load_rows
  deferrable initially deferred
  for each row execute function teaching_load_rows_blocks();

-- Decision 8 with correction 1: the lessons per week each teacher or vacancy
-- has in every branch other than `branch_ref`, from that branch's version
-- that runs on `on_day`: the published version in force (the latest start on
-- or before the day, ties by number), or while it has none, its draft with the
-- latest start on or before the day (ties by number), else its earliest later
-- draft, each of the year that holds the day. Only for a branch of the
-- transaction and for records linked to it (spec review of the plan,
-- should-fix 4); counts and branch ids only.
create function teacher_load_elsewhere(branch_ref uuid, teacher_ids uuid[], on_day date)
returns table (teacher_id uuid, branch_id uuid, lessons integer, draft boolean)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if not (teacher_load_elsewhere.branch_ref = any (public.app_branch_ids())) then
    raise exception 'teacher_load_branch'
      using errcode = 'check_violation', constraint = 'teacher_load_branch';
  end if;
  return query
    with running as (
      select distinct on (v.branch_id) v.id, v.branch_id, v.status = 'draft' as draft
      from public.timetable_versions v
      join public.academic_years y on y.id = v.academic_year_id
      where v.branch_id <> teacher_load_elsewhere.branch_ref
        and v.status in ('published', 'draft')
        and y.start_date <= teacher_load_elsewhere.on_day
        and y.end_date >= teacher_load_elsewhere.on_day
        and (v.status = 'draft' or v.starts_on <= teacher_load_elsewhere.on_day)
      order by v.branch_id,
        (v.status = 'published') desc,
        (v.starts_on <= teacher_load_elsewhere.on_day) desc,
        case when v.starts_on <= teacher_load_elsewhere.on_day then v.starts_on end desc,
        case when v.starts_on > teacher_load_elsewhere.on_day then v.starts_on end asc,
        v.number desc
    )
    select r.teacher_id, running.branch_id, sum(r.lessons_per_week)::integer, running.draft
    from running
    join public.teaching_load_rows r on r.version_id = running.id
    where r.teacher_id = any (teacher_load_elsewhere.teacher_ids)
      and exists (
        select 1 from public.staff_branches b
        where b.staff_id = r.teacher_id and b.branch_id = teacher_load_elsewhere.branch_ref
      )
    group by r.teacher_id, running.branch_id, running.draft;
end;
$$;

revoke execute on function teacher_load_elsewhere(uuid, uuid[], date) from public;
grant execute on function teacher_load_elsewhere(uuid, uuid[], date) to sodiq_app;
