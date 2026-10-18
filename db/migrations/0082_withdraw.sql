-- 0082 Publish: withdraw (task 5.5c-2a, pull request #156).
--
-- docs/spec/06-timetable.md, How surprises are prevented: "Withdraw. A
-- published version can be withdrawn only before its start date." and
-- "Out-of-date draft. If the live timetable changed after a draft was
-- started, the draft must be brought up to date before publishing".
--
-- The plan approved on pull request #156: decision 2 (Look first, a pinned
-- list widened by a requirement). A withdraw marks every draft of its branch
-- and year with a cause of its own; the check of 0077 gains its action and
-- nothing else changes. The transition published -> archived before the
-- start is 0076's (`version_archive_started`), the delete and re-point of
-- future lessons 0079's.

alter table timetable_version_out_of_date_causes
  drop constraint timetable_version_out_of_date_causes_action_check;

alter table timetable_version_out_of_date_causes
  add constraint timetable_version_out_of_date_causes_action_check check (
    action in (
      'timetable_version.publish',
      'timetable_version.withdraw',
      'calendar_entry.create',
      'calendar_entry.edit',
      'calendar_entry.archive',
      'calendar_entry.restore',
      'slot_type.length_change',
      'day_template.version_create',
      'day_template_assignment.set',
      'day_template_assignment.end',
      'staff.availability_set',
      'staff.availability_end',
      'room.edit'
    )
  );
