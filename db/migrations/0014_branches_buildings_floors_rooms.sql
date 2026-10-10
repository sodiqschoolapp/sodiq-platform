-- 0014 The full branch record, buildings, floors and rooms (task 1.1).
--
-- docs/spec/03-school-setup.md, the setup table: Branch ("Name, address,
-- working weekdays, contacts"; owner: Super Admin) and Building, floor, room
-- ("Rooms are added floor by floor. Room: name or number, floor, type
-- (classroom, laboratory, sports hall, hall, other), capacity, status (in use,
-- under repair, closed)"; owner: Super Admin).
-- docs/spec/edge-cases/timetable.md, Structure: "A room has a 'shared' switch
-- and a maximum number of lessons at the same time."
-- docs/spec/edge-cases/00-definitions.md, Branch time: "Each branch has a time
-- zone (Asia/Tashkent)."
--
-- The bounds (lengths, capacity, lessons at once) were agreed by the owner at
-- the plan (pull request #37, answer 9) and are the constants of
-- packages/shared/src/setup.ts; a test compares the lists of the checks with
-- the constants.

-- Branch. School-wide, as in 0002: the switcher shows the names. The table is
-- small and nothing is deployed yet, so one step is enough.
alter table branches
  add constraint branches_name_check check (length(btrim(name)) between 1 and 100),
  -- Optional; stored as null when empty.
  add column address text constraint branches_address_check check (
    length(btrim(address)) between 1 and 300
  ),
  -- The contacts: one phone and one email, both optional (decided by the owner).
  add column phone text constraint branches_phone_check check (
    length(btrim(phone)) between 1 and 40
  ),
  add column email text constraint branches_email_check check (
    length(btrim(email)) between 1 and 200
  ),
  -- ISO numbers, Monday 1 to Sunday 7, at least one. The application writes
  -- them once each in that order; a new branch works Monday to Friday
  -- (decided by the owner): a working Saturday is a special day of the calendar.
  add column working_weekdays smallint[] not null default '{1,2,3,4,5}'
    constraint branches_working_weekdays_check check (
      cardinality(working_weekdays) between 1 and 7
      and working_weekdays <@ '{1,2,3,4,5,6,7}'::smallint[]
    ),
  -- The branch time of every rule. No task changes it yet; sodiq_app cannot.
  add column time_zone text not null default 'Asia/Tashkent'
    constraint branches_time_zone_check check (length(time_zone) between 1 and 100);

-- Two branches of one name would be indistinguishable in the switcher.
create unique index branches_name_idx on branches (lower(btrim(name)));

-- The Super Admin creates a branch and edits its record; nothing removes one.
grant insert on branches to sodiq_app;
grant update (name, address, phone, email, working_weekdays) on branches to sodiq_app;

-- Buildings. A branch table: branch_id and the one policy of 0002.
create table buildings (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  name text not null constraint buildings_name_check check (
    length(btrim(name)) between 1 and 100
  ),
  -- From the injected clock; empty while active. Archived, never deleted (CLAUDE.md).
  archived_at timestamptz,
  -- Bookkeeping only; no rule reads it.
  created_at timestamptz not null default now(),
  -- So that a floor can reference the building together with the branch.
  constraint buildings_id_branch_key unique (id, branch_id)
);

-- Two active buildings of one name in a branch would be indistinguishable;
-- an archived one keeps its name and may be restored while no active one has it.
create unique index buildings_active_name_idx
  on buildings (branch_id, lower(btrim(name))) where archived_at is null;

alter table buildings enable row level security;
create policy branch_filter on buildings for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select, insert on buildings to sodiq_app;
grant update (name, archived_at) on buildings to sodiq_app;

-- Floors. "Rooms are added floor by floor." A floor has a name or number.
create table floors (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  building_id uuid not null,
  name text not null constraint floors_name_check check (
    length(btrim(name)) between 1 and 50
  ),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  -- A floor can never belong to a building of another branch, whatever the
  -- application does (.claude/rules/database.md: an id that arrives in a
  -- request is checked against the branch).
  constraint floors_building_fkey foreign key (building_id, branch_id)
    references buildings (id, branch_id),
  constraint floors_id_branch_key unique (id, branch_id)
);

-- Two active floors of one name in a building would be indistinguishable.
-- With branch_id, as every unique constraint on a branch table.
create unique index floors_active_name_idx
  on floors (branch_id, building_id, lower(btrim(name))) where archived_at is null;

create index floors_building_idx on floors (building_id);

alter table floors enable row level security;
create policy branch_filter on floors for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select, insert on floors to sodiq_app;
grant update (name, archived_at) on floors to sodiq_app;

-- Rooms. Never archived: closed is the end state of a room
-- (docs/spec/edge-cases/academic-year.md: "an archived teacher and a closed
-- room"; decided by the owner).
create table rooms (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  floor_id uuid not null,
  name text not null constraint rooms_name_check check (
    length(btrim(name)) between 1 and 50
  ),
  -- The same lists as ROOM_TYPES and ROOM_STATUSES of packages/shared.
  type text not null constraint rooms_type_check check (
    type in ('classroom', 'laboratory', 'sports_hall', 'hall', 'other')
  ),
  capacity integer not null constraint rooms_capacity_check check (
    capacity between 1 and 1000
  ),
  status text not null constraint rooms_status_check check (
    status in ('in_use', 'under_repair', 'closed')
  ),
  shared boolean not null default false,
  -- How many lessons a shared room holds at once; nothing for a room that is
  -- not shared. The timetable tasks copy the flag onto the lesson's claim row
  -- (developer rules, "Room in one use").
  max_simultaneous_lessons integer,
  -- "is not null" is said: a check that comes out null would pass.
  constraint rooms_shared_check check (
    (shared and max_simultaneous_lessons is not null and max_simultaneous_lessons between 2 and 10)
    or (not shared and max_simultaneous_lessons is null)
  ),
  created_at timestamptz not null default now(),
  constraint rooms_floor_fkey foreign key (floor_id, branch_id)
    references floors (id, branch_id)
);

-- A room name is shown alone in the timetable, the journal and the prints, so
-- it is unique in the branch, not per building (decided by the owner).
create unique index rooms_name_idx on rooms (branch_id, lower(btrim(name)));

create index rooms_floor_idx on rooms (floor_id);

alter table rooms enable row level security;
create policy branch_filter on rooms for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select, insert on rooms to sodiq_app;
grant update (name, floor_id, type, capacity, status, shared, max_simultaneous_lessons)
  on rooms to sodiq_app;
