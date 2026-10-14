-- 0050 Class and group transfers (task 3.3a, pull request #95).
--
-- docs/spec/04-people.md, Movements: "Class transfer and group transfer. One
-- action with an effective date. ... The profile History tab shows each move
-- with dates. Head Teachers move students between groups of their subjects;
-- class transfers are done by the Academic Vice Principal."
-- docs/spec/edge-cases/students-classes-groups.md: "The effective date is the
-- first day in the new class, tomorrow by default." "Backdating is for the
-- Academic Vice Principal, in an open quarter." "A transfer or a leaving is
-- set for a future date. It is \"scheduled\": the student shows the current
-- class with a badge, and the seat in the target class is reserved. It can be
-- changed or cancelled until the date." "A transfer was a mistake. It can be
-- undone only while the new journals hold no entries. Otherwise a transfer
-- back is made." "... scheduled moves are cancelled."
--
-- The plan approved on pull request #95 with corrections 1 to 4: decisions 7,
-- 8, 10 and 12. Decision 12 (Look first): the checks and triggers of 0045,
-- 0048 and 0049 replaced below change because the requirement changed with
-- the causes `transfer` and `undone` of this task, each named where it is
-- replaced; nothing named in edge/developer-rules (the overlap exclusions, the
-- peak functions, group_memberships_in_class, class_memberships_need_groups)
-- changes.
--
-- Every refusal raised here names a constraint, which the API maps to an
-- error code (apps/api/src/modules/classes/student-moves.ts).

-- One move of a student (decision 7): to another class, or to another group
-- of one subject, from `effective_on`, the first day in the new class or
-- group. Scheduled while `effective_on` is after today in the branch's time
-- zone; cancelled before its date, undone on or after it, each a moment of
-- the injected clock written once; never deleted by the application. The rows
-- it cut and wrote name it (`ended_by_move_id`, `written_by_move_id` below).
-- A move belongs to the branch of its classes or groups; it goes with a
-- student deleted as created twice (the cascade kept in the audit entry).
create table student_moves (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  student_id uuid not null references students (id) on delete cascade,
  kind text not null constraint student_moves_kind_check check (kind in ('class', 'group')),
  subject_id uuid references subjects (id),
  from_class_id uuid,
  to_class_id uuid,
  from_group_id uuid,
  to_group_id uuid,
  effective_on date not null,
  -- The moment the move was made, from the injected clock.
  made_at timestamptz not null,
  cancelled_at timestamptz,
  undone_at timestamptz,
  -- Decision 8: the leaving that cancelled a scheduled move.
  cancelled_by_leaving_id uuid references student_statuses (id),
  -- The reason of an undo (decision 10), required then.
  reason text constraint student_moves_reason_check check (
    reason = btrim(reason) and length(reason) between 1 and 500
  ),
  -- Bookkeeping only; no rule reads it.
  created_at timestamptz not null default now(),
  constraint student_moves_from_class_fkey foreign key (from_class_id, branch_id)
    references classes (id, branch_id),
  constraint student_moves_to_class_fkey foreign key (to_class_id, branch_id)
    references classes (id, branch_id),
  constraint student_moves_from_group_fkey foreign key (from_group_id, branch_id)
    references groups (id, branch_id),
  constraint student_moves_to_group_fkey foreign key (to_group_id, branch_id)
    references groups (id, branch_id),
  constraint student_moves_shape_check check (
    (kind = 'class'
      and from_class_id is not null and to_class_id is not null and from_class_id <> to_class_id
      and from_group_id is null and to_group_id is null and subject_id is null)
    or (kind = 'group'
      and from_group_id is not null and to_group_id is not null and from_group_id <> to_group_id
      and from_class_id is null and to_class_id is null and subject_id is not null)
  ),
  constraint student_moves_state_check check (cancelled_at is null or undone_at is null),
  constraint student_moves_leaving_check check (
    cancelled_by_leaving_id is null or cancelled_at is not null
  ),
  constraint student_moves_undo_reason_check check (undone_at is null or reason is not null)
);

create index student_moves_student_idx on student_moves (student_id, effective_on);
create index student_moves_branch_idx on student_moves (branch_id);
create index student_moves_leaving_idx on student_moves (cancelled_by_leaving_id);

alter table student_moves enable row level security;
create policy branch_filter on student_moves for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select on student_moves to sodiq_app;
grant insert (
  branch_id, student_id, kind, subject_id, from_class_id, to_class_id, from_group_id, to_group_id,
  effective_on, made_at
) on student_moves to sodiq_app;
grant update (cancelled_at, undone_at, cancelled_by_leaving_id, reason) on student_moves to sodiq_app;

-- A new move: of a student of its branch, not yet cancelled nor undone. For
-- every user. Runs as the invoker.
create function student_moves_insert_guard() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  perform 1 from students s where s.id = new.student_id for share;
  if not exists (
    select 1 from students s where s.id = new.student_id and s.branch_id = new.branch_id
  ) then
    raise exception 'student_moves_student_branch'
      using errcode = 'check_violation', constraint = 'student_moves_student_branch';
  end if;
  if new.cancelled_at is not null or new.undone_at is not null
    or new.cancelled_by_leaving_id is not null or new.reason is not null then
    raise exception 'student_moves_state'
      using errcode = 'check_violation', constraint = 'student_moves_state';
  end if;
  return new;
end;
$$;

create trigger student_moves_insert_guard
  before insert on student_moves
  for each row execute function student_moves_insert_guard();

-- Decision 7 and the review's should-fix 7: the cancel, the undo, the leaving
-- that cancelled and the reason are each written once; only they change. A
-- cancel only before the move's date, an undo only on or after it, in the
-- branch's time zone at `app.now`; without a moment, neither. For every user.
-- Runs as the invoker.
create function student_moves_state() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  today date := branch_today(new.branch_id);
begin
  if (to_jsonb(new) - 'cancelled_at' - 'undone_at' - 'cancelled_by_leaving_id' - 'reason')
      is distinct from (to_jsonb(old) - 'cancelled_at' - 'undone_at' - 'cancelled_by_leaving_id' - 'reason')
    or (old.cancelled_at is not null and new.cancelled_at is distinct from old.cancelled_at)
    or (old.undone_at is not null and new.undone_at is distinct from old.undone_at)
    or (old.cancelled_by_leaving_id is not null
      and new.cancelled_by_leaving_id is distinct from old.cancelled_by_leaving_id)
    or (old.reason is not null and new.reason is distinct from old.reason) then
    raise exception 'student_moves_state'
      using errcode = 'check_violation', constraint = 'student_moves_state';
  end if;
  if old.cancelled_at is null and new.cancelled_at is not null
    and (today is null or new.effective_on <= today) then
    raise exception 'student_moves_not_scheduled'
      using errcode = 'check_violation', constraint = 'student_moves_not_scheduled';
  end if;
  if old.undone_at is null and new.undone_at is not null
    and (today is null or new.effective_on > today) then
    raise exception 'student_moves_not_begun'
      using errcode = 'check_violation', constraint = 'student_moves_not_begun';
  end if;
  return new;
end;
$$;

create trigger student_moves_state
  before update on student_moves
  for each row execute function student_moves_state();

-- Whether `move` is a move of `student`.
create function student_move_of(student uuid, move uuid) returns boolean
language sql
stable
set search_path = pg_catalog, public
as $$
  select exists (select 1 from student_moves m where m.id = move and m.student_id = student)
$$;

-- Correction 1: a row inserted already cut by a scheduled move names a move
-- of the same student, not cancelled nor undone, whose date is the row's end.
create function student_move_cuts_at(student uuid, move uuid, day date) returns boolean
language sql
stable
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from student_moves m
    where m.id = move
      and m.student_id = student
      and m.cancelled_at is null
      and m.undone_at is null
      and m.effective_on = day
  )
