import type { CurrentPeriod as Period } from '@sodiq/shared';
import { useQuery } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { useView } from '@/features/access/use-view';
import { currentPeriodQuery } from './setup-api';
import { schoolDateText } from '@/lib/dates';

/** The year part of the label: its name, marked when it is planned (`edge/academic-year`: "The top bar labels a planned year"). */
function yearText(t: TFunction, period: Period): string {
  if (period.year === null) {
    return t('period.noYear');
  }
  return period.year.status === 'planned'
    ? t('period.planned', { name: period.year.name })
    : period.year.name;
}

/** The quarter part of the label (`edge/time-dates-calendar`, "A page is opened on a date that is in no quarter"). */
function quarterText(t: TFunction, language: string, period: Period): string | null {
  const startOf = (date: string | null | undefined) =>
    date == null ? '' : schoolDateText(date, language, false);
  switch (period.state) {
    case 'no_year':
      return null;
    case 'not_dated':
      return t('period.notDated');
    case 'in_quarter':
      return t('period.quarter', { number: period.quarter?.number });
    case 'before_first':
      return t('period.startsOn', {
        number: period.next?.number,
        date: startOf(period.next?.startDate),
      });
    case 'vacation':
      return period.next === null
        ? t('period.vacation')
        : t('period.vacationNext', {
            number: period.next.number,
            date: startOf(period.next.startDate),
          });
  }
}

/**
 * The academic year and quarter of the branch in use, in the top bar of every
 * page (`03`: "The current academic year and quarter are always shown in the
 * top bar"; `12`, Context; task 1.3): "2026–2027 · Quarter 2", "2026–2027 ·
 * Vacation, quarter 2 starts on 10 November", "2027–2028 (planned) · Quarter
 * 1 starts on 2 September", "No academic year". The server works it out from
 * its clock in the branch's time zone; the device's clock is never used
 * (`edge/00-definitions`, Branch time).
 */
export function CurrentPeriod() {
  const { t, i18n } = useTranslation();
  const { branchId } = useView();
  const period = useQuery(currentPeriodQuery(branchId));
  if (period.data === undefined) {
    // `03`: "always shown": a call that failed says so instead of leaving the place empty.
    return period.isError ? (
      <span
        aria-label={t('period.label')}
        className="min-w-0 truncate text-sm text-muted-foreground"
      >
        {t('period.failed')}
      </span>
    ) : null;
  }
  const parts = [yearText(t, period.data), quarterText(t, i18n.language, period.data)].filter(
    (part): part is string => part !== null,
  );
  return (
    <span
      aria-label={t('period.label')}
      title={t('period.label')}
      className="min-w-0 truncate text-sm text-muted-foreground"
    >
      {parts.join(' · ')}
    </span>
  );
}
