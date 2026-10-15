-- 0060 Exams on the time claims, and the re-check of the claims of future
-- lessons when something changes under them (task 5.1b, pull request #108).
--
-- docs/spec/06-timetable.md, Changes after publishing, Exam: "A timetabled
-- exam on one date: a title, a subject if it has one, one or more consecutive
-- lesson slots of the day template (the breaks between them included), the
-- classes that sit it, and one or more rooms, each with the classes it holds
-- and one or more invigilators. A class sits in one room; an invigilator is
-- any active staff member, never a vacancy. … over that time it is checked as
-- a lesson is for its invigilators, rooms and classes". docs/spec/edge-cases/
-- developer-rules.md, Exams: "An exam, its rooms, the classes in each room and
-- the invigilators of each room are stored in their own tables, never as
-- lesson rows … The three constraints above run over one table of time
-- claims". docs/spec/edge-cases/timetable.md, Exams: "A group sits an exam
-- only in the slots of its own lesson"; "10 Brown sits the exam, but its
-- lesson in slot 3 is a block shared with classes that do not sit".
--
-- The plan approved on pull request #108 with corrections 1 and 2: decisions
-- 1 to 14. Every function of 0058 that changes is replaced here by `create or
-- replace` (correction 2); 0058 and 0059 are not edited. No route writes these
-- tables yet (decision 14); every refusal names a constraint for 5.6c.
--
-- "Future" (decision 8): a block or exam that starts after the moment of the
-- transaction (app.now) for group classes and memberships; a claim that has
-- not ended for a room's switch, count and capacity; without a moment, every
-- one.

-- ---------------------------------------------------------------------------
-- Decision 7: "never a vacancy" is a key; `staff.kind` has no update grant.

alter table staff add constraint staff_id_kind_key unique (id, kind);

-- ---------------------------------------------------------------------------
-- Exams.

create table exams (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  academic_year_id uuid not null,
  -- The school date in the branch's time zone.
  exam_date date not null,
  -- From the start of its first slot to the end of its last, computed by the
  -- API from the day template, never typed (edge/timetable, Exams).
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  -- Kept so that a special template can move the exam with its slots (5.6b).
  first_slot smallint not null constraint exams_first_slot_check check (first_slot between 1 and 20),
  last_slot smallint not null constraint exams_last_slot_check check (last_slot between 1 and 20),
  title text not null constraint exams_title_check check (length(btrim(title)) between 1 and 200),
  -- "a subject if it has one".
  subject_id uuid references subjects (id),
  -- Decision 9: null while the exam stands; final once set.
  cancel_cause text constraint exams_cancel_cause_check check (
    cancel_cause in ('cancelled', 'day_off')
  ),
  -- Bookkeeping only; no rule reads it.
  created_at timestamptz not null default now(),
  constraint exams_order_check check (ends_at > starts_at),
  constraint exams_slots_check check (first_slot <= last_slot),
  constraint exams_year_fkey foreign key (academic_year_id, branch_id)
    references academic_years (id, branch_id),
  constraint exams_id_branch_key unique (id, branch_id)
);

create index exams_date_idx on exams (branch_id, exam_date);

alter table exams enable row level security;
create policy branch_filter on exams for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

-- "a past exam is kept as history": no delete.
grant select on exams to sodiq_app;
grant insert (
  branch_id, academic_year_id, exam_date, starts_at, ends_at, first_slot, last_slot, title,
  subject_id
) on exams to sodiq_app;
grant update (
  title, subject_id, exam_date, starts_at, ends_at, first_slot, last_slot, cancel_cause
) on exams to sodiq_app;

create table exam_rooms (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  exam_id uuid not null,
  room_id uuid not null,
  -- Bookkeeping only; no rule reads it.
  created_at timestamptz not null default now(),
  constraint exam_rooms_exam_fkey foreign key (exam_id, branch_id)
    references exams (id, branch_id),
  constraint exam_rooms_room_fkey foreign key (room_id, branch_id)
    references rooms (id, branch_id),
  constraint exam_rooms_room_key unique (exam_id, room_id, branch_id),
  constraint exam_rooms_id_exam_key unique (id, exam_id, branch_id)
);

create index exam_rooms_room_idx on exam_rooms (room_id);

alter table exam_rooms enable row level security;
create policy branch_filter on exam_rooms for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select, delete on exam_rooms to sodiq_app;
grant insert (branch_id, exam_id, room_id) on exam_rooms to sodiq_app;
grant update (room_id) on exam_rooms to sodiq_app;

-- The classes a room holds; a group that sits in its own lesson's slots
-- (decision 5).
create table exam_room_classes (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  exam_id uuid not null,
  exam_room_id uuid not null,
  class_id uuid,
  group_id uuid,
  -- Bookkeeping only; no rule reads it.
  created_at timestamptz not null default now(),
  constraint exam_room_classes_unit_check check ((class_id is null) <> (group_id is null)),
  constraint exam_room_classes_room_fkey foreign key (exam_room_id, exam_id, branch_id)
    references exam_rooms (id, exam_id, branch_id) on delete cascade,
  constraint exam_room_classes_class_fkey foreign key (class_id, branch_id)
    references classes (id, branch_id),
  constraint exam_room_classes_group_fkey foreign key (group_id, branch_id)
    references groups (id, branch_id)
);

-- "A class sits in one room."
create unique index exam_class_one_room on exam_room_classes (exam_id, class_id, branch_id)
  where class_id is not null;
create unique index exam_group_one_room on exam_room_classes (exam_id, group_id, branch_id)
  where group_id is not null;
create index exam_room_classes_room_idx on exam_room_classes (exam_room_id);
create index exam_room_classes_group_idx on exam_room_classes (group_id) where group_id is not null;
create index exam_room_classes_class_idx on exam_room_classes (class_id) where class_id is not null;

alter table exam_room_classes enable row level security;
create policy branch_filter on exam_room_classes for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select, delete on exam_room_classes to sodiq_app;
grant insert (branch_id, exam_id, exam_room_id, class_id, group_id) on exam_room_classes
  to sodiq_app;

create table exam_invigilators (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  exam_id uuid not null,
  exam_room_id uuid not null,
  staff_id uuid not null,
  -- Decision 7: the key below reaches a person only, never a vacancy.
  staff_kind text not null default 'person' constraint exam_invigilators_kind_check check (
    staff_kind = 'person'
  ),
  -- Bookkeeping only; no rule reads it.
  created_at timestamptz not null default now(),
  constraint exam_invigilators_room_fkey foreign key (exam_room_id, exam_id, branch_id)
    references exam_rooms (id, exam_id, branch_id) on delete cascade,
  constraint exam_invigilators_person_fkey foreign key (staff_id, staff_kind)
    references staff (id, kind),
  constraint exam_invigilators_staff_key unique (exam_id, staff_id, branch_id)
);

create index exam_invigilators_room_idx on exam_invigilators (exam_room_id);
create index exam_invigilators_staff_idx on exam_invigilators (staff_id);

alter table exam_invigilators enable row level security;
create policy branch_filter on exam_invigilators for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select, delete on exam_invigilators to sodiq_app;
grant insert (branch_id, exam_id, exam_room_id, staff_id) on exam_invigilators to sodiq_app;

-- Decision 6: a class that sits a whole-class exam while its block is kept for
-- the other classes is out of that block on that date. The block's class
-- claims leave it out while the exam stands and overlaps the block
-- (correction 1); kept as history after a cancel.
create table lesson_block_class_outs (
  branch_id uuid not null references branches (id),
  block_id uuid not null,
  class_id uuid not null,
  exam_id uuid not null,
  -- Bookkeeping only; no rule reads it.
  created_at timestamptz not null default now(),
  constraint lesson_block_class_outs_pkey primary key (block_id, class_id, branch_id),
  constraint lesson_block_class_outs_block_fkey foreign key (block_id, branch_id)
    references lesson_blocks (id, branch_id),
  constraint lesson_block_class_outs_class_fkey foreign key (class_id, branch_id)
    references classes (id, branch_id),
  constraint lesson_block_class_outs_exam_fkey foreign key (exam_id, branch_id)
    references exams (id, branch_id)
);

create index lesson_block_class_outs_exam_idx on lesson_block_class_outs (exam_id);

alter table lesson_block_class_outs enable row level security;
create policy branch_filter on lesson_block_class_outs for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select, delete on lesson_block_class_outs to sodiq_app;
grant insert (branch_id, block_id, class_id, exam_id) on lesson_block_class_outs to sodiq_app;

-- ---------------------------------------------------------------------------
-- The claims of exams (decision 1).

alter table time_claims
  add constraint time_claims_exam_fkey foreign key (exam_id, branch_id)
    references exams (id, branch_id) on delete cascade;

-- The list of kinds widened by one; nothing allowed for the five existing
-- kinds changes. Added not valid, then validated (spec review 18).
alter table time_claims drop constraint time_claims_kind_check;
alter table time_claims
  add constraint time_claims_kind_check check (
    kind in ('lesson', 'block_class', 'exam_room', 'exam_invigilator', 'exam_class', 'exam_group_class')
  ) not valid,
  -- A group that sits keeps its classes with the holder of its own block.
  add constraint time_claims_exam_group_check check (
    kind <> 'exam_group_class' or (
      exam_id is not null and block_id is not null and lesson_id is null and class_id is not null
      and teacher_id is null and room_id is null and holder = block_id
    )
  ) not valid;
alter table time_claims validate constraint time_claims_kind_check;
alter table time_claims validate constraint time_claims_exam_group_check;

create index time_claims_exam_idx on time_claims (exam_id) where exam_id is not null;
create unique index time_claims_exam_group_key on time_claims (exam_id, block_id, class_id, branch_id)
  where kind = 'exam_group_class';
-- One claim per room, invigilator and class of an exam, so its claims are
-- written by difference.
create unique index time_claims_exam_room_key on time_claims (exam_id, room_id, branch_id)
  where kind = 'exam_room';
create unique index time_claims_exam_invigilator_key on time_claims (exam_id, teacher_id, branch_id)
  where kind = 'exam_invigilator';
create unique index time_claims_exam_class_key on time_claims (exam_id, class_id, branch_id)
  where kind = 'exam_class';

-- The time of an exam: its start and end on its date in the branch's time
-- zone, the date in its year, and a cancel that is final (decision 9). Runs as
-- the invoker.
create function exams_check() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  zone text;
  year_start date;
  year_end date;
begin
  select b.time_zone into zone from branches b where b.id = new.branch_id;
  if zone is not null and (
    (new.starts_at at time zone zone)::date <> new.exam_date
    or (new.ends_at at time zone zone)::date <> new.exam_date
  ) then
    raise exception 'exam_date' using errcode = 'check_violation', constraint = 'exam_date';
  end if;
  select y.start_date, y.end_date into year_start, year_end
    from academic_years y where y.id = new.academic_year_id and y.branch_id = new.branch_id;
  if found and new.exam_date not between year_start and year_end then
    raise exception 'exam_year' using errcode = 'check_violation', constraint = 'exam_year';
  end if;
  if tg_op = 'UPDATE' and old.cancel_cause is not null
    and new.cancel_cause is distinct from old.cancel_cause then
    raise exception 'exam_cancel_final'
      using errcode = 'check_violation', constraint = 'exam_cancel_final';
  end if;
  return new;
end;
$$;

create trigger exams_check
  before insert or update on exams
  for each row execute function exams_check();

-- The class or group of a room is of the exam's year; a group's subject is
-- the exam's (decision 5). Runs as the invoker.
create function exam_room_classes_check() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  exam exams%rowtype;
  unit_year uuid;
  group_subject uuid;
begin
  select * into exam from exams e where e.id = new.exam_id and e.branch_id = new.branch_id;
  if not found then
    -- The foreign key answers it.
    return new;
  end if;
  if new.class_id is not null then
    select c.academic_year_id into unit_year from classes c
      where c.id = new.class_id and c.branch_id = new.branch_id;
  else
    select g.academic_year_id, g.subject_id into unit_year, group_subject from groups g
      where g.id = new.group_id and g.branch_id = new.branch_id;
  end if;
  if unit_year is not null and unit_year <> exam.academic_year_id then
    raise exception 'exam_unit_year' using errcode = 'check_violation', constraint = 'exam_unit_year';
  end if;
  if new.group_id is not null and group_subject is distinct from exam.subject_id then
    raise exception 'exam_group_subject'
      using errcode = 'check_violation', constraint = 'exam_group_subject';
  end if;
  return new;
end;
$$;

create trigger exam_room_classes_check
  before insert on exam_room_classes
  for each row execute function exam_room_classes_check();

-- A subject changed after a group sits (spec review 6). Runs as the invoker.
create function exams_group_subject() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if exists (
    select 1
    from exams e
    join exam_room_classes rc on rc.exam_id = e.id
    join groups g on g.id = rc.group_id
    where e.id = new.id and g.subject_id is distinct from e.subject_id
  ) then
    raise exception 'exam_group_subject'
      using errcode = 'check_violation', constraint = 'exam_group_subject';
  end if;
  return null;
end;
$$;

create constraint trigger exams_group_subject
  after update of subject_id on exams
  deferrable initially deferred
  for each row execute function exams_group_subject();

-- An exam that stands has a room, and each room a class or group and an
-- invigilator (decision 11): the exam row locked first, then counted in a
-- statement of its own. Runs as the invoker.
create function exams_complete() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  exam_ref uuid;
  cause text;
begin
  if tg_table_name = 'exams' then
    exam_ref := new.id;
  elsif tg_op = 'DELETE' then
    exam_ref := old.exam_id;
  else
    exam_ref := new.exam_id;
  end if;
  perform 1 from exams e where e.id = exam_ref for update;
  if not found then
    return null;
  end if;
  select e.cancel_cause into cause from exams e where e.id = exam_ref;
  if cause is not null then
    return null;
  end if;
  if not exists (select 1 from exam_rooms r where r.exam_id = exam_ref)
    or exists (
      select 1 from exam_rooms r
        where r.exam_id = exam_ref
          and (
            not exists (select 1 from exam_room_classes rc where rc.exam_room_id = r.id)
            or not exists (select 1 from exam_invigilators i where i.exam_room_id = r.id)
          )
    ) then
    raise exception 'exam_incomplete' using errcode = 'check_violation', constraint = 'exam_incomplete';
  end if;
  return null;
end;
$$;

create constraint trigger exams_complete
  after insert or update on exams
  deferrable initially deferred
  for each row execute function exams_complete();
create constraint trigger exam_rooms_complete
  after insert or update or delete on exam_rooms
  deferrable initially deferred
  for each row execute function exams_complete();
create constraint trigger exam_room_classes_complete
  after insert or update or delete on exam_room_classes
  deferrable initially deferred
  for each row execute function exams_complete();
create constraint trigger exam_invigilators_complete
  after insert or update or delete on exam_invigilators
  deferrable initially deferred
  for each row execute function exams_complete();

-- The advisory lock of a group, taken by every writer of the class claims of
-- its lessons and exams and by a change of its classes.
create function timetable_lock_group(group_ref uuid) returns void
language sql
set search_path = pg_catalog
as $$
  select pg_advisory_xact_lock(hashtextextended('timetable_group:' || group_ref::text, 0))
$$;

-- The blocks and classes a group that sits holds: each class of the group
-- per block of its lessons on the exam's date overlapping the exam, over the
-- block's time. Runs as the invoker.
create function exam_group_blocks(exam_ref uuid)
returns table (block_id uuid, class_id uuid, during tstzrange)
language sql
stable
set search_path = pg_catalog, public
as $$
  select distinct b.id, gc.class_id, tstzrange(b.starts_at, b.ends_at)
  from exams e
  join exam_room_classes rc on rc.exam_id = e.id
  join lessons l on l.group_id = rc.group_id
  join lesson_blocks b on b.id = l.block_id
  join group_classes gc on gc.group_id = rc.group_id
  where e.id = exam_ref
    and b.lesson_date = e.exam_date
    and tstzrange(b.starts_at, b.ends_at) && tstzrange(e.starts_at, e.ends_at)
$$;

-- The claims of one exam: none while it is cancelled; one per room,
-- invigilator and class sitting whole, over the exam's time; for a group that
-- sits, one per class of the group per block of its lessons on that date
-- overlapping the exam, over the block's time, holder the block (decision 1).
-- The exam row is locked first, then the groups in the order of the id (spec
-- review 9); only what differs is written. Runs as the invoker.
create function exam_claims(exam_ref uuid, prune_only boolean default false) returns void
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  exam exams%rowtype;
  exam_range tstzrange;
  group_ref uuid;
begin
  -- Every writer of an exam's rows meets on the exam row, then reads them in
  -- statements of its own (the lock exams_complete takes too).
  perform 1 from exams e where e.id = exam_ref for update;
  if not found then
    return;
  end if;
  select * into exam from exams e where e.id = exam_ref;
  if exam.cancel_cause is not null then
    delete from time_claims c where c.exam_id = exam_ref;
    return;
  end if;
  -- The subject of every group that sits, read again after the lock: a
  -- group row inserted while the subject changed read the old one (build
  -- review, must-fix 2).
  if exists (
    select 1 from exam_room_classes rc
      join groups g on g.id = rc.group_id
      where rc.exam_id = exam_ref and g.subject_id is distinct from exam.subject_id
  ) then
    raise exception 'exam_group_subject'
      using errcode = 'check_violation', constraint = 'exam_group_subject';
  end if;
  for group_ref in
    select distinct rc.group_id from exam_room_classes rc
      where rc.exam_id = exam_ref and rc.group_id is not null
      order by rc.group_id
  loop
    perform timetable_lock_group(group_ref);
  end loop;
  exam_range := tstzrange(exam.starts_at, exam.ends_at);

  -- What the exam no longer holds goes first, a claim at an old time too.
  delete from time_claims c
    where c.exam_id = exam_ref and c.kind in ('exam_room', 'exam_invigilator', 'exam_class')
      and c.during <> exam_range;
  delete from time_claims c
    where c.exam_id = exam_ref and c.kind = 'exam_room'
      and c.room_id not in (select r.room_id from exam_rooms r where r.exam_id = exam_ref);
  delete from time_claims c
    where c.exam_id = exam_ref and c.kind = 'exam_invigilator'
      and c.teacher_id not in (select i.staff_id from exam_invigilators i where i.exam_id = exam_ref);
  delete from time_claims c
    where c.exam_id = exam_ref and c.kind = 'exam_class'
      and c.class_id not in (
        select rc.class_id from exam_room_classes rc
          where rc.exam_id = exam_ref and rc.class_id is not null
      );
  delete from time_claims c
    where c.exam_id = exam_ref and c.kind = 'exam_group_class'
      and (c.block_id, c.class_id) not in (select w.block_id, w.class_id from exam_group_blocks(exam_ref) w);
  if prune_only then
    return;
  end if;

  -- Rooms, with the switch of each copied (edge/developer-rules, Room in one use).
  update time_claims c set during = exam_range, room_shared = rm.shared
    from rooms rm
    where c.exam_id = exam_ref and c.kind = 'exam_room' and rm.id = c.room_id
      and (c.during, c.room_shared) is distinct from (exam_range, rm.shared);
  insert into time_claims (branch_id, kind, exam_id, holder, during, room_id, room_shared)
  select exam.branch_id, 'exam_room', exam.id, exam.id, exam_range, r.room_id, rm.shared
  from exam_rooms r
  join rooms rm on rm.id = r.room_id and rm.branch_id = r.branch_id
  where r.exam_id = exam_ref
  order by r.room_id
  on conflict (exam_id, room_id, branch_id) where kind = 'exam_room' do nothing;

  -- Invigilators.
  update time_claims c set during = exam_range
    where c.exam_id = exam_ref and c.kind = 'exam_invigilator' and c.during <> exam_range;
  insert into time_claims (branch_id, kind, exam_id, holder, during, teacher_id)
  select exam.branch_id, 'exam_invigilator', exam.id, exam.id, exam_range, i.staff_id
  from exam_invigilators i
  where i.exam_id = exam_ref
  order by i.staff_id
  on conflict (exam_id, teacher_id, branch_id) where kind = 'exam_invigilator' do nothing;

  -- Classes that sit whole (a group row writes only exam_group_class).
  update time_claims c set during = exam_range
    where c.exam_id = exam_ref and c.kind = 'exam_class' and c.during <> exam_range;
  insert into time_claims (branch_id, kind, exam_id, holder, during, class_id)
  select exam.branch_id, 'exam_class', exam.id, exam.id, exam_range, rc.class_id
  from exam_room_classes rc
  where rc.exam_id = exam_ref and rc.class_id is not null
  order by rc.class_id
  on conflict (exam_id, class_id, branch_id) where kind = 'exam_class' do nothing;

  -- Groups that sit, held by their own blocks.
  update time_claims c set during = w.during
    from exam_group_blocks(exam_ref) w
    where c.exam_id = exam_ref and c.kind = 'exam_group_class'
      and c.block_id = w.block_id and c.class_id = w.class_id and c.during <> w.during;
  insert into time_claims (branch_id, kind, exam_id, block_id, holder, during, class_id)
  select exam.branch_id, 'exam_group_class', exam.id, w.block_id, w.block_id, w.during, w.class_id
  from exam_group_blocks(exam_ref) w
  order by w.block_id, w.class_id
  on conflict (exam_id, block_id, class_id, branch_id) where kind = 'exam_group_class' do nothing;
end;
$$;

-- The class claims of a block (0058), replaced (correction 2):
-- - the groups of its lessons are locked first, in the order of the id, the
--   lock a change of their classes takes;
-- - a class out of the block for an exam that stands and overlaps the block
--   is left out (decision 6, correction 1);
-- - a block that has started keeps the classes it claims (decision 8, spec
--   review 10); only its time follows.
-- Runs as the invoker.
create or replace function lesson_block_claims(block_ref uuid) returns void
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  block lesson_blocks%rowtype;
  moment timestamptz;
  group_ref uuid;
begin
  select * into block from lesson_blocks b where b.id = block_ref;
  if not found then
    return;
  end if;
  for group_ref in
    select distinct l.group_id from lessons l
      where l.block_id = block_ref and l.group_id is not null
      order by l.group_id
  loop
    perform timetable_lock_group(group_ref);
  end loop;

  update time_claims c set during = tstzrange(block.starts_at, block.ends_at)
    where c.kind = 'block_class' and c.block_id = block_ref
      and c.during <> tstzrange(block.starts_at, block.ends_at);

  moment := class_tutors_moment();
  if moment is not null and block.starts_at <= moment
    and exists (select 1 from time_claims c where c.kind = 'block_class' and c.block_id = block_ref) then
    return;
  end if;

  delete from time_claims c
    where c.kind = 'block_class' and c.block_id = block_ref
      and c.class_id not in (select w.class_id from lesson_block_classes(block_ref) w);
  insert into time_claims (branch_id, kind, block_id, holder, during, class_id)
  select block.branch_id, 'block_class', block.id, block.id,
    tstzrange(block.starts_at, block.ends_at), w.class_id
  from lesson_block_classes(block_ref) w
  order by w.class_id
  on conflict (block_id, class_id) where kind = 'block_class' do nothing;
end;
$$;

-- The classes a block occupies now: the class of a class lesson and the
-- classes of a group lesson's group, of its lessons that are not cancelled,
-- less a class out of the block for an exam that stands, still seats it and
-- overlaps the block.
-- Runs as the invoker.
create function lesson_block_classes(block_ref uuid) returns table (class_id uuid)
language sql
stable
set search_path = pg_catalog, public
as $$
  select w.class_id
  from (
    select l.class_id from lessons l
      where l.block_id = block_ref and l.cancel_cause is null and l.class_id is not null
    union
    select gc.class_id from lessons l
      join group_classes gc on gc.group_id = l.group_id
      where l.block_id = block_ref and l.cancel_cause is null
  ) w
  where not exists (
    select 1
    from lesson_block_class_outs o
    join lesson_blocks b on b.id = o.block_id
    join exams e on e.id = o.exam_id
    where o.block_id = block_ref and o.class_id = w.class_id
      and e.cancel_cause is null
      -- The exam still seats the class whole (build review, must-fix 1).
      and exists (
        select 1 from exam_room_classes rc where rc.exam_id = o.exam_id and rc.class_id = o.class_id
      )
      and e.exam_date = b.lesson_date
      and tstzrange(e.starts_at, e.ends_at) && tstzrange(b.starts_at, b.ends_at)
  )
$$;

-- After a write of an exam or its rows: the exam's claims, and the class
-- claims of every block its out rows name (correction 1). Runs as the invoker.
create function exams_claims() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  exam_ref uuid;
  block_ref uuid;
begin
  if tg_table_name = 'exams' then
    exam_ref := new.id;
  elsif tg_op = 'DELETE' then
    exam_ref := old.exam_id;
  else
    exam_ref := new.exam_id;
  end if;
  -- After a write of any of the four tables: what the exam no longer holds
  -- is given up first, then a class it no longer seats (or an exam cancelled
  -- or moved) returns to its block, and only then are the exam's new claims
  -- written (build review, must-fix 1).
  perform exam_claims(exam_ref, true);
  for block_ref in
    select o.block_id from lesson_block_class_outs o where o.exam_id = exam_ref order by o.block_id
  loop
    perform lesson_block_claims(block_ref);
  end loop;
  perform exam_claims(exam_ref);
  return null;
end;
$$;

create trigger exams_claims
  after insert or update on exams
  for each row execute function exams_claims();
create trigger exam_rooms_claims
  after insert or update or delete on exam_rooms
  for each row execute function exams_claims();
create trigger exam_room_classes_claims
  after insert or delete on exam_room_classes
  for each row execute function exams_claims();
create trigger exam_invigilators_claims
  after insert or delete on exam_invigilators
  for each row execute function exams_claims();

-- An out row changes the class claims of its block. Runs as the invoker.
create function lesson_block_class_outs_claims() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'DELETE' then
    perform lesson_block_claims(old.block_id);
  else
    perform lesson_block_claims(new.block_id);
  end if;
  return null;
end;
$$;

create trigger lesson_block_class_outs_claims
  after insert or delete on lesson_block_class_outs
  for each row execute function lesson_block_class_outs_claims();

-- An out row names an exam that stands, seats the class whole and overlaps the
-- block on its date (decision 6). At the commit. Runs as the invoker.
create function lesson_block_class_out_exam() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if not exists (
    select 1 from lesson_block_class_outs o where o.block_id = new.block_id and o.class_id = new.class_id
  ) then
    return null;
  end if;
  if not exists (
    select 1
    from exams e
    join lesson_blocks b on b.id = new.block_id
    join exam_room_classes rc on rc.exam_id = e.id and rc.class_id = new.class_id
    where e.id = new.exam_id
      and e.cancel_cause is null
      and e.exam_date = b.lesson_date
      and tstzrange(e.starts_at, e.ends_at) && tstzrange(b.starts_at, b.ends_at)
  ) then
    raise exception 'lesson_block_class_out_exam'
      using errcode = 'check_violation', constraint = 'lesson_block_class_out_exam';
  end if;
  return null;
end;
$$;

create constraint trigger lesson_block_class_out_exam
  after insert on lesson_block_class_outs
  deferrable initially deferred
  for each row execute function lesson_block_class_out_exam();

-- A block moved: the claims of every exam a group sits in it, on its old date
-- or its new one (spec review 4). Its own class claims follow through the
-- cascade to its lessons. Runs as the invoker.
create function lesson_blocks_exam_claims() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  exam_ref uuid;
begin
  for exam_ref in
    select distinct rc.exam_id
    from lessons l
    join exam_room_classes rc on rc.group_id = l.group_id
    join exams e on e.id = rc.exam_id
    where l.block_id = new.id
      and e.exam_date in (old.lesson_date, new.lesson_date)
    order by rc.exam_id
  loop
    perform exam_claims(exam_ref);
  end loop;
  return null;
end;
$$;

create trigger lesson_blocks_exam_claims
  after update of starts_at, ends_at, lesson_date on lesson_blocks
  for each row execute function lesson_blocks_exam_claims();

-- The rule of a group that sits (decision 5): its lessons on the exam's date
-- that overlap the exam are in one block or in the two blocks of one double
-- pair, the exam starts with the first and ends with the last, and every one
-- of them is cancelled. Behind the group's lock. Runs as the invoker.
create function exam_group_problem(exam_ref uuid) returns boolean
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  exam exams%rowtype;
  group_ref uuid;
  blocks integer;
  pairs integer;
  pair_missing boolean;
  first_start timestamptz;
  last_end timestamptz;
  open_lessons integer;
begin
  select * into exam from exams e where e.id = exam_ref;
  if not found or exam.cancel_cause is not null then
    return false;
  end if;
  for group_ref in
    select distinct rc.group_id from exam_room_classes rc
      where rc.exam_id = exam_ref and rc.group_id is not null
      order by rc.group_id
  loop
    perform timetable_lock_group(group_ref);
  end loop;
  for group_ref in
    select distinct rc.group_id from exam_room_classes rc
      where rc.exam_id = exam_ref and rc.group_id is not null
      order by rc.group_id
  loop
    select count(distinct b.id)::integer, count(distinct b.double_pair_id)::integer,
        bool_or(b.double_pair_id is null), min(b.starts_at), max(b.ends_at),
        count(*) filter (where l.cancel_cause is null)::integer
      into blocks, pairs, pair_missing, first_start, last_end, open_lessons
      from lessons l
      join lesson_blocks b on b.id = l.block_id
      where l.group_id = group_ref
        and b.lesson_date = exam.exam_date
        and tstzrange(b.starts_at, b.ends_at) && tstzrange(exam.starts_at, exam.ends_at);
    if blocks = 0
      or (blocks = 2 and (pair_missing or pairs <> 1))
      or blocks > 2
      or first_start <> exam.starts_at
      or last_end <> exam.ends_at
      or open_lessons > 0 then
      return true;
    end if;
    -- Both halves of a double lesson together (06, Exam): no block of the
    -- group in the exam has a partner with a lesson of the group outside it
    -- (build review, should-fix 3).
    if exists (
      select 1
      from lessons l
      join lesson_blocks b on b.id = l.block_id
      join lesson_blocks partner on partner.double_pair_id = b.double_pair_id and partner.id <> b.id
      join lessons pl on pl.block_id = partner.id and pl.group_id = group_ref
      where l.group_id = group_ref
        and b.lesson_date = exam.exam_date
        and tstzrange(b.starts_at, b.ends_at) && tstzrange(exam.starts_at, exam.ends_at)
        and not tstzrange(partner.starts_at, partner.ends_at) && tstzrange(exam.starts_at, exam.ends_at)
    ) then
      return true;
    end if;
  end loop;
  return false;
end;
$$;

-- The exams to check after a write, at the commit. Runs as the invoker.
create function exam_group_slots() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  exams_to_check uuid[];
  exam_ref uuid;
begin
  if tg_table_name = 'exams' then
    exams_to_check := array[new.id];
  elsif tg_table_name = 'exam_room_classes' then
    exams_to_check := array[new.exam_id];
  elsif tg_table_name = 'lessons' then
    select array_agg(distinct rc.exam_id) into exams_to_check
      from lessons l
      join exam_room_classes rc on rc.group_id = l.group_id
      join exams e on e.id = rc.exam_id
      where l.id = new.id and e.exam_date = l.lesson_date;
  else
    select array_agg(distinct rc.exam_id) into exams_to_check
      from lessons l
      join exam_room_classes rc on rc.group_id = l.group_id
      join exams e on e.id = rc.exam_id
      where l.block_id = new.id and e.exam_date in (old.lesson_date, new.lesson_date);
  end if;
  for exam_ref in
    select x from unnest(exams_to_check) x where x is not null order by x
  loop
    if exam_group_problem(exam_ref) then
      raise exception 'exam_group_slots'
        using errcode = 'check_violation', constraint = 'exam_group_slots';
    end if;
  end loop;
  return null;
end;
$$;

create constraint trigger exams_group_slots
  after insert or update of exam_date, starts_at, ends_at, cancel_cause on exams
  deferrable initially deferred
  for each row execute function exam_group_slots();
create constraint trigger exam_room_classes_group_slots
  after insert on exam_room_classes
  deferrable initially deferred
  for each row execute function exam_group_slots();
create constraint trigger lessons_exam_group_slots
  after insert or update of cancel_cause on lessons
  deferrable initially deferred
  for each row execute function exam_group_slots();
create constraint trigger lesson_blocks_exam_group_slots
  after update of starts_at, ends_at, lesson_date on lesson_blocks
  deferrable initially deferred
  for each row execute function exam_group_slots();

-- ---------------------------------------------------------------------------
-- A class added to or removed from a group: the class claims of the group's
-- future blocks and exams written again, behind the group's lock. Runs as the
-- invoker.
create function group_classes_claims() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  group_ref uuid;
  moment timestamptz;
  item uuid;
begin
  if tg_op = 'DELETE' then
    group_ref := old.group_id;
  else
    group_ref := new.group_id;
  end if;
  perform timetable_lock_group(group_ref);
  moment := class_tutors_moment();
  for item in
    select distinct l.block_id from lessons l
      where l.group_id = group_ref and l.cancel_cause is null
        and (moment is null or l.starts_at > moment)
      order by l.block_id
  loop
    perform lesson_block_claims(item);
  end loop;
  for item in
    select distinct e.id from exam_room_classes rc
      join exams e on e.id = rc.exam_id
      where rc.group_id = group_ref and e.cancel_cause is null
        and (moment is null or e.starts_at > moment)
      order by e.id
  loop
    perform exam_claims(item);
  end loop;
  return null;
end;
$$;

create trigger group_classes_claims
  after insert or delete on group_classes
  for each row execute function group_classes_claims();

-- ---------------------------------------------------------------------------
-- Students in one lesson of a block.

-- The advisory locks of the units of a block (its classes and groups, in the
-- order of the id), then of the block: the order a membership change takes
-- too. Runs as the invoker.
create function timetable_lock_block(block_ref uuid) returns void
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  unit uuid;
begin
  for unit in
    select u.id from (
      select l.class_id as id from lessons l where l.block_id = block_ref and l.class_id is not null
      union
      select l.group_id from lessons l where l.block_id = block_ref and l.group_id is not null
    ) u
    order by u.id
  loop
    perform pg_advisory_xact_lock(hashtextextended('timetable_unit:' || unit::text, 0));
  end loop;
  perform pg_advisory_xact_lock(hashtextextended('timetable_block:' || block_ref::text, 0));
end;
$$;

-- Whether a student is in two lessons of the block that are not cancelled.
-- Runs as the invoker.
create function lesson_block_student_twice(block_ref uuid) returns boolean
language sql
stable
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from lessons l
    cross join lateral lesson_students(l.id) as s(student)
    where l.block_id = block_ref and l.cancel_cause is null
    group by s.student
    having count(*) > 1
  )