$$;

-- The rows of both membership tables name the moves (decision 7, must-fix 2
-- of the plan review): `written_by_move_id`, the move whose action inserted
-- the row (the target row `transfer`, its automatic group rows, and the rows
-- a cancel or an undo of the move gave back); `ended_by_move_id`, the move
-- that cut the row (`transfer`) or emptied it (`undone`). Two columns, so a
-- chain of two moves keeps both links.
alter table class_memberships
  add column written_by_move_id uuid references student_moves (id),
  add column ended_by_move_id uuid references student_moves (id);
alter table group_memberships
  add column written_by_move_id uuid references student_moves (id),
  add column ended_by_move_id uuid references student_moves (id);

create index class_memberships_written_move_idx on class_memberships (written_by_move_id);
create index class_memberships_ended_move_idx on class_memberships (ended_by_move_id);
create index group_memberships_written_move_idx on group_memberships (written_by_move_id);
create index group_memberships_ended_move_idx on group_memberships (ended_by_move_id);

-- Decision 12: the causes of 0045 ("task 3.3 adds its causes") and of 0049
-- gain `transfer`, the row a move wrote into its target.
alter table class_memberships drop constraint class_memberships_cause_check;
alter table class_memberships add constraint class_memberships_cause_check check (
  cause in ('placement', 'create', 'cancel', 'undo', 'transfer')
);
alter table group_memberships drop constraint group_memberships_cause_check;
alter table group_memberships add constraint group_memberships_cause_check check (
  cause in ('placement', 'automatic', 'cancel', 'undo', 'transfer')
);

