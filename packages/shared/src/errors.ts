import { z } from 'zod';

/**
 * What an error answer can say. The web app translates the code; a new kind of
 * refusal adds its code here in the task that builds it.
 */
export const ERROR_CODES = [
  /** The input does not match the route's schema; `details` names the fields. */
  'validation_failed',
  /** The request could not be read at all, for example a body that is not JSON. */
  'malformed_request',
  'not_found',
  'payload_too_large',
  /** The request has a body that is not JSON. The API reads JSON bodies only. */
  'unsupported_media_type',
  /** No session: none was sent, or it is unknown or has ended. */
  'not_signed_in',
  /** Unknown login or wrong password; the answer does not say which. */
  'sign_in_failed',
  /**
   * After five failures each further attempt waits: the password was not
   * looked at. `Retry-After` of the answer says how many seconds are left.
   */
  'too_many_attempts',
  /** The password was right, but it is a first password older than 7 days or a reset one older than 24 hours. */
  'password_expired',
  /** The password was right, but the account is locked. A wrong password is answered as for any account. */
  'account_locked',
  /** A first password is in use: only the password change, the session and sign-out answer. */
  'password_change_required',
  /** The current password given with a password change is wrong. */
  'current_password_wrong',
  /** The new password is the same as the current one. */
  'password_unchanged',
  /** The account has a second step and this session has not given a code yet. */
  'second_step_required',
  /** The second step is required for the account and none is set up: only the set-up answers. */
  'second_step_set_up_required',
  /** The code of the second step is wrong, was used before or cannot be a code. */
  'second_step_code_wrong',
  /** A set-up was asked for while a second step is in force. */
  'second_step_already_on',
  /** There is no second step to turn off, or no started set-up to confirm. */
  'second_step_not_on',
  /** The second step is required for the account and cannot be turned off. */
  'second_step_cannot_turn_off',
  /**
   * No current assignment of the account permits the action in the branch of
   * the request, or that branch does not exist; the answer does not say which.
   */
  'permission_denied',
  /** Nobody approves their own request. */
  'own_request',
  /** A changing request that came from another site. */
  'cross_site_request',
  /** The request key was already used for another action, other input or other branches, or by another account. */
  'request_key_reused',
  /** A record of this name already exists where it would be created or restored (task 1.1). */
  'already_exists',
  /** A building or a floor cannot be archived while a room on it is in use or under repair (task 1.1). */
  'archive_refused',
  /** The floor of the room is archived: a room is put on an active floor, and only a closed room stays on an archived one (task 1.1). */
  'floor_archived',
  /** The record, or the building it is in, is archived: nothing changes until it is restored (task 1.1). */
  'archived_record',
  /** Academic is built in: it is neither renamed nor archived (`03`, Divisions; task 1.2). */
  'built_in',
  /** The dates overlap another academic year of the branch (task 1.3). */
  'dates_overlap',
  /** A quarter would lie outside the dates of its academic year (task 1.3). */
  'outside_year',
  /** The four quarters must follow each other in order without overlapping (task 1.3). */
  'quarters_out_of_order',
  /** The academic year is closed: nothing in it changes (task 1.3). */
  'year_closed',
  /** The branch already has a current academic year (`edge/developer-rules`, One current year; task 1.3). */
  'current_year_exists',
  /** An earlier academic year of the branch is not closed yet: "Start year" waits for "Close the year" (task 1.3). */
  'earlier_year_not_closed',
  /** A year cannot sit before a year that has already started (task 1.3). */
  'year_out_of_order',
  /** The go-live date must lie inside a planned or current academic year of the branch (task 1.3). */
  'go_live_outside_year',
  /** A change of the slot types or day templates takes effect from tomorrow at the earliest, in branch time (task 1.5). */
  'date_not_in_future',
  /** The grades overlap another range set at the same level on that date (`03`: "Grade ranges set at one level may not overlap"; task 1.5). */
  'grade_ranges_overlap',
  /** A day of a template would end after midnight (task 1.5). */
  'day_past_midnight',
  /** A day template has at least one lesson slot (answer 10; task 1.5). */
  'no_lesson_slot',
  /** The setting already ends on or before that date (task 1.5). */
  'already_ended',
  /** The default template can be replaced from a date but not ended (`03`: "A branch has a default template"; task 1.5). */
  'default_template_required',
  /** A slot type cannot be archived while a template in use from today on has it (answer 9; task 1.5). */
  'slot_type_in_use',
  /** A day template cannot be archived while it is set at a level from today on (task 1.5). */
  'template_in_use',
  /** An archived slot type is chosen for a template (task 1.5). */
  'slot_type_archived',
  /** A template being restored uses an archived slot type from today on (task 1.5). */
  'template_uses_archived_slot_type',
  /** An archived day template is chosen, or the template changed is archived (task 1.5). */
  'template_archived',
  /** Only calendar dates from tomorrow on, in branch time, can be added, changed or removed (answer 16; task 1.4). */
  'calendar_date_not_in_future',
  /** A calendar entry wholly in the past is read-only (answer 16; task 1.4). */
  'calendar_entry_past',
  /** The calendar entry is archived: nothing changes until it is restored (task 1.4). */
  'calendar_entry_archived',
  /** A calendar entry lies inside one planned or current academic year of the branch (answer 16; task 1.4). */
  'calendar_outside_year',
  /** Another entry of the same kind covers one of these dates for one of these grades (answer 17; task 1.4). */
  'calendar_overlap',
  /** A special day with a date on a non-working weekday names the weekday it follows (answer 15; task 1.4). */
  'follows_weekday_required',
  /** The weekday a special day follows is a working weekday of the branch (task 1.4). */
  'follows_weekday_not_working',
  /** An entry whose first date is today or earlier is not restored (answer 16; task 1.4). */
  'calendar_restore_started',
  /** An entry being restored overlaps an active entry of its kind (answer 17; task 1.4). */
  'calendar_restore_overlap',
  /** An entry being restored no longer lies inside one planned or current year (task 1.4). */
  'calendar_restore_outside_year',
  /** An entry being restored no longer fits the working weekdays with its followed weekday (task 1.4). */
  'calendar_restore_follows_weekday',
  /** The day template of an entry being restored is archived (task 1.4). */
  'calendar_restore_template_archived',
  /** A started entry is not archived; its last date is moved instead (decision 3 of task 1.4). */
  'calendar_archive_started',
  /** A year edit would leave an active calendar entry outside the year (decision 5 of task 1.4). */
  'year_leaves_calendar_entry',
  /** A calendar save or a working-weekday edit would leave the go-live date without lessons (task 1.4). */
  'go_live_school_day_taken',
  /** The go-live date must be a school day: some grade has lessons on it (`edge/academic-year`; task 1.4). */
  'go_live_not_school_day',
  /** Travel time is set between two different branches (task 1.6). */
  'travel_time_same_branch',
  /** The subject is archived: restore it first, then change it or its weights (task 2.1). */
  'subject_archived',
  /** A subject belongs to a department of the Academic division (`03`, Department; task 2.1, decision 6). */
  'department_not_academic',
  /** The department of the subject is archived (task 2.1, decision 9). */
  'department_archived',
  /** A department cannot be archived while an active subject is in it (task 2.1, decision 9). */
  'department_has_subjects',
  /** A graded subject is not saved without its daily distribution in the branch (answer 6; task 2.1). */
  'daily_weights_required',
  /** The daily distribution of the branch is already set; it is changed on its own route (task 2.1, decision 15). */
  'daily_weights_set',
  /** An attendance-only subject has no weights (`edge/calculation`; task 2.1). */
  'attendance_only_no_weights',
  /** A subject is not restored while its department is archived (task 2.1, decision 9). */
  'subject_department_archived',
  /** Only the Super Admin moves a subject to another department (`edge/people-roles-accounts`; task 2.1, decision 17). */
  'subject_move_super_admin',
  /** A quarterly distribution has a rating exam part exactly when the subject has a rating exam (`05`; task 2.1, decision 3). */
  'weights_shape_mismatch',
  /** Quarter 1 has no distribution that fits the subject, so there is nothing to copy (answer 6; task 2.1). */
  'quarter_one_not_set',
  /** The 9,999 staff IDs of the year of first hire are all given (`edge/people-roles-accounts`: "A 10,000th hire in one year is refused"; task 2.2a). */
  'staff_id_exhausted',
  /** A staff member in the Academic division has a department there (`04`; task 2.2a). */
  'staff_department_required',
  /** A teacher's subjects come from their Academic department (`04`; task 2.2a). */
  'subject_outside_department',
  /** A grade taught is one of the grades of the subject (task 2.2a). */
  'grade_not_in_subject',
  /** A teacher with a subject has a language of instruction (task 2.2a). */
  'languages_required',
  /** The division is archived: a staff record names active divisions (task 2.2a). */
  'division_archived',
  /** A status change is dated today or later (`edge/people-roles-accounts`, Staff over time; task 2.2a, decision 4). */
  'status_from_past',
  /** A status change is dated on or after the first status of the record, its admission (task 2.2a). */
  'status_before_admission',
  /** The status asked for is already in force from that date and nothing is planned after it (task 2.2a). */
  'status_unchanged',
  /** Nobody sets their own staff record to inactive or left (task 2.2a, correction 5). */
  'own_status',
  /** The password was right, but the staff member is inactive or has left (`edge/people-roles-accounts`, Staff over time; task 2.2a). */
  'account_inactive',
  /** A subject keeps its department and grades while a teacher who has not left has them (task 2.2a, decision 13). */
  'subject_has_teachers',
  /** A department cannot be archived while a staff member who has not left is in it (task 2.2a, decision 20). */
  'department_has_staff',
  /** Hours of a staff record overlap its hours in another branch on a date (`06`, Teachers who work in several branches; task 2.2b). `details` names the weekdays when the service finds them. */
  'availability_overlap',
  /** The file is not a JPEG or PNG photo of at most 800 pixels a side (answer 2; task 2.2c-2). */
  'photo_invalid',
  /** The photo is larger than 5 MB (answer 2; task 2.2c-2). */
  'photo_too_large',
  /** No photo store is configured on this server: photos cannot be added or shown yet (answer 2; task 2.2c-2). */
  'photos_not_configured',
  /** The photo store did not answer in time or refused; only photos fail (`edge/system-behaviour`; task 2.2c-2). */
  'photos_unavailable',
  /** The link to choose a new password is unknown, used, closed by a newer link or a password change, or its account may not use it now (task 2.3c-2, decision 19). */
  'reset_link_invalid',
  /** The link to choose a new password is older than its hour (task 2.3c-2, decisions 9 and 19). */
  'reset_link_expired',
  /** The staff record has an account already; an account is linked once (task 2.3a). */
  'account_exists',
  /** The login is given to another account; logins are never reused (`edge/people-roles-accounts`, Accounts and sign-in; task 2.3a). `details` names `login`. */
  'login_taken',
  /** The staff record has no account yet: roles are given to an account (task 2.3a). */
  'no_account',
  /** The person has left: no account and no role is given (`edge/people-roles-accounts`, Staff over time: "Left: all roles ended"; task 2.3a). */
  'staff_left',
  /** A role is given in one of the branches of the person (task 2.3a, decision 10). */
  'role_branch_not_person',
  /** The account holds this role in this branch already at some moment from that date (db/migrations/0009; task 2.3a). */
  'role_overlap',
  /** At most 3 accounts are Super Admin (`02`, Super Admin; task 2.3a). */
  'too_many_super_admins',
  /** Nobody removes their own Super Admin role (`edge/people-roles-accounts`, Accounts and sign-in; task 2.3a). */
  'own_super_admin_role',
  /** The change would leave no active Super Admin (`edge/people-roles-accounts`, Accounts and sign-in; task 2.3a, decision 5). */
  'last_super_admin',
  /** The role has already ended; an end that has passed is final (0.7a; task 2.3a). */
  'assignment_ended',
  /** A role is given or ended from today or later (task 2.3a, decision 10). */
  'role_from_past',
  /** A subject of the appointment has another Head Teacher in that branch, or another Senior Head Teacher, at some moment of it (`02`, One per subject per branch; task 2.3b-1). `details` name the subjects when they are known. */
  'head_teacher_taken',
  /** A subject of an appointment does not exist or is archived (task 2.3b-1, decision 12). */
  'subject_unknown',
  /** Only the subjects of a Head Teacher or Senior Head Teacher appointment are changed (task 2.3b-1). */
  'role_not_appointment',
  /** The appointment ends on or before the date of a change of its subjects; its end is not moved later by the change (task 2.3b-1). */
  'appointment_ends_by_then',
  /** Nobody locks, unlocks or resets their own account or second step (0.6b, 0.6d; task 2.3c-1, decision 11). */
  'own_account',
  /** The account is locked already (task 2.3c-1). */
  'account_already_locked',
  /** The account is not locked, so there is nothing to unlock (task 2.3c-1). */
  'account_not_locked',
  /** The account has no confirmed second step to reset (task 2.3c-1, decision 6). */
  'second_step_off',
  /** The staff record has no account yet, so there is nothing to lock or reset (task 2.3c-1). */
  'account_missing',
  /** The first four digits of the UID are not the set of the student's grade; the save may be repeated with the confirmation (`04`, UID sets, Release 1; task 2.4a, decision 5). */
  'uid_set_mismatch',
  /** A UID, JSHSHIR, document number or contract number is already given to another student, in any branch, inactive and graduated ones too (edge/students-classes-groups; task 2.4a). `details` names the field, and the holder when the reader may open it. */
  'student_value_taken',
  /** The start date is in no academic year of the branch and no year begins after it (task 2.4a, decision 5). */
  'no_academic_year',
  /** The student is not active on the last day asked for, or a leaving or graduation is in force after it (`04`, Movements; task 2.4b-1). */
  'student_not_active',
  /** The last day of a leaving is before the student's current active time began, a return included (task 2.4b-1, decision 5). */
  'leaving_before_start',
  /** No leaving is scheduled after today, so there is nothing to cancel (task 2.4b-1). */
  'leaving_not_planned',
  /** The leaving has taken effect: it is undone with a reason, not cancelled (edge/students-classes-groups; task 2.4b-1). */
  'leaving_in_force',
  /** The student is not inactive today, or has a later status, so there is nothing to undo or to return from (task 2.4b-1). */
  'student_not_inactive',
  /** The inactive status was not written by a leaving, so it is not undone (task 2.4b-1, decision 8). */
  'undo_not_leaving',
  /** A return is dated on or before the first inactive day; on that day it would be an undo (task 2.4b-1, decision 5). */
  'return_too_early',
  /** A return or a restore is dated after today; both are dated today or earlier (task 2.4b-1, decision 5). */
  'status_date_future',
  /** The student is not graduated today, or has a later status (task 2.4b-1). */
  'student_not_graduated',
  /** A restore is dated before the first day of the graduation (task 2.4b-1). */
  'restore_before_graduation',
  /** The date falls in a closed academic year of the branch (edge/students-classes-groups; db/migrations/0033; task 2.4b-1). */
  'date_in_closed_year',
  /** The student holds data (a scholarship, a leaving, a graduation, a second contract): leave or merge instead of deleting (edge/students-classes-groups; task 2.4b-1). */
  'student_has_data',
  /** The student's status changed since the page was read (edge/students-classes-groups: "student changed, reload"; task 2.4b-1). */
  'student_changed',
  /** A student is saved, or a student of 2.4a edited, without a relative (`04`: "A student cannot be saved without at least one relative"; task 2.5a). */
  'student_needs_relative',
  /** The new main phone of a relative belongs to another relative (`04`, Changing a phone; task 2.5a). `details` names the holder. */
  'relative_phone_taken',
  /** A new relative is given a main phone that a relative already has: link that person instead (`04`, Adding a relative; task 2.5a). `details` names the holder. */
  'relative_phone_exists',
  /** The relative chosen by phone no longer has that phone (task 2.5a, decision 18). */
  'relative_phone_changed',
  /** The last relative of a student is not unlinked (`04`: "the last relative of a student cannot be removed"; task 2.5a). */
  'last_relative',
  /** A student keeps exactly one main contact: unlinking or clearing it names another (`edge/close-relatives`; task 2.5a). */
  'main_contact_needed',
  /** A merge of relatives linked in another branch is for the Super Admin (`edge/close-relatives`: "Across branches, only the Super Admin merges"; task 2.5b-1). */
  'merge_needs_super_admin',
  /** A relative changed (a phone, a link, a merge) between the read and the change: read again (task 2.5b-1). */
  'relative_changed',
  /** The relative was merged into another record and is not linked again (task 2.5b-1, decision 9). */
  'relative_merged',
  /** The staff record is already marked as the same person as another relative (`edge/close-relatives`, row 8; task 2.5b-2). `details` names the holder when visible in the branch. */
  'same_person_taken',
  /** The staff record is marked as the same person as a relative of another branch, who is not named (task 2.5b-2). */
  'same_person_held_elsewhere',
  /** The relative is marked as the same person as a staff member of another branch: only the Super Admin changes it (task 2.5b-2, decision 9). */
  'same_person_elsewhere',
  /** A vacancy is not a person and cannot be marked as the same person (task 2.5b-2). */
  'same_person_vacancy',
  /** Two relatives marked as the same person as two different staff members are not merged (task 2.5b-2, decision 5). */
  'merge_marks_differ',
  /** Any other refusal that has no code of its own yet. */
  'request_refused',
  /** A fault on the server. The answer says nothing about it; the log does. */
  'internal_error',
] as const;

