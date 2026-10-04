import { HttpException } from '@nestjs/common';
import type { ErrorCode } from '@sodiq/shared';

/**
 * A refusal with a code of its own (`ERROR_CODES` in `@sodiq/shared`). The
 * answer carries the code and our fixed text for it, nothing else.
 *
 *     throw new ApiException('not_signed_in', 401);
 */
export class ApiException extends HttpException {
  constructor(
    readonly code: ErrorCode,
    status: number,
  ) {
    super(code, status);
  }
}
