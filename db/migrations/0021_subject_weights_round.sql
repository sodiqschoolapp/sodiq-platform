-- 0021 The round of a subject's weights (task 2.1, decision 14).
--
-- A subject that becomes attendance only keeps the weight rows of every branch
-- (nothing is deleted, and one branch cannot write another branch's rows). When
-- it becomes graded again, the branch in use sets a new daily distribution and
-- every other branch shows "Not set" until its Academic Vice Principal sets
-- one (decision 14 of the plan approved on pull request #52). The subject
-- counts its rounds of being graded; a weight row counts only when it was
-- written in the subject's current round. Small tables: the columns are added
-- with their default in one step.

alter table subjects
  add column weights_round integer not null default 1
    constraint subjects_weights_round_check check (weights_round >= 1);

alter table subject_daily_weights
  add column weights_round integer not null default 1
    constraint subject_daily_weights_round_check check (weights_round >= 1);

alter table subject_quarter_weights
  add column weights_round integer not null default 1
    constraint subject_quarter_weights_round_check check (weights_round >= 1);

-- The application moves the round of a subject and writes it with each row.
grant update (weights_round) on subjects to sodiq_app;
grant insert (weights_round), update (weights_round) on subject_daily_weights to sodiq_app;
grant insert (weights_round), update (weights_round) on subject_quarter_weights to sodiq_app;
