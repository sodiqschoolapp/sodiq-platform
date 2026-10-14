-- 0048 Group membership (task 3.2b, pull request #92).
--
-- docs/spec/05-classes-groups-subjects.md, Group: "Every student of the
-- classes involved must be in exactly one group for that subject; the screen
-- lists students not yet placed." "A bulk screen places students ... into
-- groups for one subject and one grade, or one pair of grades, at a time."
-- docs/spec/edge-cases/developer-rules.md, Membership: "one group per student
-- per subject per date, by date ranges that cannot overlap."
-- docs/spec/edge-cases/students-classes-groups.md: "Bulk placement puts
-- students into the smallest suitable group and tags them \"placed
-- automatically, review\"." "The maximum size is a hard limit on the
-- effective date, counting scheduled joins and leaves, on every path. ...
-- Groups work the same way."
-- docs/spec/04-people.md, Movements: "Leaving the school ... taken out of
-- classes and groups from that date."
--
-- The plan approved on pull request #92: decisions 3, 7, 8, 9, 11 and 16.
-- The rows follow the shape of class_memberships (0045).
--
-- Every refusal raised here names a constraint, which the API maps to an
-- error code (apps/api/src/modules/classes/group-membership-rows.ts).

-- The groups of a student over dates, half-open `[valid_from, valid_until)`.
-- A row lies inside a class row of the student in a class of its group
-- (group_memberships_in_class, at the commit). Rows only shrink and are never
-- deleted by the application; they go with a student deleted as created
-- twice (the cascade kept in the audit entry of the delete).
create table group_memberships (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  student_id uuid not null references students (id) on delete cascade,
  group_id uuid not null,
  -- The group's subject, copied so that the exclusion below can read it; the
  -- guard refuses any other.
  subject_id uuid not null references subjects (id),
  valid_from date not null,
  -- The end in force: `own_until`, or earlier once a leaving cut the row or
  -- the row was withdrawn before its date (an empty range).
  valid_until date not null,
  -- Decision 7: the own end of the class row the row was written inside,
  -- written at the insert and never changed, so that a leaving taken back
  -- (task 3.2c) gives the row its own end again.
  own_until date not null,
  -- What wrote the row: a placement by hand or "Place automatically" (task
  -- 3.2c and 3.3 add their causes).
  cause text not null constraint group_memberships_cause_check check (
    cause in ('placement', 'automatic')
  ),
  -- Decision 3: "placed automatically, review" until someone marks it
  -- reviewed; only from true to false.
  review boolean not null default false,
  -- Who ended it before its own end: a leaving (`leaving_id` names its
  -- inactive status row), a withdraw of the planned row, or the withdraw of
  -- the planned class row that held it.
  ended_by text constraint group_memberships_ended_by_check check (
    ended_by in ('leaving', 'withdrawn', 'class_withdrawn')
  ),
  leaving_id uuid references student_statuses (id),
  -- Bookkeeping only; no rule reads it.
  created_at timestamptz not null default now(),
  constraint group_memberships_group_fkey foreign key (group_id, branch_id)
    references groups (id, branch_id),
  constraint group_memberships_range_check check (
    valid_from <= valid_until and valid_until <= own_until and valid_from < own_until
  ),
  constraint group_memberships_ended_check check (
    (ended_by is null) = (valid_until = own_until)
  ),
  constraint group_memberships_leaving_check check (
    (ended_by = 'leaving') = (leaving_id is not null)
  ),
  constraint group_memberships_withdrawn_check check (
    ended_by is null or ended_by = 'leaving' or valid_until = valid_from
  ),
  -- Developer rules, Membership: one group per student per subject per date.
  -- An empty range (a withdrawn row) meets nothing; half-open ends touch.
  constraint group_memberships_no_overlap exclude using gist (
    student_id with =,
    subject_id with =,
    daterange(valid_from, valid_until) with &&
  )
);

create index group_memberships_group_idx on group_memberships (group_id, valid_from);
create index group_memberships_student_idx on group_memberships (student_id, valid_from);
create index group_memberships_branch_idx on group_memberships (branch_id);
create index group_memberships_leaving_idx on group_memberships (leaving_id);
create index group_memberships_subject_idx on group_memberships (subject_id);

alter table group_memberships enable row level security;
create policy branch_filter on group_memberships for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select on group_memberships to sodiq_app;
grant insert (
  branch_id, student_id, group_id, subject_id, valid_from, valid_until, own_until, cause, review,
  ended_by, leaving_id
) on group_memberships to sodiq_app;
grant update (valid_until, ended_by, leaving_id, review) on group_memberships to sodiq_app;

-- The largest number of members a group holds on any date of `[from_day,
-- until_day)` (`until_day` null: to the end), counting every row that is not
-- empty: a scheduled join counts from its date and a scheduled leaving ends
-- the count at its date (0045's `class_members_peak` over group rows). Runs as
-- the invoker: the rows of the group's branch.
create function group_members_peak(group_ref uuid, from_day date, until_day date) returns integer
language sql
stable
set search_path = pg_catalog, public
as $$
  select coalesce(max((
    select count(*)
    from group_memberships m
    where m.group_id = group_ref
      and m.valid_from < m.valid_until
      and m.valid_from <= days.day
      and days.day < m.valid_until
  )), 0)::integer
  from (
    select from_day as day
    union
    select m.valid_from
    from group_memberships m
    where m.group_id = group_ref
      and m.valid_from < m.valid_until
      and m.valid_from > from_day
      and (until_day is null or m.valid_from < until_day)
  ) days
$$;

-- A new row. The locks first: the student FOR SHARE (every writer of a
-- student's rows holds the student FOR UPDATE), then the group FOR UPDATE, so
-- that two placements into its last seat, an archive, an edit of its classes
-- or a lower maximum pass one after another. Then each rule in a statement of
-- its own (.claude/rules/database.md, lock then read): the student of the
-- group's branch, the group active, its subject the row's, its year open, the
-- row inside the year, not inserted cut except by a leaving, a leaving of the
-- student, the review tag only on an automatic placement, and the size on
-- every date of the row. For every user. Runs as the invoker.
create function group_memberships_guard() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  pupil_branch uuid;
  held record;
  year record;
begin
  perform 1 from students s where s.id = new.student_id for share;
  perform 1 from groups g where g.id = new.group_id and g.branch_id = new.branch_id for update;
  select s.branch_id into pupil_branch from students s where s.id = new.student_id;
  if not found or pupil_branch is distinct from new.branch_id then
    raise exception 'group_memberships_student_branch'
      using errcode = 'check_violation', constraint = 'group_memberships_student_branch';
  end if;
  select g.archived_at, g.academic_year_id, g.subject_id, g.max_size into held
    from groups g where g.id = new.group_id and g.branch_id = new.branch_id;
  if not found then
    -- The foreign key answers it.
    return new;
  end if;
  if held.archived_at is not null then
    raise exception 'group_memberships_group_archived'
      using errcode = 'check_violation', constraint = 'group_memberships_group_archived';
  end if;
  if held.subject_id <> new.subject_id then
    raise exception 'group_memberships_subject'
      using errcode = 'check_violation', constraint = 'group_memberships_subject';
  end if;
  perform class_year_open(held.academic_year_id);
  select y.start_date, y.end_date into year
    from academic_years y where y.id = held.academic_year_id;
  if new.valid_from < year.start_date or new.own_until > year.end_date + 1 then
    raise exception 'group_memberships_outside_year'
      using errcode = 'check_violation', constraint = 'group_memberships_outside_year';
  end if;
  if (new.ended_by is not null and new.ended_by <> 'leaving')
    or (new.valid_until = new.valid_from and new.ended_by is distinct from 'leaving') then
    raise exception 'group_memberships_insert_ended'
      using errcode = 'check_violation', constraint = 'group_memberships_insert_ended';
  end if;
  if new.leaving_id is not null
    and not class_membership_leaving_valid(new.student_id, new.leaving_id) then
    raise exception 'group_memberships_leaving'
      using errcode = 'check_violation', constraint = 'group_memberships_leaving';
  end if;
  if new.review and new.cause <> 'automatic' then
    raise exception 'group_memberships_review'
      using errcode = 'check_violation', constraint = 'group_memberships_review';
  end if;
  if new.valid_from < new.valid_until
    and group_members_peak(new.group_id, new.valid_from, new.valid_until) + 1 > held.max_size then
    raise exception 'group_memberships_full'
      using errcode = 'check_violation', constraint = 'group_memberships_full';
  end if;
  return new;
end;
$$;

create trigger group_memberships_guard
  before insert on group_memberships
  for each row execute function group_memberships_guard();

-- Rows only shrink, as class rows (0045): the end in force moves earlier or
-- stays, the cause of an end is written once; a leaving cuts a row no one
-- ended or a leaving cut; a withdrawn row (either kind) is final and is
-- withdrawn only before its first day in the branch's time zone; the review
-- tag goes from true to false only. A change of the end in a closed year is
-- refused. For every user. Runs as the invoker.
create function group_memberships_only_shrink() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  year_id uuid;
begin
  if (to_jsonb(new) - 'valid_until' - 'ended_by' - 'leaving_id' - 'review')
      is distinct from (to_jsonb(old) - 'valid_until' - 'ended_by' - 'leaving_id' - 'review')
    or new.valid_until > old.valid_until
    or old.ended_by in ('withdrawn', 'class_withdrawn')
    or (old.ended_by = 'leaving' and new.ended_by is null)
    or (new.review and not old.review) then
    raise exception 'group_memberships_only_shrink'
      using errcode = 'check_violation', constraint = 'group_memberships_only_shrink';
  end if;
  if new.ended_by in ('withdrawn', 'class_withdrawn') and old.ended_by is distinct from new.ended_by
    and old.valid_from <= coalesce(branch_today(new.branch_id), 'infinity'::date) then
    raise exception 'group_memberships_withdraw_planned'
      using errcode = 'check_violation', constraint = 'group_memberships_withdraw_planned';
  end if;
  if new.leaving_id is not null
    and new.leaving_id is distinct from old.leaving_id
    and not class_membership_leaving_valid(new.student_id, new.leaving_id) then
    raise exception 'group_memberships_leaving'
      using errcode = 'check_violation', constraint = 'group_memberships_leaving';
  end if;
  if new.valid_until <> old.valid_until then
    perform 1 from groups g where g.id = new.group_id for share;
    select g.academic_year_id into year_id from groups g where g.id = new.group_id;
    perform class_year_open(year_id);
  end if;
  return new;
end;
$$;

create trigger group_memberships_only_shrink
  before update on group_memberships
  for each row execute function group_memberships_only_shrink();

-- Whether a row with days of a student's group rows (of one group, or of
-- every group when `group_ref` is null) lies outside the union of the
-- student's class rows in the classes of its group. Reads only, no lock
-- (decision 8: every writer of a student's rows holds the student FOR
-- UPDATE, every writer of a group's classes holds the group FOR UPDATE).
-- Runs as the invoker: a group row, its group's classes and those classes'
-- rows are all of the group's branch.
create function group_rows_outside_class(student uuid, group_ref uuid) returns boolean
language sql
stable
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from group_memberships gm
    where gm.student_id = student
      and (group_ref is null or gm.group_id = group_ref)
      and gm.valid_from < gm.valid_until
      and not coalesce((
        select range_agg(daterange(m.valid_from, m.valid_until))
        from class_memberships m
        join group_classes gc on gc.class_id = m.class_id and gc.group_id = gm.group_id
        where m.student_id = student and m.valid_from < m.valid_until
      ), '{}'::datemultirange) @> daterange(gm.valid_from, gm.valid_until)
  )
$$;

-- Decision 8: a group row only inside a class row of one of its group's
-- classes, at the commit, from both sides: a group row written or changed,
-- and a class row written or cut (a leaving, a withdraw, and the later paths
-- of 9.5a and 3.3), so that a path that ends a class row without the group
-- rows of those dates fails whatever the application does.
create function group_memberships_in_class() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if group_rows_outside_class(new.student_id, null) then
    raise exception 'group_memberships_in_class'
      using errcode = 'check_violation', constraint = 'group_memberships_in_class';
  end if;
  return null;
end;
$$;

create constraint trigger group_memberships_in_class
  after insert or update on group_memberships
  deferrable initially deferred
  for each row execute function group_memberships_in_class();

create constraint trigger class_memberships_group_rows
  after insert or update on class_memberships
  deferrable initially deferred
  for each row execute function group_memberships_in_class();

-- The task line "a group's classes cannot change while it holds students of
-- them" (decision 16): a class taken out of a group is refused while the
-- group holds any row with days, past rows included, of a student that no
-- other class of the group holds on those days.
create function group_classes_members() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  pupil uuid;
begin
  for pupil in
    select distinct gm.student_id from group_memberships gm
    where gm.group_id = old.group_id and gm.valid_from < gm.valid_until
  loop
    if group_rows_outside_class(pupil, old.group_id) then
      raise exception 'group_class_has_members'
        using errcode = 'check_violation', constraint = 'group_class_has_members';
    end if;
  end loop;
  return null;
end;
$$;

create constraint trigger group_classes_members
  after delete on group_classes
  deferrable initially deferred
  for each row execute function group_classes_members();

-- The group's side (decision 16), under the lock of the update: an archive
-- is refused while rows end after the day of the archive in the branch's time
-- zone (members in force or planned); a lower maximum when a date from today
-- on holds more members (every date without a moment). Runs as the invoker.
create function groups_members_guard() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  today date := branch_today(new.branch_id);
begin
  if old.archived_at is null and new.archived_at is not null and exists (
    select 1 from group_memberships m
    where m.group_id = new.id
      and m.valid_from < m.valid_until
      and m.valid_until > (new.archived_at at time zone (
        select b.time_zone from branches b where b.id = new.branch_id
      ))::date
  ) then
    raise exception 'group_has_members'
      using errcode = 'check_violation', constraint = 'group_has_members';
  end if;
  if new.max_size < old.max_size
    and group_members_peak(new.id, coalesce(today, '-infinity'::date), null) > new.max_size then
    raise exception 'group_size_below_members'
      using errcode = 'check_violation', constraint = 'group_size_below_members';
  end if;
  return new;
end;
$$;

create trigger groups_members_guard
  before update of archived_at, max_size on groups
  for each row execute function groups_members_guard();
