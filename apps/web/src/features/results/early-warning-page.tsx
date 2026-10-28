import {
  EARLY_WARNING_NOTE_MAX_LENGTH,
  EARLY_WARNING_REASONS,
  type EarlyWarningEntry,
  type EarlyWarningList,
  type EarlyWarningReasonKind,
} from '@sodiq/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FailureAlert } from '@/components/failure-alert';
import { SelectField, TextAreaField } from '@/components/field';
import { ListPage } from '@/components/list/list-page';
import {
  listSearch,
  type Column,
  type Filter,
  type ListSearch,
} from '@/components/list/list-state';
import { PageHeader } from '@/components/page-header';
import { PreparedStamp } from '@/components/prepared-stamp';
import { EmptyState, ErrorState, LoadingOutline } from '@/components/states';
import { Button } from '@/components/ui/button';
import { useMayView, useView } from '@/features/access/use-view';
import { nameOf } from '@/features/setup/setup-api';
import { formatMoment } from '@/lib/dates';
import { earlyWarningQuery, invalidateEarlyWarning, markHandled } from './early-warning-api';
import { useMayReport } from './reports-page';

export interface EarlyWarningSearch extends ListSearch {
  quarter?: string;
}

export function earlyWarningSearch(search: Record<string, unknown>): EarlyWarningSearch {
  const result: EarlyWarningSearch = listSearch(search);
  if (typeof search.quarter === 'string' && search.quarter !== '') result.quarter = search.quarter;
  return result;
}

type Thresholds = EarlyWarningList['thresholds'];
type Reason = EarlyWarningEntry['reasons'][number];

const rowIdOf = (entry: EarlyWarningEntry) => `${entry.student.id}|${entry.subject.id}`;

const studentName = (entry: EarlyWarningEntry): string =>
  [entry.student.lastName, entry.student.firstName].join(' ');

const figureText = (value: number | null): string => (value === null ? '—' : String(value));

/** The threshold a reason was measured against, as the settings of the branch give it. */
function thresholdOf(kind: EarlyWarningReasonKind, thresholds: Thresholds): number {
  switch (kind) {
    case 'low_result':
      return thresholds.lowResult;
    case 'result_drop':
      return thresholds.resultDrop;
    case 'low_attendance':
      return thresholds.attendancePercent;
    case 'absences_in_row':
      return thresholds.absencesInRow;
  }
}

/**
 * The early-warning list (task 9.4a; `08`, Early-warning list): the students who need attention
 * in the quarter, one row per student and subject, with the reasons, the figures and the trend,
 * and a link to the journal. The server decides who is listed and what the reader sees; a Tutor
 * or a teacher adds a staff-only note and marks a reason handled in the side panel.
 */
