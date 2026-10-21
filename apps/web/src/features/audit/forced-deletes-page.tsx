import { timeText, type ForcedDelete, type ForcedPlace } from '@sodiq/shared';
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
import { SETUP_KEY } from '@/features/setup/setup-api';
import { FORCED_DELETES_KEY, forcedDeletesQuery, restoreForcedDelete } from './forced-deletes-api';

type Language = 'uz' | 'ru' | 'en';

const languageOf = (language: string): Language =>
  language === 'ru' || language === 'en' ? language : 'uz';

/**
 * The records the Super Admin deleted for good (task 5.8b, pull request #195;
 * `06`, Protection: "Forced delete is for Super Admin only, with a typed
 * reason. The attendance and marks are kept for 30 days and can be
 * restored."): lessons, and buildings, floors and rooms (task 5.8c, pull
 * request #196). The store of the branch, newest first, and in the side
 * panel the restore while its 30 days last. The server decides what can be
 * restored; a refusal lists the rules a lesson would break.
 */
export function ForcedDeletesPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const search = useSearch({ from: '/app/forced-deletes' });
  const { branchId } = useView();
  const records = useQuery(forcedDeletesQuery(branchId));
  const language = languageOf(i18n.language);

  const columns = useMemo((): Column<ForcedDelete>[] => {
    const recordText = (row: ForcedDelete) =>
      t('forcedDeletes.recordText', {
        kind: t(`forcedDeletes.kind_${row.recordType}`),
        name:
          row.recordType === 'lesson'
            ? `${schoolDateText(row.lesson.date, i18n.language)}, ${timeText(row.lesson.start)}–${timeText(row.lesson.end)}`
            : row.place.name,
      });
    const aboutText = (row: ForcedDelete) =>
      row.recordType === 'lesson'
        ? `${row.lesson.unit.name}, ${row.lesson.subject.names[language]}`
        : placePath(row.place);
    return [
      {
        key: 'record',
        header: t('forcedDeletes.record'),
        cell: (row) => recordText(row),
        sortValue: (row) => (row.recordType === 'lesson' ? row.lesson.startsAt : row.place.name),
        searchText: (row) => recordText(row),
        opens: true,
      },
      {
        key: 'about',
        header: t('forcedDeletes.about'),
        cell: (row) => aboutText(row),
        sortValue: (row) => aboutText(row),
        searchText: (row) => aboutText(row),
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
            name: row.deletedBy.name === '' ? t('audit.unnamed') : row.deletedBy.name,
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
        rowName={(row) =>
          row.recordType === 'lesson'
            ? `${row.lesson.unit.name}, ${row.lesson.subject.names[language]}`
            : row.place.name
        }
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

/** Where a place was: its building and floor, or nothing for a building. */
function placePath(place: ForcedPlace): string {
  return [place.building?.name, place.floor?.name]
    .filter((one): one is string => one !== undefined)
    .join(', ');
}

/** One record of the store: what it was, and the restore while it can be. */
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
      await queryClient.invalidateQueries({ queryKey: SETUP_KEY });
    },
  });
  const details = restore.error instanceof ApiFailure ? (restore.error.details ?? []) : [];
  return (
    <div className="grid gap-4">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        {record.recordType === 'lesson' ? (
          <>
            <dt className="font-semibold">{t('forcedDeletes.teacher')}</dt>
            <dd>{record.lesson.teacher?.name ?? t('timetable.day.needsTeacher')}</dd>
            <dt className="font-semibold">{t('forcedDeletes.room')}</dt>
            <dd>{record.lesson.room?.name ?? t('timetable.day.needsRoom')}</dd>
            <dt className="font-semibold">{t('forcedDeletes.subject')}</dt>
            <dd>{record.lesson.subject.names[language]}</dd>
          </>
        ) : (
          <>
            {record.place.building !== null && (
              <>
                <dt className="font-semibold">{t('forcedDeletes.building')}</dt>
                <dd>{record.place.building.name}</dd>
              </>
            )}
            {record.place.floor !== null && (
              <>
                <dt className="font-semibold">{t('forcedDeletes.floor')}</dt>
                <dd>{record.place.floor.name}</dd>
              </>
            )}
            {record.recordType === 'building' && (
              <>
                <dt className="font-semibold">{t('forcedDeletes.floors')}</dt>
                <dd>
                  {record.place.floors.length === 0
                    ? t('forcedDeletes.noFloors')
                    : record.place.floors.map((one) => one.name).join(', ')}
                </dd>
              </>
            )}
          </>
        )}
        <dt className="font-semibold">{t('forcedDeletes.reason')}</dt>
        <dd>{record.reason}</dd>
        <dt className="font-semibold">{t('forcedDeletes.restoreUntil')}</dt>
        <dd>{formatMoment(i18n.language, record.restoreUntil)}</dd>
        {record.restoredBy !== null && record.restoredAt !== null && (
          <>
            <dt className="font-semibold">{t('forcedDeletes.restored')}</dt>
            <dd>
              {t('forcedDeletes.deletedBy', {
                name: record.restoredBy.name === '' ? t('audit.unnamed') : record.restoredBy.name,
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
