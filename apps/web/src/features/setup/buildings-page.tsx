import { PERMISSIONS, permits, type Building, type BuildingRecord } from '@sodiq/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, branchHeader } from '@/api/client';
import { ApiFailure, answerOf } from '@/api/failure';
import { ListPage, type BulkAction } from '@/components/list/list-page';
import { useExport } from '@/components/list/use-export';
import { type Column, type Filter, type ListSearch } from '@/components/list/list-state';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { useLeave } from '@/components/unsent/unsent-changes';
import { useView } from '@/features/access/use-view';
import { BuildingForm, BuildingPanel } from './building-panel';
import { buildingsQuery, SETUP_KEY } from './setup-api';

/**
 * What a bulk archive or restore did: how many went through, which were
 * refused for a room in use (archive), and which for a name that an active
 * building has now (restore), by name.
 */
interface Outcome {
  restore: boolean;
  done: number;
  refused: string[];
  taken: string[];
}

/** The refusals a bulk action names instead of stopping at: the others go on. */
function refusalOf(error: unknown, restore: boolean): 'refused' | 'taken' | null {
  if (!(error instanceof ApiFailure)) {
    return null;
  }
  if (error.code === 'archive_refused') {
    return 'refused';
  }
  return restore && error.code === 'already_exists' ? 'taken' : null;
}

/**
 * The list of buildings of the branch in use (`12`, Lists), each opened in
 * the side panel with its floors. The Super Admin adds, renames, archives and
 * restores (`02`); the Principal and the Academic Vice Principal read.
 */
