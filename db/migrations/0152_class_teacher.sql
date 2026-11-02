-- 0152 The Class teacher (Sinf rahbari) of grades 0–4 (task 9.4e, pull
-- request #275; the owner's spec change of 1 November 2026, items 1 and 2).
--
-- docs/spec/02-roles-and-access.md, Class teacher: "Takes the Tutor's place
-- in a class of grades 0–4 … Has one own class at a time; an acting Class
-- teacher of another class has that class too for the period."
-- docs/spec/edge-cases/people-roles-accounts.md: "A class of grade 2 is given
-- a Tutor, or a class of grade 6 a Class teacher. Refused, not a warning".
-- docs/spec/edge-cases/00-definitions.md, Tutor of a class: every rule that
-- names the Tutor of a class applies in the same way to the Class teacher of
-- a class of grades 0–4. So the Class teacher's rows are `class_tutors` rows,
-- hanging off a `class_teacher` assignment, and every reader of those rows
-- (`class_tutor_on`, the language checks, the load rule of Tutor subjects,
-- `timetable_busy_elsewhere`) covers her unchanged.
-- Departments (`02`, Departments stay; `04`, Academic): "a teacher's subjects
-- come from one department, except subjects taught only in grades 0–4, which
-- may come from any department".
--
-- The plan approved on pull request #275 (the owner chose reading A of
-- decision 2): decisions 1 (Look first: three checks refuse less because the
-- requirement changed), 3, 4 and 5.
--
-- No row is changed or removed. The new column of `class_tutors` is nullable
-- with no default, so adding it writes no row; every replaced check is wider
-- than before, so every existing row holds it. The tables are small.

-- The 16 roles (ROLES of packages/shared/src/roles.ts; a test compares them).
alter table assignments drop constraint assignments_role_check;
alter table assignments add constraint assignments_role_check check (role in (
  'super_admin', 'principal', 'academic_vice_principal', 'spiritual_vice_principal',
  'head_tutor', 'tutor', 'class_teacher', 'senior_head_teacher', 'head_teacher', 'teacher',
  'student', 'parent', 'hr', 'nurse', 'psychologist', 'librarian'
));

alter table feedback_reports drop constraint feedback_reports_roles_check;
alter table feedback_reports add constraint feedback_reports_roles_check check (roles <@ array[
  'super_admin', 'principal', 'academic_vice_principal', 'spiritual_vice_principal',
  'head_tutor', 'tutor', 'class_teacher', 'senior_head_teacher', 'head_teacher', 'teacher',
  'student', 'parent', 'hr', 'nurse', 'psychologist', 'librarian'
]::text[]);

-- Decision 4: one own class at a time for a Class teacher, across branches.
-- The account of a row of kind `tutor` whose assignment is a Class teacher
-- one, written by class_tutors_fill only (no grant); null on every other row,
-- the rows written before this migration included. Keyed by the account, not
-- the assignment: one person may hold a Class teacher assignment in two
-- branches, and an exclusion sees every branch. Acting rows are outside it.
alter table class_tutors add column own_class_account uuid references accounts (id);

alter table class_tutors add constraint class_tutors_one_class exclude using gist (
  own_class_account with =,
  tstzrange(valid_from, valid_until) with &&
) where (own_class_account is not null);

create index class_tutors_own_class_account_idx on class_tutors (own_class_account)
  where own_class_account is not null;

-- The grades that take a Class teacher (CLASS_TEACHER_GRADES of
-- packages/shared/src/roles.ts): 0 to 4. A class of grades 5 to 11 takes a
-- Tutor.
create function own_class_role(grade smallint) returns text
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select case when grade <= 4 then 'class_teacher' else 'tutor' end
$$;

