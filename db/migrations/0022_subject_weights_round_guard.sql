-- 0022 Guards of the weights round and of the closed-year lock (task 2.1).
--
-- Found by the spec review of pull request #52:
--
-- - The round of a subject (0021) only grows, and a weight row is written in
--   the subject's current round, for every user, the migrator included: a
--   round that went down, or a row moved into the current round without new
--   values, would bring an old distribution back into force without an audit
--   entry ("The database guards the rules", CLAUDE.md).
-- - The closed-year guard of 0020 locked the year only when it was closed (the
--   rows its condition filtered out were never locked), so a close of the year
--   at the same moment did not wait. The year row is now locked whatever its
--   status, then its status read.
--
-- Not SECURITY DEFINER: they run with the rights of the caller, and the branch
-- filter applies to what they read.

create function subjects_weights_round_guard() returns trigger
language plpgsql
as $$
begin
  if new.weights_round < old.weights_round then
    raise exception 'subjects_weights_round_down'
      using errcode = 'check_violation', constraint = 'subjects_weights_round_down';
  end if;
  return new;
end
$$;

create trigger subjects_weights_round_guard
  before update of weights_round on subjects
  for each row execute function subjects_weights_round_guard();

-- A weight row is inserted or changed only in the current round of its
-- subject. The subject row is read FOR SHARE, so a change of the round at the
-- same moment waits for this write, or this write for it.
create function subject_weights_current_round() returns trigger
language plpgsql
as $$
declare
  current_round integer;
begin
  select weights_round into current_round
    from subjects
    where id = new.subject_id
    for share;
  if new.weights_round is distinct from current_round then
    raise exception 'subject_weights_current_round'
      using errcode = 'check_violation', constraint = 'subject_weights_current_round';
  end if;
  return new;
end
$$;

create trigger subject_daily_weights_current_round
  before insert or update on subject_daily_weights
  for each row execute function subject_weights_current_round();

create trigger subject_quarter_weights_current_round
  before insert or update on subject_quarter_weights
  for each row execute function subject_weights_current_round();

-- The closed-year guard of 0020, locking the year row first whatever its
-- status: a close of the year at the same moment waits for this write.
create or replace function subject_quarter_weights_closed_year_guard() returns trigger
language plpgsql
as $$
declare
  year_status text;
begin
  select academic_years.status into year_status
    from quarters
    join academic_years on academic_years.id = quarters.academic_year_id
    where quarters.id = new.quarter_id
    for share of academic_years;
  if year_status = 'closed' then
    raise exception 'academic_years_closed'
      using errcode = 'check_violation', constraint = 'academic_years_closed';
  end if;
  return new;
end
$$;