export function EarlyWarningPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const navigate = useNavigate();
  const search: EarlyWarningSearch = useSearch({ from: '/app/results/early-warning' });
  const { branchId } = useView();
  const mayRate = useMayView('rating');
  const mayReport = useMayReport();
  const list = useQuery(earlyWarningQuery(branchId, search.quarter));
  const data = list.data;

  const columns = useMemo((): Column<EarlyWarningEntry>[] => {
    const thresholds = data?.thresholds;
    const reasonText = (reason: Reason, given: Thresholds) =>
      t(`results.earlyWarning.reasonText.${reason.kind}`, {
        figure: reason.figure,
        threshold: thresholdOf(reason.kind, given),
      });
    return [
      {
        key: 'student',
        header: t('results.earlyWarning.student'),
        cell: (row) => studentName(row),
        sortValue: (row) => studentName(row),
        searchText: (row) => studentName(row),
        opens: true,
        fixed: true,
      },
      {
        key: 'subject',
        header: t('results.earlyWarning.subject'),
        cell: (row) => nameOf(row.subject.names, language),
        sortValue: (row) => nameOf(row.subject.names, language),
        searchText: (row) => nameOf(row.subject.names, language),
      },
      {
        key: 'unit',
        header: t('results.earlyWarning.unit'),
        cell: (row) => row.journal.unit.name,
        sortValue: (row) => row.journal.unit.name,
        searchText: (row) => row.journal.unit.name,
      },
      {
        key: 'reasons',
        header: t('results.earlyWarning.reasons'),
        cell: (row) =>
          thresholds === undefined ? null : (
            <ul className="grid gap-0.5">
              {row.reasons.map((reason) => (
                <li key={reason.kind} data-reason={reason.kind}>
                  {reasonText(reason, thresholds)}
                </li>
              ))}
            </ul>
          ),
      },
      {
        key: 'result',
        header: t('results.earlyWarning.result'),
        cell: (row) => <span data-result="">{figureText(row.figures.result)}</span>,
        sortValue: (row) => row.figures.result,
        numeric: true,
      },
      {
        key: 'attendance',
        header: t('results.earlyWarning.attendance'),
        cell: (row) =>
          row.figures.attendance === null
            ? '—'
            : t('results.earlyWarning.percent', { value: row.figures.attendance }),
        sortValue: (row) => row.figures.attendance,
        numeric: true,
      },
    ];
  }, [t, language, data?.thresholds]);

  const filters = useMemo(
    (): Filter<EarlyWarningEntry>[] => [
      {
        key: 'reason',
        label: t('results.earlyWarning.reasons'),
        options: EARLY_WARNING_REASONS.map((kind) => ({
          value: kind,
          label: t(`results.earlyWarning.reason.${kind}`),
        })),
        matches: (row, value) => row.reasons.some((reason) => reason.kind === value),
      },
    ],
    [t],
  );

  const go = (next: EarlyWarningSearch, how: 'push' | 'replace' = 'push') => {
    void navigate({ to: '/results/early-warning', search: next, replace: how === 'replace' });
  };
  const onSearchChange = (next: ListSearch, how: 'push' | 'replace') => {
    go({ ...next, ...(search.quarter === undefined ? {} : { quarter: search.quarter }) }, how);
  };

  let content: React.ReactNode;
  if (list.isError) {
    content = <ErrorState error={list.error} onRetry={() => void list.refetch()} />;
  } else if (data === undefined) {
    content = <LoadingOutline />;
  } else if (data.quarter === null) {
    content = (
      <EmptyState
        title={t('results.earlyWarning.title')}
        text={t('results.earlyWarning.nothing')}
      />
    );
  } else {
    const quarter = data.quarter;
    content = (
      <>
        <div className="flex flex-wrap items-end gap-4">
          <div className="w-40">
            <SelectField
              label={t('results.earlyWarning.quarter')}
              value={quarter.id}
              options={data.quarters.map((one) => ({
                value: one.id,
                label: t('results.earlyWarning.quarterNumber', { number: one.number }),
              }))}
              onChange={(event) => {
                go({ quarter: event.target.value });
              }}
            />
          </div>
        </div>
        {quarter.closed && (
          <p className="text-sm text-muted-foreground" data-closed="">
            {t('results.earlyWarning.closed')}
          </p>
        )}
        <ListPage
          listId="results-early-warning"
          caption={t('results.earlyWarning.caption')}
          rows={data.entries}
          rowId={rowIdOf}
          rowName={(row) => `${studentName(row)}, ${nameOf(row.subject.names, language)}`}
          columns={columns}
          filters={filters}
          search={search}
          onSearchChange={onSearchChange}
          empty={{ title: t('results.earlyWarning.title'), text: t('results.earlyWarning.empty') }}
          panel={(row) => (
            <EntryPanel
              key={rowIdOf(row)}
              entry={row}
              quarterId={quarter.id}
              thresholds={data.thresholds}
            />
          )}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={t('results.earlyWarning.title')}
        breadcrumbs={[{ label: t('home.title'), to: '/' }]}
        actions={
          mayRate || mayReport ? (
            <>
              {mayRate && (
                <Link to="/results/rating" className="text-link self-center text-sm">
                  {t('results.ratingList.title')}
                </Link>
              )}
              {mayReport && (
                <Link to="/results/reports" className="text-link self-center text-sm">
                  {t('results.reports.link')}
                </Link>
              )}
            </>
          ) : undefined
        }
      />
      <div className="grid gap-4">
        {list.data !== undefined && (
          <PreparedStamp
            stamp={list.data.prepared}
            refreshing={list.isFetching}
            onRefresh={() => {
              void list.refetch();
            }}
          />
        )}
        {content}
      </div>
    </>
  );
}

