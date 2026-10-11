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
