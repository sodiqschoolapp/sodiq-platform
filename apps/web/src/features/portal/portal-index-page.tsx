import { useQuery } from '@tanstack/react-query';
import { Navigate, useSearch } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { EmptyState, LoadingOutline } from '@/components/states';
import { portalChildrenQuery } from './portal-api';

/**
 * `/portal`: the timetable of the first child. A parent with no child in scope has no session
 * (`parent_account_blocked`), so the empty line is only a guard for a moment between two
 * requests (review should-fix 9).
 */
export function PortalIndexPage(): React.JSX.Element {
  const { t } = useTranslation();
  const children = useQuery(portalChildrenQuery);
  const { to } = useSearch({ from: '/portal/' });
  if (children.data === undefined) return <LoadingOutline />;
  const [first] = children.data.children;
  if (first === undefined) return <EmptyState text={t('portal.noChild')} />;
  // Task 11.7: the bot's button of an announcement opens the announcements of the first child.
  if (to === 'announcements') {
    return (
      <Navigate to="/portal/$studentId/announcements" params={{ studentId: first.id }} replace />
    );
  }
  return <Navigate to="/portal/$studentId/timetable" params={{ studentId: first.id }} replace />;
}
