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
