import { PERMISSIONS, permits, type Division, type DivisionRecord } from '@sodiq/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { ApiFailure, answerOf } from '@/api/failure';
import { ListPage, type BulkAction } from '@/components/list/list-page';
import { useExport } from '@/components/list/use-export';
import { type Column, type Filter, type ListSearch } from '@/components/list/list-state';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { useLeave } from '@/components/unsent/unsent-changes';
import { useView } from '@/features/access/use-view';
import { DivisionPanel, NamesForm } from './division-panel';
import { divisionsQuery, invalidateDivisions, nameOf } from './setup-api';

/**
 * What a bulk archive or restore did: how many went through, which were
 * refused because they are built in (archive), and which for a name that an
 * active division has now (restore), by name.
 */
interface Outcome {
  restore: boolean;
  done: number;
  refused: string[];
  taken: string[];
  /** Refused because a staff member who has not left is in it (task 2.2a). */
  staffed: string[];
}

/** The refusals a bulk action names instead of stopping at: the others go on. */
function refusalOf(error: unknown, restore: boolean): 'refused' | 'taken' | 'staffed' | null {
  if (!(error instanceof ApiFailure)) {
    return null;
  }
  if (!restore && error.code === 'built_in') {
    return 'refused';
  }
  if (!restore && error.code === 'archive_refused') {
    return 'staffed';
  }
  return restore && error.code === 'already_exists' ? 'taken' : null;
}

/**
 * The list of divisions of the school (`03`, Divisions: "One list for the
 * whole school"; `12`, Lists), each opened in the side panel with its
 * departments. The Super Admin adds, renames, archives and restores (`02`);
 * the Principal and the Academic Vice Principal read. The call carries the
 * branch of the switcher like every call, but a change is a change for every
 * branch: the lists of all branches are refreshed.
 */