/** One student and subject: the reasons, the figures and the trend, and "Mark handled". */
function EntryPanel({
  entry,
  quarterId,
  thresholds,
}: {
  entry: EarlyWarningEntry;
  quarterId: string;
  thresholds: Thresholds;
}) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { branchId } = useView();
  const first = entry.reasons[0]?.kind ?? 'low_result';
  const [reason, setReason] = useState<EarlyWarningReasonKind>(first);
  const [note, setNote] = useState('');
  const chosen = entry.reasons.some((one) => one.kind === reason) ? reason : first;
  const handle = useMutation({
    mutationFn: () =>
      markHandled({
        quarterId,
        studentId: entry.student.id,
        subjectId: entry.subject.id,
        reason: chosen,
        note,
      }),
    onSuccess: async () => {
      setNote('');
      await invalidateEarlyWarning(queryClient, branchId);
    },
  });
  const { figures } = entry;
  return (
    <div className="grid gap-4">
      <ul className="grid gap-2 text-sm">
        {entry.reasons.map((one) => (
          <li key={one.kind} data-panel-reason={one.kind}>
            <span className="font-semibold">
              {t(`results.earlyWarning.reasonText.${one.kind}`, {
                figure: one.figure,
                threshold: thresholdOf(one.kind, thresholds),
              })}
            </span>
            {one.against.length > 0 && (
              <span className="text-muted-foreground">
                {' '}
                (
                {one.against
                  .map((against) => t(`results.earlyWarning.against.${against}`))
                  .join(', ')}
                )
              </span>
            )}
            {one.handledBefore !== null && (
              <p className="text-muted-foreground" data-handled-before="">
                {t(
                  one.handledBefore.note === ''
                    ? 'results.earlyWarning.handledBeforeNoNote'
                    : 'results.earlyWarning.handledBefore',
                  {
                    date: formatMoment(i18n.language, one.handledBefore.handledAt),
                    name: one.handledBefore.by,
                    figure: one.handledBefore.figure,
                    note: one.handledBefore.note,
                  },
                )}
              </p>
            )}
          </li>
        ))}
      </ul>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        {entry.attendanceOnly ? (
          <>
            <dt className="font-semibold">{t('results.earlyWarning.attendanceOnly')}</dt>
            <dd />
          </>
        ) : (
          <>
            <dt className="font-semibold">{t('results.earlyWarning.result')}</dt>
            <dd>{figureText(figures.result)}</dd>
            <dt className="font-semibold">{t('results.earlyWarning.trend')}</dt>
            <dd data-trend="">
              {t('results.earlyWarning.trendText', {
                now: figureText(figures.currentWork.now),
                daysAgo: figureText(figures.currentWork.daysAgo),
                previous: figureText(figures.currentWork.previousQuarter),
              })}
            </dd>
            <dt className="font-semibold">{t('results.earlyWarning.works')}</dt>
            <dd>{figureText(figures.gradedWorks)}</dd>
          </>
        )}
        <dt className="font-semibold">{t('results.earlyWarning.attendance')}</dt>
        <dd>
          {figures.attendance === null
            ? '—'
            : t('results.earlyWarning.percent', { value: figures.attendance })}
        </dd>
        <dt className="font-semibold">{t('results.earlyWarning.run')}</dt>
        <dd>{String(figures.absenceRun)}</dd>
      </dl>
      <div>
        <Link
          to="/journal/$journalId"
          params={{ journalId: entry.journal.id }}
          className="text-link text-sm"
        >
          {t('results.earlyWarning.openJournal')}
        </Link>
      </div>
      {handle.isSuccess && (
        <p role="status" className="text-sm">
          {t('results.earlyWarning.handled')}
        </p>
      )}
      <FailureAlert error={handle.error} />
      {entry.canHandle && (
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            handle.mutate();
          }}
        >
          {entry.reasons.length > 1 && (
            <SelectField
              label={t('results.earlyWarning.which')}
              value={chosen}
              options={entry.reasons.map((one) => ({
                value: one.kind,
                label: t(`results.earlyWarning.reason.${one.kind}`),
              }))}
              onChange={(event) => {
                const value = EARLY_WARNING_REASONS.find((kind) => kind === event.target.value);
                if (value !== undefined) setReason(value);
              }}
            />
          )}
          <TextAreaField
            label={t('results.earlyWarning.note')}
            value={note}
            maxLength={EARLY_WARNING_NOTE_MAX_LENGTH}
            onChange={(event) => {
              setNote(event.target.value);
            }}
          />
          <div>
            <Button type="submit" disabled={handle.isPending}>
              {t('results.earlyWarning.handle')}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
