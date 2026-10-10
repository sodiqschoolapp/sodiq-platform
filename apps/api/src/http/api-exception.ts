import { HttpException } from '@nestjs/common';
import type { ErrorCode, ErrorDetail } from '@sodiq/shared';

/**
 * A refusal with a code of its own (`ERROR_CODES` in `@sodiq/shared`). The
 * answer carries the code and our fixed text for it, nothing else.
 *
 *     throw new ApiException('not_signed_in', 401);
 *
 * A refusal that ends by itself names the wait, which becomes the
 * `Retry-After` header of the answer:
 *
 *     throw new ApiException('too_many_attempts', 429, 30);
 *
 * A refusal about one field of the input names it in `details`, as a
 * validation failure does (task 1.2: which of the three names is taken):
 *
 *     throw new ApiException('already_exists', 409, undefined, [detail]);
 */
export class ApiException extends HttpException {
  constructor(
    readonly code: ErrorCode,
    status: number,
    readonly retryAfterSeconds?: number,
    readonly details?: ErrorDetail[],
  ) {
    super(code, status);
  }
}