export function DivisionsPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const search = useSearch({ from: '/app/setup/divisions' });
  const { role, branchId } = useView();
  const queryClient = useQueryClient();
  const leave = useLeave();
  const [adding, setAdding] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const canEdit = role !== null && permits(PERMISSIONS, role, 'divisions', 'edit');
  const canCreate = role !== null && permits(PERMISSIONS, role, 'divisions', 'create');
  const canArchive = role !== null && permits(PERMISSIONS, role, 'divisions', 'archive');
  const canExport = role !== null && permits(PERMISSIONS, role, 'divisions', 'export');
  const exporter = useExport<Division>('divisions', (row) => row.id);
  const divisions = useQuery(divisionsQuery(branchId));
  const number = useMemo(() => new Intl.NumberFormat(i18n.language), [i18n.language]);
  const language = i18n.language;

  const refresh = () => invalidateDivisions(queryClient);

  const create = useMutation({
    mutationFn: (record: DivisionRecord) =>
      answerOf(api.POST('/api/setup/divisions', { body: record })),
    onSuccess: async () => {
      setAdding(false);
      await refresh();
    },
  });

  /** One call per division, in order; a refusal of one does not stop the others. */
  const archiveMany = useMutation({
    mutationFn: async ({ rows, restore }: { rows: Division[]; restore: boolean }) => {
      const result: Outcome = { restore, done: 0, refused: [], taken: [], staffed: [] };
      for (const row of rows) {
        try {
          await answerOf(
            api.POST(
              restore ? '/api/setup/divisions/{id}/restore' : '/api/setup/divisions/{id}/archive',
              { params: { path: { id: row.id } } },
            ),
          );
          result.done += 1;
        } catch (error) {
          const kind = refusalOf(error, restore);
          if (kind === null) {
            throw error;
          }
          result[kind].push(nameOf(row.names, language));
        }
      }
      return result;
    },
    onSuccess: setOutcome,
    onSettled: refresh,
  });

  /** People per main division, of the whole school (`03`, Divisions: "counted once, under the main division"). */
  const staffCounts = useMemo(
    () =>
      new Map(
        (divisions.data?.staffCounts ?? []).map((row) => [row.divisionId, row.people] as const),
      ),
    [divisions.data],
  );

  const columns = useMemo(
    (): Column<Division>[] => [
      {
        key: 'name',
        header: t('setup.divisions.name'),
        cell: (row) => nameOf(row.names, language),
        sortValue: (row) => nameOf(row.names, language),
        searchText: (row) => `${row.names.uz} ${row.names.ru} ${row.names.en}`,
        opens: true,
      },
      {
        key: 'departments',
        header: t('setup.divisions.departments'),
        cell: (row) =>
          number.format(row.departments.filter((one) => one.archivedAt === null).length),
        sortValue: (row) => row.departments.filter((one) => one.archivedAt === null).length,
        numeric: true,
      },
      {
        key: 'staff',
        header: t('setup.divisions.staff'),
        cell: (row) => number.format(staffCounts.get(row.id) ?? 0),
        sortValue: (row) => staffCounts.get(row.id) ?? 0,
        numeric: true,
      },
      {
        key: 'status',
        header: t('setup.divisions.status'),
        cell: (row) =>
          row.archivedAt === null ? t('setup.divisions.active') : t('setup.divisions.archived'),
        sortValue: (row) => (row.archivedAt === null ? 0 : 1),
      },
    ],
    [t, number, language, staffCounts],
  );

  const filters = useMemo(
    (): Filter<Division>[] => [
      {
        key: 'status',
        label: t('setup.divisions.status'),
        options: [
          { value: 'active', label: t('setup.divisions.active') },
          { value: 'archived', label: t('setup.divisions.archived') },
        ],
        matches: (row, value) => (row.archivedAt === null ? 'active' : 'archived') === value,
      },
    ],
    [t],
  );

  const bulkActions = useMemo((): BulkAction<Division>[] => {
    if (!canArchive) {
      return [];
    }
    const action = (restore: boolean): BulkAction<Division> => ({
      key: restore ? 'restore' : 'archive',
      label: restore ? t('setup.divisions.restore') : t('setup.divisions.archive'),
      run: (rows) => {
        archiveMany.mutate({ rows, restore });
      },
      confirm: (rows) => ({
        title: t(restore ? 'setup.divisions.restoreTitle' : 'setup.divisions.archiveTitle', {
          count: rows.length,
          n: number.format(rows.length),
        }),
        text: restore ? t('setup.divisions.restoreText') : t('setup.divisions.archiveText'),
        action: restore ? t('setup.divisions.restore') : t('setup.divisions.archive'),
        destructive: !restore,
      }),
    });
    return [action(false), action(true)];
  }, [canArchive, t, number, archiveMany]);

  const open = (next: ListSearch, how: 'push' | 'replace'): void => {
    void navigate({ to: '/setup/divisions', search: next, replace: how === 'replace' });
  };

  const addButton = canCreate && !adding && (
    <Button
      onClick={() => {
        setAdding(true);
      }}
    >
      {t('setup.divisions.add')}
    </Button>
  );

  return (
    <>
      <PageHeader
        title={t('setup.divisions.title')}
        breadcrumbs={[
          { label: t('home.title'), to: '/' },
          { label: t('setup.title'), to: '/setup' },
        ]}
        actions={addButton === false ? undefined : addButton}
      />
      {adding && (
        <section
          aria-label={t('setup.divisions.newTitle')}
          className="mb-6 grid max-w-xl gap-3 rounded-xl bg-card p-6 max-sm:p-4"
        >
          <h2 className="text-lg font-semibold">{t('setup.divisions.newTitle')}</h2>
          <NamesForm
            names={null}
            label={t('setup.divisions.newTitle')}
            takenText={t('setup.divisions.nameTaken')}
            onSave={async (record) => {
              await create.mutateAsync(record);
            }}
          />
          <div>
            <Button
              variant="ghost"
              onClick={() => {
                void leave.leave().then((leaves) => {
                  if (leaves) {
                    setAdding(false);
                  }
                });
              }}
            >
              {t('setup.divisions.cancel')}
            </Button>
          </div>
        </section>
      )}
      {outcome !== null && (
        <p role="status" className="mb-3 text-sm">
          {t(outcome.restore ? 'setup.divisions.restored' : 'setup.divisions.archived_done', {
            count: outcome.done,
            n: number.format(outcome.done),
          })}
          {outcome.refused.length > 0 && (
            <> {t('setup.divisions.refusedNames', { names: outcome.refused.join(', ') })}</>
          )}
          {outcome.taken.length > 0 && (
            <> {t('setup.divisions.takenNames', { names: outcome.taken.join(', ') })}</>
          )}
          {outcome.staffed.length > 0 && (
            <> {t('setup.divisions.staffedNames', { names: outcome.staffed.join(', ') })}</>
          )}
        </p>
      )}
      <ListPage
        listId="divisions"
        caption={t('setup.divisions.caption')}
        rows={divisions.data?.divisions}
        error={divisions.error ?? archiveMany.error ?? undefined}
        onRetry={() => {
          void divisions.refetch();
        }}
        rowId={(row) => row.id}
        rowName={(row) => nameOf(row.names, language)}
        columns={columns}
        filters={filters}
        onExport={canExport ? exporter.onExport : undefined}
        exportState={exporter.state}
        search={search}
        onSearchChange={open}
        empty={{
          title: t('setup.divisions.emptyTitle'),
          text: t('setup.divisions.empty'),
          action: addButton === false ? undefined : addButton,
        }}
        bulkActions={bulkActions}
        panel={(row) => <DivisionPanel key={row.id} division={row} canEdit={canEdit} />}
      />
    </>
  );
}
