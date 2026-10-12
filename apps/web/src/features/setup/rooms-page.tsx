import {
  PERMISSIONS,
  permits,
  ROOM_STATUSES,
  ROOM_TYPES,
  type Room,
  type RoomRecord,
  type RoomStatus,
} from '@sodiq/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, branchHeader } from '@/api/client';
import { answerOf } from '@/api/failure';
import { ListPage, type BulkAction } from '@/components/list/list-page';
import { useExport } from '@/components/list/use-export';
import { type Column, type Filter, type ListSearch } from '@/components/list/list-state';
import { PageHeader } from '@/components/page-header';
import { Button, buttonVariants } from '@/components/ui/button';
import { useLeave } from '@/components/unsent/unsent-changes';
import { useView } from '@/features/access/use-view';
import { isNamedRefusal } from './building-panel';
import { RoomForm } from './room-form';
import { activeFloorsOf, buildingsQuery, roomsQuery, SETUP_KEY } from './setup-api';

/** The fields of a room as the edit route takes them. */
const recordOf = (room: Room, status: RoomStatus): RoomRecord => ({
  name: room.name,
  floorId: room.floorId,
  type: room.type,
  capacity: room.capacity,
  status,
  shared: room.shared,
  maxSimultaneousLessons: room.maxSimultaneousLessons,
});

/**
 * The room list (`12`, Lists: search, filters, column chooser, sorting,
 * checkboxes with bulk actions, a side panel). The Super Admin adds and edits
 * rooms and changes the status of several at once; the Principal and the
 * Academic Vice Principal read. "Add room" is switched off while the branch
 * has no active floor and says what is missing (`edge/academic-year`: "An
 * action whose prerequisite is missing is switched off and says what is
 * missing"). No export until 2.2 brings the export route.
 */
