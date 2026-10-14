-- 0042 Classes and their Tutors (task 3.1a, pull request #88).
--
-- docs/spec/05-classes-groups-subjects.md, Class: "Grade (1–11), name
-- (Oxford, Princeton), language of instruction (Uzbek or Russian), tutor,
-- main classroom, maximum size, academic year. A class is shown as grade and
-- name: 7 Oxford." "There are no class codes such as 7-A. The name is unique
-- within a branch, grade and year." Language of instruction, The rule: "In
-- the teaching load a teacher can be given a class or group only if they can
-- teach in its language. This is blocked, not a warning. The same holds when
-- a Tutor is given a class."
-- docs/spec/edge-cases/students-classes-groups.md: "The Tutor of a class is
-- recorded with dates. The new Tutor sees the class's whole year; the earlier
-- one loses access on the end date. An acting Tutor can be set for a period."
-- "Look-alike Cyrillic and Latin letters in class and group names are treated
-- as the same."
-- docs/spec/edge-cases/academic-year.md: "Closed quarters and years keep the
-- names as they were".
--
-- The plan approved on pull request #88 with the corrections of its review:
-- decisions 2 to 4, 6, 7, 9, 10, 14 to 19; corrections 1 to 4 and 6.
--
-- Every refusal raised here names a constraint, which the API maps to an
-- error code (apps/api/src/modules/classes/class-refusals.ts).

-- Correction 1: so that a class can name its main classroom together with
-- the branch (.claude/rules/database.md: an id that arrives in a request is
-- checked against the branch). `rooms` is a small table.
alter table rooms add constraint rooms_id_branch_key unique (id, branch_id);

-- The folded name a class is compared by (decision 4): look-alike Cyrillic
-- letters as their Latin twins, then lower case, runs of white space as one
-- space, no outer spaces. The same fold as `classNameKey` of packages/shared;
-- a test compares the two over generated names (correction 6). Each Cyrillic
-- letter is folded in both cases to the Latin letter its capital looks like,
-- so that a name typed in either case folds the same.
create function class_name_key(name text) returns text
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select lower(btrim(regexp_replace(
    translate(
      name,
      'АаВвЕеКкМмНнОоРрСсТтУуХхІіЈјЅѕ',
      'AaBbEeKkMmHhOoPpCcTtYyXxIiJjSs'
    ),
    '\s+', ' ', 'g'
  )))
$$;

-- The classes of a branch. A branch table: branch_id and the one policy of
-- 0002. A class belongs to one academic year, fixed at the create
-- (decision 6: `academic_year_id` is not in the update grant).
create table classes (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  academic_year_id uuid not null,
  grade smallint not null constraint classes_grade_check check (grade between 1 and 11),
  -- Decision 17: 2 to CLASS_NAME_MAX_LENGTH (40) characters after trimming,
  -- beginning with a letter ("There are no class codes such as 7-A"). Stored
  -- as typed (`12`: "Names of ... classes are stored as entered").
  name text not null constraint classes_name_check check (
    length(btrim(name)) between 2 and 40 and btrim(name) ~ '^[[:alpha:]]'
  ),
  -- Written by the database only: a generated column cannot be written.
  name_key text generated always as (class_name_key(name)) stored,
  -- INSTRUCTION_LANGUAGES of packages/shared.
  language text not null constraint classes_language_check check (language in ('uz', 'ru')),
  -- Optional (decision 7): a room of the branch, not closed when chosen
  -- (classes_room_guard).
  main_room_id uuid,
  -- Decision 14: 1 to CLASS_MAX_SIZE (60).
  max_size smallint not null constraint classes_max_size_check check (
    max_size between 1 and 60
  ),
  -- The state the edit compares with ("class changed, reload"); raised by
  -- classes_version on every update.
  version integer not null default 0,
  -- From the injected clock; empty while active.
  archived_at timestamptz,
  -- Bookkeeping only; no rule reads it.
  created_at timestamptz not null default now(),
  constraint classes_year_fkey foreign key (academic_year_id, branch_id)
    references academic_years (id, branch_id),
  constraint classes_room_fkey foreign key (main_room_id, branch_id)
    references rooms (id, branch_id),
  constraint classes_id_branch_key unique (id, branch_id),
  -- `05`: "The name is unique within a branch, grade and year", archived
  -- classes included (decision 3), by the folded name (decision 4).
  constraint classes_name_key unique (branch_id, academic_year_id, grade, name_key)
);

create index classes_year_idx on classes (academic_year_id);
create index classes_room_idx on classes (main_room_id);

alter table classes enable row level security;
create policy branch_filter on classes for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select on classes to sodiq_app;
grant insert (branch_id, academic_year_id, grade, name, language, main_room_id, max_size)
  on classes to sodiq_app;
grant update (grade, name, language, main_room_id, max_size, archived_at) on classes to sodiq_app;

-- Every update raises the version, so an edit made on an old state is seen.
create function classes_version() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.version := old.version + 1;
  return new;
end;
$$;

create trigger classes_version
  before update on classes
  for each row execute function classes_version();

-- Decision 18: in a closed year a class is history. The year row is locked
-- FOR SHARE first, whatever its state, and its state read afterwards in a
-- statement of its own (.claude/rules/database.md, the lock-then-read rule),
-- so a close of the year at the same moment waits or is waited for. For every
-- user. Runs as the invoker: the year is of the class's own branch.
create function class_year_open(year_id uuid) returns void
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  state text;
begin
  perform 1 from academic_years y where y.id = year_id for share;
  select y.status into state from academic_years y where y.id = year_id;
  if state = 'closed' then
    raise exception 'class_year_closed'
      using errcode = 'check_violation', constraint = 'class_year_closed';
  end if;
end;
$$;

create function classes_year_guard() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'UPDATE' and new.academic_year_id is distinct from old.academic_year_id then
    raise exception 'classes_year_fixed'
      using errcode = 'check_violation', constraint = 'classes_year_fixed';
  end if;
  perform class_year_open(new.academic_year_id);
  return new;
end;
$$;

create trigger classes_year_guard
  before insert or update on classes
  for each row execute function classes_year_guard();

-- Decision 7: the main classroom is a room that is not closed when it is
-- chosen; a room closed later stays on its classes. The room is locked FOR
-- SHARE first and its status read afterwards, so a close at the same moment
-- (the room edit locks it FOR UPDATE) waits or is waited for. The composite
-- key keeps it in the branch.
create function classes_room_guard() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  state text;
begin
  if new.main_room_id is null
    or (tg_op = 'UPDATE' and new.main_room_id is not distinct from old.main_room_id) then
    return new;
  end if;
  perform 1 from rooms r where r.id = new.main_room_id for share;
  select r.status into state from rooms r where r.id = new.main_room_id;
  if state = 'closed' then
    raise exception 'classes_room_closed'
      using errcode = 'check_violation', constraint = 'classes_room_closed';
  end if;
  return new;
end;
$$;

create trigger classes_room_guard
  before insert or update of main_room_id on classes
  for each row execute function classes_room_guard();

-- The Tutors of a class with dates (edge, "The Tutor of a class is recorded
-- with dates"; decisions 8, 9 and 15). A row hangs off a Tutor assignment of
-- the class's branch and is in force over [valid_from, valid_until). A
-- withdrawn planned row keeps an empty range, as staff_statuses and
-- assignments have it. Rows are never deleted.
create table class_tutors (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  class_id uuid not null,
  assignment_id uuid not null references assignments (id),
  -- Decision 15: the Tutor, and an acting Tutor for a period beside them.
  kind text not null constraint class_tutors_kind_check check (kind in ('tutor', 'acting')),
  -- From the injected clock: the moment of the give, or 00:00 of a later date
  -- in the branch's time zone (decision 9).
  valid_from timestamptz not null,
  -- The end in force: the earlier of `own_until` and the end of the Tutor
  -- assignment, or the moment of an archive. Written by
  -- class_tutors_fill, the end route, the archive and the mirror of a role end.
  valid_until timestamptz,
  -- Correction 3: the end the give or the end route set, never written by the
  -- mirror, so that a role end taken back gives the row its own end again.
  own_until timestamptz,
  -- Correction 2: who ended it: the end route or a typed end (`ended`), the
  -- end of the role (`role`), the archive of the class (`archive`).
  end_cause text constraint class_tutors_end_cause_check check (
    end_cause in ('ended', 'role', 'archive')
  ),
  given_by uuid not null references accounts (id),
  ended_by uuid references accounts (id),
  -- "Inserted by this transaction" (.claude/rules/database.md).
  written_xact xid8 not null default pg_current_xact_id(),
  -- Bookkeeping only; no rule reads it.
  created_at timestamptz not null default now(),
  constraint class_tutors_class_fkey foreign key (class_id, branch_id)
    references classes (id, branch_id),
  constraint class_tutors_range_check check (valid_until is null or valid_until >= valid_from),
  constraint class_tutors_own_range_check check (own_until is null or own_until > valid_from),
  constraint class_tutors_end_cause_needed check ((valid_until is null) = (end_cause is null)),
  constraint class_tutors_ended_by_check check (ended_by is null or valid_until is not null),
  -- One Tutor and one acting Tutor of a class at a moment. Half-open: a class
  -- passes at one moment from one Tutor to the next; an empty range (a
  -- withdrawn row) meets nothing.
  constraint class_tutors_one_tutor exclude using gist (
    class_id with =,
    tstzrange(valid_from, valid_until) with &&
  ) where (kind = 'tutor'),
  constraint class_tutors_one_acting exclude using gist (
    class_id with =,
    tstzrange(valid_from, valid_until) with &&
  ) where (kind = 'acting')
);

create index class_tutors_class_idx on class_tutors (class_id);
create index class_tutors_assignment_idx on class_tutors (assignment_id);

alter table class_tutors enable row level security;
create policy branch_filter on class_tutors for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select on class_tutors to sodiq_app;
grant insert (branch_id, class_id, assignment_id, kind, valid_from, own_until, given_by)
  on class_tutors to sodiq_app;
grant update (valid_until, own_until, ended_by, end_cause) on class_tutors to sodiq_app;

-- The moment of the transaction (`app.now`, set by Transactions.run from the
-- injected clock), and 00:00 of its day in the time zone of a branch.
create function class_tutors_moment() returns timestamptz
language sql
stable
set search_path = pg_catalog
as $$
  select nullif(current_setting('app.now', true), '')::timestamptz
$$;

create function class_tutors_day_start(moment timestamptz, branch uuid) returns timestamptz
language sql
stable
set search_path = pg_catalog, public
as $$
  select date_trunc('day', moment at time zone b.time_zone) at time zone b.time_zone
  from branches b
  where b.id = branch
$$;

-- A new Tutor row (decisions 8 and 9). Locks the assignment and the class
-- FOR SHARE first, then reads them in statements of their own, so that a role
-- end (FOR UPDATE of the assignment) or an archive (FOR UPDATE of the class)
-- at the same moment either waits for the give or is waited for and sees its
-- row. The application inserts the start and its own end; this writes the
-- end in force. Runs as the invoker.
create function class_tutors_fill() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  given record;
  held record;
  moment timestamptz;
begin
  perform 1 from assignments a where a.id = new.assignment_id for share;
  perform 1 from classes c where c.id = new.class_id and c.branch_id = new.branch_id for share;
  select a.role, a.branch_id, a.valid_from, a.valid_until into given
    from assignments a where a.id = new.assignment_id;
  if not found then
    -- The foreign key answers it.
    return new;
  end if;
  if given.role <> 'tutor' or given.branch_id is distinct from new.branch_id then
    raise exception 'class_tutors_not_tutor'
      using errcode = 'check_violation', constraint = 'class_tutors_not_tutor';
  end if;
  select c.archived_at, c.academic_year_id into held
    from classes c where c.id = new.class_id and c.branch_id = new.branch_id;
  if not found then
    -- The foreign key answers it.
    return new;
  end if;
  if held.archived_at is not null then
    raise exception 'class_tutors_class_archived'
      using errcode = 'check_violation', constraint = 'class_tutors_class_archived';
  end if;
  perform class_year_open(held.academic_year_id);
  if current_user = 'sodiq_app' then
    moment := class_tutors_moment();
    if moment is null then
      raise exception 'class_tutors_needs_moment'
        using errcode = 'check_violation', constraint = 'class_tutors_needs_moment';
    end if;
    -- Never in the past: today from the moment of the give, else 00:00 of a
    -- later date (decision 9).
    if new.valid_from < class_tutors_day_start(moment, new.branch_id) then
      raise exception 'class_tutors_start_past'
        using errcode = 'check_violation', constraint = 'class_tutors_start_past';
    end if;
  end if;
  -- Never before its assignment, and within it.
  if new.valid_from < given.valid_from
    or (given.valid_until is not null and new.valid_from >= given.valid_until) then
    raise exception 'class_tutors_outside_role'
      using errcode = 'check_violation', constraint = 'class_tutors_outside_role';
  end if;
  -- The end in force: the earlier of its own end and the role's (decision 9;
  -- correction 2).
  if given.valid_until is not null
    and (new.own_until is null or given.valid_until < new.own_until) then
    new.valid_until := given.valid_until;
    new.end_cause := 'role';
    new.ended_by := null;
  elsif new.own_until is not null then
    new.valid_until := new.own_until;
    new.end_cause := 'ended';
    new.ended_by := new.given_by;
  else
    new.valid_until := null;
    new.end_cause := null;
    new.ended_by := null;
  end if;
  return new;
end;
$$;

create trigger class_tutors_fill
  before insert on class_tutors
  for each row execute function class_tutors_fill();

-- An end written by the application (the end route, the archive): an end at
-- or before the moment is final; a new end is not before 00:00 of that day
-- in the branch's time zone and not after the end of the role; not in a
-- closed year. The mirror of a role end runs as the owner and is not checked
-- (as assignments_end_guard, 0027). Runs as the invoker.
create function class_tutors_end_guard() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  moment timestamptz;
  role_end timestamptz;
  year_id uuid;
begin
  if current_user <> 'sodiq_app' then
    return new;
  end if;
  moment := class_tutors_moment();
  if moment is null then
    raise exception 'class_tutors_needs_moment'
      using errcode = 'check_violation', constraint = 'class_tutors_needs_moment';
  end if;
  if old.valid_until is not null and old.valid_until <= moment then
    raise exception 'class_tutors_end_final'
      using errcode = 'check_violation', constraint = 'class_tutors_end_final';
  end if;
  if new.valid_until is not null
    and new.valid_until < class_tutors_day_start(moment, new.branch_id) then
    raise exception 'class_tutors_end_past'
      using errcode = 'check_violation', constraint = 'class_tutors_end_past';
  end if;
  perform 1 from assignments a where a.id = new.assignment_id for share;
  select a.valid_until into role_end from assignments a where a.id = new.assignment_id;
  if role_end is not null and (new.valid_until is null or new.valid_until > role_end) then
    raise exception 'class_tutors_outside_role'
      using errcode = 'check_violation', constraint = 'class_tutors_outside_role';
  end if;
  perform 1 from classes c where c.id = new.class_id for share;
  select c.academic_year_id into year_id from classes c where c.id = new.class_id;
  perform class_year_open(year_id);
  return new;
end;
$$;

create trigger class_tutors_end_guard
  before update on class_tutors
  for each row execute function class_tutors_end_guard();

-- Decision 2 (Look first) with corrections 2 and 3: every change of the end
-- of a Tutor assignment (a role end, a `left` through Staff.endRoles, their
-- taking back) is written on its class rows in the same transaction.
-- - The end set or moved earlier: the rows not ended by then end at it (a
--   planned row is withdrawn: its range becomes empty), `end_cause = 'role'`.
--   An end that has passed is final and is not rewritten.
-- - The end moved later or emptied: the rows the role ended follow it, back
--   to the earlier of their own end and the role's; the deferred language
--   check runs again on them (class_tutors_language). Rows ended by the
--   Academic Vice Principal or by an archive stay ended.
-- When an end moves later and another Tutor was given meanwhile, the
-- exclusion constraints refuse it. SECURITY DEFINER: a role end is written
-- school-wide (`assignments` has no policy) and `class_tutors` is a branch
-- table; the application has no right to write `end_cause = 'role'` rows of
-- a branch it does not filter to.
create function assignments_class_tutors_end() returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  moment timestamptz := coalesce(
    nullif(current_setting('app.now', true), '')::timestamptz, '-infinity'::timestamptz
  );
begin
  if new.valid_until is not null
    and (old.valid_until is null or new.valid_until < old.valid_until) then
    update public.class_tutors t
      set valid_until = greatest(t.valid_from, new.valid_until),
        end_cause = 'role'
      where t.assignment_id = new.id
        and (t.valid_until is null or t.valid_until > new.valid_until)
        and (t.valid_until is null or t.valid_until > moment);
  else
    update public.class_tutors t
      set valid_until = ends.valid_until,
        end_cause = case
          when ends.valid_until is null then null
          when t.own_until is not null
            and t.own_until <= coalesce(new.valid_until, 'infinity'::timestamptz) then 'ended'
          else 'role'
        end,
        ended_by = case when ends.valid_until is null then null else t.ended_by end
      from (
        select t2.id,
          case
            when t2.own_until is null and new.valid_until is null then null
            else greatest(t2.valid_from, least(t2.own_until, new.valid_until))
          end as valid_until
        from public.class_tutors t2
        where t2.assignment_id = new.id and t2.end_cause = 'role'
      ) ends
      where t.id = ends.id;
  end if;
  return null;
end;
$$;

create trigger assignments_class_tutors_end
  after update of valid_until on assignments
  for each row
  when (new.valid_until is distinct from old.valid_until and new.role = 'tutor')
  execute function assignments_class_tutors_end();

revoke execute on function assignments_class_tutors_end() from public;

-- Decision 19 (Look first) with correction 4. The language rule reads the
-- languages of a person, which the membership filter may hide (a Tutor whose
-- record is linked to another branch), and the Tutor rows of a person, which
-- the branch filter splits. Both answer a fact, never row data, and are named
-- in SECURITY_DEFINER_FUNCTIONS of apps/api/src/database/catalog.test.ts.

-- Whether the person of a Tutor assignment teaches in a language (`04`:
-- "Languages of instruction"). The staff record is locked FOR SHARE first and
-- its languages read afterwards: the language edit of the record locks it FOR
-- UPDATE (Staff.teaching), so the two sides of the rule never pass each other
-- unseen. No record, or no such language: false.
create function tutor_teaches_language(assignment_id uuid, language text) returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  person uuid;
begin
  select s.id into person
    from public.assignments a
    join public.staff s on s.account_id = a.account_id and s.kind = 'person'
    where a.id = tutor_teaches_language.assignment_id
    for share of s;
  if person is null then
    return false;
  end if;
  return exists (
    select 1 from public.staff_languages l
    where l.staff_id = person and l.language = tutor_teaches_language.language
  );
end;
$$;

-- The classes of a language that a person tutors, now or planned, while the
-- person does not teach in it: the ids of those of the branches of the
-- transaction (read with app_branch_ids(), never from an argument) and the
-- number of the others; never an id of another branch's class.
create function tutor_classes_of_language(staff_id uuid, language text)
returns table (class_ids uuid[], elsewhere integer)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with held as (
    select distinct c.id, c.branch_id
    from public.staff s
    join public.assignments a on a.account_id = s.account_id and a.role = 'tutor'
    join public.class_tutors t on t.assignment_id = a.id
    join public.classes c on c.id = t.class_id
    where s.id = tutor_classes_of_language.staff_id
      and c.language = tutor_classes_of_language.language
      and not exists (
        select 1 from public.staff_languages l
        where l.staff_id = s.id and l.language = tutor_classes_of_language.language
      )
      and (
        t.valid_until is null
        or (
          t.valid_until > t.valid_from
          and t.valid_until > coalesce(
            nullif(current_setting('app.now', true), '')::timestamptz, '-infinity'::timestamptz
          )
        )
      )
  )
  select
    coalesce(
      array_agg(held.id order by held.id) filter (
        where held.branch_id = any (public.app_branch_ids())
      ),
      '{}'::uuid[]
    ),
    (count(*) filter (where not (held.branch_id = any (public.app_branch_ids()))))::integer
  from held
$$;

revoke execute on function tutor_teaches_language(uuid, text) from public;
revoke execute on function tutor_classes_of_language(uuid, text) from public;
grant execute on function tutor_teaches_language(uuid, text) to sodiq_app;
grant execute on function tutor_classes_of_language(uuid, text) to sodiq_app;

-- Whether a Tutor row is in force now or planned: not withdrawn and not
-- ended by the moment of the transaction.
create function class_tutor_live(valid_from timestamptz, valid_until timestamptz)
returns boolean
language sql
stable
set search_path = pg_catalog, public
as $$
  select valid_until is null
    or (
      valid_until > valid_from
      and valid_until > coalesce(class_tutors_moment(), '-infinity'::timestamptz)
    )
$$;

-- The rule from the Tutor's side, at the commit of the transaction that gives
-- a row or brings one back into service (a role end taken back,
-- .claude/rules/database.md: a row back in service is checked again).
create function class_tutors_language() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  spoken text;
begin
  if not class_tutor_live(new.valid_from, new.valid_until) then
    return null;
  end if;
  select c.language into spoken from classes c where c.id = new.class_id;
  -- A class the transaction does not see is refused rather than passed.
  if spoken is null or not tutor_teaches_language(new.assignment_id, spoken) then
    raise exception 'tutor_language'
      using errcode = 'check_violation', constraint = 'class_tutors_language';
  end if;
  return null;
end;
$$;

create constraint trigger class_tutors_language
  after insert or update on class_tutors
  deferrable initially deferred
  for each row execute function class_tutors_language();

-- The rule from the class's side: a change of the language of a class with a
-- Tutor in force or planned who does not teach in it.
create function classes_tutor_language() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  spoken text;
begin
  select c.language into spoken from classes c where c.id = new.id;
  if exists (
    select 1 from class_tutors t
    where t.class_id = new.id
      and class_tutor_live(t.valid_from, t.valid_until)
      and not tutor_teaches_language(t.assignment_id, spoken)
  ) then
    raise exception 'tutor_language'
      using errcode = 'check_violation', constraint = 'class_tutors_language';
  end if;
  return null;
end;
$$;

create constraint trigger classes_tutor_language
  after update of language on classes
  deferrable initially deferred
  for each row
  when (new.language is distinct from old.language)
  execute function classes_tutor_language();

-- The rule from the staff record's side (decision 16, correction 5): a
-- language is removed only while no class the person tutors, now or planned,
-- in any branch, needs it.
create function staff_languages_tutor_held() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  found record;
begin
  select * into found from tutor_classes_of_language(old.staff_id, old.language);
  if cardinality(found.class_ids) > 0 or found.elsewhere > 0 then
    raise exception 'tutor_language_held'
      using errcode = 'check_violation', constraint = 'staff_languages_tutor_held';
  end if;
  return null;
end;
$$;

create constraint trigger staff_languages_tutor_held
  after delete on staff_languages
  deferrable initially deferred
  for each row execute function staff_languages_tutor_held();
