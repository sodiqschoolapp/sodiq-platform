import { PERMISSIONS, permits, type RoomClosure, type RoomClosureRecord } from '@sodiq/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ListPage } from '@/components/list/list-page';
import { type Column, type Filter, type ListSearch } from '@/components/list/list-state';
import { useNewRecord } from '@/components/list/use-new-record';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { useView } from '@/features/access/use-view';
import { roomsQuery } from '@/features/setup/setup-api';
import { schoolDateText } from '@/lib/dates';
import { NewRoomClosureForm } from './room-closure-form';
import { RoomClosurePanel } from './room-closure-panel';
import { createRoomClosure, invalidateTimetable, roomClosuresQuery } from './timetable-api';

/**
 * The closures of the branch's rooms (task 5.7a-2b, pull request #187;
 * `edge/timetable`, After publishing: "A room closure has a start, an end and
 * a reason. Lessons in the range go to 'needs a room', with 'move all to room
 * R for the period'."): the list, a new closure, and in the side panel the
 * change of its days, the withdraw, "move all" and the lessons inside it. The
 * Super Admin and the Academic Vice Principal enter and change (`timetable`
 * `create` and `edit`); the Principal reads.
 */
export function RoomClosuresPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const search = useSearch({ from: '/app/timetable/room-closures' });
  const { role, branchId } = useView();
  const queryClient = useQueryClient();
  const newRecord = useNewRecord();
  const canCreate = role !== null && permits(PERMISSIONS, role, 'timetable', 'create');
  const canEdit = role !== null && permits(PERMISSIONS, role, 'timetable', 'edit');
  const closures = useQuery(roomClosuresQuery(branchId));
  const rooms = useQuery({ ...roomsQuery(branchId), enabled: branchId !== null && canEdit });

  const create = useMutation({
    mutationFn: (record: RoomClosureRecord) => createRoomClosure(record),
    onSuccess: () => invalidateTimetable(queryClient),
  });

  const sorted = useMemo(
    () =>
      [...(rooms.data?.rooms ?? [])].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { numeric: true }),
      ),
    [rooms.data],
  );
  // A room closed by its status needs no closure (`room_closure_room`).
  const closable = useMemo(
    () =>
      sorted
        .filter((one) => one.status !== 'closed')
        .map((one) => ({ id: one.id, name: one.name })),
    [sorted],
  );
  // "Move all" goes to a room in use (the rule `room_closed` refuses one under repair).
  const inUse = useMemo(
    () =>
      sorted
        .filter((one) => one.status === 'in_use')
        .map((one) => ({ id: one.id, name: one.name })),
    [sorted],
  );

  const columns = useMemo((): Column<RoomClosure>[] => {
    const date = (value: string) => schoolDateText(value, i18n.language);
    return [
      {
        key: 'room',
        header: t('timetable.roomClosures.room'),
        cell: (row) => row.room.name,
        sortValue: (row) => row.room.name,
        searchText: (row) => row.room.name,
        opens: true,
      },
      {
        key: 'firstDay',
        header: t('timetable.roomClosures.firstDay'),
        cell: (row) => date(row.startsOn),
        sortValue: (row) => row.startsOn,
      },
      {
        key: 'lastDay',
        header: t('timetable.roomClosures.lastDay'),
        cell: (row) => date(row.endsOn),
        sortValue: (row) => row.endsOn,
      },
      {
        key: 'reason',
        header: t('timetable.roomClosures.reason'),
        cell: (row) => row.reason,
        searchText: (row) => row.reason,
      },
      {
        key: 'state',
        header: t('timetable.roomClosures.state'),
        cell: (row) => t(`timetable.roomClosures.state_${row.state}`),
        sortValue: (row) => row.state,
      },
    ];
  }, [t, i18n.language]);

  const filters = useMemo(
    (): Filter<RoomClosure>[] => [
      {
        key: 'state',
        label: t('timetable.roomClosures.state'),
        options: (['planned', 'current', 'ended', 'withdrawn'] as const).map((state) => ({
          value: state,
          label: t(`timetable.roomClosures.state_${state}`),
        })),
        matches: (row, value) => row.state === value,
      },
    ],
    [t],
  );

  const open = (next: ListSearch, how: 'push' | 'replace'): void => {
    void navigate({ to: '/timetable/room-closures', search: next, replace: how === 'replace' });
  };

  const addButton = canCreate && newRecord.value === null && (
    <Button
      id={newRecord.buttonId}
      disabled={rooms.data === undefined || closures.data === undefined}
      onClick={() => {
        newRecord.start(true);
      }}
    >
      {t('timetable.roomClosures.add')}
    </Button>
  );

  return (
    <>
      <PageHeader
        title={t('timetable.roomClosures.title')}
        breadcrumbs={[
          { label: t('home.title'), to: '/' },
          { label: t('timetable.title'), to: '/timetable' },
        ]}
        actions={addButton === false ? undefined : addButton}
      />
      <ListPage
        listId="room-closures"
        caption={t('timetable.roomClosures.caption')}
        rows={closures.data?.closures}
        error={closures.error ?? rooms.error ?? undefined}
        onRetry={() => {
          void closures.refetch();
          void rooms.refetch();
        }}
        rowId={(row) => row.id}
        rowName={(row) => row.room.name}
        columns={columns}
        filters={filters}
        search={search}
        onSearchChange={open}
        empty={{
          title: t('timetable.roomClosures.emptyTitle'),
          text: t('timetable.roomClosures.empty'),
          action: addButton === false ? undefined : addButton,
        }}
        creating={
          newRecord.value === null
            ? undefined
            : {
                key: 'room-closure',
                title: t('timetable.roomClosures.newTitle'),
                content: ({ saved, close }) => (
                  <div className="grid gap-4">
                    <NewRoomClosureForm
                      rooms={closable}
                      today={closures.data?.today ?? ''}
                      label={t('timetable.roomClosures.newTitle')}
                      onSave={async (record) => {
                        saved((await create.mutateAsync(record)).id);
                      }}
                    />
                    <div>
                      <Button variant="ghost" onClick={close}>
                        {t('timetable.roomClosures.cancel')}
                      </Button>
                    </div>
                  </div>
                ),
                ...newRecord.handlers,
              }
        }
        panel={(row) => (
          <RoomClosurePanel
            key={row.id}
            closure={row}
            columns={columns}
            canEdit={canEdit}
            rooms={inUse.filter((one) => one.id !== row.room.id)}
          />
        )}
      />
    </>
  );
}
