import { useInfiniteQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { EmptyState, ErrorState, LoadingOutline } from '@/components/states';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { signInHistoryQuery } from '@/features/audit/audit-api';
import { actionName } from '@/features/audit/entry-panel';
import { AccountSection } from './account-section';
import { formatMoment } from '../moments';

/**
 * The own sign-in history (edge cases, Personal data and the audit log:
 * "every user sees their own sign-in history"; task 2.6a, decisions 10 and
 * 11): sign-ins, sign-outs, the second step, password changes and resets,
 * locks, newest first, 50 at a time. An administrator's action names the
 * administrator, as "your password was reset by X"; a lock's reason is not
 * shown. A plain table, not a `ListPage`: no record to open, nothing to export.
 */
export function SignInHistorySection() {
  const { t, i18n } = useTranslation();
  const history = useInfiniteQuery(signInHistoryQuery);
  const events = history.data?.pages.flatMap((page) => page.events);

  let body;
  if (events !== undefined) {
    body =
      events.length === 0 ? (
        <EmptyState text={t('account.signInEmpty')} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('account.signInWhen')}</TableHead>
              <TableHead>{t('account.signInEvent')}</TableHead>
              <TableHead>{t('account.signInBy')}</TableHead>
              <TableHead>{t('account.signInBrowser')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {events.map((event) => (
              <TableRow key={event.id}>
                <TableCell>{formatMoment(i18n.language, event.occurredAt)}</TableCell>
                <TableCell>{actionName(t, event.action)}</TableCell>
                <TableCell>{event.by ?? ''}</TableCell>
                <TableCell className="max-w-xs truncate" title={event.browser ?? undefined}>
                  {event.browser ?? ''}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      );
  } else if (history.isError) {
    body = (
      <ErrorState
        error={history.error}
        onRetry={() => {
          void history.refetch();
        }}
      />
    );
  } else {
    body = <LoadingOutline />;
  }

  return (
    <AccountSection title={t('account.signInHistoryTitle')} text={t('account.signInHistoryText')}>
      {body}
      {history.hasNextPage && (
        <div>
          <Button
            variant="secondary"
            disabled={history.isFetchingNextPage}
            onClick={() => {
              void history.fetchNextPage();
            }}
          >
            {history.isFetchingNextPage ? t('app.loading') : t('list.loadMore')}
          </Button>
        </div>
      )}
    </AccountSection>
  );
}
