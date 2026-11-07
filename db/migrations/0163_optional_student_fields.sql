-- Date of birth and relatives of a student are optional (owner, 7 November 2026;
-- `docs/spec-changes.md`, `04` Student record and "Relatives are optional").
-- Numbered after 0162 of task 10.8, which merges first.
--
-- No row is changed: a column gives up its `not null`, and the guard of the
-- relatives keeps one rule of two.

alter table students alter column birth_date drop not null;

-- The guard of 0036 kept "at least one live link" and "exactly one live main
-- contact". The first rule is gone (Look first: a constraint removed because the
-- requirement changed): a student may have no relative, and the last one may be
-- unlinked. The second stays for a student who has relatives. The triggers of
-- 0036 call this function and stay as they are. Not SECURITY DEFINER, as before.
create or replace function student_relatives_guard() returns trigger
language plpgsql
as $$
declare
  record_id uuid;
  live bigint;
  main bigint;
begin
  if tg_table_name = 'students' then
    record_id := new.id;
  else
    record_id := new.student_id;
  end if;
  if not exists (select 1 from students where id = record_id) then
    return null;
  end if;
  select count(*), count(*) filter (where main_contact) into live, main
    from student_relatives
    where student_id = record_id and unlinked_at is null;
  if live > 0 and main <> 1 then
    raise exception 'student_main_contact'
      using errcode = 'check_violation', constraint = 'student_main_contact';
  end if;
  return null;
end
$$;

-- The duplicate warning across branches (`edge/students-classes-groups`): the
-- same name and date of birth, or the same name when either has no date of
-- birth (owner, 7 November 2026). `create or replace` keeps the owner and the
-- grants of 0032.
create or replace function student_duplicate_elsewhere(name_key text, birth_date date) returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.students s
    where s.name_key = student_duplicate_elsewhere.name_key
      and (
        s.birth_date is null
        or student_duplicate_elsewhere.birth_date is null
        or s.birth_date = student_duplicate_elsewhere.birth_date
      )
      and not (s.branch_id = any (public.app_branch_ids()))
  )
$$;
