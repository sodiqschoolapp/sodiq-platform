import type { TFunction } from 'i18next';
import { ApiFailure } from '@/api/failure';

/**
 * The text of the UID set warning: the set of the grade when the server
 * names it (finding 25 of the hand test of 13 October 2026; task 2.7b-1,
 * decision 7), today's text otherwise.
 */
export function uidSetText(t: TFunction, failure: ApiFailure, grade: number): string {
  const set = failure.details?.find((detail) => detail.code === 'uid_set')?.expected;
  return set === undefined
    ? t('people.students.setText')
    : t('people.students.setTextNamed', { grade, set });
}