$$;

-- 0058, replaced (correction 2): the units of the block are locked before the
-- block, as a membership change locks them. Runs as the invoker.
create or replace function lessons_block_students() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  lesson lessons%rowtype;
begin
  select * into lesson from lessons l where l.id = new.id;
  if not found then
    return null;
  end if;
  perform timetable_lock_block(lesson.block_id);
  if lesson_block_student_twice(lesson.block_id) then
    raise exception 'lesson_block_student_twice'
      using errcode = 'check_violation', constraint = 'lesson_block_student_twice';
  end if;
  return null;
end;
$$;

-- A membership that puts its student in two lessons of a future block (the
-- merge of 0054 included, spec review 2): behind the lock of the class or
-- group, then of each block in the order of the id, at the commit. Only blocks
-- of more than one lesson can hold a student twice. Runs as the invoker.
create function memberships_block_students() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  unit uuid;
  range_from date;
  range_until date;
  moment timestamptz;
  block_ref uuid;
begin
  if tg_table_name = 'class_memberships' then
    select m.class_id, m.valid_from, m.valid_until into unit, range_from, range_until
      from class_memberships m where m.id = new.id;
  else
    select m.group_id, m.valid_from, m.valid_until into unit, range_from, range_until
      from group_memberships m where m.id = new.id;
  end if;
  if not found or range_from >= range_until then
    return null;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('timetable_unit:' || unit::text, 0));
  moment := class_tutors_moment();
  for block_ref in
    select l.block_id
    from lessons l
    where (l.class_id = unit or l.group_id = unit)
      and l.cancel_cause is null
      and l.lesson_date >= range_from and l.lesson_date < range_until
      and (moment is null or l.starts_at > moment)
      and exists (
        select 1 from lessons o
          where o.block_id = l.block_id and o.id <> l.id and o.cancel_cause is null
      )
    group by l.block_id
    order by l.block_id
  loop
    perform timetable_lock_block(block_ref);
    if lesson_block_student_twice(block_ref) then
      raise exception 'lesson_block_student_twice'
        using errcode = 'check_violation', constraint = 'lesson_block_student_twice';
    end if;
  end loop;
  return null;
