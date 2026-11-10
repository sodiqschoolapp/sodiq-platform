-- 0168 Rating exams in grades 2–11, no setting and no distribution of grades 0–4 (the owner's
-- spec change of 10 November 2026, `docs/spec-changes.md`).
--
-- docs/spec/edge-cases/00-definitions.md, Rating journal: "A journal of a rating subject (one
-- whose rating exam switch is on) in grades 2–11. A journal of grades 0 and 1 of a rating
-- subject has no rating exam column; its quarter result uses the subject's quarterly
-- distribution with the rating exam left out, the other weights scaled up (rule 7)."
-- docs/spec/05-classes-groups-subjects.md, Group: "a group of grades 1 and 2 in a rating
-- subject is refused."
--
-- The setting "Rating exams in grades 0–4" (0153) and the distribution without the rating exam
-- are no longer read. Their tables stay as they are, with every row: nothing is changed or
-- removed (stop-list item 3); the application only loses the rights to write them.
--
-- Production held no rating entries in journals of grades 0–4 when this was written (the owner,
-- 10 November 2026). The migration still checks, before it changes anything, that no stored data
-- reads differently under the new rule, and stops with the reason when some does: the deploy then
-- fails and the running version stays.

-- ---------------------------------------------------------------------------
-- The new rule: a class, or a group by the classes it draws from, whose every grade is 2 or more.
-- Run as the invoker: the branch filter applies.

create function unit_rating_grades(class_ref uuid, group_ref uuid) returns boolean
language sql
stable
set search_path = pg_catalog, public
as $$
  select coalesce(bool_and(c.grade >= 2), false)
  from classes c
  where (class_ref is not null and c.id = class_ref)
    or (
      class_ref is null
      and c.id in (select gc.class_id from group_classes gc where gc.group_id = group_ref)
    )
$$;

grant execute on function unit_rating_grades(uuid, uuid) to sodiq_app;

create function journal_rating_grades(journal_ref uuid) returns boolean
language sql
stable
set search_path = pg_catalog, public
as $$
  select coalesce(
    (select unit_rating_grades(j.class_id, j.group_id) from journals j where j.id = journal_ref),
    false
  )
$$;

grant execute on function journal_rating_grades(uuid) to sodiq_app;

-- Whether the active group draws from a class of grade 0 or 1 and a class of grade 2 or more: one
-- journal that would hold students with and without the rating exam. A group joins at most two
-- grades (`group_grades`); grades 1 and 2 are the case the spec names (`05`, Group), 0 and 2 or 1
-- and 3 the same in effect (decided without the owner, 10 November 2026).
create function group_spans_rating_grades(group_ref uuid) returns boolean
language sql
stable
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from group_classes gc join classes c on c.id = gc.class_id
    where gc.group_id = group_ref and c.grade < 2
  ) and exists (
    select 1 from group_classes gc join classes c on c.id = gc.class_id
    where gc.group_id = group_ref and c.grade >= 2
  )
$$;

grant execute on function group_spans_rating_grades(uuid) to sodiq_app;

-- ---------------------------------------------------------------------------
-- The check before any change. Run as the migration's owner, so every branch is read.

do $$
declare
  hidden integer;
  closed_off integer;
  stored integer;
  spans integer;
begin
  -- (a) A rating exam entry (a score, "did not sit" or "exempt") in a journal of grades 0 and 1:
  -- the new rule would hide it.
  select count(*) into hidden
  from journal_rating_exams x
  join journal_rating_entries e on e.rating_exam_id = x.id
  where e.kind is not null
    and not journal_rating_grades(x.journal_id);
  -- (b) A quarter with a closing in force whose state was off and that has a journal of grades
  -- 0–4 of a subject with the rating exam in it: it closed without the rating exam in grades 2–4,
  -- and a closed quarter keeps the state it closed with.
  select count(*) into closed_off
  from quarter_rating_states r
  join quarters q on q.id = r.quarter_id
  where not r.rating_exams_primary
    and quarter_is_closed(q.id)
    and exists (
      select 1
      from journals j
      cross join lateral subject_quarter_switches(j.subject_id, q.id) s
      where j.academic_year_id = q.academic_year_id
        and j.branch_id = q.branch_id
        and s.journal_type = 'graded' and s.rating_exam
        and journal_primary(j.id)
        and journal_rating_grades(j.id)
    );
  -- (c) A final result stored by a closing in force for a journal of grades 0 and 1 of a subject
  -- with the rating exam in that quarter: it was stored with the rating exam as a part with no
  -- data (the state on) or with the distribution without the rating exam (the state off); the new
  -- rule would read its inputs again with the rating exam "not held", and the nightly check would
  -- report every such result as changed.
  select count(*) into stored
  from quarter_final_results r
  cross join lateral subject_quarter_switches(r.subject_id, r.quarter_id) s
  where quarter_is_closed(r.quarter_id)
    and s.journal_type = 'graded' and s.rating_exam
    and not journal_rating_grades(r.journal_id);
  -- (d) An active group of grades 0–1 with grades 2–11 of a subject with the rating exam in an
  -- open quarter of its year, in a year that is not closed.
  select count(*) into spans
  from groups g
  join academic_years y on y.id = g.academic_year_id
  where g.archived_at is null
    and y.status <> 'closed'
    and group_spans_rating_grades(g.id)
    and subject_rating_open_in_year(g.subject_id, g.academic_year_id);
  if hidden > 0 or closed_off > 0 or stored > 0 or spans > 0 then
    raise exception 'rating_grades_migration_refused: % rating exam entries in journals of grades 0 and 1, % closed quarters without the rating exam in grades 0–4, % final results of journals of grades 0 and 1 in closed quarters, % groups of grades 0–1 with grades 2–11 of a rating subject; nothing was changed',
      hidden, closed_off, stored, spans;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Whether a journal has the rating exam in a quarter (`edge/00-definitions`, Rating journal):
