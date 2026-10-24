-- 0125 What the reviews of the code of task 8.5 found (pull request #223).
--
-- ---------------------------------------------------------------------------
-- The end of a full exemption that has not started (spec review of the code,
-- must-fix 2).
--
-- edge/students-classes-groups, row 16: "Open exemptions end"; edge/exemptions,
-- row 4: "'End' from a date". 0123 kept a full exemption ending on the last
-- day of its year while its start is ahead, whatever the write: a leaving set
-- for a date after the start, or an End, was refused. The rule is the shape of
-- an exemption entered or edited (`07`, Kind: a full one runs to the end of
-- the year); an End (`end_cause`) or a leaving (`leaving_id`) cuts it like a
-- started one. An edit clears `end_cause`.
--
-- A merge's carry (the student only) is taken first, before the checks of the
-- year: an exemption of a closed year is carried too (spec review of the code,
-- should-fix 4). The rest of the function is 0123's.

create or replace function exemptions_write() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  moment timestamptz;
  year_row academic_years;
  today date;
begin
  moment := class_tutors_moment();
  if moment is null then
    raise exception 'exemption_moment'
      using errcode = 'check_violation', constraint = 'exemption_moment';
  end if;
  -- A merge carries the exemption to the kept record and changes nothing else
  -- (From 3.3d): no check of its year, also a closed one, and no new version.
  if tg_op = 'UPDATE' and new.student_id is distinct from old.student_id then
    if not student_merge_here(old.student_id, new.student_id)
      or (to_jsonb(new) - 'student_id') is distinct from (to_jsonb(old) - 'student_id') then
      raise exception 'exemption_student'
        using errcode = 'check_violation', constraint = 'exemption_student';
    end if;
    return new;
  end if;
  select * into year_row from academic_years y
    where y.id = new.year_id and y.branch_id = new.branch_id
    for share;
  if year_row.status = 'closed' then
    raise exception 'exemption_closed_year'
      using errcode = 'check_violation', constraint = 'exemption_closed_year';
  end if;
  if new.start_date < year_row.start_date or new.end_date > year_row.end_date then
    raise exception 'exemption_outside_year'
      using errcode = 'check_violation', constraint = 'exemption_outside_year';
  end if;
  today := exemption_today(new.branch_id, moment);
  if tg_op = 'INSERT' then
    new.version := 1;
    new.granted_at := moment;
    if new.kind = 'full' and new.end_date <> year_row.end_date then
      raise exception 'exemption_full_end'
        using errcode = 'check_violation', constraint = 'exemption_full_end';
    end if;
  else
    -- A void is final, but the void of a leaving is given back by its cancel
    -- or undo (decision 14): void and leaving fields only.
    if old.voided_at is not null
      and (to_jsonb(new) - 'student_id') is distinct from (to_jsonb(old) - 'student_id')
      and not (
        old.void_cause = 'leaving' and new.voided_at is null and new.leaving_id is null
        and (to_jsonb(new) - array['student_id', 'voided_at', 'voided_by', 'void_cause', 'leaving_id', 'end_before_leaving'])
          = (to_jsonb(old) - array['student_id', 'voided_at', 'voided_by', 'void_cause', 'leaving_id', 'end_before_leaving'])
      ) then
      raise exception 'exemption_voided'
        using errcode = 'check_violation', constraint = 'exemption_voided';
    end if;
    if new.student_id is distinct from old.student_id
      and not student_merge_here(old.student_id, new.student_id) then
      raise exception 'exemption_student'
        using errcode = 'check_violation', constraint = 'exemption_student';
    end if;
    if old.start_date <= today and (
      new.kind, new.all_subjects, new.start_date, new.start_time, new.end_time,
      new.category, new.detail
    ) is distinct from (
      old.kind, old.all_subjects, old.start_date, old.start_time, old.end_time,
      old.category, old.detail
    ) then
      raise exception 'exemption_started'
        using errcode = 'check_violation', constraint = 'exemption_started';
    end if;
    if new.kind = 'full' and old.start_date > today and new.end_date <> year_row.end_date
      and new.end_cause is null and new.leaving_id is null then
      raise exception 'exemption_full_end'
        using errcode = 'check_violation', constraint = 'exemption_full_end';
    end if;
    if new.kind = 'full' and old.start_date <= today and new.end_date > old.end_date
      and new.end_date <> year_row.end_date then
      raise exception 'exemption_full_end'
        using errcode = 'check_violation', constraint = 'exemption_full_end';
    end if;
    new.version := old.version + 1;
  end if;
  new.changed_at := moment;
  return new;
end;
$$;


-- ---------------------------------------------------------------------------
-- A decided move offer keeps nothing of the reason (permission review 1 and 7;
-- edge/exemptions, row 10: the detail and the document are read only by the
-- Academic Vice Principal, the Principal and the Super Admin, each opening
-- logged). The receiving branch reads the detail of a waiting offer through a
-- logged route; a confirm copies it into the exemption, a drop says no to it,
-- and either clears the offer's copy and its document.

alter table exemption_move_offers alter column detail drop not null;

alter table exemption_move_offers add constraint exemption_move_offers_reason_check check (
  (decision is null) = (detail is not null)
  and (decision is null or (document_key is null and document_type is null and document_name is null))
);

grant update (detail, document_key, document_type, document_name) on exemption_move_offers to sodiq_app;
