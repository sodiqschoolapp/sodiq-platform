-- 0081 The journal record, created and closed at publish (task 5.5c-1, pull
-- request #155).
--
-- docs/spec/edge-cases/timetable.md, Versions and drafts: "Journals are
-- created and closed at publish. There is one journal per class or group and
-- subject in a year; adding a removed subject again reopens its journal."
-- docs/spec/edge-cases/developer-rules.md, One journal: "Unique on (class or
-- group, subject, academic year)." docs/spec/07-journal.md: "There is one
-- journal for each class or group and subject in an academic year."
--
-- The plan approved on pull request #155: decisions 3 to 8. No cells (6.1).

create table journals (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  academic_year_id uuid not null,
  class_id uuid,
  group_id uuid,
  subject_id uuid not null references subjects (id),
  -- Decision 3: the days on which the published chain's load has the class or
  -- group and subject, half-open, gaps kept; the last run has no upper bound
  -- while the latest published version has it (decision 10). Empty when no
  -- published run has it any more (decision 8). Written only by a publish.
  runs datemultirange not null,
  -- Bookkeeping only; no rule reads it.
  created_at timestamptz not null default now(),
  constraint journals_unit_check check ((class_id is null) <> (group_id is null)),
  constraint journals_year_fkey foreign key (academic_year_id, branch_id)
    references academic_years (id, branch_id),
  constraint journals_class_fkey foreign key (class_id, branch_id)
    references classes (id, branch_id),
  constraint journals_group_fkey foreign key (group_id, branch_id)
    references groups (id, branch_id),
  -- One journal (edge/developer-rules). Nulls stay distinct, and the unit
  -- check leaves exactly one of the two keys set.
  constraint journals_class_key unique (branch_id, class_id, subject_id, academic_year_id),
  constraint journals_group_key unique (branch_id, group_id, subject_id, academic_year_id),
  constraint journals_id_branch_key unique (id, branch_id)
);

alter table journals enable row level security;
create policy branch_filter on journals for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

-- No delete (CLAUDE.md, archive, do not delete; decision 8); the unit, the
-- subject and the year never change.
grant select on journals to sodiq_app;
grant insert (branch_id, academic_year_id, class_id, group_id, subject_id, runs)
  on journals to sodiq_app;
grant update (runs) on journals to sodiq_app;

-- The class's or group's year is the journal's, and a group's subject is the
-- journal's, as `lessons_check` (0058) holds a lesson. Runs as the invoker.
create function journals_check() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  unit_year uuid;
  group_subject uuid;
begin
  if (new.class_id is null) = (new.group_id is null) then
    -- `journals_unit_check` answers it.
    return new;
  end if;
  if new.class_id is not null then
    select c.academic_year_id into unit_year from classes c
      where c.id = new.class_id and c.branch_id = new.branch_id;
  elsif new.group_id is not null then
    select g.academic_year_id, g.subject_id into unit_year, group_subject from groups g
      where g.id = new.group_id and g.branch_id = new.branch_id;
  end if;
  if unit_year is not null and unit_year <> new.academic_year_id then
    raise exception 'journal_unit_year'
      using errcode = 'check_violation', constraint = 'journal_unit_year';
  end if;
  if new.group_id is not null and group_subject is distinct from new.subject_id then
    raise exception 'journal_group_subject'
      using errcode = 'check_violation', constraint = 'journal_group_subject';
  end if;
  return new;
end;
$$;

create trigger journals_check
  before insert on journals
  for each row execute function journals_check();
