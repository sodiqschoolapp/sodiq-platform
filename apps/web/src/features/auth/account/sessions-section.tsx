import { sessionListSchema } from '@sodiq/shared';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { answerOf } from '@/api/failure';
import { useConfirm } from '@/components/confirm-dialog';
import { FailureAlert } from '@/components/failure-alert';
import { ErrorState, LoadingOutline } from '@/components/states';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { AccountSection } from './account-section';
import { formatMoment } from '../moments';
import { refreshSession, sessionQuery } from '../session';

export const sessionsQuery = queryOptions({
  queryKey: ['account', 'sessions'],
  queryFn: async () => sessionListSchema.parse(await answerOf(api.GET('/api/auth/sessions'))),
});

/** The trusted devices are the trusted sessions: whatever changes one list changes the other. */
export const DEVICES_KEY = ['account', 'trusted-devices'] as const;

/**
 * Edge cases, "Accounts and sign-in": several sessions are allowed, the profile
 * lists them, with "sign out everywhere". Decided by the owner (task 0.8d): the
 * session that asks stays signed in; its trust ends, as the spec says. No
 * button per session. A plain table, not a `ListPage`: a handful of rows with
 * no record to open and nothing to export.
 */
export function SessionsSection() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const sessions = useQuery(sessionsQuery);
  const { data: session } = useQuery(sessionQuery);
  const [signedOut, setSignedOut] = useState<number | null>(null);

  const signOutEverywhere = useMutation({
    mutationFn: async (others: number) => {
      await answerOf(api.POST('/api/auth/sign-out-everywhere'));
      return others;
    },
    onSuccess: async (others) => {
      setSignedOut(others);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: sessionsQuery.queryKey }),
        queryClient.invalidateQueries({ queryKey: DEVICES_KEY }),
        // This device may be trusted no more.
        refreshSession(queryClient),
      ]);
    },
  });

  const ask = async () => {
    // The list may be stale: the question names what is there now.
    const fresh = await sessions.refetch();
    const rows = fresh.data?.sessions ?? sessions.data?.sessions ?? [];
    const others = rows.filter((row) => !row.current).length;
    const trusted = session?.trustedUntil != null;
    const text = [
      t('account.signOutEverywhereText', { count: others }),
      ...(trusted ? [t('account.signOutEverywhereTrust')] : []),
    ].join(' ');
    if (
      await confirm({
        title: t('account.signOutEverywhereTitle'),
        text,
        action: t('account.signOutEverywhere'),
        destructive: true,
      })
    ) {
      setSignedOut(null);
      signOutEverywhere.mutate(others);
    }
  };

  let body;
  if (sessions.data !== undefined) {
    body = (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('account.device')}</TableHead>
            <TableHead>{t('account.started')}</TableHead>
            <TableHead>{t('account.lastUsed')}</TableHead>
            <TableHead>
              <span className="sr-only">{t('account.marks')}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sessions.data.sessions.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="max-w-xs truncate" title={row.userAgent ?? undefined}>
                {row.userAgent ?? t('account.unknownDevice')}
              </TableCell>
              <TableCell>{formatMoment(i18n.language, row.startedAt)}</TableCell>
              <TableCell>{formatMoment(i18n.language, row.lastUsedAt)}</TableCell>
              <TableCell className="space-x-2 text-muted-foreground">
                {row.current && <span>{t('account.thisDevice')}</span>}
                {row.trusted && <span>{t('account.trusted')}</span>}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  } else if (sessions.isError) {
    body = (
      <ErrorState
        error={sessions.error}
        onRetry={() => {
          void sessions.refetch();
        }}
      />
    );
  } else {
    body = <LoadingOutline />;
  }

  return (
    <AccountSection title={t('account.sessionsTitle')} text={t('account.sessionsText')}>
      {body}
      <FailureAlert error={signOutEverywhere.error} />
      {signedOut !== null && (
        <p role="status" className="text-sm font-medium">
          {t('account.signedOutEverywhere', { count: signedOut })}
        </p>
      )}
      <div>
        <Button
          variant="secondary"
          disabled={sessions.data === undefined || signOutEverywhere.isPending}
          onClick={() => {
            void ask();
          }}
        >
          {t('account.signOutEverywhere')}
        </Button>
      </div>
    </AccountSection>
  );
}
