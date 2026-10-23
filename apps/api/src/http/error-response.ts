import { HttpException, Logger } from '@nestjs/common';
import type { ApiError, ErrorCode } from '@sodiq/shared';
import type { Response } from 'express';
import { reportFault } from '../reporting/reporting.js';
import { ApiException } from './api-exception.js';
import { requestIdOf } from './request-id.js';
import { ValidationFailedException } from './validation.js';

const logger = new Logger('Errors');

/** English text for the developer. Users see the translation of the code (task 0.8a). */
const MESSAGE: Record<ErrorCode, string> = {
  validation_failed: 'The input is not valid.',
  malformed_request: 'The request could not be read.',
  not_found: 'Not found.',
  payload_too_large: 'The request is too large.',
  unsupported_media_type: 'The body of the request is not JSON.',
  not_signed_in: 'Not signed in.',
  sign_in_failed: 'The login or the password is wrong.',
  too_many_attempts: 'Too many failed attempts. Wait before the next one.',
  password_expired: 'The first or reset password is no longer valid.',
  account_locked: 'The account is locked.',
  password_change_required: 'The password must be changed first.',
  current_password_wrong: 'The current password is wrong.',
  password_unchanged: 'The new password is the same as the current one.',
  second_step_required: 'The second step of sign-in must be passed first.',
  second_step_set_up_required: 'The second step of sign-in must be set up first.',
  second_step_code_wrong: 'The code is wrong.',
  second_step_already_on: 'A second step is already in force.',
  second_step_not_on: 'There is no second step, or no set-up was started.',
  second_step_cannot_turn_off: 'The second step is required for this account.',
  permission_denied: 'No permission for this action.',
  own_request: 'Nobody decides their own request.',
  cross_site_request: 'The request came from another site.',
  request_key_reused: 'The request key was already used for another request.',
  already_exists: 'A record of this name already exists here.',
  archive_refused: 'It cannot be archived while a room on it is in use or under repair.',
  floor_archived:
    'The floor is archived: a room goes on an active floor, and only a closed room stays on an archived one.',
  archived_record: 'The record, or the building it is in, is archived. Restore it first.',
  built_in: 'Academic is built in: it cannot be renamed or archived.',
  dates_overlap: 'The dates overlap another academic year of the branch.',
  outside_year: 'A quarter would lie outside the dates of its academic year.',
  quarters_out_of_order: 'The quarters must follow each other in order without overlapping.',
  year_closed: 'The academic year is closed: nothing in it changes.',
  current_year_exists: 'The branch already has a current academic year.',
  earlier_year_not_closed: 'An earlier academic year of the branch is not closed yet.',
  year_out_of_order: 'A year cannot come before a year that has already started.',
  go_live_outside_year: 'The go-live date must lie inside a planned or current academic year.',
  date_not_in_future: 'A change takes effect from tomorrow at the earliest.',
  grade_ranges_overlap: 'The grades overlap another range set at the same level.',
  day_past_midnight: 'A day of a template would end after midnight.',
  no_lesson_slot: 'A day template needs at least one lesson slot.',
  already_ended: 'The setting already ends on or before that date.',
  default_template_required: 'The default template can be replaced, not ended.',
  slot_type_in_use: 'The slot type is used by a day template from today on.',
  template_in_use: 'The day template is set at a level from today on.',
  slot_type_archived: 'An archived slot type is chosen.',
  template_uses_archived_slot_type:
    'The template uses an archived slot type from today on. Restore that slot type first.',
  template_archived: 'The day template is archived.',
  calendar_date_not_in_future:
    'Only calendar dates from tomorrow on can be added, changed or removed.',
  calendar_entry_past: 'The calendar entry lies wholly in the past and is read-only.',
  calendar_entry_archived: 'The calendar entry is archived. Restore it first.',
  calendar_outside_year: 'The dates must lie inside one planned or current academic year.',
  calendar_overlap:
    'Another entry of the same kind covers one of these dates for one of these grades.',
  follows_weekday_required: 'A special day on a non-working weekday names the weekday it follows.',
  follows_weekday_not_working: 'The weekday followed must be a working weekday of the branch.',
  go_live_not_school_day: 'The go-live date must be a school day.',
  calendar_restore_started: 'An entry whose first date is today or earlier is not restored.',
  calendar_restore_overlap: 'The entry overlaps an active entry of its kind.',
  calendar_restore_outside_year: 'The entry no longer lies inside one planned or current year.',
  calendar_restore_follows_weekday: 'The entry no longer fits the working weekdays.',
  calendar_restore_template_archived: 'The day template of the entry is archived.',
  calendar_archive_started: 'A started entry is not archived; move its last date instead.',
  year_leaves_calendar_entry: 'A calendar entry would lie outside the year.',
  go_live_school_day_taken: 'The change would leave the go-live date without lessons.',
  calendar_blocked: 'The change meets a blocked conflict on a date it changes; each is listed.',
  calendar_exam_slots:
    'The day after the change has no lesson slot of an exam, or its group no lesson at its time; each is listed.',
  calendar_exam_templates:
    'The classes of an exam are on two day templates after the change; each is listed.',
  calendar_exam_block_choice:
    'A shared lesson newly under an exam needs a choice: cancel it or keep it for the other classes.',
  calendar_group_block_choice:
    'A lesson of a two-grade group left with one grade at school needs a choice: cancel it or keep it for that grade.',
  template_slot_in_use:
    'The change removes or reorders a lesson slot the published timetable uses; each is listed.',
  quarter_past_lessons:
    'The new quarter dates would move lessons of today or earlier to another quarter; each is listed.',
  quarter_leaves_exam: 'An exam lies on a date the new quarter dates take out of every quarter.',
  quarter_splits_move: 'A one-day move would have its two dates in two quarters.',
  quarter_rating_exams:
    'The new quarter dates would give a journal two rating exams in one quarter; each is listed.',
  quarter_leaves_lesson: 'A lesson would lie outside the dates of its quarter.',
  year_leaves_exam: 'An exam of the year would lie outside the new dates.',
  exam_year:
    'The exam date lies in no academic year of the branch, or in another year than the exam.',
  exam_no_timetable: 'No published timetable is in force on the exam date.',
  exam_started: 'The exam, or a lesson it would cancel or restore, has started.',
  exam_cancelled: 'The exam is cancelled.',
  exam_templates: 'The classes of the exam are on two day templates on its date.',
  exam_slots: 'The first or last lesson is not a lesson slot of the day.',
  exam_block_choice: 'A shared block under the exam has no choice.',
  exam_group_slots: 'A sitting group has no single lesson at exactly the exam time.',
  exam_group_subject: 'A sitting group is not of the exam subject.',
  exam_unit_year: 'A sitting class or group is of another academic year.',
  exam_blocked:
    'The exam meets a blocked rule: a clash, an invigilator who cannot invigilate, or a date without lessons.',
  exam_warnings: 'The exam meets warnings that need a tick.',
  exam_restore_blocked: 'A lesson the exam no longer covers cannot be restored.',
  exam_rating_subject: 'The subject of the exam has no rating exam.',
  exam_rating_taken:
    'A journal is already linked to another rating exam of the same quarter; each is listed.',
  exam_rating_journal: 'A journal of the rating exam is of another subject or year than the exam.',
  absence_overlap: 'The absence overlaps another absence of the person.',
  absence_past:
    'The change would act on a day before today or on a lesson that has started; set the end instead.',
  absence_withdrawn: 'The absence is withdrawn.',
  absence_person: 'A vacancy cannot be absent.',
  room_closure_overlap: 'The closure overlaps another closure of the room.',
  room_closure_past:
    'The change would act on a day before today or on a closure that has started; set the end instead.',
  room_closure_ended: 'The closure has ended.',
  room_closure_withdrawn: 'The closure is withdrawn.',
  room_closure_room: 'The room is closed; choose another room.',
  room_closure_nothing: 'No lesson of the closure is left to move.',
  room_closure_days: 'The last day of the closure is before its first.',
  room_move_same: 'The lessons are already in this room.',
  room_move_blocked: 'A lesson cannot move to the room; each is listed and nothing was moved.',
  travel_time_same_branch: 'Travel time is set between two different branches.',
  subject_archived: 'The subject is archived. Restore it first.',
  department_not_academic: 'A subject belongs to a department of the Academic division.',
  department_archived: 'The department is archived.',
  department_has_subjects: 'The department cannot be archived while an active subject is in it.',
  daily_weights_required: 'A graded subject needs its daily distribution in this branch.',
  daily_weights_set:
    'The daily distribution is already set in this branch; change it on its own route.',
  attendance_only_no_weights: 'An attendance-only subject has no weights.',
  subject_department_archived:
    'The department of the subject is archived; the subject is not restored.',
  subject_move_super_admin: 'Only the Super Admin moves a subject to another department.',
  weights_shape_mismatch:
    'The distribution has a rating exam part exactly when the subject has a rating exam.',
  quarter_one_not_set: 'Quarter 1 has no distribution that fits the subject.',
  staff_id_exhausted: 'All staff IDs of this year of first hire are given.',
  staff_department_required: 'A staff member in the Academic division has a department there.',
  subject_outside_department: 'A subject of a teacher is in their Academic department.',
  grade_not_in_subject: 'A grade taught is one of the grades of the subject.',
  languages_required: 'A teacher with a subject has a language of instruction.',
  division_archived: 'The division is archived.',
  status_from_past: 'A status change is dated today or later.',
  status_before_admission: 'A status change is dated on or after the admission.',
  status_unchanged: 'The status is already in force from that date.',
  own_status: 'Nobody sets their own staff record to inactive or left.',
  account_inactive: 'The staff member is inactive or has left.',
  subject_has_teachers: 'Teachers have this subject with these grades in this department.',
  department_move_loads:
    "Teaching load rows would have a teacher outside the subject's department; reassign them first.",
  department_move_start_outside:
    "The start date of the move is before today or after the end of the branch's latest year.",
  staff_changed: 'The staff record changed since it was read; read it again.',
  subject_changed: 'The subject changed since it was read; read it again.',
  department_has_staff: 'The department cannot be archived while a staff member is in it.',
  availability_overlap: 'The hours overlap the hours of another branch on a date.',
  photo_invalid: 'The file is not a JPEG or PNG photo of at most 800 pixels a side.',
  photo_too_large: 'The photo is larger than 5 MB.',
  photos_not_configured: 'Photos are not configured on this server.',
  photos_unavailable: 'The photo store did not answer.',
  reset_link_invalid: 'The link does not work.',
  reset_link_expired: 'The link has expired.',
  account_exists: 'The staff record has an account already.',
  own_record_exists: 'The account of the session has a staff record already.',
  own_link_status:
    'The record is inactive, has left, has such a status planned, or is not employed yet.',
  login_taken: 'The login is given to another account.',
  no_account: 'The staff record has no account.',
  staff_left: 'The staff member has left.',
  role_branch_not_person: 'The branch is not one of the branches of the person.',
  role_overlap: 'The account holds this role in this branch at that time.',
  too_many_super_admins: 'At most 3 accounts can be Super Admin.',
  own_super_admin_role: 'Nobody can remove their own Super Admin role.',
  last_super_admin: 'The change would leave no active Super Admin.',
  assignment_ended: 'The assignment has already ended.',
  role_from_past: 'A role is given or ended from today or later.',
  head_teacher_taken: 'A subject of the appointment has another holder at that time.',
  subject_unknown: 'A subject of the appointment does not exist or is archived.',
  appointment_ends_by_then: 'The appointment ends on or before that date.',
  role_not_appointment:
    'Only the subjects of a Head Teacher or Senior Head Teacher appointment are changed.',
  own_account: 'Nobody locks, unlocks or resets their own account.',
  account_already_locked: 'The account is already locked.',
  account_not_locked: 'The account is not locked.',
  second_step_off: 'The account has no second step to reset.',
  account_missing: 'The staff record has no account yet.',
  uid_set_mismatch: "The UID is not in the set of the student's grade; confirm to save it.",
  student_value_taken: 'A value of the student is given to another student.',
  student_needs_relative: 'The student needs at least one relative.',
  relative_phone_taken: 'The phone belongs to another relative.',
  relative_phone_exists: 'A relative with this phone exists; link that person.',
  relative_phone_changed: 'The relative chosen no longer has that phone.',
  last_relative: 'The last relative of a student is not unlinked.',
  main_contact_needed: 'The student needs exactly one main contact.',
  merge_needs_super_admin: 'Only the Super Admin merges relatives linked in another branch.',
  relative_changed: 'The relative changed meanwhile; read it again.',
  relative_merged: 'The relative was merged into another record.',
  staff_phone_taken: 'The phone belongs to another staff record.',
  phone_is_staff: "The phone is a staff member's phone; correct the staff record first.",
  class_year_closed: 'The academic year of the class is closed.',
  class_needs_year: 'The branch has no planned or current academic year.',
  class_changed: 'The class changed since it was read.',
  class_archived: 'The class is archived.',
  room_closed: 'The room is closed.',
  tutor_language: 'The person does not teach in the language of the class.',
  tutor_language_held: 'The person tutors a class of that language.',
  class_tutor_taken: 'The class has another Tutor of that kind at that time.',
  tutor_not_tutor: 'The assignment is not a Tutor role of the branch.',
  tutor_outside_role: 'The Tutor role does not cover those dates.',
  tutor_date_past: 'A Tutor is given or ended from today or later.',
  tutor_ended: 'The Tutor row has already ended.',
  tutor_ends_by_then: 'The Tutor row ends on or before that date.',
  class_language_tutor: 'A Tutor of the class does not teach in that language.',
  role_tutor_taken: 'A class of the role has another Tutor of that kind at that time.',
  role_tutor_language: 'A class of the role is of a language the person no longer teaches.',
  student_has_class: 'The student is in a class on or after that date; a move is a transfer.',
  student_not_active_on: 'The student is not active on every day of that time.',
  class_grade_differs: 'The class is of another grade than the student.',
  class_full: 'The class would hold more students than its maximum size on some date.',
  membership_outside_year: 'The date is outside the academic year of the class.',
  membership_before_start: 'The date is before the start date of the student.',
  membership_in_force: 'The placement is in force; a transfer moves the student.',
  membership_not_planned: 'The placement has ended.',
  student_needs_class: 'A student who starts today or earlier is created with a class.',
  student_grade_class: 'The student is in a class of another grade, now or planned.',
  class_has_members: 'The class has members in force or planned.',
  class_has_lessons: 'The class has lessons dated after today.',
  class_grade_members: 'The class has members; its grade cannot change.',
  class_size_below_members: 'The class holds more members than that on a date from today on.',
  year_cut_holds: 'Class or group stays stand in the days the new dates cut off.',
  no_academic_year: 'The start date is in no academic year of the branch.',
  student_not_active: 'The student is not active on that day, or a leaving is in force.',
  leaving_before_start: 'The last day is before the current time at school began.',
  leaving_not_planned: 'No leaving is scheduled.',
  leaving_in_force: 'The leaving has taken effect; undo it instead.',
  student_not_inactive: 'The student is not inactive.',
  undo_not_leaving: 'The inactive status was not written by a leaving.',
  return_too_early: 'The return is not after the first inactive day.',
  return_not_planned: 'No return or restore is scheduled.',
  return_in_force: 'The return or restore has taken effect.',
  status_date_future: 'The date is after today.',
  student_not_graduated: 'The student is not graduated.',
  restore_before_graduation: 'The date is before the graduation.',
  date_in_closed_year: 'The date is in a closed academic year.',
  student_has_data: 'The student holds data and cannot be deleted.',
  student_changed: 'The student changed since it was read.',
  cell_stale: 'The cell was changed since it was read.',
  cell_closed: 'The student is not expected in this lesson.',
  lesson_cancelled_cell: 'The lesson is cancelled.',
  student_merge_has_cells: 'The merged record has journal entries.',
  group_year_closed: 'The academic year of the group is closed.',
  group_needs_year: 'The branch has no planned or current academic year.',
  group_changed: 'The group changed since it was read.',
  group_archived: 'The group is archived.',
  group_class_year: 'A class is archived or of another academic year.',
  group_grades: 'The classes are of more than two grades.',
  group_subject_grade: 'The subject is not taught in a grade of the group.',
  group_subject_archived: 'The subject is archived.',
  group_language: 'The classes share a language; the group takes it.',
  group_language_needed: 'The classes differ in language; choose one for the group.',
  group_mixed_language: 'The group mixes languages; the warning was not confirmed.',
  class_grade_groups: 'The class feeds a group; its grade cannot change.',
  class_in_groups: 'The class feeds an active group.',
  class_language_mixes_groups:
    'The change makes a group mix languages; the warning was not confirmed.',
  subject_grade_groups: 'An active group of that grade needs the subject.',
  subject_has_groups: 'The subject has active groups.',
  group_restore_class: 'A class of the group is archived or of another academic year.',
  group_restore_subject: 'The subject of the group is archived or not taught in its grades.',
  student_has_group: 'The student is in a group of the subject on or after that date.',
  student_not_in_group_class: 'The student is in no class of the group on that date.',
  membership_lesson_clash: 'The student would have two lessons at the same time.',
  group_full: 'The group would hold more students than its maximum size on some date.',
  group_membership_outside_year: 'The date is outside the academic year of the group.',
  group_membership_in_force: 'The group placement is in force.',
  group_membership_not_planned: 'The group placement has ended.',
  group_has_members: 'The group has members in force or planned.',
  group_size_below_members: 'The group holds more members on some date from today on.',
  group_class_has_members: 'The group holds or held students of a class taken out.',
  group_membership_in_class: 'A group row would lie outside a class row.',
  placement_no_seat: 'No group of the screen has a seat for some students.',
  class_group_no_seat: 'No group of a subject of the class has a seat for some students.',
  class_group_missing: 'A class row would be saved without a group of its subjects.',
  stay_continues: 'The student is already in this class or group on the day before.',
  move_in_past: 'A move dated before today is for the Super Admin and the Academic Vice Principal.',
  move_not_scheduled: 'Only a scheduled move is changed or cancelled.',
  move_not_undoable: 'The move cannot be undone.',
  move_scheduled: 'Another move of the student is scheduled.',
  branch_move_same_branch: 'The student is in that branch already.',
  branch_move_open: 'The student has an open release to another branch.',
  branch_move_closed: 'The release was cancelled, declined or accepted meanwhile.',
  branch_move_not_yet: 'The release is accepted from its date on.',
  branch_move_language_differs:
    'The class left and the class chosen differ in language; confirm first.',
  branch_move_group: 'The group is not offered to the class for that subject.',
  branch_move_outside_year: 'The date is in no academic year of the branch.',
  branch_move_year_closed: 'The date is in a closed academic year.',
  status_scheduled: 'A leaving or graduation is scheduled after the date.',
  before_branch_move: 'The date is before the student moved to this branch.',
  student_merge_same: 'A record cannot be merged with itself.',
  student_merge_not_found: 'No student holds the UID.',
  student_merge_overlap: 'A row of the two records would lose its start or its middle.',
  student_merge_release_open: 'One of the two records has an open release to another branch.',
  student_merge_move_scheduled: 'One of the two records has a move scheduled after today.',
  student_merge_year_closed: 'A row the merge would cut ends in a closed academic year.',
  student_merge_grade: 'A class row in force after today is of another grade.',
  move_before_later: 'A later move of the student has begun.',
  move_no_membership: 'The student is in no class or group of the subject on that date.',
  move_same_target: 'The student is already in that class or group on that date.',
  class_language_differs: 'The two classes differ in language of instruction.',
  return_language_differs:
    'The class left differs in language of instruction from the class of the return.',
  return_outside_year:
    'The date of the return or restore is outside the academic year of the class.',
  group_transfer_subject: 'The group is of another subject.',
  version_not_draft: 'The version is not a draft.',
  up_to_date_blocked: 'The picks bring a blocked result or a load problem; the details list them.',
  up_to_date_pick_missing: 'Every difference listed needs a pick.',
  out_of_date_changed:
    'The causes, the published version compared or the differences changed since they were read.',
  timetable_year_closed: 'The academic year of the version is closed.',
  version_start_past: 'The start date is before today.',
  version_start_outside_year: 'The start date is outside the academic year.',
  version_copy_year: 'The version copied is of another academic year.',
  version_compare_year: 'The two versions are of different academic years.',
  preferences_changed: 'The weights changed since they were read.',
  pins_changed: 'The pinned lessons changed since they were read.',
  pin_taken: 'The row is already pinned to that weekday and slot.',
  pin_over_load: 'The block already has as many pinned slots as lessons per week.',
  pin_mixed_block: 'A half of a split marked mixed block cannot be pinned.',
  day_keep_date_passed: 'The lessons kept can be chosen from tomorrow on only.',
  day_keep_not_short: 'The date is not a shortened day for the class.',
  day_keep_lessons: 'A slot chosen is not a lesson of the class on that date.',
  day_keep_over_slots: 'More lessons are chosen than the day has lesson slots.',
  pattern_blocked: 'A blocked rule refuses the lesson at that slot.',
  pattern_no_slot: 'The weekday has no slot at that position for the lesson.',
  pattern_mixed_partner:
    "The partner is not a half of another subject's mixed split of the same class.",
  pattern_clash: 'The database refused a clash of the weekly pattern.',
  pattern_locked: 'A lock holds a lesson the change would move.',
  draft_edit_locked: 'Another person is editing this draft.',
  lock_taken: 'The draft already has that lock.',
  timetable_busy: 'Another change of the timetable was being saved.',
  draft_not_ready: 'A step of the draft is not ready.',
  publish_blocked: 'The draft cannot be published; the details list why.',
  version_not_published: 'The version is not published.',
  withdraw_started: 'The version has started; it can no longer be withdrawn.',
  lesson_started: 'The lesson has started; a one-day change is for a lesson that has not.',
  lesson_cancelled: 'The lesson is already cancelled.',
  lesson_not_restorable: 'Only a lesson cancelled with a reason is restored by a one-day restore.',
  restore_blocked: 'The restore meets a blocked rule on its date.',
  day_change_blocked: 'The one-day change meets a blocked rule at the lesson’s new place.',
  room_unchanged: 'The lesson already has that room.',
  lesson_not_started: 'The lesson has not started; a correction is for a past lesson.',
  teacher_unchanged: 'The person is already the teacher of the lesson.',
  correction_blocked: 'The correction meets a blocked rule on the lesson’s date.',
  correction_needs_confirm: 'The correction meets warnings that need a tick.',
  teacher_left_branch: 'The lesson’s teacher no longer works in the branch.',
  cancel_holds_data: 'The lesson holds data; the cancel is sent again with the tick.',
  move_target_started: 'The new place of the move has started.',
  move_other_quarter: 'A one-day move stays inside the lesson’s quarter.',
  move_other_version: 'Another published version is in force on that date.',
  move_no_slot: 'The date has no such lesson slot.',
  move_unchanged: 'The lesson already has that place.',
  move_room_parts: 'A room is given only for a lesson of one part.',
  bulk_cancel_empty: 'No lesson of the chosen classes in the chosen slots is left to cancel.',
  bulk_cancel_out_of_year: 'The date is in no academic year of the branch.',
  class_not_active: 'A class is archived or of another academic year than the date.',
  bulk_choice_missing: 'A block shared with classes not chosen has no choice.',
  bulk_choice_unknown: 'A choice names a block that is not shared in this bulk cancel.',
  bulk_scope_changed: 'The lessons to cancel changed since the check.',
  bulk_data_choice_missing: 'A lesson with data has no choice of keep as held or cancel.',
  bulk_data_choice_unknown:
    'A data choice names a lesson the bulk cancel does not cancel with data.',
  bulk_data_choice_split: 'The two halves of a double lesson have different data choices.',
  bulk_data_choice_conflict: 'A lesson with data is kept in a shared block chosen to be cancelled.',
  withdraw_blocked:
    'The version that would run again meets a blocked conflict; the details list each.',
  load_unit_year: 'The class or group is of another academic year.',
  load_unit_archived: 'The class or group is archived.',
  load_group_subject: "The subject is not the group's.",
  load_subject_archived: 'The subject is archived.',
  load_subject_grade: 'The subject is not taught in every grade of the unit.',
  load_teacher_branch: 'The teacher is not of the branch.',
  load_teacher_status: 'The teacher or vacancy is out on the start date.',
  load_teacher_subject: 'The teacher does not have the subject.',
  load_teacher_grade: 'The teacher does not have every grade of the unit.',
  load_teacher_language: 'The teacher does not teach in the language of the unit.',
  load_room_closed: 'The room is closed.',
  load_no_tutor: 'The class has no Tutor on the start date of the version.',
  load_tutor_row_teacher: "The class's Tutor holds this row; no teacher is named for it.",
  load_teacher_needed: 'A teacher or a vacancy is needed.',
  load_room_choice: 'A row names a room or a room type, not both.',
  load_row_exists: 'The version already has a row for this unit and subject.',
  load_group_no_shared_slot: 'The two grades share no lesson slot on any school weekday.',
  load_split_and_whole:
    'The version holds a whole-class row and a group row for one class and subject.',
  load_mixed_not_split: 'Only the halves of a split are part of a mixed block.',
  load_block_mixed: 'The halves of one split disagree on the mixed block.',
  load_block_lessons: 'Every part of a block has the same lessons per week.',
  load_block_teacher: 'Two parts of one block have the same teacher.',
  load_group_gaps: 'Students of the classes are not placed in a group of the block.',
  fill_vacancy: 'The vacancy is not open.',
  fill_person: 'The person cannot fill the vacancy from the date.',
  fill_start: 'A vacancy is filled from tomorrow at the earliest, inside the year.',
  fill_rows: 'A row named is not a row of the vacancy from the date.',
  fill_nothing: 'Every row stays with the vacancy.',
  fill_blocked: 'The fill would leave a later version with the vacancy.',
  fill_rows_changed: 'The rows the fill would fill or leave changed since the check.',
  fill_version_rows: 'A row of the version in force cannot be copied on the date.',
  acting_not_vacancy: 'The journal is not under the vacancy on that day.',
  acting_person: 'The person cannot be named on that day.',
  acting_profile: "The subject for these grades is not in the person's profile.",
  acting_language: "The person does not teach in the class's language; confirm it.",
  acting_start_past: 'The period starts today at the earliest.',
  acting_overlap: 'The journal has another acting teacher in the period.',
  acting_end_past: 'The end is today at the earliest.',
  acting_end_later: "The end is after the period's own end.",
  acting_ended: 'The period has ended or is withdrawn.',
  acting_started: 'The period has started; end it instead.',
  substitute_away: "The substitute cannot teach at the lesson's start.",
  substitute_is_replaced:
    'The teacher replaced takes the lesson back by withdrawing the substitution.',
  substitution_blocked: 'The substitution meets a blocked rule.',
  substitution_needs_confirm: 'The substitution meets warnings that need a tick.',
  substitution_not_in_force: 'The lesson has no substitution in force.',
  substitution_return_blocked: 'The teacher returned has another lesson or exam at that time.',
  journal_substitute_none: 'No lesson of the journal in the period can take this substitute.',
  lesson_holds_data: 'The lesson holds data and cannot be deleted.',
  lessons_hold_data: 'The change would move or cut off lessons that hold data.',
  forced_delete_expired: 'The 30 days to restore this record have passed.',
  forced_delete_restored: 'The record was restored already.',
  forced_delete_version: 'Another timetable is in force on the date of the lesson.',
  forced_delete_parent_changed: 'A record the lesson was tied to changed since.',
  forced_delete_block_gone: 'The block of the deleted lesson is gone since.',
  forced_delete_restore_blocked: 'The restored lesson would break a timetable rule.',
  place_referenced: 'The building, floor or room is in use; archive or close it instead.',
  timetable_view_scope:
    'The timetable of this class, teacher or room is outside what the role may see.',
  pdf_unavailable: 'A PDF cannot be made on this server now.',
  journal_scope: 'This journal is outside what the role may read.',
  journal_no_quarter: 'The year has no quarter with dates.',
  journal_entry_scope: 'The lesson is not one the person teaches or owns.',
  entry_not_started: 'The lesson has not started.',
  lesson_not_held: 'The lesson needs a teacher or is unresolved.',
  absence_scope: "The class is outside the Tutor's own classes.",
  absence_not_member: 'The student was in no class of the branch on that date.',
  student_merge_absence_reasons: 'Both records have a reason of absence for the same date.',
  plan_scope: 'This plan is outside what the role may read or write.',
  plan_row_taken: 'The row already holds an item.',
  plan_row_unknown: 'The quarter has no row with that number.',
  plan_row_moved: 'Another lesson stands at the row now: the plan moved since it was read.',
  plan_closed: 'The plan is closed with its journal.',
  plan_item_stale: 'A field was changed by somebody else since it was read.',
  plan_row_held: 'The lesson of the row is held.',
  plan_file_too_large: 'The file is larger than 20 MB.',
  plan_files_full: 'The item holds 10 files already.',
  plan_works_full: 'The item would hold more than 10 works of a kind.',
  plan_file_type: 'The file is not of a type on the list.',
  plan_attendance_only: 'The subject is attendance only and has no plan.',
  plan_year_closed: 'The year is closed.',
  plan_window_closed: 'The plan window has ended and no approved request opens this.',
  plan_window_not_open: 'The plan window is not open yet and no approved request opens this.',
  plan_window_unpublished: 'The published timetable does not cover the quarter.',
  plan_window_end_past: 'The end is before today.',
  plan_window_after_quarter: 'The end is after the quarter\'s last day.',
  plan_window_dates: 'The window must start inside the quarter, on or before its end.',
  plan_window_started: 'The window has started; its start does not move.',
  plan_window_confirm: 'Lessons will be held without a plan; confirm to go on.',
  plan_window_none: 'The quarter has no window yet.',
  plan_extension_not_later: 'The extension does not end later than the end in force.',
  plan_extension_owner: 'The person owns no plan of the quarter.',
  plan_request_window_open: 'The window is open: the plan is written freely.',
  plan_request_held_replan: 'A re-plan starts at a lesson not yet held.',
  plan_request_lesson_unknown: 'A lesson named is not a lesson of the plan.',
  plan_request_decided: 'The request is not waiting any more.',
  plan_request_nothing: 'The plan needs no request.',
  plan_queue_stale: 'The queue changed since it was read.',
  plan_queue_items: 'The queue names an item twice or one not in the queue.',
  plan_share_language: 'Their languages of instruction differ.',
  plan_share_grade: 'Their grades differ.',
  plan_share_kind: 'A class and a group do not share a plan.',
  plan_share_subject: 'The subjects differ.',
  plan_share_owner: 'A class of the share gets another teacher later in the quarter.',
  plan_share_same: 'The journal already shares this plan.',
  plan_share_has_items: 'The plan of the joining journal has items.',
  plan_not_shared: 'The plan is not shared.',
  plan_not_empty: 'The plan has items on lessons not yet held.',
  plan_copy_subject: 'The plan copied from is of another subject.',
  plan_copy_grade: 'The plan copied from is of another grade.',
  plan_copy_same: 'The plan cannot be copied into itself.',
  files_not_configured: 'Files are not configured on this server.',
  files_unavailable: 'The file store did not answer.',
  forced_delete_place_parent:
    'The building or floor of the deleted place was archived or deleted since.',
  vacancy_has_load: 'A load row that can still run, or a future lesson, names the vacancy.',
  vacancy_in_load: 'A load row names the vacancy, so it cannot be deleted.',
  request_refused: 'The request was refused.',
  internal_error: 'Something went wrong on the server.',
};