-- its subject's switch of the quarter is graded and rating, and every grade of the journal is 2
-- or more. Every write of 0120 and 0128 already asks this, insert and update, so a rating exam or
-- an entry of a journal of grades 0 and 1 is refused (`journal_rating_switch_off`). The state of
-- the quarter (0153) is no longer read.

create or replace function journal_rating_on(journal_ref uuid, quarter_ref uuid) returns boolean
language sql
stable
set search_path = pg_catalog, public
as $$
  select coalesce(
    (
      select s.journal_type = 'graded' and s.rating_exam and journal_rating_grades(j.id)
      from journals j
      cross join lateral subject_quarter_switches(j.subject_id, quarter_ref) s
      where j.id = journal_ref
    ),
    false
  )
$$;

-- ---------------------------------------------------------------------------
-- The group rule (`05`, Group): a group of a subject with the rating exam in an open quarter of
-- its year, whose classes include a grade 0 or 1 and a grade 2 or more, is refused. It replaces the rule of grades
-- 4 and 5 while the setting is off (0153); every other rule of `group_rules` is as before.

create or replace function group_rules(group_ref uuid)
 returns void
 language plpgsql
 set search_path to 'pg_catalog', 'public'
as $function$
declare
  g record;
  year_state text;
  subject_archived timestamptz;
  subject_grades smallint[];
  class_count integer;
  grade_count integer;
  language_count integer;
  shared_language text;
begin
  perform 1 from groups where id = group_ref for share;
  select * into g from groups where id = group_ref;
  if not found then
    return;
  end if;

  perform 1 from academic_years y where y.id = g.academic_year_id for share;
  select y.status into year_state from academic_years y where y.id = g.academic_year_id;
  if year_state = 'closed' then
    raise exception 'group_year_closed'
      using errcode = 'check_violation', constraint = 'group_year_closed';
  end if;

  -- Decision 10: an archived group is not checked again; a restore is.
  if g.archived_at is not null then
    return;
  end if;

  perform 1 from subjects s where s.id = g.subject_id for share;
  select s.archived_at, s.grades into subject_archived, subject_grades
    from subjects s where s.id = g.subject_id;
  if subject_archived is not null then
    raise exception 'group_subject_archived'
      using errcode = 'check_violation', constraint = 'group_subject_archived';
  end if;

  perform 1 from classes c
    where c.id in (select gc.class_id from group_classes gc where gc.group_id = group_ref)
    order by c.id
    for share;

  select count(*) into class_count from group_classes gc where gc.group_id = group_ref;
  if class_count = 0 then
    raise exception 'group_needs_class'
      using errcode = 'check_violation', constraint = 'group_needs_class';
  end if;

  if exists (
    select 1 from group_classes gc
    join classes c on c.id = gc.class_id
    where gc.group_id = group_ref
      and (c.archived_at is not null or c.academic_year_id <> g.academic_year_id)
  ) then
    raise exception 'group_class_year'
      using errcode = 'check_violation', constraint = 'group_class_year';
  end if;

  select count(distinct c.grade), count(distinct c.language),
      min(c.language)
    into grade_count, language_count, shared_language
    from group_classes gc
    join classes c on c.id = gc.class_id
    where gc.group_id = group_ref;
  if grade_count > 2 then
    raise exception 'group_grades'
      using errcode = 'check_violation', constraint = 'group_grades';
  end if;

  -- Decision 16 (Look first): the subject is taught in every grade of the
  -- group.
  if exists (
    select 1 from group_classes gc
    join classes c on c.id = gc.class_id
    where gc.group_id = group_ref and not (c.grade = any (subject_grades))
  ) then
    raise exception 'group_subject_grade'
      using errcode = 'check_violation', constraint = 'group_subject_grade';
  end if;

  -- Decision 8: the classes' language when they share one.
  if language_count = 1 and g.language <> shared_language then
    raise exception 'group_language'
      using errcode = 'check_violation', constraint = 'group_language';
  end if;

  -- The owner's spec change of 10 November 2026: grades 0–1 with grades 2–11 of a rating subject. The subject
  -- row is held `for share` above, so a change of its switches waits for the group or the group
  -- for it.
  if group_spans_rating_grades(group_ref)
    and subject_rating_open_in_year(g.subject_id, g.academic_year_id) then
    raise exception 'groups_rating_grades_span'
      using errcode = 'check_violation', constraint = 'groups_rating_grades_span';
  end if;
