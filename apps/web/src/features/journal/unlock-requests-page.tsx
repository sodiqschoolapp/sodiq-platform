import {
  UNLOCK_DAYS_MAX,
  UNLOCK_REASON_MAX_LENGTH,
  UNLOCK_VIEWS,
  editExtensionCreateSchema,
  type EditExtensionCreate,
  type JournalUnlock,
} from '@sodiq/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FailureAlert } from '@/components/failure-alert';
import { DateField, SelectField, TextAreaField } from '@/components/field';
import { wholeNumber } from '@/components/form/form-messages';
import { RecordForm } from '@/components/form/record-form';
import { useRecordForm } from '@/components/form/use-record-form';
import { ListPage } from '@/components/list/list-page';
import { listSearch, type Column, type ListSearch } from '@/components/list/list-state';
import { PageHeader } from '@/components/page-header';
import { ErrorState, LoadingOutline } from '@/components/states';
import { Button } from '@/components/ui/button';
import { PANEL, SECTION_TITLE } from '@/components/ui/control';
import { Segmented } from '@/components/ui/segmented';
import { useMayView, useView } from '@/features/access/use-view';
import { nameOf } from '@/features/setup/setup-api';
import { momentText, schoolDateText } from '@/lib/dates';
import { DecideUnlockDialog, useDrafts } from './edit-period';
import {
  extendEditPeriod,
  extensionsQuery,
  invalidateUnlocks,
  unlocksQuery,
  withdrawUnlock,
} from './unlocks-api';

type View = (typeof UNLOCK_VIEWS)[number];

export type UnlockRequestsSearch = ListSearch & { view?: View };

export function unlockRequestsSearch(search: Record<string, unknown>): UnlockRequestsSearch {
  const result: UnlockRequestsSearch = listSearch(search);
  const view = search.view;
  if (typeof view === 'string' && (UNLOCK_VIEWS as readonly string[]).includes(view)) {
    result.view = view as View;
  }
  return result;
}

/** The last open moment of a stored 00:00 end: 23:59 of the day before, as the spec words it. */
const lastMinuteOf = (iso: string): string => new Date(Date.parse(iso) - 60_000).toISOString();

/**
 * The unlock requests of the branch (task 8.4, pull request #222; `07`,
 * Editing rules and locks; `edge/journal`, Locks, unlocks and corrections;
 * `02`, "Who approves"): "Waiting for me" (the requests the reader may decide
 * now), "My requests", and "Branch" for the Super Admin, the Principal and the
 * Academic Vice Principal; and the branch-wide extension of the edit period
 * for the Academic Vice Principal (`edge/system-behaviour`). The routing and
 * "nobody approves their own" are the server's.
 */
