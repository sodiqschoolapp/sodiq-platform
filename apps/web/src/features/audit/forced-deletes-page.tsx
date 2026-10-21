import { timeText, type ForcedDelete } from '@sodiq/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiFailure } from '@/api/failure';
import { FailureAlert } from '@/components/failure-alert';
import { ListPage } from '@/components/list/list-page';
import { type Column, type Filter, type ListSearch } from '@/components/list/list-state';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { useView } from '@/features/access/use-view';
import { BlockedRules } from '@/features/timetable/blocked-rules';
import { timetableKey } from '@/features/timetable/timetable-api';
import { formatMoment, schoolDateText } from '@/lib/dates';
import { FORCED_DELETES_KEY, forcedDeletesQuery, restoreForcedDelete } from './forced-deletes-api';

type Language = 'uz' | 'ru' | 'en';

const languageOf = (language: string): Language =>
  language === 'ru' || language === 'en' ? language : 'uz';

/**
 * The lessons the Super Admin deleted for good (task 5.8b, pull request #195;
 * `06`, Protection: "Forced delete is for Super Admin only, with a typed
 * reason. The attendance and marks are kept for 30 days and can be
 * restored."): the store of the branch, newest first, and in the side panel
 * the restore while its 30 days last. The server decides what can be
 * restored; a refusal lists the rules the lesson would break.
 */
export function ForcedDeletesPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const search = useSearch({ from: '/app/forced-deletes' });
  const { branchId } = useView();
  const records = useQuery(forcedDeletesQuery(branchId));
  const language = languageOf(i18n.language);

  const columns = useMemo((): Column<ForcedDelete>[] => {
    const lessonText = (row: ForcedDelete) =>
      `${schoolDateText(row.lesson.date, i18n.language)}, ${timeText(row.lesson.start)}–${timeText(row.lesson.end)}`;
    return [
      {
        key: 'lesson',
        header: t('forcedDeletes.lesson'),
        cell: (row) => lessonText(row),
        sortValue: (row) => row.lesson.startsAt,
        searchText: (row) => lessonText(row),
        opens: true,
      },
      {
        key: 'unit',
        header: t('forcedDeletes.unit'),
        cell: (row) => row.lesson.unit.name,
        sortValue: (row) => row.lesson.unit.name,
        searchText: (row) => row.lesson.unit.name,
      },
      {
        key: 'subject',
        header: t('forcedDeletes.subject'),
        cell: (row) => row.lesson.subject.names[language],
        searchText: (row) => row.lesson.subject.names[language],
      },
      {
        key: 'reason',
        header: t('forcedDeletes.reason'),
        cell: (row) => row.reason,
        searchText: (row) => row.reason,
      },
      {
        key: 'deleted',
        header: t('forcedDeletes.deleted'),
        cell: (row) =>
          t('forcedDeletes.deletedBy', {
            name: row.deletedBy.name,
            moment: formatMoment(i18n.language, row.deletedAt),
          }),
        sortValue: (row) => row.deletedAt,
      },
      {
        key: 'state',
        header: t('forcedDeletes.state'),
        cell: (row) => t(`forcedDeletes.state_${stateOf(row)}`),
        sortValue: (row) => stateOf(row),
      },
    ];
  }, [t, i18n.language, language]);

  const filters = useMemo(
    (): Filter<ForcedDelete>[] => [
      {
        key: 'state',
        label: t('forcedDeletes.state'),
        options: (['restorable', 'restored', 'expired'] as const).map((state) => ({
          value: state,
          label: t(`forcedDeletes.state_${state}`),
        })),
        matches: (row, value) => stateOf(row) === value,
      },
    ],
    [t],
  );

  const open = (next: ListSearch, how: 'push' | 'replace'): void => {
    void navigate({ to: '/forced-deletes', search: next, replace: how === 'replace' });
  };

  return (
    <>
      <PageHeader
        title={t('forcedDeletes.title')}
        breadcrumbs={[
          { label: t('home.title'), to: '/' },
          { label: t('setup.title'), to: '/setup' },
        ]}
      />
      <ListPage
        listId="forced-deletes"
        caption={t('forcedDeletes.caption')}
        rows={records.data?.entries}
        error={records.error ?? undefined}
        onRetry={() => {
          void records.refetch();
        }}
        rowId={(row) => row.id}
        rowName={(row) => `${row.lesson.unit.name}, ${row.lesson.subject.names[language]}`}
        columns={columns}
        filters={filters}
        search={search}
        onSearchChange={open}
        empty={{ title: t('forcedDeletes.emptyTitle'), text: t('forcedDeletes.empty') }}
        panel={(row) => <ForcedDeletePanel key={row.id} record={row} language={language} />}
      />
    </>
  );
}

/** Restorable, restored, or past its 30 days, as the server answered. */
function stateOf(row: ForcedDelete): 'restorable' | 'restored' | 'expired' {
  return row.restoredAt !== null ? 'restored' : row.restorable ? 'restorable' : 'expired';
}

/** One record of the store: what the lesson was, and the restore while it can be. */
function ForcedDeletePanel({ record, language }: { record: ForcedDelete; language: Language }) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { branchId } = useView();
  const key = useRef(crypto.randomUUID());
  const restore = useMutation({
    mutationFn: () => restoreForcedDelete(record.id, key.current),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: FORCED_DELETES_KEY });
      await queryClient.invalidateQueries({ queryKey: timetableKey(branchId) });
    },
  });
  const details = restore.error instanceof ApiFailure ? (restore.error.details ?? []) : [];
  const { lesson } = record;
  return (
    <div className="grid gap-4">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="font-semibold">{t('forcedDeletes.teacher')}</dt>
        <dd>{lesson.teacher?.name ?? t('timetable.day.needsTeacher')}</dd>
        <dt className="font-semibold">{t('forcedDeletes.room')}</dt>
        <dd>{lesson.room?.name ?? t('timetable.day.needsRoom')}</dd>
        <dt className="font-semibold">{t('forcedDeletes.subject')}</dt>
        <dd>{lesson.subject.names[language]}</dd>
        <dt className="font-semibold">{t('forcedDeletes.reason')}</dt>
        <dd>{record.reason}</dd>
        <dt className="font-semibold">{t('forcedDeletes.restoreUntil')}</dt>
        <dd>{formatMoment(i18n.language, record.restoreUntil)}</dd>
        {record.restoredBy !== null && record.restoredAt !== null && (
          <>
            <dt className="font-semibold">{t('forcedDeletes.restored')}</dt>
            <dd>
              {t('forcedDeletes.deletedBy', {
                name: record.restoredBy.name,
                moment: formatMoment(i18n.language, record.restoredAt),
              })}
            </dd>
          </>
        )}
      </dl>
      {restore.isSuccess && (
        <p role="status" className="text-sm">
          {t('forcedDeletes.restoredMessage')}
        </p>
      )}
      <FailureAlert error={restore.error} />
      {details.length > 0 && <BlockedRules details={details} intoText={() => ''} />}
      {record.restorable && !restore.isSuccess && (
        <div>
          <Button
            disabled={restore.isPending}
            onClick={() => {
              restore.mutate();
            }}
          >
            {t('forcedDeletes.restore')}
          </Button>
        </div>
      )}
    </div>
  );
}