end;
$function$;

-- The number of active groups of a subject, of a year that is not closed, in every branch, that
-- draw from a class of grade 0 or 1 and one of grade 2 or more: a count only. As `subject_primary_span_groups`
-- (0153), a SECURITY DEFINER named in the allow-list of `catalog.test.ts`: the subject is
-- school-wide and its edit runs for the branch of the request.
create function subject_rating_span_groups(subject uuid) returns integer
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select count(*)::integer
  from public.groups g
  join public.academic_years y on y.id = g.academic_year_id
  where g.subject_id = subject_rating_span_groups.subject
    and g.archived_at is null
    and y.status <> 'closed'
    and exists (
      select 1 from public.group_classes gc join public.classes c on c.id = gc.class_id
      where gc.group_id = g.id and c.grade < 2
    )
    and exists (
      select 1 from public.group_classes gc join public.classes c on c.id = gc.class_id
      where gc.group_id = g.id and c.grade >= 2
    )
$$;

revoke execute on function subject_rating_span_groups(uuid) from public;
grant execute on function subject_rating_span_groups(uuid) to sodiq_app;

-- The same refusal when a subject's rating switch is turned on: a new switch row with the rating
-- exam, where the subject's row before it had none, while an active group of grades 0–1 with 2–11 of
-- the subject exists in a year that is not closed, in any branch. The setting is no longer read.
create or replace function subject_switches_rating_primary() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  was_on boolean;
begin
  if not (new.journal_type = 'graded' and new.rating_exam) then
    return null;
  end if;
  select s.journal_type = 'graded' and s.rating_exam into was_on
    from subject_switches s
    where s.subject_id = new.subject_id and s.id <> new.id
    order by s.changed_at desc, s.id desc
    limit 1;
  if coalesce(was_on, false) then
    return null;
  end if;
  -- Every branch's groups: a group writer of another branch holds the subject `for share`
  -- (group_rules), and the subject's update holds it, so neither misses the other.
  if subject_rating_span_groups(new.subject_id) > 0 then
    raise exception 'groups_rating_grades_span'
      using errcode = 'check_violation', constraint = 'groups_rating_grades_span';
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- A class moved across grades 1 and 2 (either way) changes whether its journals of a rating
-- subject have the rating exam. Refused where such a journal of the class holds a rating exam
-- entry in a quarter without a closing in force (moved into grades 0 and 1 the entries would be
-- hidden), or where a quarter of the class's year has a closing in force (a closed quarter keeps
-- its rating column). The lock order of 0153 stays: the states of the year `for no key update` in
-- the order of the id (a rating exam or entry write holds its state row `for share`, 0153), then
-- the quarters `for key share` (a close holds its quarter `for update`).

create or replace function classes_grade_rating_primary() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if (old.grade >= 2) = (new.grade >= 2) then
    return new;
  end if;
  perform 1 from quarter_rating_states r
    join quarters q on q.id = r.quarter_id
    where q.academic_year_id = new.academic_year_id
    order by r.quarter_id
    for no key update of r;
  perform 1 from quarters q
    where q.academic_year_id = new.academic_year_id
    order by q.id
    for key share;
  if exists (
    select 1
    from journals j
    join quarters q on q.academic_year_id = j.academic_year_id
    cross join lateral subject_quarter_switches(j.subject_id, q.id) s
    where j.class_id = new.id
      and s.journal_type = 'graded' and s.rating_exam
      and (
        quarter_is_closed(q.id)
        or exists (
          select 1 from journal_rating_exams x
          join journal_rating_entries e on e.rating_exam_id = x.id
          where x.journal_id = j.id and x.quarter_id = q.id and e.kind is not null
        )
      )
  ) then
    raise exception 'classes_grade_rating_primary'
      using errcode = 'check_violation', constraint = 'classes_grade_rating_primary';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- The distribution without the rating exam is read only; its rows stay. The setting and the state
-- of a quarter keep their grants: no rule reads their values any more, but their rows are the
-- lock rows above (a rating exam or entry write holds its quarter's state `for share`, and a new
-- quarter's state row reads the setting `for share`), and a row lock needs the update right.

revoke insert (
  branch_id, subject_id, quarter_id, attendance, classwork, homework, weights_round, rating_round
) on subject_quarter_primary_weights from sodiq_app;
revoke update (attendance, classwork, homework, weights_round, rating_round)
  on subject_quarter_primary_weights from sodiq_app;

-- ---------------------------------------------------------------------------
-- The prepared report totals read the rule (through `journal_rating_on`): every branch's prepared
-- units are put behind, as a change of an input does (0140). The rows are new change rows only.

select report_changed_rows(
  coalesce((select jsonb_agg(jsonb_build_object('branch_id', b.id)) from branches b), '[]'::jsonb)
);
