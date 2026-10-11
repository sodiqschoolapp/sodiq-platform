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
  /** An archived slot type is chosen, or a template being restored uses one (task 1.5). */
  'slot_type_archived',
  /** A template being restored uses an archived slot type from today on (task 1.5). */
  'template_uses_archived_slot_type',
  /** An archived day template is chosen, or the template changed is archived (task 1.5). */
  'template_archived',
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
