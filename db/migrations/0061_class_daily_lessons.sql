-- 0061 The most lessons per day of a class (task 5.2, pull request #109).
--
-- docs/spec/06-timetable.md, Rules: "Warning | A class has more lessons in a
-- day than the daily maximum in settings." docs/spec/edge-cases/timetable.md,
-- Structure, "Rules refer to settings that no record has": "Added: … a class's
-- most lessons per day". Decision 2 (Look first): one value per branch, read
-- for every class of the branch; null is "not set" and gives no warning. The
-- bounds are those of staff.daily_lessons (0024) and of
-- CLASS_DAILY_LESSONS_MAX in packages/shared/src/settings.ts (a test compares
-- them). branch_settings is a small table: one step.
alter table branch_settings
  add column class_daily_lessons smallint
    constraint branch_settings_class_daily_lessons_check check (
      class_daily_lessons between 1 and 12
    );

grant update (class_daily_lessons) on branch_settings to sodiq_app;