end;
$$;

create constraint trigger class_memberships_block_students
  after insert or update of valid_until, student_id on class_memberships
  deferrable initially deferred
  for each row execute function memberships_block_students();
create constraint trigger group_memberships_block_students
  after insert or update of valid_until, student_id on group_memberships
  deferrable initially deferred
  for each row execute function memberships_block_students();

-- ---------------------------------------------------------------------------
-- Rooms.

-- The count of 0058 at every moment of a range: lessons and exams at once
-- against the room's number, the students of its lessons together against
-- its capacity (exams not counted, decision 2). Runs as the invoker.
create function room_shared_problem(room_ref uuid, range_ref tstzrange) returns text
language plpgsql
stable
set search_path = pg_catalog, public
as $$
declare
  most integer;
  room_capacity integer;
  busiest integer;
  fullest integer;
begin
  select r.max_simultaneous_lessons, r.capacity into most, room_capacity
    from rooms r where r.id = room_ref;
  select max(at_once.lessons), max(at_once.students) into busiest, fullest
  from (
    select lower(range_ref) as moment
    union
    select lower(o.during) from time_claims o
      where o.room_id = room_ref
        and lower(o.during) > lower(range_ref)
        and lower(o.during) < upper(range_ref)
  ) moments
  cross join lateral (
    select
      count(*)::integer as lessons,
      (
        select count(distinct s.student)::integer
        from time_claims o2
        cross join lateral lesson_students(o2.lesson_id) as s(student)
        where o2.room_id = room_ref
          and o2.lesson_id is not null
          and o2.during @> moments.moment
      ) as students
    from time_claims o
    where o.room_id = room_ref and o.during @> moments.moment
  ) at_once;
  if most is not null and busiest > most then
    return 'room_shared_full';
  end if;
  if fullest > room_capacity then
    return 'room_shared_capacity';
  end if;
  return null;
