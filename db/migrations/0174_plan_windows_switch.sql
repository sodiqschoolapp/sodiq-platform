-- 0174 The plan windows switch (the owner, 20 November 2026; not a task of the
-- build plan).
--
-- The owner: "We have plan windows, can we add a toggle for the admin to turn
-- it off completely so that anyone can fully edit their plans anytime when the
-- toggle is off. For the first year, we want it to be completely independent."
--
-- One value per branch, as the edit days (0019): the plan windows are per
-- branch and quarter (`edge/lesson-plans`: "There is one window per quarter
-- and branch"). On (true), the default, keeps every branch as it is: windows,
-- edit requests and "overdue". Off: the owner of a plan edits it at any time
-- while the quarter is open (`PlansService.gate` lets the write through), no
-- window reminder, no request prepared by the system, no "overdue" and no
-- "window not opened". Nothing stored is changed by switching: the windows,
-- their extensions and the requests stay, and switching back on brings them
-- back. branch_settings is a small table (one row per branch): one step.
alter table branch_settings
  add column plan_windows boolean not null default true;

grant update (plan_windows) on branch_settings to sodiq_app;
