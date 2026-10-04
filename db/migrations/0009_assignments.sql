-- 0009 Roles and assignments (task 0.7a).
--
-- docs/spec/02-roles-and-access.md: 15 user types; one person has one account
-- and can hold several roles; every role is limited to a branch, and only the
-- Super Admin and the Senior Head Teacher work across branches.
-- docs/spec/edge-cases/people-roles-accounts.md, "Who can act": rights are
-- assignments: person, role, branch, and where needed subjects or a class, with
-- dates; a Senior Head Teacher's assignment has subjects and no branch.
--
-- An assignment belongs to an account: the person or staff record comes with
-- task 2.2. Subject scope is added in 2.3 and class scope in 3.1.
--
-- The table is school-wide: the rows of the Super Admin and the Senior Head
-- Teacher have no branch, and the roles of an account are read on every
-- request, before any branch is known.

-- "The same account, role and branch" combined with "overlapping time" needs
-- this. Migration 0001 created it; named again here because this is the first
-- constraint that uses it.
create extension if not exists btree_gist;

create table assignments (
  id uuid primary key default uuidv7(),
  account_id uuid not null references accounts (id),
  -- The same names as ROLES in packages/shared; a test compares the two.
  role text not null constraint assignments_role_check check (
    role in (
      'super_admin', 'principal', 'academic_vice_principal', 'spiritual_vice_principal',
      'head_tutor', 'tutor', 'senior_head_teacher', 'head_teacher', 'teacher', 'student',
      'parent', 'hr', 'nurse', 'psychologist', 'librarian'
    )
  ),
  branch_id uuid references branches (id),
  -- Stored moments, from the injected clock, compared with the clock on each
  -- request: the assignment is in force from `valid_from` until just before
  -- `valid_until`; without an end it is in force until somebody ends it.
  valid_from timestamptz not null,
  valid_until timestamptz,
  -- From the injected clock: when the row was written, which can be before
  -- `valid_from`.
  created_at timestamptz not null,
  -- The account that gave the assignment; empty for the first-account command.
  given_by uuid references accounts (id),
  -- The account that ended it; empty while it has no end, and for the system.
  ended_by uuid references accounts (id),
  -- An end at the start is an assignment that was never in force (given for a
  -- later day and taken back).
  constraint assignments_valid_range_check check (valid_until is null or valid_until >= valid_from),
  -- No branch for exactly the two roles that work across branches.
  constraint assignments_branch_check check (
    (branch_id is null) = (role in ('super_admin', 'senior_head_teacher'))
  ),
  constraint assignments_ended_by_check check (ended_by is null or valid_until is not null),
  -- One account holds one role in one branch once at any moment. The time is
  -- half-open: an assignment that begins at the moment another ends follows it.
  constraint assignments_no_overlap exclude using gist (
    account_id with =,
    role with =,
    (coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid)) with =,
    tstzrange(valid_from, valid_until) with &&
  )
);

-- "The assignments of this account", read on every request.
create index assignments_account_idx on assignments (account_id);

-- An assignment is ended, never removed; who holds which role where, and from
-- when, cannot be changed afterwards.
grant select, insert on assignments to sodiq_app;
grant update (valid_until, ended_by) on assignments to sodiq_app;