end;
$$;

-- 0058, replaced (correction 2): every claim with a room takes the room's
-- lock and reads its switch again in a statement of its own; a claim whose
-- copied flag is not the room's was written from an old read (spec review
-- 3). A shared room is then counted as before. Runs as the invoker.
create or replace function time_claims_shared_room() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  claim time_claims%rowtype;
  shared boolean;
  problem text;
begin
  select * into claim from time_claims c where c.id = new.id;
  if not found or claim.room_id is null then
    return null;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('timetable_room:' || claim.room_id::text, 0));
  select r.shared into shared from rooms r where r.id = claim.room_id;
  if shared is distinct from claim.room_shared then
    raise exception 'room_shared_stale'
      using errcode = 'check_violation', constraint = 'room_shared_stale';
  end if;
  if not claim.room_shared then
    return null;
  end if;
  problem := room_shared_problem(claim.room_id, claim.during);
  if problem is not null then
    raise exception '%', problem using errcode = 'check_violation', constraint = problem;
  end if;
  return null;
end;
$$;

-- A room's switch copied onto its claims that have not ended, behind the
-- room's lock, so a switch to not shared meets time_claims_room_excl. Runs as
-- the invoker.
create function rooms_claims_shared() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  moment timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended('timetable_room:' || new.id::text, 0));
  moment := class_tutors_moment();
  update time_claims c set room_shared = new.shared
    where c.room_id = new.id
      and c.room_shared <> new.shared
      and (moment is null or upper(c.during) > moment);
  return null;
