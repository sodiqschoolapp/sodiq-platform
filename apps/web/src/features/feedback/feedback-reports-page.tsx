import { FEEDBACK_HANDLED_LISTED, ROLES, type FeedbackReportEntry } from '@sodiq/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ListPage } from '@/components/list/list-page';
import { type Column, type Filter, type ListSearch } from '@/components/list/list-state';
import { PanelActions } from '@/components/list/panel-actions';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { formatMoment } from '@/lib/dates';
import {
  FEEDBACK_REPORTS_KEY,
  feedbackReportsQuery,
  markFeedbackReport,
} from './feedback-reports-api';

type State = 'new' | 'handled';

const stateOf = (row: FeedbackReportEntry): State => (row.handledAt === null ? 'new' : 'handled');

/**
 * The Feedback reports page of the Super Admin (pull request #361; owner, 19 November 2026;
 * `14`, Monitoring: "A feedback button on every page sends a report with the page and role
 * attached"): every report of the school, newest first, and in the side panel the mark that it
 * was handled, or new again.
 */
export function FeedbackReportsPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const search = useSearch({ from: '/app/feedback-reports' });
  const reports = useQuery(feedbackReportsQuery());

  const columns = useMemo((): Column<FeedbackReportEntry>[] => {
    const senderText = (row: FeedbackReportEntry) =>
      row.sender.name === '' ? t('audit.unnamed') : row.sender.name;
    const rolesText = (row: FeedbackReportEntry) =>
      row.roles.length === 0
        ? t('feedbackReports.noRole')
        : row.roles.map((role) => t(`roles.${role}`)).join(', ');
    return [
      {
        key: 'text',
        header: t('feedbackReports.text'),
        cell: (row) => <span className="line-clamp-2 max-w-prose">{row.text}</span>,
        searchText: (row) => row.text,
        opens: true,
      },
      {
        key: 'sender',
        header: t('feedbackReports.sender'),
        cell: senderText,
        sortValue: senderText,
        searchText: senderText,
      },
      {
        key: 'roles',
        header: t('feedbackReports.roles'),
        cell: rolesText,
        searchText: rolesText,
      },
      {
        key: 'page',
        header: t('feedbackReports.page'),
        cell: (row) => <code className="text-sm">{row.page}</code>,
        sortValue: (row) => row.page,
        searchText: (row) => row.page,
      },
      {
        key: 'sent',
        header: t('feedbackReports.sent'),
        cell: (row) => formatMoment(i18n.language, row.createdAt),
        sortValue: (row) => row.createdAt,
      },
      {
        key: 'state',
        header: t('feedbackReports.state'),
        cell: (row) => t(`feedbackReports.state_${stateOf(row)}`),
        sortValue: stateOf,
      },
    ];
  }, [t, i18n.language]);

  const filters = useMemo(
    (): Filter<FeedbackReportEntry>[] => [
      {
        key: 'state',
        label: t('feedbackReports.state'),
        options: (['new', 'handled'] as const).map((state) => ({
          value: state,
          label: t(`feedbackReports.state_${state}`),
        })),
        matches: (row, value) => stateOf(row) === value,
      },
      {
        key: 'role',
        label: t('feedbackReports.roles'),
        options: ROLES.map((role) => ({ value: role, label: t(`roles.${role}`) })),
        matches: (row, value) => row.roles.some((role) => role === value),
      },
    ],
    [t],
  );

  const open = (next: ListSearch, how: 'push' | 'replace'): void => {
    void navigate({ to: '/feedback-reports', search: next, replace: how === 'replace' });
  };

  return (
    <>
      <PageHeader
        title={t('feedbackReports.title')}
        breadcrumbs={[
          { label: t('home.title'), to: '/' },
          { label: t('setup.title'), to: '/setup' },
        ]}
      />
      {reports.data?.handledTruncated === true && (
        <p className="mb-4 text-sm text-muted-foreground">
          {t('feedbackReports.handledTruncated', { count: FEEDBACK_HANDLED_LISTED })}
        </p>
      )}
      <ListPage
        listId="feedback-reports"
        caption={t('feedbackReports.caption')}
        rows={reports.data?.entries}
        error={reports.error ?? undefined}
        onRetry={() => {
          void reports.refetch();
        }}
        rowId={(row) => row.id}
        rowName={(row) =>
          t('feedbackReports.rowName', {
            name: row.sender.name === '' ? t('audit.unnamed') : row.sender.name,
            moment: formatMoment(i18n.language, row.createdAt),
          })
        }
        columns={columns}
        filters={filters}
        search={search}
        onSearchChange={open}
        empty={{ title: t('feedbackReports.emptyTitle'), text: t('feedbackReports.empty') }}
        panel={(row) => <FeedbackReportPanel key={row.id} report={row} />}
      />
    </>
  );
}

/** One report: every field, and the mark that it was handled or new again. */
function FeedbackReportPanel({ report }: { report: FeedbackReportEntry }) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const handled = report.handledAt !== null;
  const mark = useMutation({
    mutationFn: () => markFeedbackReport(report.id, !handled),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: FEEDBACK_REPORTS_KEY });
    },
  });
  const nameOf = (name: string) => (name === '' ? t('audit.unnamed') : name);
  return (
    <div className="grid gap-4">
      <PanelActions
        primary={
          <Button
            disabled={mark.isPending}
            onClick={() => {
              mark.mutate();
            }}
          >
            {handled ? t('feedbackReports.markNew') : t('feedbackReports.markHandled')}
          </Button>
        }
        error={mark.error}
      />
      <p className="max-w-prose whitespace-pre-wrap break-words">{report.text}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="font-semibold">{t('feedbackReports.sender')}</dt>
        <dd>{nameOf(report.sender.name)}</dd>
        <dt className="font-semibold">{t('feedbackReports.roles')}</dt>
        <dd>
          {report.roles.length === 0
            ? t('feedbackReports.noRole')
            : report.roles.map((role) => t(`roles.${role}`)).join(', ')}
        </dd>
        <dt className="font-semibold">{t('feedbackReports.page')}</dt>
        <dd>
          <code className="break-all">{report.page}</code>
        </dd>
        <dt className="font-semibold">{t('feedbackReports.sent')}</dt>
        <dd>{formatMoment(i18n.language, report.createdAt)}</dd>
        <dt className="font-semibold">{t('feedbackReports.appVersion')}</dt>
        <dd>{report.appVersion === null ? t('feedbackReports.noVersion') : report.appVersion}</dd>
        <dt className="font-semibold">{t('feedbackReports.state')}</dt>
        <dd>
          {report.handledAt === null || report.handledBy === null
            ? t('feedbackReports.state_new')
            : t('feedbackReports.handledBy', {
                name: nameOf(report.handledBy.name),
                moment: formatMoment(i18n.language, report.handledAt),
              })}
        </dd>
      </dl>
    </div>
  );
}