export function UnlockRequestsPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const search: UnlockRequestsSearch = useSearch({ from: '/app/journal/unlocks' });
  const { branchId } = useView();
  const deciders = useMayView('journal_unlocks', 'edit');
  const branchReader = useMayView('journal_extensions');
  const extends_ = useMayView('journal_extensions', 'create');
  const views: View[] = [
    ...(deciders ? (['deciding'] as const) : []),
    'own',
    ...(branchReader ? (['branch'] as const) : []),
  ];
  const view: View =
    search.view !== undefined && views.includes(search.view) ? search.view : (views[0] ?? 'own');
  const requests = useQuery(unlocksQuery(branchId, view));
  const language = i18n.language;
  const whatOf = (row: JournalUnlock) =>
    row.date === null
      ? t('journal.locks.rating')
      : row.target === 'rating'
        ? t('journal.unlocks.rating', { date: schoolDateText(row.date, language, false) })
        : t('journal.unlocks.lesson', { date: schoolDateText(row.date, language, false) });
  const columns = useMemo(
    (): Column<JournalUnlock>[] => [
      {
        key: 'what',
        header: t('journal.unlocks.what'),
        cell: whatOf,
        sortValue: (row) => row.date ?? '',
        opens: true,
        fixed: true,
      },
      {
        key: 'unit',
        header: t('journal.unlocks.unit'),
        cell: (row) => row.unit.name,
        sortValue: (row) => row.unit.name,
        searchText: (row) => `${row.unit.name} ${row.person}`,
      },
      {
        key: 'subject',
        header: t('journal.unlocks.subject'),
        cell: (row) => nameOf(row.subject.names, language),
        sortValue: (row) => nameOf(row.subject.names, language),
      },
      {
        key: 'person',
        header: t('journal.unlocks.person'),
        cell: (row) => row.person,
        sortValue: (row) => row.person,
      },
      {
        key: 'status',
        header: t('journal.unlocks.statusLabel'),
        cell: (row) => t(`journal.unlocks.status.${row.status}`),
        sortValue: (row) => (row.canDecide ? 0 : row.status === 'sent' ? 1 : 2),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `whatOf` follows `t` and `language`.
    [t, language],
  );
  const go = (next: UnlockRequestsSearch, how: 'push' | 'replace' = 'push') => {
    void navigate({ to: '/journal/unlocks', search: next, replace: how === 'replace' });
  };
  return (
    <>
      <PageHeader
        title={t('journal.unlocks.title')}
        breadcrumbs={[
          { label: t('home.title'), to: '/' },
          { label: t('journal.page.title'), to: '/journal' },
        ]}
      />
      <div className="grid gap-4">
        {views.length > 1 && (
          <Segmented
            label={t('journal.unlocks.tabs')}
            options={views.map((one) => ({ value: one, label: t(`journal.unlocks.${one}`) }))}
            value={view}
            onChange={(value) => {
              go({ view: value });
            }}
          />
        )}
        {requests.isError ? (
          <ErrorState
            error={requests.error}
            onRetry={() => {
              void requests.refetch();
            }}
          />
        ) : (
          <ListPage
            listId="journal-unlocks"
            caption={t('journal.unlocks.caption')}
            rows={requests.data?.requests}
            rowId={(row) => row.id}
            rowName={(row) => `${whatOf(row)} · ${row.unit.name}`}
            columns={columns}
            search={search}
            onSearchChange={(next: ListSearch, how) => {
              go({ ...next, view }, how);
            }}
            panel={(row) => <UnlockPanel key={row.id} request={row} />}
            empty={{ title: t('journal.unlocks.emptyTitle'), text: t('journal.unlocks.empty') }}
          />
        )}
        {extends_ && <Extensions />}
      </div>
    </>
  );
}

function UnlockPanel({ request }: { request: JournalUnlock }) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const language = i18n.language;
  const [deciding, setDeciding] = useState(false);
  // The reason of a refusal typed and the dialog closed is kept (code review 1, finding 3).
  const drafts = useDrafts();
  const withdraw = useMutation({
    mutationFn: () => withdrawUnlock(request.id, request.version),
    onSuccess: () => invalidateUnlocks(queryClient),
  });
  return (
    <div className="grid gap-3 text-sm">
      <p>
        <span className="font-semibold">{t(`journal.unlocks.status.${request.status}`)}</span>
        {' · '}
        {t('journal.unlocks.requested', { at: momentText(language, request.requestedAt) })}
      </p>
      <p>{t('journal.unlocks.reasonLine', { reason: request.reason })}</p>
      {request.decidedBy !== null && request.decidedAt !== null && (
        <p>
          {t('journal.unlocks.decided', {
            name: request.decidedBy,
            at: momentText(language, request.decidedAt),
          })}
        </p>
      )}
      {request.openUntil !== null && (
        <p>
          {t('journal.unlocks.openUntil', {
            until: momentText(language, lastMinuteOf(request.openUntil)),
          })}
        </p>
      )}
      {request.refuseReason !== null && (
        <p>{t('journal.unlocks.refuseReason', { reason: request.refuseReason })}</p>
      )}
      {request.journalId !== null && (
        <div>
          <Button
            variant="ghost"
            onClick={() => {
              void navigate({
                to: '/journal/$journalId',
                params: { journalId: request.journalId ?? '' },
                search: request.quarterId === null ? {} : { quarter: request.quarterId },
              });
            }}
          >
            {t('journal.unlocks.openJournal')}
          </Button>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {request.canDecide && (
          <Button
            onClick={() => {
              setDeciding(true);
            }}
          >
            {t('journal.unlocks.decide')}
          </Button>
        )}
        {request.canWithdraw && (
          <Button
            variant="secondary"
            disabled={withdraw.isPending}
            onClick={() => {
              withdraw.mutate();
            }}
          >
            {t('journal.unlocks.withdraw')}
          </Button>
        )}
      </div>
      <FailureAlert error={withdraw.error} />
      {deciding && (
        <DecideUnlockDialog
          unlockId={request.id}
          version={request.version}
          draft={drafts.draftOf(request.id)}
          onTyped={(text) => {
            drafts.keep(request.id, text);
          }}
          onSent={() => {
            drafts.drop(request.id);
          }}
          onClose={() => {
            setDeciding(false);
          }}
        />
      )}
    </div>
  );
}

/** `edge/system-behaviour`: "extends the edit period for a date range for the whole branch in one logged action". */
function Extensions() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { branchId } = useView();
  const list = useQuery(extensionsQuery(branchId));
  const language = i18n.language;
  // Each extension made gives a new, empty form (code review 2, finding 2).
  const [made, setMade] = useState(0);
  return (
    <section className={`${PANEL} grid gap-4`} aria-labelledby="edit-extensions">
      <h2 id="edit-extensions" className={SECTION_TITLE}>
        {t('journal.unlocks.extensionsTitle')}
      </h2>
      <ExtensionForm
        key={made}
        onSave={async (extension) => {
          await extendEditPeriod(extension);
          await invalidateUnlocks(queryClient);
        }}
        onSaved={() => {
          setMade((count) => count + 1);
        }}
      />
      {made > 0 && <p role="status">{t('journal.unlocks.extended')}</p>}
      {list.isError ? (
        <ErrorState
          error={list.error}
          onRetry={() => {
            void list.refetch();
          }}
        />
      ) : list.data === undefined ? (
        <LoadingOutline />
      ) : list.data.extensions.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('journal.unlocks.extensionsEmpty')}</p>
      ) : (
        <ul className="grid gap-2 text-sm">
          {list.data.extensions.map((one) => (
            <li key={one.id}>
              {t('journal.unlocks.extensionLine', {
                from: schoolDateText(one.fromDate, language, false),
                to: schoolDateText(one.toDate, language, false),
                until: momentText(language, lastMinuteOf(one.openUntil)),
                name: one.createdBy ?? '—',
                reason: one.reason,
              })}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

type ExtensionField = 'fromDate' | 'toDate' | 'days' | 'reason';

/**
 * The form of a new extension: a record form (`useRecordForm` with
 * `editExtensionCreateSchema`, the schema the server checks, and
 * `RecordForm`), so the dates, the days, the reason and "the first day comes
 * before the last" are checked as typed (code review 2, finding 2).
 */
function ExtensionForm({
  onSave,
  onSaved,
}: {
  onSave: (extension: EditExtensionCreate) => Promise<void>;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const read = useCallback(
    (typed: Record<ExtensionField, string>): unknown => ({
      ...typed,
      days: wholeNumber(typed.days),
    }),
    [],
  );
  const form = useRecordForm<ExtensionField, EditExtensionCreate>({
    schema: editExtensionCreateSchema,
    initial: { fromDate: '', toDate: '', days: '1', reason: '' },
    read,
    message: (field, issue) =>
      field === 'toDate' && issue.code === 'custom'
        ? t('journal.unlocks.toBeforeFrom')
        : field === 'fromDate' || field === 'toDate'
          ? t('journal.unlocks.dateNeeded')
          : field === 'reason' && issue.code === 'too_small'
            ? t('journal.locks.reasonNeeded')
            : undefined,
    save: async (extension) => {
      await onSave(extension);
      onSaved();
    },
  });
  return (
    <RecordForm form={form} label={t('journal.unlocks.extensionsTitle')}>
      <DateField label={t('journal.unlocks.fromDate')} {...form.bind('fromDate')} />
      <DateField label={t('journal.unlocks.toDate')} {...form.bind('toDate')} />
      <SelectField
        label={t('journal.unlocks.days')}
        options={Array.from({ length: UNLOCK_DAYS_MAX }, (_, index) => ({
          value: String(index + 1),
          label: String(index + 1),
        }))}
        {...form.bind('days')}
      />
      <TextAreaField
        label={t('journal.unlocks.reason')}
        maxLength={UNLOCK_REASON_MAX_LENGTH}
        {...form.bind('reason')}
      />
    </RecordForm>
  );
}