-- Decision 12: the ends gain `transfer` (a row a move cut, which may keep
-- days) and `undone` (the row of an undone move, emptied).
alter table class_memberships drop constraint class_memberships_ended_by_check;
alter table class_memberships add constraint class_memberships_ended_by_check check (
  ended_by in ('leaving', 'withdrawn', 'transfer', 'undone')
);
alter table group_memberships drop constraint group_memberships_ended_by_check;
alter table group_memberships add constraint group_memberships_ended_by_check check (
  ended_by in ('leaving', 'withdrawn', 'class_withdrawn', 'transfer', 'undone')
);

-- 0045's `class_memberships_withdrawn_check` stays as it is; an undone row is
-- empty as a withdrawn one is.
alter table class_memberships add constraint class_memberships_undone_check check (
  ended_by is distinct from 'undone' or valid_until = valid_from
);
-- Decision 12, must-fix 3 of the plan review: 0048's check allowed days only
-- to a row a leaving cut; a row a move cut keeps its days before the move's
-- date as well. Withdrawn, class-withdrawn and undone rows stay empty.
alter table group_memberships drop constraint group_memberships_withdrawn_check;
alter table group_memberships add constraint group_memberships_withdrawn_check check (
  ended_by is null or ended_by in ('leaving', 'transfer') or valid_until = valid_from
);

-- The move that ended a row is named exactly when a move ended it, and a row
-- a move wrote into its target names the move.
alter table class_memberships add constraint class_memberships_move_check check (
  coalesce(ended_by in ('transfer', 'undone'), false) = (ended_by_move_id is not null)
);
alter table class_memberships add constraint class_memberships_written_check check (
  cause <> 'transfer' or written_by_move_id is not null
);
alter table group_memberships add constraint group_memberships_move_check check (
  coalesce(ended_by in ('transfer', 'undone'), false) = (ended_by_move_id is not null)
);
alter table group_memberships add constraint group_memberships_written_check check (
  cause <> 'transfer' or written_by_move_id is not null
);

grant insert (written_by_move_id, ended_by_move_id) on class_memberships to sodiq_app;
grant update (ended_by_move_id) on class_memberships to sodiq_app;
grant insert (written_by_move_id, ended_by_move_id) on group_memberships to sodiq_app;
grant update (ended_by_move_id) on group_memberships to sodiq_app;

-- The guard of 0045 with its insert rule changed (decision 12, correction 1):
-- a row is inserted cut by a leaving as before, or by a scheduled move of the
-- student whose date is its end; never withdrawn nor undone; the moves it
-- names are the student's. Every other rule and lock as in 0045.
create or replace function class_memberships_guard() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  pupil record;
  held record;
  year record;
