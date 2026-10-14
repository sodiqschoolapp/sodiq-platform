-- 0043 Withdrawn and archived Tutor rows stay ended; class names of plain
-- characters (task 3.1a, pull request #88, spec review of the build).
--
-- Plan decisions 2 and 10 as confirmed: "rows ended by the Academic Vice
-- Principal or by an archive stay ended"; "a restore gives none back".
-- .claude/rules/database.md: a row brought back into service is checked
-- again for every rule its waiver skipped.

-- The mirror of a role end (0042), again, with two changes:
-- - the end set or moved earlier rewrites only rows in force or planned: a
--   withdrawn row (an empty range) keeps its cause, so a later taking back of
--   the role end never reaches it;
-- - the end moved later or emptied brings back only rows of a class that is
--   not archived, in a year that is not closed; the others stay as they are.
create or replace function assignments_class_tutors_end() returns trigger
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
        and (
          t.valid_until is null
          or (
            t.valid_until > t.valid_from
            and t.valid_until > new.valid_until
            and t.valid_until > moment
          )
        );
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
        join public.classes c on c.id = t2.class_id
        join public.academic_years y on y.id = c.academic_year_id
        where t2.assignment_id = new.id
          and t2.end_cause = 'role'
          and c.archived_at is null
          and y.status <> 'closed'
      ) ends
      where t.id = ends.id;
  end if;
  return null;
end;
$$;

-- An end written by the application (0042), again: a withdrawn row (an empty
-- range) is final as an end that has passed is.
create or replace function class_tutors_end_guard() returns trigger
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
  if old.valid_until is not null
    and (old.valid_until <= moment or old.valid_until <= old.valid_from) then
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

-- A class name is letters, digits, spaces, hyphens and the Uzbek apostrophes,
-- beginning with a letter (decision 17), so that the fold of the database and
-- the fold of packages/shared see the same white space (spec review of the
-- build, should-fix 3). No class exists before this task is merged.
alter table classes drop constraint classes_name_check;
alter table classes add constraint classes_name_check check (
  length(btrim(name)) between 2 and 40
  and btrim(name) ~ '^[[:alpha:]][[:alpha:][:digit:] ''ʻʼ-]*$'
);