-- A new Tutor or Class teacher row (0042, decisions 8 and 9 of #88), with
-- decision 3: the assignment is a Tutor or a Class teacher one of the class's
-- branch (`class_tutors_not_tutor`, as before), and the role is the one of the
-- class's grade, for a main and an acting row alike
-- (`class_tutors_needs_class_teacher`, `class_tutors_needs_tutor`). The class
-- row is locked FOR SHARE before its grade is read, so a grade edit at the
-- same moment (which holds the class FOR UPDATE) waits or is waited for.
create or replace function class_tutors_fill() returns trigger
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
  select a.role, a.branch_id, a.account_id, a.valid_from, a.valid_until into given
    from assignments a where a.id = new.assignment_id;
  if not found then
    -- The foreign key answers it.
    return new;
  end if;
  if given.role not in ('tutor', 'class_teacher')
    or given.branch_id is distinct from new.branch_id then
    raise exception 'class_tutors_not_tutor'
      using errcode = 'check_violation', constraint = 'class_tutors_not_tutor';
  end if;
  select c.archived_at, c.academic_year_id, c.grade into held
    from classes c where c.id = new.class_id and c.branch_id = new.branch_id;
  if not found then
    -- The foreign key answers it.
    return new;
  end if;
  if held.archived_at is not null then
    raise exception 'class_tutors_class_archived'
      using errcode = 'check_violation', constraint = 'class_tutors_class_archived';
  end if;
  if given.role <> own_class_role(held.grade) then
    if given.role = 'tutor' then
      raise exception 'class_tutors_needs_class_teacher'
        using errcode = 'check_violation', constraint = 'class_tutors_needs_class_teacher';
    end if;
    raise exception 'class_tutors_needs_tutor'
      using errcode = 'check_violation', constraint = 'class_tutors_needs_tutor';
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
  -- Decision 4: the own class of a Class teacher (`class_tutors_one_class`).
  new.own_class_account := case
    when given.role = 'class_teacher' and new.kind = 'tutor' then given.account_id
  end;
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

-- Found by the spec-reviewer of the plan: the mirror of a role end (0042,
-- 0043) fired for Tutor assignments only, so a Class teacher's role end would
-- have left her rows in force (`edge/students-classes-groups`: "the earlier
-- one loses access on the end date").
drop trigger assignments_class_tutors_end on assignments;
create trigger assignments_class_tutors_end
  after update of valid_until on assignments
  for each row
  when (new.valid_until is distinct from old.valid_until
    and new.role in ('tutor', 'class_teacher'))
  execute function assignments_class_tutors_end();

-- Decision 5: a grade edit that moves a class between grades 0–4 and 5–11 is
-- refused while a row of the class is in force or planned whose role no
-- longer fits the new grade (`classes_grade_tutor_role`); the row is ended
-- first. A withdrawn row (an empty range) and an ended one do not count. The
-- class row is already locked by the update, and a give locks it FOR SHARE
-- first, so the two wait for each other. Runs as the invoker: the rows are of
-- the class's own branch.
create function classes_grade_tutor_guard() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  moment timestamptz := coalesce(
    nullif(current_setting('app.now', true), '')::timestamptz, '-infinity'::timestamptz
  );
begin
  if own_class_role(new.grade) = own_class_role(old.grade) then
    return new;
  end if;
  if exists (
    select 1
    from class_tutors t
    join assignments a on a.id = t.assignment_id
    where t.class_id = new.id
      and a.role <> own_class_role(new.grade)
      and (t.valid_until is null or (t.valid_until > t.valid_from and t.valid_until > moment))
  ) then
    raise exception 'classes_grade_tutor_role'
      using errcode = 'check_violation', constraint = 'classes_grade_tutor_role';
  end if;
  return new;
end;
$$;

create trigger classes_grade_tutor_guard
  before update of grade on classes
  for each row
  when (new.grade is distinct from old.grade)
  execute function classes_grade_tutor_guard();

-- `edge/people-roles-accounts`, who is an administrator: the Academic Vice
-- Principal also resets and locks Class teachers (VICE_REACHES of
-- apps/api/src/modules/people/account-reach.ts). As 0031 otherwise.
create or replace function password_reset_allowed(account_id uuid, at timestamptz)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.accounts a
    join public.staff s on s.account_id = a.id and s.kind = 'person'
    cross join lateral public.last_email_change(a.id) w
    where a.id = password_reset_allowed.account_id
      and a.locked_at is null
      and s.email is not null
      and s.email <> ''
      and not public.staff_account_blocked(a.id, password_reset_allowed.at)
      and (
        exists (
          select 1
          from public.assignments sa
          where sa.account_id = w.actor_id
            and sa.role = 'super_admin'
            and sa.valid_from <= w.occurred_at
            and (sa.valid_until is null or sa.valid_until > w.occurred_at)
        )
        or (
          not exists (
            select 1
            from public.assignments g
            where g.account_id = a.id
              and g.role not in ('teacher', 'tutor', 'class_teacher', 'head_teacher', 'head_tutor')
              and (
                g.valid_until is null
                or (g.valid_until > password_reset_allowed.at and g.valid_until > g.valid_from)
              )
          )
          and exists (
            select 1
            from public.assignments v
            join public.assignments g
              on g.account_id = a.id
              and g.branch_id = v.branch_id
              and (
                g.valid_until is null
                or (g.valid_until > password_reset_allowed.at and g.valid_until > g.valid_from)
              )
            where v.account_id = w.actor_id
              and v.role = 'academic_vice_principal'
              and v.valid_from <= password_reset_allowed.at
              and (v.valid_until is null or v.valid_until > password_reset_allowed.at)
          )
        )
      )
  )
$$;

-- The classes a teacher holds as Tutor or Class teacher in a language the
-- teacher no longer has (0042). As before, with the Class teacher's rows.
create or replace function tutor_classes_of_language(staff_id uuid, language text)
returns table (class_ids uuid[], elsewhere integer)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with held as (
    select distinct c.id, c.branch_id
    from public.staff s
    join public.assignments a on a.account_id = s.account_id
      and a.role in ('tutor', 'class_teacher')
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

-- Decision 1 (Look first): the grades taught of a subject row that keep it
-- outside the one-department rule: all within 0 to 4 (PRIMARY_GRADES of
-- packages/shared/src/grades.ts).
create function primary_grades_only(grades smallint[]) returns boolean
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select grades <@ array[0, 1, 2, 3, 4]::smallint[]
$$;

-- Decision 1 (Look first): the profile check of a staff record or a vacancy
-- (0024, as in force): `staff_subject_department` leaves out a subject row
-- whose grades taught are all within 0 to 4. As before otherwise.
create or replace function staff_profile_check()
 RETURNS trigger
 LANGUAGE plpgsql
AS $$
declare
  record_id uuid;
  record_kind text;
  academic_department uuid;
begin
  if tg_table_name = 'staff' then
    record_id := new.id;
  elsif tg_op = 'DELETE' then
    record_id := old.staff_id;
  else
    record_id := new.staff_id;
  end if;
  select kind into record_kind from staff where id = record_id;
  if not found then
    return null;
  end if;
  if (select count(*) from staff_divisions where staff_id = record_id and is_main) <> 1 then
    raise exception 'staff_main_division'
      using errcode = 'check_violation', constraint = 'staff_main_division';
  end if;
  if exists (
    select 1 from staff_divisions sd
    join divisions d on d.id = sd.division_id
    where sd.staff_id = record_id and d.built_in and sd.department_id is null
  ) then
    raise exception 'staff_department_required'
      using errcode = 'check_violation', constraint = 'staff_department_required';
  end if;
  if record_kind = 'vacancy' and exists (
    select 1 from staff_divisions sd
    join divisions d on d.id = sd.division_id
    where sd.staff_id = record_id and not d.built_in
  ) then
    raise exception 'staff_vacancy_division'
      using errcode = 'check_violation', constraint = 'staff_vacancy_division';
  end if;
  select sd.department_id into academic_department
    from staff_divisions sd
    join divisions d on d.id = sd.division_id
    where sd.staff_id = record_id and d.built_in;
  if exists (
    select 1 from staff_subjects ss
    join subjects s on s.id = ss.subject_id
    where ss.staff_id = record_id
      and s.department_id is distinct from academic_department
      and not primary_grades_only(ss.grades)
  ) then
    raise exception 'staff_subject_department'
      using errcode = 'check_violation', constraint = 'staff_subject_department';
  end if;
  if exists (
    select 1 from staff_subjects ss
    join subjects s on s.id = ss.subject_id
    where ss.staff_id = record_id and not (ss.grades <@ s.grades)
  ) then
    raise exception 'staff_subject_grades'
      using errcode = 'check_violation', constraint = 'staff_subject_grades';
  end if;
  if exists (select 1 from staff_subjects where staff_id = record_id)
    and not exists (select 1 from staff_languages where staff_id = record_id) then
    raise exception 'staff_languages_required'
      using errcode = 'check_violation', constraint = 'staff_languages_required';
  end if;
  return null;
end
$$;

-- The people of other branches whom a change of a subject's department or
-- grades would leave outside it (0024, as in force), with the same exception.
create or replace function staff_subject_in_use(subject_id uuid, grades smallint[], department_id uuid, at timestamp with time zone)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $$
  select count(distinct ss.staff_id)::integer
  from public.staff_subjects ss
  left join public.staff_divisions sd on sd.staff_id = ss.staff_id
    and sd.division_id = (select d.id from public.divisions d where d.built_in)
  where ss.subject_id = staff_subject_in_use.subject_id
    and not exists (
      select 1 from public.staff_branches b
      where b.staff_id = ss.staff_id and b.branch_id = any (public.app_branch_ids())
    )
    and not public.staff_out_for_good(ss.staff_id, staff_subject_in_use.at)
    and (
      not (ss.grades <@ staff_subject_in_use.grades)
      or (
        sd.department_id is distinct from staff_subject_in_use.department_id
        and not public.primary_grades_only(ss.grades)
      )
    )
$$;

-- The department move check of the teaching load (0057, as replaced by 0075),
-- with the exception of decision 1 (`edge/people-roles-accounts`: "except a
-- row of a class or group of grades 0–4"). As 0075 otherwise.
create or replace function department_move_loads(branch_ref uuid, teacher_ref uuid, subject_ref uuid, department_ref uuid, starts_on date)
 RETURNS TABLE(row_id uuid, version_id uuid, branch_id uuid, rows integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $$
declare
  today_moment timestamptz;
begin
  if not (department_move_loads.branch_ref = any (public.app_branch_ids())) then
    raise exception 'department_move_branch'
      using errcode = 'check_violation', constraint = 'department_move_branch';
  end if;
  if (department_move_loads.teacher_ref is null) = (department_move_loads.subject_ref is null)
    or department_move_loads.starts_on is null
    or (department_move_loads.subject_ref is not null and department_move_loads.department_ref is null)
  then
    raise exception 'department_move_input'
      using errcode = 'check_violation', constraint = 'department_move_input';
  end if;
  if department_move_loads.teacher_ref is not null and not exists (
    select 1 from public.staff_branches b
    where b.staff_id = department_move_loads.teacher_ref
      and b.branch_id = department_move_loads.branch_ref
  ) then
    raise exception 'department_move_branch'
      using errcode = 'check_violation', constraint = 'department_move_branch';
  end if;
  today_moment := public.class_tutors_moment();
  if today_moment is null then
    raise exception 'department_move_needs_moment'
      using errcode = 'check_violation', constraint = 'department_move_needs_moment';
  end if;

  return query
    with counted as (
      select r.id, r.version_id, r.branch_id, r.class_id, r.group_id, r.teacher_id, v.starts_on as version_start,
        case when department_move_loads.subject_ref is not null
          then department_move_loads.department_ref else s.department_id end as subject_department,
        case when department_move_loads.teacher_ref is not null
          then department_move_loads.department_ref
          else (
            select sd.department_id from public.staff_divisions sd
            join public.divisions d on d.id = sd.division_id
            where sd.staff_id = r.teacher_id and d.built_in
          ) end as teacher_department
      from public.teaching_load_rows r
      join public.timetable_versions v on v.id = r.version_id
      join public.academic_years y on y.id = v.academic_year_id
      join public.subjects s on s.id = r.subject_id
      where v.status <> 'archived'
        and y.status <> 'closed'
        and y.end_date >= department_move_loads.starts_on
        and (department_move_loads.teacher_ref is null or r.teacher_id = department_move_loads.teacher_ref)
        and (department_move_loads.subject_ref is null or r.subject_id = department_move_loads.subject_ref)
        and not (
          v.status = 'published'
          and exists (
            select 1 from public.timetable_versions later
            where later.branch_id = v.branch_id
              and later.academic_year_id = v.academic_year_id
              and later.status = 'published'
              and (later.starts_on > v.starts_on
                or (later.starts_on = v.starts_on and later.number > v.number))
              and later.starts_on <= department_move_loads.starts_on
          )
        )
    ),
    outside as (
      select c.* from counted c
      where c.subject_department is distinct from c.teacher_department
        -- 0152, decision 1: a row of a class of grades 0–4, or of a group whose
        -- every class is of grades 0–4, is not outside the department.
        and not (
          (c.class_id is not null and exists (
            select 1 from public.classes k where k.id = c.class_id and k.grade <= 4
          ))
          or (c.group_id is not null
            and exists (select 1 from public.group_classes gc where gc.group_id = c.group_id)
            and not exists (
              select 1 from public.group_classes gc
              join public.classes k on k.id = gc.class_id
              where gc.group_id = c.group_id and k.grade > 4
            ))
        )
        and not (
          c.class_id is not null
          and exists (
            select 1 from public.departments dep
            where dep.id = c.subject_department and dep.tutors
          )
          and public.class_tutor_on(
            c.class_id,
            (
              select greatest(
                c.version_start,
                department_move_loads.starts_on,
                (today_moment at time zone br.time_zone)::date
              )
              from public.branches br
              where br.id = c.branch_id
            )
          ) is not distinct from c.teacher_id
        )
    )
    select o.id, o.version_id, o.branch_id, 1
      from outside o where o.branch_id = department_move_loads.branch_ref
    union all
    select null::uuid, null::uuid, o.branch_id, count(*)::integer
      from outside o where o.branch_id <> department_move_loads.branch_ref
      group by o.branch_id;
end;
$$;
