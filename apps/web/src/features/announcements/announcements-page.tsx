import { PERMISSIONS, permits } from '@sodiq/shared';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/page-header';
import { ErrorState, LoadingOutline } from '@/components/states';
import { buttonVariants } from '@/components/ui/button';
import { useView } from '@/features/access/use-view';
import { AnnouncementMonth } from './announcement-month';
import { addressedQuery } from './announcements-api';

/**
 * The announcements and events addressed to the staff member in the branch of the switcher
 * (task 11.7, plan decision 4): the month as a list or a calendar. An author also has the link
 * to the list where announcements are written.
 */
export function AnnouncementsPage(): React.JSX.Element {
  const { t } = useTranslation();
  const { role, branchId } = useView();
  const search = useSearch({ from: '/app/announcements' });
  const navigate = useNavigate({ from: '/announcements' });
  const month = useQuery(addressedQuery(branchId, search.month));
  const writes = role !== null && permits(PERMISSIONS, role, 'announcements', 'view');
  return (
    <>
      <PageHeader
        title={t('announcements.title')}
        breadcrumbs={[{ label: t('home.title'), to: '/' }]}
        actions={
          writes ? (
            <Link to="/announcements/manage" className={buttonVariants({ variant: 'default' })}>
              {t('announcements.manage.link')}
            </Link>
          ) : undefined
        }
      />
      {month.isError ? (
        <ErrorState
          error={month.error}
          onRetry={() => {
            void month.refetch();
          }}
        />
      ) : month.data === undefined ? (
        <LoadingOutline lines={4} />
      ) : (
        <AnnouncementMonth
          month={month.data}
          view={search.view ?? 'list'}
          onView={(view) => {
            void navigate({ search: (old) => ({ ...old, view }), replace: true });
          }}
          onMonth={(next) => {
            void navigate({ search: (old) => ({ ...old, month: next }) });
          }}
        />
      )}
    </>
  );
}
