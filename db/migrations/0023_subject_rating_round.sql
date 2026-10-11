-- 0023 The round of a subject's rating switch (task 2.1, decision 19).
--
-- Found by the review of pull request #52: when the rating exam switch is
-- turned off and on again, a quarterly distribution written before it fits the
-- switch again and would count, though nobody typed it again and no audit
-- entry was written for it. A change of the switch starts a new rating round;
-- a quarterly distribution counts only when it was written in the subject's
-- current weights round (0021) and its current rating round. The daily
-- distribution has no rating part (`05`, "Grading weights on a subject") and
-- keeps counting across the switch.
--
-- Only added: the guards of 0022 stay as they are. Small tables: the columns
-- are added with their default in one step. Not SECURITY DEFINER: the
-- triggers run with the rights of the caller, and the branch filter applies to
-- what they read.

alter table subjects
  add column rating_round integer not null default 1
    constraint subjects_rating_round_check check (rating_round >= 1);

alter table subject_quarter_weights
  add column rating_round integer not null default 1
    constraint subject_quarter_weights_rating_round_check check (rating_round >= 1);

-- The application moves the rating round of a subject and writes it with each quarterly row.
grant update (rating_round) on subjects to sodiq_app;
grant insert (rating_round), update (rating_round) on subject_quarter_weights to sodiq_app;

-- The rating round only grows, for every user, the migrator included: a round
-- that went down would bring an old distribution back into force.
create function subjects_rating_round_guard() returns trigger
language plpgsql
as $$
begin
  if new.rating_round < old.rating_round then
    raise exception 'subjects_rating_round_down'
      using errcode = 'check_violation', constraint = 'subjects_rating_round_down';
  end if;
  return new;
end
$$;

create trigger subjects_rating_round_guard
  before update of rating_round on subjects
  for each row execute function subjects_rating_round_guard();

-- A quarterly row is inserted or changed only in the current rating round of
-- its subject. The subject row is read FOR SHARE, so a change of the switch at
-- the same moment waits for this write, or this write for it.
create function subject_quarter_weights_current_rating_round() returns trigger
language plpgsql
as $$
declare
  current_round integer;
begin
  select rating_round into current_round
    from subjects
    where id = new.subject_id
    for share;
  if new.rating_round is distinct from current_round then
    raise exception 'subject_quarter_weights_current_rating_round'
      using errcode = 'check_violation',
        constraint = 'subject_quarter_weights_current_rating_round';
  end if;
  return new;
end
$$;

create trigger subject_quarter_weights_current_rating_round
  before insert or update on subject_quarter_weights
  for each row execute function subject_quarter_weights_current_rating_round();