export function BuildingsPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const search = useSearch({ from: '/app/setup/buildings' });
  const { role, branchId } = useView();
  const queryClient = useQueryClient();
  const leave = useLeave();
  const [adding, setAdding] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const canEdit = role !== null && permits(PERMISSIONS, role, 'rooms', 'edit');
  const canCreate = role !== null && permits(PERMISSIONS, role, 'rooms', 'create');
  const canArchive = role !== null && permits(PERMISSIONS, role, 'rooms', 'archive');
  const canExport = role !== null && permits(PERMISSIONS, role, 'rooms', 'export');
  const exporter = useExport<Building>('buildings', (row) => row.id);
  const buildings = useQuery(buildingsQuery(branchId));
  const number = useMemo(() => new Intl.NumberFormat(i18n.language), [i18n.language]);

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: [...SETUP_KEY, 'buildings', branchId] });

  const create = useMutation({
    mutationFn: (record: BuildingRecord) =>
      answerOf(
        api.POST('/api/setup/buildings', { params: { header: branchHeader() }, body: record }),
      ),
    onSuccess: async () => {
      setAdding(false);
      await refresh();
    },
  });

  /** One call per building, in order; a refusal of one does not stop the others. */
  const archiveMany = useMutation({
    mutationFn: async ({ rows, restore }: { rows: Building[]; restore: boolean }) => {
      const result: Outcome = { restore, done: 0, refused: [], taken: [] };
      for (const row of rows) {
        try {
          await answerOf(
            api.POST(
              restore ? '/api/setup/buildings/{id}/restore' : '/api/setup/buildings/{id}/archive',
              {
                params: { header: branchHeader(), path: { id: row.id } },
              },
            ),
          );
          result.done += 1;
        } catch (error) {
          const kind = refusalOf(error, restore);
          if (kind === null) {
            throw error;
          }
          result[kind].push(row.name);
        }
      }
      return result;
    },
    onSuccess: setOutcome,
    onSettled: refresh,
  });

  const columns = useMemo(
    (): Column<Building>[] => [
      {
        key: 'name',
        header: t('setup.buildings.name'),
        cell: (row) => row.name,
        sortValue: (row) => row.name,
        searchText: (row) => row.name,
        opens: true,
      },
      {
        key: 'floors',
        header: t('setup.buildings.floors'),
        cell: (row) =>
          number.format(row.floors.filter((floor) => floor.archivedAt === null).length),
        sortValue: (row) => row.floors.filter((floor) => floor.archivedAt === null).length,
        numeric: true,
      },
      {
        key: 'rooms',
        header: t('setup.buildings.rooms'),
        cell: (row) => number.format(row.floors.reduce((sum, floor) => sum + floor.roomCount, 0)),
        sortValue: (row) => row.floors.reduce((sum, floor) => sum + floor.roomCount, 0),
        numeric: true,
      },
      {
        key: 'status',
        header: t('setup.buildings.status'),
        cell: (row) =>
          row.archivedAt === null ? t('setup.buildings.active') : t('setup.buildings.archived'),
        sortValue: (row) => (row.archivedAt === null ? 0 : 1),
      },
    ],
    [t, number],
  );

  const filters = useMemo(
    (): Filter<Building>[] => [
      {
        key: 'status',
        label: t('setup.buildings.status'),
        options: [
          { value: 'active', label: t('setup.buildings.active') },
          { value: 'archived', label: t('setup.buildings.archived') },
        ],
        matches: (row, value) => (row.archivedAt === null ? 'active' : 'archived') === value,
      },
    ],
    [t],
  );

  const bulkActions = useMemo((): BulkAction<Building>[] => {
    if (!canArchive) {
      return [];
    }
    const action = (restore: boolean): BulkAction<Building> => ({
      key: restore ? 'restore' : 'archive',
      label: restore ? t('setup.buildings.restore') : t('setup.buildings.archive'),
      run: (rows) => {
        archiveMany.mutate({ rows, restore });
      },
      confirm: (rows) => ({
        title: t(restore ? 'setup.buildings.restoreTitle' : 'setup.buildings.archiveTitle', {
          count: rows.length,
          n: number.format(rows.length),
        }),
        text: restore ? t('setup.buildings.restoreText') : t('setup.buildings.archiveText'),
        action: restore ? t('setup.buildings.restore') : t('setup.buildings.archive'),
        destructive: !restore,
      }),
    });
    return [action(false), action(true)];
  }, [canArchive, t, number, archiveMany]);

  const open = (next: ListSearch, how: 'push' | 'replace'): void => {
    void navigate({ to: '/setup/buildings', search: next, replace: how === 'replace' });
  };

  const addButton = canCreate && !adding && (
    <Button
      onClick={() => {
        setAdding(true);
      }}
    >
      {t('setup.buildings.add')}
    </Button>
  );

  return (
    <>
      <PageHeader
        title={t('setup.buildings.title')}
        breadcrumbs={[
          { label: t('home.title'), to: '/' },
          { label: t('setup.title'), to: '/setup' },
        ]}
        actions={addButton === false ? undefined : addButton}
      />
      {adding && (
        <section
          aria-label={t('setup.buildings.newTitle')}
          className="mb-6 grid max-w-xl gap-3 rounded-xl bg-card p-6 max-sm:p-4"
        >
          <h2 className="text-lg font-semibold">{t('setup.buildings.newTitle')}</h2>
          <BuildingForm
            building={null}
            label={t('setup.buildings.newTitle')}
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
              {t('setup.buildings.cancel')}
            </Button>
          </div>
        </section>
      )}
      {outcome !== null && (
        <p role="status" className="mb-3 text-sm">
          {t(outcome.restore ? 'setup.buildings.restored' : 'setup.buildings.archived_done', {
            count: outcome.done,
            n: number.format(outcome.done),
          })}
          {outcome.refused.length > 0 && (
            <> {t('setup.buildings.refusedNames', { names: outcome.refused.join(', ') })}</>
          )}
          {outcome.taken.length > 0 && (
            <> {t('setup.buildings.takenNames', { names: outcome.taken.join(', ') })}</>
          )}
        </p>
      )}
      <ListPage
        listId="buildings"
        caption={t('setup.buildings.caption')}
        rows={buildings.data?.buildings}
        error={buildings.error ?? archiveMany.error ?? undefined}
        onRetry={() => {
          void buildings.refetch();
        }}
        rowId={(row) => row.id}
        rowName={(row) => row.name}
        columns={columns}
        filters={filters}
        onExport={canExport ? exporter.onExport : undefined}
        exportState={exporter.state}
        search={search}
        onSearchChange={open}
        empty={{
          text: t('setup.buildings.empty'),
          action: addButton === false ? undefined : addButton,
        }}
        bulkActions={bulkActions}
        panel={(row) => (
          <BuildingPanel key={row.id} building={row} canEdit={canEdit} branchId={branchId} />
        )}
      />
    </>
  );
}
