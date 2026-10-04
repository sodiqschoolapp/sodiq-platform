import { apiErrorSchema, type ErrorCode } from '@sodiq/shared';

/**
 * Why a call of the API did not give its answer: the code of the one error
 * shape, or `no_answer` when nothing readable came back (no connection, the
 * API is down, an answer that is not ours).
 */
export type FailureCode = ErrorCode | 'no_answer';

/**
 * A refused or failed call. Screens show the translation of `code`
 * (`failureText`); the English `message` of the API is for the developer and
 * is never shown to a person.
 */
export class ApiFailure extends Error {
  constructor(
    readonly code: FailureCode,
    /** `Retry-After` of the answer: how long to wait before the next attempt. */
    readonly retryAfterSeconds?: number,
  ) {
    super(`The API call failed: ${code}.`);
  }
}

function retryAfterOf(response: Response): number | undefined {
  const seconds = Number(response.headers.get('Retry-After') ?? '');
  return Number.isInteger(seconds) && seconds > 0 ? seconds : undefined;
}

/** What the generated client answers: the body by status, and the raw answer. */
interface ClientResult<T> {
  data?: T;
  error?: unknown;
  response: Response;
}

/**
 * The body of a call of the generated client, or an `ApiFailure`.
 *
 *     const session = await answerOf(api.GET('/api/auth/session'));
 */
export async function answerOf<T>(call: Promise<ClientResult<T>>): Promise<T> {
  let result: ClientResult<T>;
  try {
    result = await call;
  } catch {
    throw new ApiFailure('no_answer');
  }
  if (result.response.ok) {
    // The client gives `data` for every 2xx answer; for 204 it is `undefined`, and so is T.
    return result.data as T;
  }
  const parsed = apiErrorSchema.safeParse(result.error);
  if (!parsed.success) {
    throw new ApiFailure('no_answer');
  }
  throw new ApiFailure(parsed.data.error.code, retryAfterOf(result.response));
}
