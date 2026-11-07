import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { ErrorState, LoadingOutline } from '@/components/states';
import { AnnouncementMonth } from '@/features/announcements/announcement-month';
import { portalAnnouncementsQuery } from '@/features/announcements/announcements-api';

/**
 * The Announcements page of the portal (task 11.7; `10`: announcements, later in Release 2): what
 * the school published for the child's parents in the month, as a list or a calendar; the server
 * sends only what reaches the child (the whole school, its branch, its branch and grade, its
 * class) and never what is for staff only.
 */
export function PortalAnnouncementsPage(): React.JSX.Element {
  const { t } = useTranslation();
  const { studentId } = useParams({ from: '/portal/$studentId/announcements' });
  const search = useSearch({ from: '/portal/$studentId/announcements' });
  const navigate = useNavigate({ from: '/portal/$studentId/announcements' });
  const month = useQuery(portalAnnouncementsQuery(studentId, search.month));
  return (
    <>
      <h1 className="text-[1.75rem]/[2.125rem] font-bold tracking-[-0.01em]">
        {t('portal.announcements.title')}
      </h1>
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
