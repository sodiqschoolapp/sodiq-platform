-- 0069 Step 5 of the draft builder: the weights of the preferences and their
-- confirmation (task 5.3b-1, pull request #128).
--
-- docs/spec/06-timetable.md, Building a timetable, step 5: "Reviews the fixed
-- rules, sets the weight of each preference, and pins lessons ... Ready when:
-- Confirmed." Auto-generation: "Preferences, each with a weight set by the
-- Academic Vice Principal".
--
-- Decision 8: one column per preference, in the order of the table of `06`
-- (`PREFERENCES` of packages/timetable-rules). Decision 3: a whole number
-- from 0 (not used) to 10, starting at 5. A copy inserts the weights of its
-- source (decision 5), so the insert grant covers them.

alter table timetable_versions
  add column weight_class_no_gaps smallint not null default 5
    constraint timetable_versions_weight_class_no_gaps_check
    check (weight_class_no_gaps between 0 and 10),
  add column weight_teacher_few_gaps smallint not null default 5
    constraint timetable_versions_weight_teacher_few_gaps_check
    check (weight_teacher_few_gaps between 0 and 10),
  add column weight_subject_spread smallint not null default 5
    constraint timetable_versions_weight_subject_spread_check
    check (weight_subject_spread between 0 and 10),
  add column weight_demanding_early smallint not null default 5
    constraint timetable_versions_weight_demanding_early_check
    check (weight_demanding_early between 0 and 10),
  add column weight_class_even_days smallint not null default 5
    constraint timetable_versions_weight_class_even_days_check
    check (weight_class_even_days between 0 and 10),
  add column weight_main_room smallint not null default 5
    constraint timetable_versions_weight_main_room_check
    check (weight_main_room between 0 and 10),
  add column weight_part_time_few_days smallint not null default 5
    constraint timetable_versions_weight_part_time_few_days_check
    check (weight_part_time_few_days between 0 and 10),
  add column weight_teacher_preferred_times smallint not null default 5
    constraint timetable_versions_weight_teacher_preferred_times_check
    check (weight_teacher_preferred_times between 0 and 10),
  -- Decision 2: the eight weights as confirmed, by code; null never confirmed.
  -- Readiness compares them with the columns on each read, so a later change
  -- of a weight makes step 5 not ready with no write. Only the confirm route
  -- writes it; a copy starts unconfirmed (no grant on insert).
  add column rules_confirmed jsonb;

grant insert (
  weight_class_no_gaps, weight_teacher_few_gaps, weight_subject_spread, weight_demanding_early,
  weight_class_even_days, weight_main_room, weight_part_time_few_days,
  weight_teacher_preferred_times
) on timetable_versions to sodiq_app;

grant update (
  weight_class_no_gaps, weight_teacher_few_gaps, weight_subject_spread, weight_demanding_early,
  weight_class_even_days, weight_main_room, weight_part_time_few_days,
  weight_teacher_preferred_times, rules_confirmed
) on timetable_versions to sodiq_app;

-- As starts_on, left_rows (0055) and templates_confirmed (0068): changed only
-- while the version is a draft of a year that is not closed.
create trigger timetable_versions_rules_draft
  before update of
    weight_class_no_gaps, weight_teacher_few_gaps, weight_subject_spread,
    weight_demanding_early, weight_class_even_days, weight_main_room,
    weight_part_time_few_days, weight_teacher_preferred_times, rules_confirmed
  on timetable_versions
  for each row execute function timetable_versions_draft();
