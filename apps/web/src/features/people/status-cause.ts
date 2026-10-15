import { previousDay, startsLater, type StatusCause, type StudentStatus } from '@sodiq/shared';
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

/**
 * The status of a student as every list, record and search result shows it:
 * "Starts later" without a status row, "From <date>" for an active student
 * whose start date is ahead (issue #105, H13), else the status.
 */
export function studentStatusText(
  t: TFunction,
  student: { status: StudentStatus | null; startsOn: string },
  today: string,
  language: string,
): string {
  if (student.status === null) {
    return t('people.students.notStarted');
  }
  return startsLater(student, today)
    ? t('people.students.startsFrom', { date: schoolDateText(student.startsOn, language) })
    : t(`people.students.statuses.${student.status}`);
}
