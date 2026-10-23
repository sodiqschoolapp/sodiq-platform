import { z } from 'zod';
import { quarterItemSchema } from './academic-year.js';
import { heldDataSchema } from './held-data.js';

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
  /** A calendar save over published dates meets a blocked conflict on a date it changes; `details` lists each by date (task 5.6b-1). */
  'calendar_blocked',
  /** Task 5.6b-2c-1: the day after a calendar save has no lesson slot of the exam, or its group no lesson at the exam's time; a detail of `calendar_blocked`. */
  'calendar_exam_slots',
  /** Task 5.6b-2c-1: the classes of an exam are on two day templates after a calendar save; a detail of `calendar_blocked`. */
  'calendar_exam_templates',
  /** Task 5.6b-2c-1: a shared block newly under an exam has no choice in the save; a detail of `calendar_blocked`. */
  'calendar_exam_block_choice',
  /** Task 5.6b-3: a block of a two-grade group that a day off leaves with one grade at school has no choice in the save; a detail of `calendar_blocked`. */
  'calendar_group_block_choice',
  /** Task 5.6b-4a: a template change removes or reorders a lesson slot the published timetable uses (`edge/time-dates-calendar`, mid-year row). */
  'template_slot_in_use',
  /** Task 5.6b-5a: a quarter change would move a lesson of today or earlier to another quarter, or out of every quarter (`edge/time-dates-calendar`, "A boundary can move only over future dates"). */
  'quarter_past_lessons',
  /** Task 5.6b-5a (decision 5): a standing exam lies on a date a quarter change would take out of every quarter. */
  'quarter_leaves_exam',
  /** Task 5.6b-5a (decision 6): a stored one-day move would have its two dates in two quarters ("A one-day move stays inside the same quarter"). */
  'quarter_splits_move',
  /** Task 5.6c-3b (decision 2): the new quarter dates would bring two standing rating exams linked to one journal into one quarter. */
  'quarter_rating_exams',
  /** Task 5.6b-5a: a lesson would lie outside its quarter's dates (`quarters_lessons`, 0093). */
  'quarter_leaves_lesson',
  /** Task 5.6b-5a: an exam of the year would lie outside the year's new dates (the From line of 5.1b). */
  'year_leaves_exam',
  /** Task 5.6c-1: the exam's date lies in no academic year of the branch, or a change moves it into another year. */
  'exam_year',
  /** Task 5.6c-1 (decision 16): no published timetable is in force on the exam's date. */
  'exam_no_timetable',
  /** Task 5.6c-1: the exam, or a lesson it would cancel or restore (or the earlier half of its double), has started; exams are made and changed from today on, in slots that have not started. */
  'exam_started',
  /** Task 5.6c-1: the exam is cancelled; a cancel is final. */
  'exam_cancelled',
  /** Task 5.6c-1: the classes of the exam are on two day templates on its date; two exams are made. */
  'exam_templates',
  /** Task 5.6c-1: the first or last lesson of the exam is not a lesson slot of the classes' day. */
  'exam_slots',
  /** Task 5.6c-1: a sitting class shares a block with classes that do not sit and the save has no choice for it; `details` lists each block (`classId`, `recordId` the block). */
  'exam_block_choice',
  /** Task 5.6c-1: a sitting group has no lesson, or more than one, at exactly the exam's time. */
  'exam_group_slots',
  /** Task 5.6c-1: a sitting group's subject is not the exam's. */
  'exam_group_subject',
  /** Task 5.6c-1: a sitting class or group is of another academic year than the exam. */
  'exam_unit_year',
  /** Task 5.6c-1: the exam meets a blocked rule (an invigilator or a room in a lesson or another exam, a vacancy or an inactive invigilator, a day off); `details` lists each. */
  'exam_blocked',
  /** Task 5.6c-1 (decision 8): the exam meets warnings that need a tick; `details` lists each, and the save is sent again with `confirm`. */
  'exam_warnings',
  /** Task 5.6c-1 (decision 3): a lesson the exam no longer covers cannot be restored; `details` lists each with the free rooms of its time, and the save is sent again with the lesson in `keepCancelled`. */
  'exam_restore_blocked',
  /** Task 5.6c-3b (decision 5): the exam's subject has no rating exam, so the exam cannot be its rating exam. */
  'exam_rating_subject',
  /** Task 5.6c-3b (decision 2): a journal the exam would link is linked to another standing exam of the same quarter; `details` lists each (`recordId` the journal, `day` the other exam's date). */
  'exam_rating_taken',
  /** Task 5.6c-3b: a journal of a rating exam is of another subject or year than the exam (`exam_rating_journal`, 0095). */
  'exam_rating_journal',
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
  /**
   * A department move of a teacher or a subject would leave teaching load rows
   * with a teacher outside the subject's department; `details` lists the rows
   * of the branch (`load.<id>`) and counts the others (`elsewhere`)
   * (`edge/people-roles-accounts`, row 15; task 3.4c).
   */
  'department_move_loads',
  /** The start date of a department move is before today or after the branch's latest year (task 3.4c, decision 2). */
  'department_move_start_outside',
  /** The staff record's department changed since it was read: read it again (task 3.4c, decision 9). */
  'staff_changed',
  /** The subject's department changed since it was read: read it again (task 3.4c, decision 9). */
  'subject_changed',
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
  /** The account of the session has a staff record already: one record per account (task 2.7d). */
  'own_record_exists',
  /** A record linked to the own account has no inactive or left status in force or planned, and its employment has begun (task 2.7d, decisions 3 and 9). */
  'own_link_status',
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
  /** No return or restore is scheduled after today, so there is nothing to cancel (task 3.6b-2, L170). */
  'return_not_planned',
  /** The return or restore has taken effect; it can no longer be cancelled (task 3.6b-2, L170). */
  'return_in_force',
  /** A return or a restore is dated after today; both are dated today or earlier (task 2.4b-1, decision 5). */
  'status_date_future',
  /** The student is not graduated today, or has a later status (task 2.4b-1). */
  'student_not_graduated',
  /** A restore is dated before the first day of the graduation (task 2.4b-1). */
  'restore_before_graduation',
  /** The date falls in a closed academic year of the branch (edge/students-classes-groups; db/migrations/0033; task 2.4b-1). */
  'date_in_closed_year',
  /** The student holds data (a scholarship, a leaving, a graduation, a second contract, from task 6.1a a journal cell): leave or merge instead of deleting (edge/students-classes-groups; task 2.4b-1). */
  'student_has_data',
  /** The student's status changed since the page was read (edge/students-classes-groups: "student changed, reload"; task 2.4b-1). */
  'student_changed',
  /** A journal cell was saved from an old version: someone saved it first; both values are shown (edge/journal, Saving and working together; task 6.1a). */
  'cell_stale',
  /** The student is not expected in the lesson on its date, so the cell is closed (07, Editing rules and locks; task 6.1a). */
  'cell_closed',
  /** The lesson is cancelled: its cells take no new value (task 6.1a, decision 8). */
  'lesson_cancelled_cell',
  /** The merged record has journal entries, which a merge does not carry yet (task 6.1a, decision 9). */
  'student_merge_has_cells',
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
  /** The phone is another staff record's, archived and left included (`edge/people-roles-accounts`, re-hire row; task 3.6b-1). `details` names the record when it is of the branch of the request. */
  'staff_phone_taken',
  /** The relative's phone is a staff member's current phone and is not given to another person: the staff phone is corrected first (the owner's answer of 16 October 2026; task 3.6b-1, decision 5). */
  'phone_is_staff',
  /** The academic year of the class is closed: a class of a closed year and its Tutors stay as they were (`edge/academic-year`; task 3.1a, decision 18). */
  'class_year_closed',
  /** The branch has no planned or current academic year to create a class in (task 3.1a, decision 6). */
  'class_needs_year',
  /** The class changed since it was read: read it again (task 3.1a). */
  'class_changed',
  /** The class is archived: restore it first (task 3.1a, decision 10). */
  'class_archived',
  /** The room chosen as the main classroom is closed (task 3.1a, decision 7). */
  'room_closed',
  /** The person does not teach in the class's language (`05`, Language of instruction: "The same holds when a Tutor is given a class"; task 3.1a). */
  'tutor_language',
  /** A language is removed from a person who tutors a class of that language, now or planned (task 3.1a, decision 16). `details` names the class when it is of the branch. */
  'tutor_language_held',
  /** The class has another Tutor, or another acting Tutor, at some moment of that time (task 3.1a, decision 15). */
  'class_tutor_taken',
  /** The assignment chosen is not a Tutor role of the branch (task 3.1a, decision 8). */
  'tutor_not_tutor',
  /** The Tutor role of the person does not cover those dates: a class is held within the role (task 3.1a, decision 9). */
  'tutor_outside_role',
  /** A Tutor row begins and ends today or later (task 3.1a, decision 9). */
  'tutor_date_past',
  /** The Tutor row has already ended, or was withdrawn (task 3.1a). */
  'tutor_ended',
  /** The Tutor row already ends on or before that date (task 3.1a). */
  'tutor_ends_by_then',
  /** A class's language is changed while its Tutor, now or planned, does not teach in the new one (task 3.1a). */
  'class_language_tutor',
  /** A role end moved later or taken back would bring back a Tutor of a class that has another Tutor of that kind at that time (task 3.1a). */
  'role_tutor_taken',
  /** A role end moved later or taken back would bring back a Tutor of a class whose language the person no longer teaches (task 3.1a). */
  'role_tutor_language',
  /** The student is in a class on or after that date: a move between classes is a transfer (task 3.1b, decision 5; task 3.3). */
  'student_has_class',
  /** The student is not active on every day from that date to the end of the class's year or of a scheduled leaving (task 3.1b). */
  'student_not_active_on',
  /** The class is of another grade than the student (task 3.1b, decision 4). */
  'class_grade_differs',
  /** The class would hold more students than its maximum size on some date, scheduled joins and leaves counted (`edge/students-classes-groups`, "A class is full"; task 3.1b). `details` names the fewest free seats. */
  'class_full',
  /** The date lies outside the academic year of the class (task 3.1b, decision 7). */
  'membership_outside_year',
  /** The date is before the student's start date (task 3.1b, decision 6). */
  'membership_before_start',
  /** A placement in force is not withdrawn: a transfer moves the student (task 3.1b, decision 10; task 3.3). */
  'membership_in_force',
  /** The placement has ended: there is nothing to withdraw (task 3.1b). */
  'membership_not_planned',
  /** A student who starts today or earlier is created with a class (`edge/students-classes-groups`, "An active student with no class is allowed only before their start date"; task 3.1b, decision 2). */
  'student_needs_class',
  /** The grade of a student in a class, now or planned, cannot change away from the class's grade (task 3.1b, decision 4). */
  'student_grade_class',
  /** A class with members in force or planned is not archived (task 3.1b). */
  'class_has_members',
  /** A class with a lesson dated after today is not archived (`edge/timetable`, After publishing: "A class cannot be archived while it has future lessons or members"; task 5.5b-1). */
  'class_has_lessons',
  /** The grade of a class with members is not changed (task 3.1b, decision 4). */
  'class_grade_members',
  /** The maximum size cannot drop below the members of a date from today on (task 3.1b, decision 11). */
  'class_size_below_members',
  /** The new dates of an academic year cut days that class or group stays stand in (task 3.6b-2, L128). */
  'year_cut_holds',
  /** The academic year of the group is closed: a group of a closed year stays as it was (task 3.2a). */
  'group_year_closed',
  /** The branch has no planned or current academic year to create a group in (task 3.2a, decision 5). */
  'group_needs_year',
  /** The group changed since it was read: read it again (task 3.2a). */
  'group_changed',
  /** The group is archived (task 3.2a, decision 10). */
  'group_archived',
  /** A class of the group is archived or of another academic year (task 3.2a). */
  'group_class_year',
  /** The classes of a group are of one grade or two (`05`, Group; task 3.2a). */
  'group_grades',
  /** The subject is not taught in a grade of the group (`edge/timetable`, Structure; task 3.2a, decision 16). */
  'group_subject_grade',
  /** The subject of the group is archived (`05`: "Inactive subjects do not appear in pickers"; task 3.2a). */
  'group_subject_archived',
  /** The classes of the group share a language, and the group takes it (`05`, Groups; task 3.2a, decision 8). */
  'group_language',
  /** The classes of the group differ in language: a language is chosen for it (`05`, Groups; task 3.2a, decision 8). */
  'group_language_needed',
  /** The group mixes Uzbek and Russian classes for a subject under the language rule: the warning is confirmed first (`05`, Groups; task 3.2a, decision 8). */
  'group_mixed_language',
  /** The grade of a class that feeds an active group is not changed (task 3.2a, decision 16). */
  'class_grade_groups',
  /** A class that feeds an active group is not archived (task 3.2a, decision 16). */
  'class_in_groups',
  /** A class language change makes a group of a subject under the language rule mix languages: confirmed first (task 3.2a, decision 8). `details` names the groups. */
  'class_language_mixes_groups',
  /** A grade leaves a subject while an active group of that grade needs it, in any branch (task 3.2a, decision 16). `details` names the groups of the branch and counts the others. */
  'subject_grade_groups',
  /** A subject with active groups, in any branch, is not archived (task 3.2a, decision 16). `details` names the groups of the branch and counts the others. */
  'subject_has_groups',
  /** A class of the group is archived or of another academic year, so the group is not restored (task 3.2a, spec review of the build). */
  'group_restore_class',
  /** The subject of the group is archived or no longer taught in a grade of its classes, so the group is not restored (task 3.2a, spec review of the build). */
  'group_restore_subject',
  /** The student is in a group of the subject on or after that date: a move between groups is a transfer (task 3.2b, decision 10; task 3.3). */
  'student_has_group',
  /** No class row of the student in a class of the group holds the date (task 3.2b, decision 7). */
  'student_not_in_group_class',
  /** The membership would put the student into two lessons of one block at once (`06`, Rules: no student in two lessons at once; the trigger `lesson_block_student_twice`, 0060; task 5.12a, decision 7). */
  'membership_lesson_clash',
  /** The group would hold more students than its maximum size on some date, scheduled joins and leaves counted (`edge/students-classes-groups`: "Groups work the same way"; task 3.2b). `details` names the fewest free seats. */
  'group_full',
  /** The date lies outside the academic year of the group (task 3.2b). */
  'group_membership_outside_year',
  /** A group placement in force is not withdrawn: a transfer moves the student (task 3.2b; task 3.3). */
  'group_membership_in_force',
  /** The group placement has ended: there is nothing to withdraw (task 3.2b). */
  'group_membership_not_planned',
  /** A group with members in force or planned is not archived (task 3.2b, decision 16). */
  'group_has_members',
  /** The maximum size of a group cannot drop below its members of a date from today on (task 3.2b, decision 16). */
  'group_size_below_members',
  /** A class whose students the group holds or held is not taken out of the group (task 3.2b, decision 16). */
  'group_class_has_members',
  /** A change would leave a group row outside the class rows of its group's classes (task 3.2b, decision 8): a fault of the path, never a choice of the person. */
  'group_membership_in_class',
  /** "Place automatically" found no group of the screen with a free seat on every day for some students; nothing was placed (task 3.2b, decision 13). `details` names them. */
  'placement_no_seat',
  /** A class row needs a group of every split or group subject of its class, and no group of a subject that draws from it has a free seat on every day of the row; nothing was saved (task 3.2c, decision 3). `details` names each student, with `subjectId`. */
  'class_group_no_seat',
  /** A class row would be saved without a group of a split or group subject of its class (task 3.2c, decision 1): a fault of the path, never a choice of the person. */
  'class_group_missing',
  /** The change would put the student in the same class or group on the day after a stay there ends, which is one stay (task 3.5c, decision 11: `*_one_stay`); the earlier change is cancelled or undone instead. */
  'stay_continues',
  /** A move dated before today is for the Super Admin and the Academic Vice Principal (`edge/students-classes-groups`: "Backdating is for the Academic Vice Principal"; task 3.3a, decision 4). */
  'move_in_past',
  /** The move has begun, or was cancelled or undone: only a scheduled move is changed or cancelled (edge: "It can be changed or cancelled until the date"; task 3.3a). */
  'move_not_scheduled',
  /** The move cannot be undone: it has not begun, was cancelled or undone, its year is closed, or something cut what it wrote since (a later move, a leaving); a transfer back is made instead (edge: "A transfer was a mistake"; task 3.3a, decision 10). */
  'move_not_undoable',
  /** Another move of the student of the same kind (and subject) is scheduled: it is changed or cancelled first (task 3.3a). */
  'move_scheduled',
  /** A later move of the student (of the same kind and subject) has begun: a move is not dated before it (task 3.3a, spec review of the build). */
  'move_before_later',
  /** The student is in no class (or no group of the subject) on the date of the move (task 3.3a). */
  'move_no_membership',
  /** The student is already in that class or group on the date (task 3.3a). */
  'move_same_target',
  /** The two classes differ in language of instruction: the move is confirmed first (`05`, Language of instruction, Students; task 3.3a). */
  'class_language_differs',
  /** The class the returning student left differs in language from the class of the return: confirmed first (`05`, Language of instruction; task 3.3b, decision 2). */
  'return_language_differs',
  /** The date of a return or a graduate restore is not in the academic year of the class named (task 3.3b, decision 10). */
  'return_outside_year',
  /** A release to the branch the student is in (task 3.3c). */
  'branch_move_same_branch',
  /** The student has an open release to another branch: it is cancelled, declined or accepted first; a class or group move waits for it (task 3.3c, decision 11). */
  'branch_move_open',
  /** The release was cancelled, declined or accepted meanwhile (task 3.3c). */
  'branch_move_closed',
  /** The release is accepted from its date on, in the receiving branch's time zone (task 3.3c, decision 6). */
  'branch_move_not_yet',
  /** The class left in the old branch and the class chosen differ in language: confirmed first (`05`, Language of instruction; task 3.3c, decision 15). */
  'branch_move_language_differs',
  /** The group chosen for a subject is not a group of that subject offered to the class (task 3.3c, decision 13). */
  'branch_move_group',
  /** The date of a release is in no academic year of the sending branch (task 3.3c). */
  'branch_move_outside_year',
  /** The date of a release is in a closed academic year of the sending branch (task 3.3c). */
  'branch_move_year_closed',
  /** A leaving or graduation of the student is scheduled after the date of the move: it is changed first (task 3.3c, decision 11). */
  'status_scheduled',
  /** The date is before the student's move to this branch: the old branch's rows are not changed from here (task 3.3c, decision 12). */
  'before_branch_move',
  /** A record cannot be merged with itself (task 3.3d). */
  'student_merge_same',
  /** No student holds the UID named for a merge: unknown, or merged already (task 3.3d). */
  'student_merge_not_found',
  /** A row of the two records would lose days at its start or in its middle; `details` names the first such day (task 3.3d, decision 4). */
  'student_merge_overlap',
  /** One of the two records has an open release to another branch: it is cancelled, declined or accepted first (task 3.3d, decision 11). */
  'student_merge_release_open',
  /** One of the two records has a class or group move scheduled or begun after today: it is cancelled first (task 3.3d, decision 11). */
  'student_merge_move_scheduled',
  /** A row the merge would cut ends in a closed academic year (task 3.3d, decision 4). */
  'student_merge_year_closed',
  /** A class row in force after today is of another grade than the grade the merged student would have (task 3.3d). */
  'student_merge_grade',
  /** The group is of another subject than the group the student leaves (task 3.3a). */
  'group_transfer_subject',
  /** The version is not a draft: its load and start date no longer change (task 3.4a). */
  'version_not_draft',
  /** The picks of bringing a draft up to date bring a blocked result or a load problem; the details list them (task 5.5a-3b-2, decision 8). */
  'up_to_date_blocked',
  /** Bringing a draft up to date after a publish needs one pick for every difference listed (task 5.5a-3b-2, decision 7). */
  'up_to_date_pick_missing',
  /** The causes of the mark, the published version compared or the differences are not the ones shown (tasks 5.5a-3b-1 and 5.5a-3b-2). */
  'out_of_date_changed',
  /** The academic year of the version is closed (task 3.4a). */
  'timetable_year_closed',
  /** The intended start date of a draft is before today (task 3.4a, decision 5). */
  'version_start_past',
  /** The intended start date of a draft is outside its academic year (task 3.4a, decision 5). */
  'version_start_outside_year',
  /** The version copied is of another academic year (task 3.4a, decision 10). */
  'version_copy_year',
  /** The two versions compared are of different academic years (task 5.8a, decision 4). */
  'version_compare_year',
  /** The weights confirmed are not the weights stored now (task 5.3b-1, decision 9). */
  'preferences_changed',
  /** The pins confirmed are not the pins stored now (task 5.3b-2, decision 7). */
  'pins_changed',
  /** The load row is already pinned to that weekday and slot (task 5.3b-2). */
  'pin_taken',
  /** The block of the row already has as many pinned slots as lessons per week (task 5.3b-2, decision 5). */
  'pin_over_load',
  /** A row of a split marked mixed block cannot be pinned (task 5.3b-2, decision 4). */
  'pin_mixed_block',
  /** The date of a choice of the lessons kept is today or earlier (task 5.5a-2b-2, decision 10). */
  'day_keep_date_passed',
  /** The date is not a shortened day for the class: every lesson of the class fits, or the class has no lessons then (task 5.5a-2b-2, decision 6). */
  'day_keep_not_short',
  /** A slot position chosen is not a lesson of the class on that date (task 5.5a-2b-2, decision 6). */
  'day_keep_lessons',
  /** More lessons are chosen than the day has lesson slots (task 5.5a-2b-2, decision 6). */
  'day_keep_over_slots',
  /** A blocked rule of the timetable refuses the lesson at that slot; the rules are in the details (task 5.4a, decision 4). */
  'pattern_blocked',
  /** The weekday has no slot at that position for the grades of the lesson (task 5.4a). */
  'pattern_no_slot',
  /** The partner named is not a half of another subject's mixed split of the same class (task 5.4c-3b, decision 7). */
  'pattern_mixed_partner',
  /** The database refused a clash of the weekly pattern that the rule engine let through (task 5.4a, decision 17). */
  'pattern_clash',
  /** A lock holds a lesson that the applied suggestion moves, or keeps it out of a locked day (task 5.4c-1, decision 8). */
  'pattern_locked',
  /** Another account holds the draft's edit lock and was active in the last 5 minutes (task 5.4c-1, edge/timetable, Generator and editing). */
  'draft_edit_locked',
  /** The draft already has that lock (task 5.4c-1). */
  'lock_taken',
  /** Another change of the timetable held what this one needed; it can be sent again (task 5.4a, decision 17). */
  'timetable_busy',
  /** A step of the draft builder is not ready, so the draft cannot move to generation (task 5.3b-1, decision 6). */
  'draft_not_ready',
  /** A publish is refused; `details` lists every reason, each with its code of `PUBLISH_REFUSALS` (task 5.5a-1, decision 12). */
  'publish_blocked',
  /** The version is not published: only a published version can be withdrawn (task 5.5c-2a). */
  'version_not_published',
  /** The version has started: a published version can be withdrawn only before its start date (task 5.5c-2a). */
  'withdraw_started',
  /** A withdraw is refused: the version that would run again meets a blocked conflict; `details` lists each (task 5.5c-2a). */
  'withdraw_blocked',
  /** The lesson has started: a one-day change is for a lesson that has not started; a past lesson is corrected (task 5.6a-1, decision 3). */
  'lesson_started',
  /** The lesson is already cancelled (task 5.6a-1). */
  'lesson_cancelled',
  /** Only a lesson cancelled with a reason is restored by a one-day restore; an exam's cancel is restored by cancelling the exam (task 5.6a-1, decision 5). */
  'lesson_not_restorable',
  /** A restore meets a blocked rule on its date; `details` lists each, and the free rooms of its time (task 5.6a-1, edge/timetable, After publishing). */
  'restore_blocked',
  /** A one-day room change or move meets a blocked rule at the lesson's new place; `details` lists each, and the free rooms of its time when a room rule blocks (task 5.6a-2). */
  'day_change_blocked',
  /** The lesson already has that room (task 5.6a-2). */
  'room_unchanged',
  /** The lesson has not started: a correction is for a past lesson; a lesson still to come takes a one-day change (task 5.6a-4, decision 5). */
  'lesson_not_started',
  /** The person is already the lesson's teacher (task 5.6a-4). */
  'teacher_unchanged',
  /** A correction meets a blocked rule on the lesson's date; `details` lists each, and the free rooms of its time when a room rule blocks (task 5.6a-4). */
  'correction_blocked',
  /** A correction meets warnings that need a tick; `details` lists each, and the correction is sent again with `confirm` (task 5.6a-4, decisions 2 and 13). */
  'correction_needs_confirm',
  /** The lesson, or the other half of its double, holds data: `details` lists what each holds, and the cancel is sent again with `confirm` (task 6.1b-2, decision 2; edge/timetable, After publishing). */
  'cancel_holds_data',
  /** The lesson's teacher no longer works in the branch, so a restore or a room correction cannot check them; the person who taught it is recorded first (task 5.6a-4). */
  'teacher_left_branch',
  /** The new place of a one-day move has started: a move targets a lesson slot that has not started (task 5.6a-2, decision 5). */
  'move_target_started',
  /** A one-day move stays inside the lesson's quarter (task 5.6a-2; edge/time-dates-calendar). */
  'move_other_quarter',
  /** Another published version is in force on the date of a one-day move (task 5.6a-2, decision 1). */
  'move_other_version',
  /** The date has no lesson slot of that number, or none after it for a double lesson (task 5.6a-2). */
  'move_no_slot',
  /** A one-day move to the place the lesson already has (task 5.6a-2). */
  'move_unchanged',
  /** A room for a one-day move is taken only for a lesson of one part (task 5.6a-2, decision 9). */
  'move_room_parts',
  /** No lesson of the chosen classes in the chosen slots of the date is left to cancel (task 5.6a-3). */
  'bulk_cancel_empty',
  /** The date of a bulk cancel is in no academic year of the branch (task 5.6a-3). */
  'bulk_cancel_out_of_year',
  /** A class of a bulk cancel is archived or of another academic year than the date (task 5.6a-3, decision 14). */
  'class_not_active',
  /** A block shared with classes not chosen has no choice; `details` lists each (task 5.6a-3, decision 7). */
  'bulk_choice_missing',
  /** A choice names a block that is not shared in the bulk cancel; `details` lists each (task 5.6a-3). */
  'bulk_choice_unknown',
  /** The lessons a bulk cancel would cancel changed since its check; `details` lists the differences (task 5.6a-3, decision 12). */
  'bulk_scope_changed',
  /** A lesson of a bulk cancel that holds data has no choice of "keep as held" or "cancel"; `details` lists each (task 6.1b-2, decision 4; edge/time-dates-calendar). */
  'bulk_data_choice_missing',
  /** A data choice names a lesson the bulk cancel does not cancel with data; `details` lists each (task 6.1b-2). */
  'bulk_data_choice_unknown',
  /** The two halves of a double lesson are given different data choices; `details` lists them (task 6.1b-2, decision 4). */
  'bulk_data_choice_split',
  /** A lesson with data is kept as held in a shared block chosen "cancel", which cancels the whole block; `details` lists each (task 6.1b-2, decision 4). */
  'bulk_data_choice_conflict',
  /** The class or group of a load row is of another academic year than the version (task 3.4a). */
  'load_unit_year',
  /** The class or group of a load row is archived (task 3.4a). */
  'load_unit_archived',
  /** A group load row names another subject than the group's (task 3.4a). */
  'load_group_subject',
  /** The subject of a load row is archived (task 3.4a). */
  'load_subject_archived',
  /** The subject is not taught in every grade of the class or group (task 3.4a). */
  'load_subject_grade',
  /** The teacher or vacancy is not linked to the branch (task 3.4a). */
  'load_teacher_branch',
  /** The teacher is inactive or has left, or the vacancy is closed, on the start date (06, Rules; task 3.4a). */
  'load_teacher_status',
  /** The profile of the teacher or vacancy does not have the subject (05, Teaching load; task 3.4a). */
  'load_teacher_subject',
  /** The profile has the subject but not every grade of the class or group (05, Teaching load; task 3.4a). */
  'load_teacher_grade',
  /** The teacher or vacancy does not teach in the language of the class or group, under the language rule (05; task 3.4a). */
  'load_teacher_language',
  /** The room named is closed (06, Rules; task 3.4a). */
  'load_room_closed',
  /** A Tutor row's class has no Tutor on the version's start date, or today when it has passed (task 3.6c-2). */
  'load_no_tutor',
  /** A teacher was named for a Tutor row, whose teacher is always the class's Tutor (task 3.6c-2, decision 1). */
  'load_tutor_row_teacher',
  /** A row that is not a Tutor row was sent without a teacher (task 3.6c-2). */
  'load_teacher_needed',
  /** A load row names a room or a room type, not both (task 3.4a, decision 13). */
  'load_room_choice',
  /** The version already has a row for this class and subject, or this group; `details` names them (task 3.4a). */
  'load_row_exists',
  /** A group of two grades has no school weekday with a lesson slot of the same start and end in both grades (edge/timetable, Structure; task 3.4a, decision 8). */
  'load_group_no_shared_slot',
  /** The version already holds a whole-class row and a group row for one class and the subject (05, Group; task 3.4b). */
  'load_split_and_whole',
  /** A group across classes is marked as part of a mixed block: only the halves of a split are (task 3.4b, decision 12). */
  'load_mixed_not_split',
  /** The halves of one split disagree on the mixed-block mark (task 3.4b, decision 12). */
  'load_block_mixed',
  /** A part of a split or of parallel groups has other lessons per week than the rest of its block (edge/timetable, Structure; task 3.4b). */
  'load_block_lessons',
  /** Two parts of one block name the same teacher or vacancy (edge/timetable, Structure; task 3.4b). */
  'load_block_teacher',
  /** Students of the classes of a group row are not placed in one of the block's groups; listed, never a refusal (task 3.4b, decision 4). */
  'load_group_gaps',
  /**
   * A load row of a draft or of a published version that can still run, or a
   * lesson dated after today, names the vacancy: it cannot be closed yet (04,
   * Vacancy; task 3.4a, narrowed by task 5.5c-2b).
   */
  'vacancy_has_load',
  /** A load row of any version names the vacancy: it cannot be deleted, only closed and kept (04, Vacancy; task 5.5c-2b). */
  'vacancy_in_load',
  /** Task 5.7a-1: the absence would overlap another live absence of the person; `details` names it (`recordId`, `day` its first day). */
  'absence_overlap',
  /** Task 5.7a-1 (decision 5): the change would act on a day before today, on a lesson that has started, or on an absence that has started or ended (set the end instead). */
  'absence_past',
  /** Task 5.7a-1: the absence is withdrawn; a withdraw is final. */
  'absence_withdrawn',
  /** Task 5.7a-1 (decision 11): a vacancy cannot be absent; its lessons need a teacher already. */
  'absence_person',
  /** Task 5.7a-2b: the closure would overlap another live closure of the room; `details` names it (`recordId`, `day` its first day). */
  'room_closure_overlap',
  /** Task 5.7a-2b (decision 4): the change would act on a day before today or on a closure that has started (set the end instead). */
  'room_closure_past',
  /** Task 5.7a-2b: the closure has ended; a new one is entered. */
  'room_closure_ended',
  /** Task 5.7a-2b: the closure is withdrawn; a withdraw is final. */
  'room_closure_withdrawn',
  /** Task 5.7a-2b: a room whose status is `closed` is not closed again, and "move all" goes to another room. */
  'room_closure_room',
  /** Task 5.7a-2b: no lesson of the closure is left to move. */
  'room_closure_nothing',
  /** Task 5.7a-2b: the last day of a closure is before its first (a change of a closure that has not started today). */
  'room_closure_days',
  /** Task 5.7a-2b: "move all" to the closure's own room. */
  'room_move_same',
  /** Task 5.7a-2b (decision 6): a lesson of "move all" meets a blocked rule in the room; `details` lists each, nothing is moved. */
  'room_move_blocked',
  /** Task 5.7a-3a: the vacancy to fill is not open (closed, or closed from a later day). */
  'fill_vacancy',
  /** Task 5.7a-3a: the person is a vacancy, or is not active on the fill date. */
  'fill_person',
  /** Task 5.7a-3a: the fill date is today or earlier, or outside the year of a published version. */
  'fill_start',
  /** Task 5.7a-3a: a row named is not a row of the vacancy in a version that runs on or after the fill date, or the vacancy has none. */
  'fill_rows',
  /** Task 5.7a-3a (decision 3): every row stays with the vacancy; `details` lists them. */
  'fill_nothing',
  /** Task 5.7a-3a (plan step 4): the fill would leave a later published version naming the vacancy unchanged; nothing is filled. */
  'fill_blocked',
  /** Task 5.7a-3a: the rows the fill would fill or leave differ from those the check showed (`rowsKey`). */
  'fill_rows_changed',
  /** Task 5.7a-3a: a row of the version in force cannot be copied on the fill date (a teacher out, a class with no Tutor); `details` names the rows. */
  'fill_version_rows',
  /** Task 5.7a-3c: the journal's row in the published version in force on the start day does not name the vacancy (filled, another teacher, no run), or the record is not a vacancy of the branch. */
  'acting_not_vacancy',
  /** Task 5.7a-3c (decision 5): the person is a vacancy, not linked to the branch, or not active on the start day. */
  'acting_person',
  /** Task 5.7a-3c (decision 5): the person's profile lacks the subject for the grades of the class or group. */
  'acting_profile',
  /** Task 5.7a-3c (decision 5): the person does not teach in the class's language; send `confirmLanguage`. */
  'acting_language',
  /** Task 5.7a-3c (decision 4): the period would start before today. */
  'acting_start_past',
  /** Task 5.7a-3c (decision 6): the journal has another acting teacher on a day of the period; `details` names it. */
  'acting_overlap',
  /** Task 5.7a-3c: the end is before today. */
  'acting_end_past',
  /** Task 5.7a-3c: the end is after the period's own end; a new period is named instead. */
  'acting_end_later',
  /** Task 5.7a-3c: the period has ended or is withdrawn. */
  'acting_ended',
  /** Task 5.7a-3c: a period that has started is ended, not withdrawn. */
  'acting_started',
  /** Task 5.7b-1 (decision 4): the substitute cannot teach at the lesson's start (absent, inactive, left or locked). */
  'substitute_away',
  /** Task 5.7b-1 (decision 5): the teacher replaced by the substitution in force takes the lesson back by its withdrawal. */
  'substitute_is_replaced',
  /** Task 5.7b-1: a substitution meets a blocked rule on the lesson's date; `details` lists each. */
  'substitution_blocked',
  /** Task 5.7b-1: a substitution meets warnings that need a tick; `details` lists each, and it is sent again with `confirm`. */
  'substitution_needs_confirm',
  /** Task 5.7b-1: the lesson has no substitution in force to withdraw. */
  'substitution_not_in_force',
  /** Task 5.7b-1 (decision 12): the teacher returned by a withdrawal has another lesson or exam at that time; `details` lists each. */
  'substitution_return_blocked',
  /** Task 5.7b-2 (decision 6): no lesson of the journal in the run can take the substitute; `details` lists the dates blocked. */
  'journal_substitute_none',
  /** A lesson holds data (attendance, marks, a comment) and is never deleted; only the Super Admin's forced delete removes it (06, Protection; task 5.8b). */
  'lesson_holds_data',
  /** Task 6.1b-1 (decision 3): the change would move a lesson that holds data to another block, or cut off the days of one (decision 7); `details` lists each. */
  'lessons_hold_data',
  /** The forced delete can no longer be restored: its 30 days have passed (06, Protection; task 5.8b). */
  'forced_delete_expired',
  /** The forced delete was restored already (task 5.8b). */
  'forced_delete_restored',
  /** A later timetable is in force on the lesson's date, so the deleted lesson cannot come back (task 5.8b, decision 7). */
  'forced_delete_version',
  /** A record the deleted lesson was tied to changed since (an exam cancelled), so it cannot come back as it was (task 5.8b, decision 9). */
  'forced_delete_parent_changed',
  /** The block the deleted lesson stayed in is gone since (its other lessons went too), so the lesson has nothing to come back into (task 5.8b, spec review of the code). */
  'forced_delete_block_gone',
  /** The restored lesson would break a timetable rule (its room or teacher is taken); the details list why (edge/timetable, After publishing; task 5.8b). */
  'forced_delete_restore_blocked',
  /** A building, floor or room is referenced (a room on it, a lesson, a timetable entry, a closure, the lesson history), so it is archived or closed, never deleted for good (03, Building, floor, room; task 5.8c). */
  'place_referenced',
  /** The building or floor a deleted place belonged to was archived or deleted for good since, so it has nothing to come back into; the details name which (task 5.8c, spec review of the code). */
  'forced_delete_place_parent',
  /** The class, teacher or room is of the branch but outside what the role may see of the timetable (06, Views and outputs; task 5.9a, decision 4). */
  'timetable_view_scope',
  /** A PDF cannot be made on this server now: no Chromium, or too many waiting (task 5.9c-1, decision 4). Excel still works. */
  'pdf_unavailable',
  /** The journal is of the branch but outside what the role may read of it (07, Who can do what; task 6.2, decision 19). */
  'journal_scope',
  /** The journal's year has no quarter with dates yet, so no quarter can be shown (task 6.2). */
  'journal_no_quarter',
  /** The person may not enter this lesson: it is not theirs to teach or own (07, Who can do what; task 6.3, decision 3). */
  'journal_entry_scope',
  /** The lesson has not started: attendance is entered from its start time (07, Editing rules and locks; task 6.3, decision 15). */
  'entry_not_started',
  /** The lesson needs a teacher or is unresolved, so it is not held and takes no entry (edge/00-definitions, Held lesson; task 6.3, decision 15). */
  'lesson_not_held',
  /** The class is outside the Tutor's own classes (edge/journal, "A Tutor records why a student was absent"; task 6.3, decision 8). */
  'absence_scope',
  /** The student was in no class of the branch on that date (task 6.3, decision 8). */
  'absence_not_member',
  /** Both records have a reason of absence for the same date in one branch (task 6.3, correction 2). */
  'student_merge_absence_reasons',
  /** The plan is of the branch but outside what the role may read of it, or the reader may not write it: only the owner edits (edge/lesson-plans, "Who may read a plan?"; task 7.1a). */
  'plan_scope',
  /** The row already holds an item; the details name it (task 7.1a). */
  'plan_row_taken',
  /** The quarter has no row with that number: rows are the lessons of the quarter not cancelled (task 7.1a, decision 5). */
  'plan_row_unknown',
  /** Another lesson stands at the row now: a change of the timetable shifted the plan since it was read (edge/lesson-plans, "A plan is open in two tabs while a cancellation shifts it"; task 7.1b, decision 12). */
  'plan_row_moved',
  /** The journal has no lesson on or after today: the plan is closed with it (09, "A subject is removed from a class"; task 7.1b, decision 9). */
  'plan_closed',
  /** A field the save changes was changed by somebody else since it was read; the details hold the stored value of each (edge/lesson-plans, "A plan is open in two tabs"; task 7.1a, decision 9). */
  'plan_item_stale',
  /** The lesson of the row is held, so the row cannot be cleared (edge/lesson-plans: "'Clear' empties only rows of lessons not yet held"; task 7.1a). */
  'plan_row_held',
  /** The file is larger than 20 MB (edge/lesson-plans, "Limits"; task 7.1a). */
  'plan_file_too_large',
  /** The item holds 10 files already (edge/lesson-plans, "Limits"; task 7.1a). */
  'plan_files_full',
  /** The item would hold more than 10 classworks or 10 homeworks: another save added some meanwhile (build plan 7.1a; task 7.1a). */
  'plan_works_full',
  /** The file is not of a type on the list, or its content is not of the type it says (task 7.1a, decision 3). */
  'plan_file_type',
  /** The subject is attendance only and has no plan (09: "This is not a setting"; task 7.1a). */
  'plan_attendance_only',
  /** The year is closed: nothing in its plans changes (edge/lesson-plans: "Nothing is possible in a closed quarter"; task 7.1a). */
  'plan_year_closed',
  /** No file store is configured on this server: plan files cannot be added or opened yet (task 7.1a, decision 1). */
  'files_not_configured',
  /** The file store did not answer in time or refused (task 7.1a, decision 1). */
  'files_unavailable',
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
  /**
   * The staff record that holds a phone, on a `staff_phone_taken` or a
   * `phone_is_staff` (task 3.6b-1), when it is of the branch of the request;
   * `recordId` is its id.
   */
  staffName: z.string().optional(),
  /**
   * The value the rule expected, when the reader is told it: the UID set of
   * the grade on a `uid_set_mismatch` (task 2.7b-1, decision 7).
   */
  expected: z.string().optional(),
  /** The first day a row would lose on a `student_merge_overlap` (task 3.3d, decision 4). */
  day: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  /** The fewest free seats of a class or group on any date of the placement, on a `class_full` (task 3.1b) or a `group_full` (task 3.2b). */
  freeSeats: z.int().optional(),
  /**
   * On a `class_full` from a check before the write (task 3.5b, H24 of issue
   * #105): the class, the first day it has fewer free seats than the students
   * placed, and how many students were placed.
   */
  classId: z.uuid().optional(),
  fullFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  students: z.int().min(1).optional(),
  /** The subject without a group with a free seat, on a `class_group_no_seat` (task 3.2c). */
  subjectId: z.uuid().optional(),
  /**
   * A teaching load row of the branch of the request that a department move
   * would leave with a teacher outside the subject's department, on a
   * `department_move_loads` (task 3.4c, correction 2 of pull request #101):
   * what its line shows and the version its link opens.
   */
  load: z
    .object({
      versionId: z.uuid(),
      versionNumber: z.int().min(1),
      versionStartsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      /**
       * `grade` is the class's grade, shown as "7 Oxford" (issue #105, H8);
       * `null` for a group, whose name carries its grade.
       */
      unit: z.object({
        kind: z.enum(['class', 'group']),
        id: z.uuid(),
        name: z.string(),
        grade: z.int().nullable(),
      }),
      subjectId: z.uuid(),
      /** `name` is `null` for a teacher this branch no longer sees. */
      teacher: z.object({ id: z.uuid(), name: z.string().nullable(), vacancy: z.boolean() }),
    })
    .optional(),
  /**
   * A class or group stay in the days a change of the year's dates would cut
   * off, on a `year_cut_holds` (task 3.6b-2, decision 9): the student's name,
   * `null` for a student the branch does not hold now ("a student of another
   * branch"); the class (with its grade) or the group; the stay's first and
   * last day.
   */
  stay: z
    .object({
      studentName: z.string().nullable(),
      unit: z.object({
        kind: z.enum(['class', 'group']),
        name: z.string(),
        grade: z.int().nullable(),
      }),
      firstDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      lastDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    })
    .optional(),
  /**
   * A blocked result of the rule engine on a `pattern_blocked` (task 5.4a):
   * `code` is the rule (`timetable.rule.<code>`); its weekday, `null` when it
   * names the week; the lessons involved, a lesson not saved yet named `new:<load row>`.
   */
  rule: z
    .object({ weekday: z.int().min(1).max(7).nullable(), lessonIds: z.array(z.string()) })
    .optional(),
  /** A room free at the time of a refused restore, room change or move, on a `restore_blocked` or `day_change_blocked` (tasks 5.6a-1 and 5.6a-2). */
  room: z.object({ id: z.uuid(), name: z.string() }).optional(),
  /** What stands in the way of a save of the quarters, on a `quarter_past_lessons`, `quarter_leaves_exam` or `quarter_splits_move` (task 5.6b-5a) or a `quarter_rating_exams` (task 5.6c-3b), or a lesson with data on a `lessons_hold_data` of the quarters (task 6.1b-1), or an exam left out by new year dates, on a `year_leaves_exam` (task 5.6b-5b). */
  quarterItem: quarterItemSchema.optional(),
  /**
   * The stored journal cell a save was refused against, on a `cell_stale`
   * (task 6.1a; edge/journal: "the stored value is kept, and both values are
   * shown for the user to choose"): its value (the mark or the number, `null`
   * when empty), its version and who saved it when. `recordId` is the cell.
   */
  storedCell: z
    .object({
      value: z.int().min(0).nullable(),
      version: z.int().min(1),
      changedBy: z.uuid(),
      changedAt: z.iso.datetime(),
    })
    .optional(),
  /**
   * The value stored now of a field a plan save was refused for, on a
   * `plan_item_stale` (task 7.1a, decision 9): the topic or the objectives
   * as text, the links as a list, a work as its title and description, or
   * `null` for a work removed since. `path` names the field.
   */
  storedPlanValue: z
    .union([
      z.string(),
      z.array(z.string()),
      z.object({ title: z.string(), description: z.string() }),
      z.null(),
    ])
    .optional(),
  /**
   * What a lesson holds, on a `cancel_holds_data` (task 6.1b-2, decision 2):
   * `recordId` is the lesson.
   */
  heldData: heldDataSchema.optional(),
  /** The number of items a list of details leaves out, on its detail `more` (`year_cut_holds`, task 3.6b-2). */
  more: z.int().min(1).optional(),
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
