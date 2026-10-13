import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from 'cn';
import { ErrorState, LoadingOutline } from '@/components/states';
import { PANEL } from '@/components/ui/control';
import { studentNoClassQuery } from '@/features/people/people-api';
import { useView } from './use-view';

/**
 * The "No class" counter of the Academic Vice Principal's home page
 * (`edge/students-classes-groups`: "An active student with no class ...
 * appear with class \"—\", under a \"No class\" filter and in a counter on the
 * Academic Vice Principal's home page"; task 2.4b-2, decision 9). Hidden at
 * 0; the link opens the list with the "No class" and "Active" filters, so the
 * rows shown are the ones counted.
 */
export function NoClassTile() {
  const { t, i18n } = useTranslation();
  const number = useMemo(() => new Intl.NumberFormat(i18n.language), [i18n.language]);
  const { branchId } = useView();
  const noClass = useQuery(studentNoClassQuery(branchId));
  if (noClass.isError) {
    return (
      <div className={cn(PANEL, 'mb-4')}>
        <ErrorState
          error={noClass.error}
          onRetry={() => {
            void noClass.refetch();
          }}
        />
      </div>
    );
  }
  if (noClass.data === undefined) {
    return (
      <div className={cn(PANEL, 'mb-4')}>
        <LoadingOutline lines={1} />
      </div>
    );
  }
  if (noClass.data.count === 0) {
    return null;
  }
  return (
    <section
      aria-label={t('home.noClass.title')}
      className={cn(PANEL, 'mb-4 grid max-w-sm gap-1')}
      data-tile="no-class"
    >
      <h2 className="text-[1.0625rem]/6 font-bold">{t('home.noClass.title')}</h2>
      {/* The Page title style of docs/design-system.md, with tabular figures. */}
      <p className="text-[1.75rem]/[2.125rem] font-bold tracking-[-0.01em] tabular-nums" data-count>
        {number.format(noClass.data.count)}
      </p>
      <Link
        to="/people/students"
        search={{ f: { class: 'none', status: 'active' } }}
        className="text-link justify-self-start"
      >
        {t('home.noClass.link')}
      </Link>
    </section>
  );
}