begin
  perform 1 from students s where s.id = new.student_id for share;
  perform 1 from classes c where c.id = new.class_id and c.branch_id = new.branch_id for update;
  select s.grade, s.branch_id into pupil from students s where s.id = new.student_id;
  if not found or pupil.branch_id is distinct from new.branch_id then
    raise exception 'class_memberships_student_branch'
      using errcode = 'check_violation', constraint = 'class_memberships_student_branch';
  end if;
  select c.archived_at, c.academic_year_id, c.grade, c.max_size into held
    from classes c where c.id = new.class_id and c.branch_id = new.branch_id;
  if not found then
    -- The foreign key answers it.
    return new;
  end if;
  if held.archived_at is not null then
    raise exception 'class_memberships_class_archived'
      using errcode = 'check_violation', constraint = 'class_memberships_class_archived';
  end if;
  perform class_year_open(held.academic_year_id);
  select y.start_date, y.end_date into year
    from academic_years y where y.id = held.academic_year_id;
  if new.valid_from < year.start_date or new.own_until > year.end_date + 1 then
    raise exception 'class_memberships_outside_year'
      using errcode = 'check_violation', constraint = 'class_memberships_outside_year';
  end if;
  if pupil.grade <> held.grade then
    raise exception 'class_memberships_grade'
      using errcode = 'check_violation', constraint = 'class_memberships_grade';
  end if;
  if new.ended_by in ('withdrawn', 'undone')
    or (new.valid_until = new.valid_from
      and (new.ended_by is null or new.ended_by not in ('leaving', 'transfer'))) then
    raise exception 'class_memberships_insert_ended'
      using errcode = 'check_violation', constraint = 'class_memberships_insert_ended';
  end if;
  if new.leaving_id is not null
    and not class_membership_leaving_valid(new.student_id, new.leaving_id) then
    raise exception 'class_memberships_leaving'
      using errcode = 'check_violation', constraint = 'class_memberships_leaving';
  end if;
  if (new.ended_by = 'transfer'
      and not student_move_cuts_at(new.student_id, new.ended_by_move_id, new.valid_until))
    or (new.written_by_move_id is not null
      and not student_move_of(new.student_id, new.written_by_move_id)) then
    raise exception 'class_memberships_move'
      using errcode = 'check_violation', constraint = 'class_memberships_move';
  end if;
  if new.valid_from < new.valid_until
    and class_members_peak(new.class_id, new.valid_from, new.valid_until) + 1 > held.max_size then
    raise exception 'class_memberships_full'
      using errcode = 'check_violation', constraint = 'class_memberships_full';
  end if;
  return new;
end;
$$;

-- The shrink rule of 0045 with one path added (decision 12, must-fix 4 of
-- the plan review); none is taken away. A move cuts a row (`transfer`) as a
-- leaving does, also back to or before today for a move dated in the past,
-- and a leaving cuts a row a move cut; the undo of a move empties the row the
-- move wrote (`undone`), also once it has begun; a withdrawn or undone row is
-- final; a row a leaving or a move ended is never given its end back. The
-- moves named are the student's. Every other rule as in 0045.
create or replace function class_memberships_only_shrink() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  year_id uuid;
begin
  if (to_jsonb(new) - 'valid_until' - 'ended_by' - 'leaving_id' - 'ended_by_move_id')
      is distinct from (to_jsonb(old) - 'valid_until' - 'ended_by' - 'leaving_id' - 'ended_by_move_id')
    or new.valid_until > old.valid_until
    or old.ended_by in ('withdrawn', 'undone')
    or (old.ended_by in ('leaving', 'transfer') and new.ended_by is null) then
    raise exception 'class_memberships_only_shrink'
      using errcode = 'check_violation', constraint = 'class_memberships_only_shrink';
  end if;
  -- Decision 10 of 3.1b: a placement is withdrawn only before its first day
  -- in the branch's time zone; without a moment, never.
  if new.ended_by = 'withdrawn' and old.ended_by is distinct from 'withdrawn'
    and old.valid_from <= coalesce(branch_today(new.branch_id), 'infinity'::date) then
    raise exception 'class_memberships_withdraw_planned'
      using errcode = 'check_violation', constraint = 'class_memberships_withdraw_planned';
  end if;
  if new.leaving_id is not null
    and new.leaving_id is distinct from old.leaving_id
    and not class_membership_leaving_valid(new.student_id, new.leaving_id) then
    raise exception 'class_memberships_leaving'
      using errcode = 'check_violation', constraint = 'class_memberships_leaving';
  end if;
  if (new.ended_by_move_id is not null
      and new.ended_by_move_id is distinct from old.ended_by_move_id
      and not student_move_of(new.student_id, new.ended_by_move_id))
    or (new.ended_by = 'undone'
      and new.ended_by_move_id is distinct from old.written_by_move_id) then
    raise exception 'class_memberships_move'
      using errcode = 'check_violation', constraint = 'class_memberships_move';
  end if;
  if new.valid_until <> old.valid_until then
    perform 1 from classes c where c.id = new.class_id for share;
    select c.academic_year_id into year_id from classes c where c.id = new.class_id;
    perform class_year_open(year_id);
  end if;
  return new;
