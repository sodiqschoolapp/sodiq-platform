import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from 'cn';
import { ErrorState, LoadingOutline } from '@/components/states';
import { PANEL } from '@/components/ui/control';
import { relativeNoValidPhoneQuery } from '@/features/people/people-api';
import { useView } from './use-view';

/**
 * The parents with "no valid phone" on the Academic Vice Principal's home page
 * (`edge/close-relatives`, row 2: "listed for the Academic Vice Principal
 * while a linked student is active"; task 2.5b-1, decision 3), as the "No
 * class" counter. Hidden at 0; the link opens the Parents list with the same
 * filter, so the rows shown are the ones counted.
 */
export function NoValidPhoneTile() {
  const { t, i18n } = useTranslation();
  const number = useMemo(() => new Intl.NumberFormat(i18n.language), [i18n.language]);
  const { branchId } = useView();
  const counted = useQuery(relativeNoValidPhoneQuery(branchId));
  if (counted.isError) {
    return (
      <div className={cn(PANEL, 'mb-4')}>
        <ErrorState
          error={counted.error}
          onRetry={() => {
            void counted.refetch();
          }}
        />
      </div>
    );
  }
  if (counted.data === undefined) {
    return (
      <div className={cn(PANEL, 'mb-4')}>
        <LoadingOutline lines={1} />
      </div>
    );
  }
  if (counted.data.count === 0) {
    return null;
  }
  return (
    <section
      aria-label={t('home.noValidPhone.title')}
      className={cn(PANEL, 'mb-4 grid max-w-sm gap-1')}
      data-tile="no-valid-phone"
    >
      <h2 className="text-[1.0625rem]/6 font-bold">{t('home.noValidPhone.title')}</h2>
      {/* The Page title style of docs/design-system.md, with tabular figures. */}
      <p className="text-[1.75rem]/[2.125rem] font-bold tracking-[-0.01em] tabular-nums" data-count>
        {number.format(counted.data.count)}
      </p>
      <Link
        to="/people/parents"
        search={{ f: { phone: 'no_valid_phone' } }}
        className="text-link justify-self-start"
      >
        {t('home.noValidPhone.link')}
      </Link>
    </section>
  );
}