export function RoomsPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const search = useSearch({ from: '/app/setup/rooms' });
  const { role, branchId } = useView();
  const queryClient = useQueryClient();
  const leave = useLeave();
  const [adding, setAdding] = useState(false);
  const [changed, setChanged] = useState<{ done: number; refused: string[] } | null>(null);
  const canEdit = role !== null && permits(PERMISSIONS, role, 'rooms', 'edit');
  const canCreate = role !== null && permits(PERMISSIONS, role, 'rooms', 'create');
  const canExport = role !== null && permits(PERMISSIONS, role, 'rooms', 'export');
  const exporter = useExport<Room>('/api/setup/rooms/export', (row) => row.id);
  const rooms = useQuery(roomsQuery(branchId));
  const buildings = useQuery(buildingsQuery(branchId));
  const number = useMemo(() => new Intl.NumberFormat(i18n.language), [i18n.language]);
  const floors = useMemo(() => activeFloorsOf(buildings.data?.buildings ?? []), [buildings.data]);
  const floorsKnown = buildings.data !== undefined;

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: [...SETUP_KEY, 'rooms', branchId] });

  const create = useMutation({
    mutationFn: (record: RoomRecord) =>
      answerOf(api.POST('/api/setup/rooms', { params: { header: branchHeader() }, body: record })),
    onSuccess: async () => {
      setAdding(false);
      await refresh();
      // The counts of rooms per floor changed.
      await queryClient.invalidateQueries({ queryKey: [...SETUP_KEY, 'buildings', branchId] });
    },
  });

  const edit = useMutation({
    mutationFn: ({ id, record }: { id: string; record: RoomRecord }) =>
      answerOf(
        api.PUT('/api/setup/rooms/{id}', {
          params: { header: branchHeader(), path: { id } },
          body: record,
        }),
      ),
    onSuccess: async () => {
      await refresh();
      await queryClient.invalidateQueries({ queryKey: [...SETUP_KEY, 'buildings', branchId] });
    },
  });

  /**
   * One call per room that is not in that status yet, in order. A room on an
   * archived floor cannot be put in use: it is named, and the others go on.
   */
  const setStatus = useMutation({
    mutationFn: async ({ rows, status }: { rows: Room[]; status: RoomStatus }) => {
      const result = { done: 0, refused: [] as string[] };
      for (const row of rows.filter((room) => room.status !== status)) {
        try {
          await answerOf(
            api.PUT('/api/setup/rooms/{id}', {
              params: { header: branchHeader(), path: { id: row.id } },
              body: recordOf(row, status),
            }),
          );
          result.done += 1;
        } catch (error) {
          if (!isNamedRefusal(error)) {
            throw error;
          }
          result.refused.push(row.name);
        }
      }
      return result;
    },
    onSuccess: setChanged,
    onSettled: refresh,
  });

  const columns = useMemo(
    (): Column<Room>[] => [
      {
        key: 'name',
        header: t('setup.rooms.name'),
        cell: (row) => row.name,
        sortValue: (row) => row.name,
        searchText: (row) => row.name,
        opens: true,
      },
      {
        key: 'building',
        header: t('setup.rooms.building'),
        cell: (row) => row.buildingName,
        sortValue: (row) => row.buildingName,
        searchText: (row) => row.buildingName,
      },
      {
        key: 'floor',
        header: t('setup.rooms.floor'),
        cell: (row) => row.floorName,
        sortValue: (row) => row.floorName,
        searchText: (row) => row.floorName,
      },
      {
        key: 'type',
        header: t('setup.rooms.type'),
        cell: (row) => t(`setup.rooms.types.${row.type}`),
        sortValue: (row) => t(`setup.rooms.types.${row.type}`),
      },
      {
        key: 'capacity',
        header: t('setup.rooms.capacity'),
        cell: (row) => number.format(row.capacity),
        sortValue: (row) => row.capacity,
        numeric: true,
      },
      {
        key: 'status',
        header: t('setup.rooms.status'),
        cell: (row) => t(`setup.rooms.statuses.${row.status}`),
        sortValue: (row) => ROOM_STATUSES.indexOf(row.status),
      },
      {
        key: 'shared',
        header: t('setup.rooms.shared'),
        cell: (row) =>
          row.shared && row.maxSimultaneousLessons !== null
            ? t('setup.rooms.sharedCount', {
                count: row.maxSimultaneousLessons,
                n: number.format(row.maxSimultaneousLessons),
              })
            : t('setup.rooms.notShared'),
        sortValue: (row) => row.maxSimultaneousLessons ?? 0,
      },
    ],
    [t, number],
  );

  const filters = useMemo((): Filter<Room>[] => {
    const list = rooms.data?.rooms ?? [];
    const buildingOptions = [...new Map(list.map((room) => [room.buildingId, room.buildingName]))]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label, i18n.language));
    const floorOptions = [
      ...new Map(list.map((room) => [room.floorId, `${room.buildingName} › ${room.floorName}`])),
    ]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label, i18n.language));
    return [
      {
        key: 'building',
        label: t('setup.rooms.building'),
        options: buildingOptions,
        matches: (row, value) => row.buildingId === value,
      },
      {
        key: 'floor',
        label: t('setup.rooms.floor'),
        options: floorOptions,
        matches: (row, value) => row.floorId === value,
      },
      {
        key: 'type',
        label: t('setup.rooms.type'),
        options: ROOM_TYPES.map((type) => ({ value: type, label: t(`setup.rooms.types.${type}`) })),
        matches: (row, value) => row.type === value,
      },
      {
        key: 'status',
        label: t('setup.rooms.status'),
        options: ROOM_STATUSES.map((status) => ({
          value: status,
          label: t(`setup.rooms.statuses.${status}`),
        })),
        matches: (row, value) => row.status === value,
      },
    ];
  }, [t, rooms.data, i18n.language]);

  const bulkActions = useMemo((): BulkAction<Room>[] => {
    if (!canEdit) {
      return [];
    }
    return ROOM_STATUSES.map((status) => ({
      key: `status-${status}`,
      label: t(`setup.rooms.setStatus.${status}`),
      run: (rows) => {
        setStatus.mutate({ rows, status });
      },
      confirm: (rows) => ({
        title: t('setup.rooms.setStatusTitle', {
          count: rows.length,
          n: number.format(rows.length),
        }),
        text: t('setup.rooms.setStatusText', { status: t(`setup.rooms.statuses.${status}`) }),
        action: t(`setup.rooms.setStatus.${status}`),
        destructive: status === 'closed',
      }),
    }));
  }, [canEdit, t, number, setStatus]);

  const open = (next: ListSearch, how: 'push' | 'replace'): void => {
    void navigate({ to: '/setup/rooms', search: next, replace: how === 'replace' });
  };

  const noFloor = floorsKnown && floors.length === 0;
  const addButton = canCreate && !adding && (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        disabled={!floorsKnown || noFloor}
        onClick={() => {
          setAdding(true);
        }}
      >
        {t('setup.rooms.add')}
      </Button>
      {noFloor && (
        <span className="text-sm text-muted-foreground">{t('setup.rooms.needFloor')}</span>
      )}
    </div>
  );

  const emptyAction = noFloor ? (
    <Link to="/setup/buildings" className={buttonVariants({ variant: 'outline' })}>
      {t('setup.rooms.goToBuildings')}
    </Link>
  ) : addButton === false ? undefined : (
    addButton
  );

  return (
    <>
      <PageHeader
        title={t('setup.rooms.title')}
        breadcrumbs={[
          { label: t('home.title'), to: '/' },
          { label: t('setup.title'), to: '/setup' },
        ]}
        actions={addButton === false ? undefined : addButton}
      />
      {adding && (
        <section
          aria-label={t('setup.rooms.newTitle')}
          className="mb-6 grid max-w-xl gap-3 rounded-lg border p-4"
        >
          <h2 className="text-lg font-semibold">{t('setup.rooms.newTitle')}</h2>
          <RoomForm
            room={null}
            floors={floors}
            label={t('setup.rooms.newTitle')}
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
              {t('setup.rooms.cancel')}
            </Button>
          </div>
        </section>
      )}
      {changed !== null && (
        <p role="status" className="mb-3 text-sm">
          {t('setup.rooms.statusChanged', { count: changed.done, n: number.format(changed.done) })}
          {changed.refused.length > 0 && (
            <> {t('setup.rooms.refusedNames', { names: changed.refused.join(', ') })}</>
          )}
        </p>
      )}
      <ListPage
        listId="rooms"
        caption={t('setup.rooms.caption')}
        rows={rooms.data?.rooms}
        error={rooms.error ?? buildings.error ?? setStatus.error ?? undefined}
        onRetry={() => {
          void rooms.refetch();
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
          text: noFloor ? t('setup.rooms.emptyNoFloor') : t('setup.rooms.empty'),
          action: emptyAction,
        }}
        bulkActions={bulkActions}
        panel={(row) =>
          canEdit ? (
            <RoomForm
              key={row.id}
              room={row}
              floors={floors}
              label={row.name}
              onSave={async (record) => {
                await edit.mutateAsync({ id: row.id, record });
              }}
            />
          ) : (
            <dl className="grid gap-3">
              {columns.map((column) => (
                <div key={column.key} className="grid gap-0.5">
                  <dt className="text-sm text-muted-foreground">{column.header}</dt>
                  <dd>{column.cell(row)}</dd>
                </div>
              ))}
            </dl>
          )
        }
      />
    </>
  );
}
