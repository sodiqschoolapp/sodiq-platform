-- 0096 Teacher absences (task 5.7a-1, pull request #185, decisions 2, 3, 5
-- and 12).
--
-- docs/spec/06-timetable.md, Teachers who work in several branches:
-- "Absence. An absence is entered once for the person and covers every
-- branch. Each branch's Academic Vice Principal gets the list of own affected
-- lessons and arranges substitutes; the other is told."
-- docs/spec/edge-cases/timetable.md, After publishing: "An absence record has
-- a start and an end, or is open-ended. All lessons in the range go to 'needs
-- a teacher'. ... Shortening the absence returns future lessons to the
-- teacher." and "The lesson time passes and nobody was assigned. The lesson
-- stays 'unresolved' ... until it is cancelled with a reason or the person who
-- taught it is recorded."
--
-- An absence writes no lesson: a lesson keeps its teacher, and its state is
-- read from the stored moments on every request (decision 7). The days typed
-- are kept for the screen; the rule compares `applies_from` and
-- `applies_until`, written from the injected clock (decision 5): an absence
-- entered today starts at the save moment, and one ended "yesterday" ends at
-- the save moment, so no save changes the state of a lesson that has started.

-- School-wide by membership, as `staff_statuses` (0024; decision 2, Look
-- first): the Academic Vice Principal of every branch of the person reads it.
create table absences (
  id uuid primary key default uuidv7(),
  staff_id uuid not null references staff (id),
  starts_on date not null,
  -- Null: open-ended.
  ends_on date,
  applies_from timestamptz not null,
  -- Null: open-ended.
  applies_until timestamptz,
  reason text not null constraint absences_reason_check check (
    length(btrim(reason)) between 1 and 500
  ),
  withdrawn_at timestamptz,
  created_by uuid not null references accounts (id),
  -- Bookkeeping only; no rule reads it.
  created_at timestamptz not null default now(),
  constraint absences_days_check check (ends_on is null or ends_on >= starts_on),
  constraint absences_moments_check check (
    applies_until is null or applies_until > applies_from
  ),
  constraint absences_open_check check ((ends_on is null) = (applies_until is null)),
  -- Two live absences of one person never overlap.
  constraint absences_no_overlap exclude using gist (
    staff_id with =,
    tstzrange(applies_from, applies_until) with &&
  ) where (withdrawn_at is null)
);

alter table absences enable row level security;
create policy staff_membership on absences for all to sodiq_app
  using (exists (select 1 from staff_branches b where b.staff_id = absences.staff_id))
  with check (exists (select 1 from staff_branches b where b.staff_id = absences.staff_id));

grant select, insert (
  staff_id, starts_on, ends_on, applies_from, applies_until, reason, created_by
) on absences to sodiq_app;
grant update (starts_on, ends_on, applies_from, applies_until, withdrawn_at) on absences
  to sodiq_app;

-- Decision 12: the absent person taught this lesson after all, recorded by
-- the correction of kind `teacher` with the same person. Insert only.
create table lesson_absence_taught (
  branch_id uuid not null references branches (id),
  lesson_id uuid not null,
  recorded_by uuid not null references accounts (id),
  recorded_at timestamptz not null,
  constraint lesson_absence_taught_pkey primary key (lesson_id),
  constraint lesson_absence_taught_lesson_fkey foreign key (lesson_id, branch_id)
    references lessons (id, branch_id)
);

alter table lesson_absence_taught enable row level security;
create policy branch_filter on lesson_absence_taught for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select, insert (branch_id, lesson_id, recorded_by, recorded_at)
  on lesson_absence_taught to sodiq_app;

-- The live absences of the persons named that meet [range_from, range_until)
-- (null: no end), ids and moments only, past the membership filter (decision
-- 3, Look first): a branch whose link to the person was removed while it
-- still holds the person's lessons reads the same state as every other.
create function absences_of_teachers(
  staff_ids uuid[], range_from timestamptz, range_until timestamptz
)
returns table (
  staff_id uuid, absence_id uuid, applies_from timestamptz, applies_until timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select a.staff_id, a.id, a.applies_from, a.applies_until
  from public.absences a
  where a.staff_id = any (absences_of_teachers.staff_ids)
    and a.withdrawn_at is null
    and (absences_of_teachers.range_until is null
      or a.applies_from < absences_of_teachers.range_until)
    and (a.applies_until is null or a.applies_until > absences_of_teachers.range_from)
  order by a.staff_id, a.applies_from
$$;

revoke execute on function absences_of_teachers(uuid[], timestamptz, timestamptz) from public;
grant execute on function absences_of_teachers(uuid[], timestamptz, timestamptz) to sodiq_app;

-- The accounts of the current Academic Vice Principals of every branch linked
-- to a person the transaction sees, or holding a lesson of the person that
-- starts in [range_from, range_until), ids only (decision 3, Look first; as
-- `relative_notice_accounts`, 0037). Nothing for a person the transaction
-- does not see.
create function absence_notice_accounts(
  staff_id uuid, range_from timestamptz, range_until timestamptz
)
returns table (branch_id uuid, account_id uuid)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  moment timestamptz := nullif(current_setting('app.now', true), '')::timestamptz;
begin
  if not exists (
    select 1 from public.staff_branches b
    where b.staff_id = absence_notice_accounts.staff_id
      and b.branch_id = any (public.app_branch_ids())
  ) then
    return;
  end if;
  return query
    with branches_of as (
      select b.branch_id from public.staff_branches b
      where b.staff_id = absence_notice_accounts.staff_id
      union
      select l.branch_id from public.lessons l
      where l.teacher_id = absence_notice_accounts.staff_id
        and l.starts_at >= absence_notice_accounts.range_from
        and (absence_notice_accounts.range_until is null
          or l.starts_at < absence_notice_accounts.range_until)
    )
    select distinct a.branch_id, a.account_id
    from branches_of o
    join public.assignments a
      on a.branch_id = o.branch_id and a.role = 'academic_vice_principal'
    where a.valid_from <= moment
      and (a.valid_until is null or a.valid_until > moment)
    order by 1, 2;
end
$$;

revoke execute on function absence_notice_accounts(uuid, timestamptz, timestamptz) from public;
grant execute on function absence_notice_accounts(uuid, timestamptz, timestamptz) to sodiq_app;
