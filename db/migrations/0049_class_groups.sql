-- 0049 Groups on every class membership path (task 3.2c, pull request #93).
--
-- docs/spec/edge-cases/students-classes-groups.md, first row: "A class
-- membership cannot be saved without a group for every split or group
-- subject of that class, from the same date. Bulk placement puts students
-- into the smallest suitable group and tags them \"placed automatically,
-- review\"."
-- docs/spec/05-classes-groups-subjects.md, Group: "Every student of the
-- classes involved must be in exactly one group for that subject; the screen
-- lists students not yet placed."
--
-- The plan approved on pull request #93: decisions 1, 4, 5 and 8.
-- Every refusal raised here names a constraint, which the API maps to an
-- error code (apps/api/src/modules/classes/class-groups.ts).

-- Decision 5: until the teaching load (task 3.4), the split or group subjects
-- of a class are the subjects of the active groups that draw from it (a group
-- and its classes are of one year, 0046). Runs as the invoker.
create function class_group_subjects(class_ref uuid) returns setof uuid
language sql
stable
set search_path = pg_catalog, public
as $$
  select distinct g.subject_id
  from group_classes gc
  join groups g on g.id = gc.group_id
  where gc.class_id = class_ref and g.archived_at is null
$$;

-- The days of a class row from `from_day` on that hold no group row of the
-- student of a subject, as one multirange (empty when every day is held).
-- One group of a subject per date is the exclusion of 0048, so a day without
-- a row is the only way to miss "exactly one group". Runs as the invoker.
create function class_row_gaps(membership_ref uuid, subject_ref uuid, from_day date)
returns datemultirange
language sql
stable
set search_path = pg_catalog, public
as $$
  select datemultirange(daterange(greatest(m.valid_from, from_day), m.valid_until))
    - coalesce((
      select range_agg(daterange(gm.valid_from, gm.valid_until))
      from group_memberships gm
      where gm.student_id = m.student_id
        and gm.subject_id = subject_ref
        and gm.valid_from < gm.valid_until
    ), '{}'::datemultirange)
  from class_memberships m
  where m.id = membership_ref
    and m.valid_from < m.valid_until
    and m.valid_until > from_day
$$;

-- Decision 8, the check task 3.4 calls before a load row of a group or split
-- is valid: the students of the classes whose class rows hold a day from
-- `from_day` on with no group row of the subject, each with the class row and
-- its first such day. Runs as the invoker, so the branch filter applies: a
-- class the request cannot see gives nothing (the reader in TypeScript
-- refuses such an id first).
create function group_placement_gaps(class_refs uuid[], subject_ref uuid, from_day date)
returns table (student_id uuid, class_id uuid, membership_id uuid, first_day date)
language sql
stable
set search_path = pg_catalog, public
as $$
  select m.student_id, m.class_id, m.id, lower(gaps.left_over)
  from class_memberships m
  cross join lateral (
    select class_row_gaps(m.id, subject_ref, from_day) as left_over
  ) gaps
  where m.class_id = any (class_refs)
    and m.valid_from < m.valid_until
    and m.valid_until > from_day
    and not isempty(gaps.left_over)
  order by m.student_id, m.valid_from
$$;

grant execute on function class_group_subjects(uuid) to sodiq_app;
grant execute on function class_row_gaps(uuid, uuid, date) to sodiq_app;
grant execute on function group_placement_gaps(uuid[], uuid, date) to sodiq_app;

-- Decision 1: the rule from the class side. At the commit, a class row
-- inserted that still holds days needs group rows of the student over every
-- day it holds, for each split or group subject of its class at the commit.
-- Only the insert of a class row is checked ("cannot be saved"): a group
-- created in a later transaction, a class added to a group, an archive or the
-- withdraw of a planned group row leaves gaps that group_placement_gaps and
-- the placement screen list. Reads only, as group_memberships_in_class.
create function class_memberships_need_groups() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if exists (
    select 1
    from class_group_subjects(new.class_id) subject
    where not isempty(coalesce(class_row_gaps(new.id, subject, '-infinity'::date), '{}'::datemultirange))
  ) then
    raise exception 'class_memberships_need_groups'
      using errcode = 'check_violation', constraint = 'class_memberships_need_groups';
  end if;
  return null;
end;
$$;

create constraint trigger class_memberships_need_groups
  after insert on class_memberships
  deferrable initially deferred
  for each row execute function class_memberships_need_groups();

-- Decision 4: a cancel or an undo of a leaving gives back the group rows the
-- leaving cut (causes as the class rows of 0045), and a row given back keeps
-- the "placed automatically, review" tag of the row it gives back. The 0048
-- comment on `cause`: "task 3.2c and 3.3 add their causes".
alter table group_memberships drop constraint group_memberships_cause_check;
alter table group_memberships add constraint group_memberships_cause_check check (
  cause in ('placement', 'automatic', 'cancel', 'undo')
);

-- The guard of 0048 with one line changed: the review tag is allowed on an
-- automatic placement and on a row given back by a cancel or an undo.
create or replace function group_memberships_guard() returns trigger
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
  if new.review and new.cause not in ('automatic', 'cancel', 'undo') then
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