function codeOfStatus(status: number): ErrorCode {
  switch (status) {
    case 400:
      return 'malformed_request';
    case 404:
      return 'not_found';
    case 413:
      return 'payload_too_large';
    case 415:
      return 'unsupported_media_type';
    default:
      return status >= 500 ? 'internal_error' : 'request_refused';
  }
}

/**
 * The status of an error that did not come from our code or NestJS: the body
 * parser marks its refusals with `type` and a 4xx status, and Express gives a
 * path it cannot decode status 400. Everything else is a fault of the server.
 */
function statusOfForeignError(error: unknown): number {
  if (typeof error !== 'object' || error === null) {
    return 500;
  }
  const fromBodyParser = 'type' in error && typeof error.type === 'string';
  const status = 'status' in error ? error.status : undefined;
  if ((fromBodyParser || error instanceof URIError) && typeof status === 'number') {
    return status >= 400 && status < 500 ? status : 500;
  }
  return 500;
}

/**
 * Answers any error in the one shape (`apiErrorSchema`). Only the status and,
 * for validation, the details are taken from the error: its own message may
 * repeat what was sent or name internals, so the text is always ours.
 */
export function sendError(response: Response, error: unknown): void {
  const requestId = requestIdOf(response);
  const status = error instanceof HttpException ? error.getStatus() : statusOfForeignError(error);
  const code =
    error instanceof ValidationFailedException
      ? 'validation_failed'
      : error instanceof ApiException
        ? error.code
        : codeOfStatus(status);
  if (code === 'internal_error') {
    // Name, message and stack only: other fields of an error (for example the
    // detail of a database error) can hold values of a row.
    logger.error(
      `Request ${requestId} failed`,
      error instanceof Error ? error.stack : `Thrown value of type ${typeof error}`,
    );
    // The same to the error reports (task 0.10): name, message, stack and the request id.
    reportFault(error, { requestId });
  }
  if (response.headersSent) {
    // The answer has started; all that is left is to end it.
    response.end();
    return;
  }
  if (error instanceof ApiException && error.retryAfterSeconds !== undefined) {
    response.setHeader('Retry-After', String(error.retryAfterSeconds));
  }
  const details =
    error instanceof ValidationFailedException
      ? error.details
      : error instanceof ApiException
        ? error.details
        : undefined;
  const body: ApiError = {
    error: {
      code,
      message: MESSAGE[code],
      requestId,
      ...(details === undefined ? {} : { details }),
    },
  };
  response.status(status).json(body);
}
