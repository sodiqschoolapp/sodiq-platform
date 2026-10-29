-- 0142 The hidden Monitoring branch (task 10.2b, pull request #261).
--
-- Decided ahead for Phase 10, answer 10: "The sign-in-and-save check every 5
-- minutes runs in a hidden 'Monitoring' branch with one class, one test teacher
-- and invented students, left out of every school report; the Super Admin sees
-- it in the branch switcher as 'Monitoring'." The owner's answer of 29 October
-- 2026 on #261: only the Super Admin sees it.
--
-- No existing row changes: a nullable column with no default and no backfill,
-- grants narrowed to the columns the application writes, and two functions
-- replaced.

-- ---------------------------------------------------------------------------
-- The mark. At most one branch has it; nothing removes it.

alter table branches
  add column purpose text constraint branches_purpose_check check (purpose = 'monitoring');

create unique index branches_purpose_idx on branches (purpose) where purpose is not null;

-- `sodiq_app` inserted into every column (0014); from now on only the columns
-- the branch create writes, so the mark is never typed (plan review of #261,
-- correction 1). `update` is already a column list (0014, 0016) without it.
revoke insert on branches from sodiq_app;
grant insert (name, address, phone, email, working_weekdays) on branches to sodiq_app;

-- The command of the owner (`monitoring-branch`, apps/api/src/monitoring/)
-- marks the branch it has just created, and only such a branch: one that holds
-- no building, class, staff member, student, role or year yet. A real branch is
-- never marked.
create function monitoring_branch_mark(branch_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
begin
  if exists (select 1 from public.branches b where b.purpose = 'monitoring') then
    raise exception 'a Monitoring branch exists already'
      using errcode = '23505', constraint = 'branches_purpose_idx';
  end if;
  if exists (select 1 from public.buildings x where x.branch_id = monitoring_branch_mark.branch_id)
    or exists (select 1 from public.classes x where x.branch_id = monitoring_branch_mark.branch_id)
    or exists (
      select 1 from public.staff_branches x where x.branch_id = monitoring_branch_mark.branch_id
    )
    or exists (
      select 1 from public.academic_years x where x.branch_id = monitoring_branch_mark.branch_id
    )
    or exists (select 1 from public.students x where x.branch_id = monitoring_branch_mark.branch_id)
    or exists (
      select 1 from public.assignments x where x.branch_id = monitoring_branch_mark.branch_id
    )
  then
    raise exception 'only a new, empty branch is marked as the Monitoring branch'
      using errcode = '23514', constraint = 'monitoring_branch_mark_empty';
  end if;
  update public.branches b set purpose = 'monitoring'
  where b.id = monitoring_branch_mark.branch_id;
  if not found then
    raise exception 'no such branch' using errcode = '23503';
  end if;
end
$$;

revoke execute on function monitoring_branch_mark(uuid) from public;
grant execute on function monitoring_branch_mark(uuid) to sodiq_app;

-- ---------------------------------------------------------------------------
-- The Super Admin's banner of branches without an Academic Vice Principal
-- (0029) leaves the Monitoring branch out: it never has one.

create or replace function branches_without_vice_principal(at timestamptz)
returns table (id uuid, name text)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select br.id, br.name
  from public.branches br
  where br.purpose is null
    and not exists (
      select 1
      from public.assignments a
      join public.accounts ac on ac.id = a.account_id
      where a.role = 'academic_vice_principal'
        and a.branch_id = br.id
        and a.valid_from <= branches_without_vice_principal.at
        and (a.valid_until is null or a.valid_until > branches_without_vice_principal.at)
        and ac.locked_at is null
        and not public.staff_account_blocked(a.account_id, branches_without_vice_principal.at)
    )
  order by br.name, br.id
$$;

-- ---------------------------------------------------------------------------
-- The staff counts of the Divisions page (0024) leave out the people who work
-- in the Monitoring branch only (its test teacher). `staff_in_division`, the
-- guard against archiving a division that still has people, is not changed:
-- a guard keeps counting every row.

create or replace function staff_count_by_division(at timestamptz)
returns table (division_id uuid, people integer)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select sd.division_id, count(*)::integer
  from public.staff_divisions sd
  join public.staff s on s.id = sd.staff_id
  where sd.is_main and s.kind = 'person'
    and not public.staff_out_on(s.id, staff_count_by_division.at)
    and not (
      exists (select 1 from public.staff_branches b where b.staff_id = s.id)
      and not exists (
        select 1
        from public.staff_branches b
        join public.branches br on br.id = b.branch_id
        where b.staff_id = s.id and br.purpose is null
      )
    )
  group by sd.division_id
$$;
