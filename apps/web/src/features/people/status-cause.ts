import { previousDay, type StatusCause } from '@sodiq/shared';
import type { TFunction } from 'i18next';
import { schoolDateText } from '@/lib/dates';

/**
 * The cause of a status row (`04`, Movements). A leaving whose first inactive
 * day is still ahead reads in the future, naming the last day at school (the
 * day before `from`); from the first inactive day on it reads as done (issue
 * #105, H3). A graduation is set when the year closes, never ahead.
 */
export function statusCauseText(
  t: TFunction,
  row: { cause: StatusCause; from: string },
  today: string,
  language: string,
): string {
  return row.cause === 'leaving' && row.from > today
    ? t('people.students.plannedCauses.leaving', {
        lastDay: schoolDateText(previousDay(row.from), language),
      })
    : t(`people.students.causes.${row.cause}`);
}
