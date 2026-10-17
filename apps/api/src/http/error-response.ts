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
  timetable_year_closed: 'The academic year of the version is closed.',
  version_start_past: 'The start date is before today.',
  version_start_outside_year: 'The start date is outside the academic year.',
  version_copy_year: 'The version copied is of another academic year.',
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
  vacancy_has_load: 'A load row names the vacancy.',
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
