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
import { useNewRecord } from '@/components/list/use-new-record';
import {
  listSearch,
  type Column,
  type Filter,
  type ListSearch,
} from '@/components/list/list-state';
import { PageHeader } from '@/components/page-header';
import { Button, buttonVariants } from '@/components/ui/button';
import { Segmented } from '@/components/ui/segmented';
import { ErrorState, LoadingOutline } from '@/components/states';
import { useView } from '@/features/access/use-view';
import { isNamedRefusal } from './building-panel';
import { RoomForm } from './room-form';
import { RoomPanel } from './room-panel';
import { RoomsByFloor } from './rooms-by-floor';
import { activeFloorsOf, buildingsQuery, roomsQuery, SETUP_KEY } from './setup-api';

/**
 * The address of the Rooms page: the list's state, and the "By floor" view
 * with its building and floor (task 2.7c-3, decision 8), so Back and a link
 * return to the view.
 */
export interface RoomsSearch extends ListSearch {
  view?: 'floors';
  building?: string;
  floor?: string;
}

/** `validateSearch` of the Rooms page: `listSearch` with the view, a building and a floor. */
export function roomsSearch(search: Record<string, unknown>): RoomsSearch {
  const result: RoomsSearch = listSearch(search);
  if (search.view === 'floors') {
    result.view = 'floors';
    if (typeof search.building === 'string' && search.building !== '') {
      result.building = search.building;
    }
    if (typeof search.floor === 'string' && search.floor !== '') {
      result.floor = search.floor;
    }
  }
  return result;
}

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
  const newRecord = useNewRecord();
  const [changed, setChanged] = useState<{ done: number; refused: string[] } | null>(null);
  const canEdit = role !== null && permits(PERMISSIONS, role, 'rooms', 'edit');
  const canCreate = role !== null && permits(PERMISSIONS, role, 'rooms', 'create');
  const canExport = role !== null && permits(PERMISSIONS, role, 'rooms', 'export');
  const exporter = useExport<Room>('rooms', (row) => row.id);
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
        // Rooms are found by name; the building and floor are in the side panel
        // and the export (task 2.7b-2, decision 3).
        narrow: true,
      },
      {
        key: 'floor',
        header: t('setup.rooms.floor'),
        cell: (row) => row.floorName,
        sortValue: (row) => row.floorName,
        searchText: (row) => row.floorName,
        narrow: true,
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
        cell: (row) => <span className="whitespace-nowrap">{number.format(row.capacity)}</span>,
        sortValue: (row) => row.capacity,
        numeric: true,
      },
      {
        key: 'status',
        header: t('setup.rooms.status'),
        cell: (row) => (
          <span className="whitespace-nowrap">{t(`setup.rooms.statuses.${row.status}`)}</span>
        ),
        sortValue: (row) => ROOM_STATUSES.indexOf(row.status),
      },
      {
        key: 'shared',
        header: t('setup.rooms.shared'),
        cell: (row) => (
          <span className="whitespace-nowrap">
            {row.shared && row.maxSimultaneousLessons !== null
              ? t('setup.rooms.sharedCount', {
                  count: row.maxSimultaneousLessons,
                  n: number.format(row.maxSimultaneousLessons),
                })
              : t('setup.rooms.notShared')}
          </span>
        ),
        sortValue: (row) => row.maxSimultaneousLessons ?? 0,
      },
    ],
    [t, number],
  );

  const byFloor = search.view === 'floors';

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
    // In "By floor" the buildings on the left and the floor tabs are that
    // choice: the two filters are not offered there (review finding 3).
    const place: Filter<Room>[] = byFloor
      ? []
      : [
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
        ];
    return [
      ...place,
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
  }, [t, rooms.data, i18n.language, byFloor]);

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

  /** The list's state with the view of the address, which the list does not know. */
  const open = (next: ListSearch, how: 'push' | 'replace'): void => {
    const place: RoomsSearch = byFloor
      ? {
          view: 'floors',
          ...(search.building === undefined ? {} : { building: search.building }),
          ...(search.floor === undefined ? {} : { floor: search.floor }),
        }
      : {};
    void navigate({
      to: '/setup/rooms',
      search: { ...next, ...place },
      replace: how === 'replace',
    });
  };

  /**
   * The list or "By floor". A building or floor chosen in the list's filters
   * becomes the view's building and floor, and the two filters are dropped
   * (review finding 3); back in the list they stay dropped.
   */
  const changeView = (next: 'list' | 'floors'): void => {
    const { building, floor, ...others } = search.f ?? {};
    const f = Object.keys(others).length === 0 ? undefined : others;
    const list = listSearch({ ...search, f: undefined });
    void navigate({
      to: '/setup/rooms',
      search:
        next === 'floors'
          ? {
              ...list,
              ...(f === undefined ? {} : { f }),
              view: 'floors',
              ...(building === undefined ? {} : { building }),
              ...(floor === undefined ? {} : { floor }),
            }
          : { ...list, ...(f === undefined ? {} : { f }) },
    });
  };

  const noFloor = floorsKnown && floors.length === 0;
  const addButton = canCreate && newRecord.value === null && (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        id={newRecord.buttonId}
        disabled={!floorsKnown || noFloor}
        onClick={() => {
          newRecord.start(true);
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
    <Link to="/setup/buildings" className={buttonVariants({ variant: 'secondary' })}>
      {t('setup.rooms.goToBuildings')}
    </Link>
  ) : addButton === false ? undefined : (
    addButton
  );

  const viewSwitch = (
    <Segmented
      label={t('setup.rooms.views')}
      options={[
        { value: 'list', label: t('setup.rooms.viewList') },
        { value: 'floors', label: t('setup.rooms.viewFloors') },
      ]}
      value={byFloor ? 'floors' : 'list'}
      onChange={changeView}
    />
  );

  return (
    <>
      <PageHeader
        title={t('setup.rooms.title')}
        breadcrumbs={[
          { label: t('home.title'), to: '/' },
          { label: t('setup.title'), to: '/setup' },
        ]}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            {viewSwitch}
            {addButton}
          </div>
        }
      />
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
        // In "By floor" a failure of the buildings is the view's own error state.
        error={rooms.error ?? (byFloor ? null : buildings.error) ?? setStatus.error ?? undefined}
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
          title: t('setup.rooms.emptyTitle'),
          text: noFloor ? t('setup.rooms.emptyNoFloor') : t('setup.rooms.empty'),
          action: emptyAction,
        }}
        bulkActions={bulkActions}
        view={
          byFloor
            ? ({ rows, sorted, open: openRoom }) =>
                // The view is drawn from the buildings too: while they load
                // or after they failed it says so, never the table (review
                // of the branch, finding 1).
                buildings.isError ? (
                  <ErrorState
                    error={buildings.error}
                    onRetry={() => {
                      void buildings.refetch();
                    }}
                  />
                ) : buildings.data === undefined ? (
                  <LoadingOutline lines={4} />
                ) : (
                  <RoomsByFloor
                    rooms={rows}
                    sorted={sorted}
                    allRooms={rooms.data?.rooms ?? []}
                    buildings={buildings.data.buildings}
                    chosen={{ building: search.building, floor: search.floor }}
                    onChoose={(place) => {
                      void navigate({
                        to: '/setup/rooms',
                        search: {
                          ...listSearch(search),
                          view: 'floors',
                          building: place.building,
                          ...(place.floor === undefined ? {} : { floor: place.floor }),
                        },
                      });
                    }}
                    open={openRoom}
                  />
                )
            : undefined
        }
        creating={
          newRecord.value === null
            ? undefined
            : {
                key: 'room',
                title: t('setup.rooms.newTitle'),
                content: ({ saved, close }) => (
                  <div className="grid gap-4">
                    <RoomForm
                      room={null}
                      floors={floors}
                      label={t('setup.rooms.newTitle')}
                      onSave={async (record) => {
                        saved((await create.mutateAsync(record)).id);
                      }}
                    />
                    <div>
                      <Button variant="ghost" onClick={close}>
                        {t('setup.rooms.cancel')}
                      </Button>
                    </div>
                  </div>
                ),
                ...newRecord.handlers,
              }
        }
        panel={(row) => (
          <RoomPanel
            key={row.id}
            room={row}
            floors={floors}
            columns={columns}
            canEdit={canEdit}
            onSave={async (record) => {
              await edit.mutateAsync({ id: row.id, record });
            }}
          />
        )}
      />
    </>
  );
}
