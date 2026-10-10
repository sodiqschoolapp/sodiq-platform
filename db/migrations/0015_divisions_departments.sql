-- 0015 Divisions and departments (task 1.2).
--
-- docs/spec/03-school-setup.md, Divisions: "A division is the top-level unit a
-- staff member is employed in. The school has eight (decided)." "One list.
-- Divisions are the same in every branch." "Academic is built in. It cannot be
-- renamed or archived." "Other divisions are data. The Super Admin adds,
-- renames and archives them." "Names. Each division and department has a name
-- in three languages." Department (kafedra): "A department groups subjects and
-- teachers ... Other divisions may have departments too; there they are only
-- groupings." docs/spec/15-conflicts-resolved.md: "Departments are editable."
--
-- Both tables are school-wide (no branch, no filter): one list for the whole
-- school, decided by the owner (pull request #40, answer 3). The missing names
-- (Russian division names, Uzbek and Russian department names) are the owner's
-- starting values (answer 2); the Super Admin corrects them in the app, except
-- Academic's, which the trigger below fixes. The order of the lists is an
-- explicit position (the owner's correction): rows of one migration share one
-- created_at. The name bound of 100 follows 1.1.

create table divisions (
  id uuid primary key default uuidv7(),
  name_uz text not null constraint divisions_name_uz_check check (
    length(btrim(name_uz)) between 1 and 100
  ),
  name_ru text not null constraint divisions_name_ru_check check (
    length(btrim(name_ru)) between 1 and 100
  ),
  name_en text not null constraint divisions_name_en_check check (
    length(btrim(name_en)) between 1 and 100
  ),
  -- Academic. The application can neither write nor change this column.
  built_in boolean not null default false,
  -- The order of the list. A new division takes the greatest position of every
  -- row, archived ones included, plus one, so a restored division never meets
  -- a newer one on its position.
  position smallint not null constraint divisions_position_check check (position >= 1),
  -- From the injected clock; empty while active. Archived, never deleted (CLAUDE.md).
  archived_at timestamptz,
  -- Bookkeeping only; no rule reads it.
  created_at timestamptz not null default now()
);

-- Two active divisions of one name in any language would be indistinguishable
-- in that language's list; an archived one keeps its names and is restored
-- while no active one has them (decided by the owner, answer 6).
create unique index divisions_active_name_uz_idx
  on divisions (lower(btrim(name_uz))) where archived_at is null;
create unique index divisions_active_name_ru_idx
  on divisions (lower(btrim(name_ru))) where archived_at is null;
create unique index divisions_active_name_en_idx
  on divisions (lower(btrim(name_en))) where archived_at is null;
create unique index divisions_active_position_idx
  on divisions (position) where archived_at is null;

-- "Academic is built in. It cannot be renamed or archived, because departments,
-- subjects and the teaching load depend on it." The database keeps the rule
-- for every user, the migrator included: a later migration that must change
-- a name of Academic disables the trigger for its statement. Not SECURITY
-- DEFINER: it runs with the rights of the caller.
create function divisions_built_in_guard() returns trigger
language plpgsql
as $$
begin
  if old.built_in and (
    new.name_uz is distinct from old.name_uz
    or new.name_ru is distinct from old.name_ru
    or new.name_en is distinct from old.name_en
    or new.archived_at is distinct from old.archived_at
    or new.built_in is distinct from old.built_in
  ) then
    raise exception 'built_in_division' using errcode = 'restrict_violation';
  end if;
  return new;
end
$$;

create trigger divisions_built_in_guard
  before update on divisions
  for each row execute function divisions_built_in_guard();

-- The Super Admin adds, renames, archives and restores; nothing removes a
-- division, and the application never writes built_in.
grant select on divisions to sodiq_app;
grant insert (name_uz, name_ru, name_en, position) on divisions to sodiq_app;
grant update (name_uz, name_ru, name_en, archived_at) on divisions to sodiq_app;

create table departments (
  id uuid primary key default uuidv7(),
  division_id uuid not null references divisions (id),
  name_uz text not null constraint departments_name_uz_check check (
    length(btrim(name_uz)) between 1 and 100
  ),
  name_ru text not null constraint departments_name_ru_check check (
    length(btrim(name_ru)) between 1 and 100
  ),
  name_en text not null constraint departments_name_en_check check (
    length(btrim(name_en)) between 1 and 100
  ),
  -- The order inside the division, as for divisions.
  position smallint not null constraint departments_position_check check (position >= 1),
  archived_at timestamptz,
  created_at timestamptz not null default now()
);

-- Two active departments of one name in a division would be indistinguishable.
create unique index departments_active_name_uz_idx
  on departments (division_id, lower(btrim(name_uz))) where archived_at is null;
create unique index departments_active_name_ru_idx
  on departments (division_id, lower(btrim(name_ru))) where archived_at is null;
create unique index departments_active_name_en_idx
  on departments (division_id, lower(btrim(name_en))) where archived_at is null;
create unique index departments_active_position_idx
  on departments (division_id, position) where archived_at is null;

create index departments_division_idx on departments (division_id);

-- A department stays in its division (decided by the owner, answer 4).
grant select on departments to sodiq_app;
grant insert (division_id, name_uz, name_ru, name_en, position) on departments to sodiq_app;
grant update (name_uz, name_ru, name_en, archived_at) on departments to sodiq_app;

-- The eight divisions of `03`, one insert each in the order of its table.
-- Uzbek oʻ and gʻ are written with U+02BB, as the locale files write them,
-- so that typed and seeded names compare alike (answer 2).
insert into divisions (name_uz, name_ru, name_en, built_in, position)
  values ('Oʻquv boʻlimi', 'Учебный отдел', 'Academic', true, 1);
insert into divisions (name_uz, name_ru, name_en, position)
  values ('Rahbariyat', 'Руководство', 'Management', 2);
insert into divisions (name_uz, name_ru, name_en, position)
  values ('Oʻquvchilarga xizmat koʻrsatish boʻlimi', 'Отдел по работе с учащимися', 'Student Services', 3);
insert into divisions (name_uz, name_ru, name_en, position)
  values ('Qabul va marketing boʻlimi', 'Отдел приёма и маркетинга', 'Admissions and Marketing', 4);
insert into divisions (name_uz, name_ru, name_en, position)
  values ('Moliya boʻlimi', 'Финансовый отдел', 'Finance', 5);
insert into divisions (name_uz, name_ru, name_en, position)
  values ('Kadrlar boʻlimi', 'Отдел кадров', 'HR', 6);
insert into divisions (name_uz, name_ru, name_en, position)
  values ('Axborot texnologiyalari boʻlimi', 'Отдел информационных технологий', 'IT', 7);
insert into divisions (name_uz, name_ru, name_en, position)
  values ('Xoʻjalik boʻlimi', 'Хозяйственный отдел', 'Operations', 8);

-- The departments of the Departments column of `03`, in its order. The Tutors
-- department is "Tyutorlar", as the owner keeps "Tyutor" in Uzbek (10 October 2026).
insert into departments (division_id, name_uz, name_ru, name_en, position)
  select id, 'STEAM', 'STEAM', 'STEAM', 1 from divisions where name_en = 'Academic';
insert into departments (division_id, name_uz, name_ru, name_en, position)
  select id, 'Xorijiy tillar', 'Иностранные языки', 'Foreign languages', 2 from divisions where name_en = 'Academic';
insert into departments (division_id, name_uz, name_ru, name_en, position)
  select id, 'Milliy fanlar', 'Национальные предметы', 'National', 3 from divisions where name_en = 'Academic';
insert into departments (division_id, name_uz, name_ru, name_en, position)
  select id, 'Tabiiy fanlar', 'Естественные науки', 'Natural sciences', 4 from divisions where name_en = 'Academic';
insert into departments (division_id, name_uz, name_ru, name_en, position)
  select id, 'Umumiy fanlar', 'Общие предметы', 'General', 5 from divisions where name_en = 'Academic';
insert into departments (division_id, name_uz, name_ru, name_en, position)
  select id, 'Tyutorlar', 'Тьюторы', 'Tutors', 6 from divisions where name_en = 'Academic';
insert into departments (division_id, name_uz, name_ru, name_en, position)
  select id, 'Tibbiyot', 'Медицина', 'Medical', 1 from divisions where name_en = 'Student Services';
insert into departments (division_id, name_uz, name_ru, name_en, position)
  select id, 'Psixologiya', 'Психология', 'Psychology', 2 from divisions where name_en = 'Student Services';
insert into departments (division_id, name_uz, name_ru, name_en, position)
  select id, 'Kutubxona', 'Библиотека', 'Library', 3 from divisions where name_en = 'Student Services';
insert into departments (division_id, name_uz, name_ru, name_en, position)
  select id, 'Toʻgaraklar va tadbirlar', 'Кружки и мероприятия', 'Clubs and events', 4 from divisions where name_en = 'Student Services';
insert into departments (division_id, name_uz, name_ru, name_en, position)
  select id, 'Xoʻjalik xizmati', 'Хозяйственная служба', 'Facilities', 1 from divisions where name_en = 'Operations';
insert into departments (division_id, name_uz, name_ru, name_en, position)
  select id, 'Oshxona', 'Питание', 'Catering', 2 from divisions where name_en = 'Operations';
insert into departments (division_id, name_uz, name_ru, name_en, position)
  select id, 'Xavfsizlik', 'Охрана', 'Security', 3 from divisions where name_en = 'Operations';
insert into departments (division_id, name_uz, name_ru, name_en, position)
  select id, 'Transport', 'Транспорт', 'Transport', 4 from divisions where name_en = 'Operations';
