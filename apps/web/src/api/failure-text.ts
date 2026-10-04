import type { TFunction } from 'i18next';
import { ApiFailure } from './failure';

/**
 * What a person reads when a call failed: the translation of the code. With a
 * wait (too many attempts) the text says how long. Any other error is a fault
 * of the app and is not blamed on the connection.
 */
export function failureText(t: TFunction, error: unknown): string {
  if (!(error instanceof ApiFailure)) {
    // A fault of the app itself, for example an answer it cannot read.
    return t('problems.unexpected');
  }
  const failure = error;
  if (failure.code === 'no_answer') {
    return t('problems.noAnswer');
  }
  if (failure.code === 'too_many_attempts' && failure.retryAfterSeconds !== undefined) {
    return t('problems.wait', { count: failure.retryAfterSeconds });
  }
  return t(`errors.${failure.code}`);
}
