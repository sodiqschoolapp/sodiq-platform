-- 0166 Date of birth, phone and admission date of a staff member are optional
-- (owner, 7 November 2026; `docs/spec-changes.md`, `04` Teacher and staff
-- record, `edge/people-roles-accounts`). Numbered after 0164 and 0165 of task
-- 11.7 (pull request #306), which merges first.
--
-- No row is changed: a check gives up three conditions, and the duplicate
-- warning across branches matches the name alone when a side has no date.

-- The check of 0024 without `birth_date`, `phone` and `admission_date` (Look
-- first: a constraint weakened because the requirement changed). Every other
-- condition stays: a person still has a staff ID, a name, a sex and no
-- vacancy name. `staff_vacancy_check` (0026) is not touched. `staff` is small
-- and the migration runs in one transaction; the new check holds for every
-- row, which met the stricter one.
alter table staff drop constraint staff_person_check;
alter table staff add constraint staff_person_check check (
  kind <> 'person' or (
    staff_id is not null and first_name is not null and last_name is not null
    and sex is not null and vacancy_name is null
  )
);

-- The duplicate warning of `edge/people-roles-accounts` (re-hire row): the
-- same name and date of birth, or the same name when either record has no
-- date of birth (owner, 7 November 2026, as for students in 0163). The
-- signature of 0024 stays (the phone argument is not read since 0063);
-- `create or replace` keeps the owner and the grants.
create or replace function staff_duplicate_elsewhere(
  first_name text, last_name text, birth_date date, phone text
) returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.staff s
    where s.kind = 'person'
      and not exists (
        select 1 from public.staff_branches b
        where b.staff_id = s.id and b.branch_id = any (public.app_branch_ids())
      )
      and lower(s.first_name) = lower(staff_duplicate_elsewhere.first_name)
      and lower(s.last_name) = lower(staff_duplicate_elsewhere.last_name)
      and (
        s.birth_date is null
        or staff_duplicate_elsewhere.birth_date is null
        or s.birth_date = staff_duplicate_elsewhere.birth_date
      )
  )
$$;