end;
$$;

-- The guard of 0049 with its insert rule changed (decision 12, correction 1):
-- a group row written inside a class row a scheduled move cut (a placement,
-- "Place automatically", a group transfer, the cover of a class path) is
-- inserted already cut by that move, naming it, as a row is inserted cut by
-- a scheduled leaving; never withdrawn nor undone; the moves it names are the
-- student's; the review tag also on an automatic row a move wrote. Every
-- other rule and lock as in 0049.
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
  if (new.ended_by is not null and new.ended_by not in ('leaving', 'transfer'))
    or (new.valid_until = new.valid_from
      and (new.ended_by is null or new.ended_by not in ('leaving', 'transfer'))) then
    raise exception 'group_memberships_insert_ended'
      using errcode = 'check_violation', constraint = 'group_memberships_insert_ended';
  end if;
  if new.leaving_id is not null
    and not class_membership_leaving_valid(new.student_id, new.leaving_id) then
    raise exception 'group_memberships_leaving'
      using errcode = 'check_violation', constraint = 'group_memberships_leaving';
  end if;
  if (new.ended_by = 'transfer'
      and not student_move_cuts_at(new.student_id, new.ended_by_move_id, new.valid_until))
    or (new.written_by_move_id is not null
      and not student_move_of(new.student_id, new.written_by_move_id)) then
    raise exception 'group_memberships_move'
      using errcode = 'check_violation', constraint = 'group_memberships_move';
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

-- The shrink rule of 0048 with the paths of the class rows above added
-- (decision 12); none taken away.
create or replace function group_memberships_only_shrink() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  year_id uuid;
begin
  if (to_jsonb(new) - 'valid_until' - 'ended_by' - 'leaving_id' - 'review' - 'ended_by_move_id')
      is distinct from (to_jsonb(old) - 'valid_until' - 'ended_by' - 'leaving_id' - 'review' - 'ended_by_move_id')
    or new.valid_until > old.valid_until
    or old.ended_by in ('withdrawn', 'class_withdrawn', 'undone')
    or (old.ended_by in ('leaving', 'transfer') and new.ended_by is null)
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
  if (new.ended_by_move_id is not null
      and new.ended_by_move_id is distinct from old.ended_by_move_id
      and not student_move_of(new.student_id, new.ended_by_move_id))
    or (new.ended_by = 'undone'
      and new.ended_by_move_id is distinct from old.written_by_move_id) then
    raise exception 'group_memberships_move'
      using errcode = 'check_violation', constraint = 'group_memberships_move';
  end if;
  if new.valid_until <> old.valid_until then
    perform 1 from groups g where g.id = new.group_id for share;
    select g.academic_year_id into year_id from groups g where g.id = new.group_id;
    perform class_year_open(year_id);
  end if;
  return new;
end;
$$;
