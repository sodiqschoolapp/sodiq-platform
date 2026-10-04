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
  /** A first password is in use: only the password change, the session and sign-out answer. */
  'password_change_required',
  /** The current password given with a password change is wrong. */
  'current_password_wrong',
  /** The new password is the same as the current one. */
  'password_unchanged',
  /** A changing request that came from another site. */
  'cross_site_request',
  /** The request key was already used for another action, other input or other branches. */
  'request_key_reused',
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
