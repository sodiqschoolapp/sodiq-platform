import type { TFunction } from 'i18next';
import { failureOf } from './failure';

/**
 * What a person reads when a call failed: the translation of the code. With a
 * wait (too many attempts) the text says how long.
 */
export function failureText(t: TFunction, error: unknown): string {
  const failure = failureOf(error);
  if (failure.code === 'no_answer') {
    return t('problems.noAnswer');
  }
  if (failure.code === 'too_many_attempts' && failure.retryAfterSeconds !== undefined) {
    return t('problems.wait', { count: failure.retryAfterSeconds });
  }
  return t(`errors.${failure.code}`);
}