end;
$$;

create trigger rooms_claims_shared
  after update of shared on rooms
  for each row when (old.shared is distinct from new.shared)
  execute function rooms_claims_shared();

-- A shared room's number or capacity lowered, or the switch turned on: every
-- claim of the room that has not ended is counted again, at the commit,
-- behind the room's lock. Runs as the invoker.
create function rooms_shared_recheck() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  room rooms%rowtype;
  moment timestamptz;
  claim_range tstzrange;
  problem text;
begin
  perform pg_advisory_xact_lock(hashtextextended('timetable_room:' || new.id::text, 0));
  select * into room from rooms r where r.id = new.id;
  if not found or not room.shared then
    return null;
  end if;
  moment := class_tutors_moment();
  for claim_range in
    select c.during from time_claims c
      where c.room_id = room.id and (moment is null or upper(c.during) > moment)
      order by lower(c.during)
  loop
    problem := room_shared_problem(room.id, claim_range);
    if problem is not null then
      raise exception '%', problem using errcode = 'check_violation', constraint = problem;
    end if;
  end loop;
  return null;
end;
$$;

create constraint trigger rooms_shared_recheck
  after update of shared, max_simultaneous_lessons, capacity on rooms
  deferrable initially deferred
  for each row execute function rooms_shared_recheck();

grant execute on function lesson_block_classes(uuid) to sodiq_app;