export const errorCodeSchema = z.enum(ERROR_CODES);

export type ErrorCode = z.infer<typeof errorCodeSchema>;

/**
 * One field that failed validation. It names where and what kind, never the
 * value that was sent.
 */
export const errorDetailSchema = z.object({
  /** Dotted path of the field, for example `students.0.score`; empty for the whole input. */
  path: z.string(),
  code: z.string(),
  message: z.string(),
  /**
   * The record that holds a value refused as taken, when the reader may open
   * it (task 2.4a, decision 3: a student of the branch of the request).
   */
  recordId: z.uuid().optional(),
  /**
   * The relative that holds a phone refused as taken (task 2.5a, decision 3):
   * the name and the number of students linked in every branch.
   */
  holder: z.object({ fullName: z.string(), students: z.int().min(0) }).optional(),
  /**
   * For a refused phone change: whether the two records may be merged by this
   * reader (task 2.5b-1, decision 8: the holder live and visible in the
   * branch, or in any branch for the Super Admin).
   */
  mergeable: z.boolean().optional(),
});

export type ErrorDetail = z.infer<typeof errorDetailSchema>;

/**
 * The one shape of every error answer of the API. `message` is English text for
 * the developer and is never shown to a user; users see the translation of `code`.
 */
export const apiErrorSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string(),
    /** The same id as the `X-Request-Id` header of the answer. */
    requestId: z.string(),
    details: z.array(errorDetailSchema).optional(),
  }),
});

export type ApiError = z.infer<typeof apiErrorSchema>;
