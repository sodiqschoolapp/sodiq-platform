import { PERMISSIONS, listName, permits, type Absence, type AbsenceRecord } from '@sodiq/shared';
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
import { staffQuery } from '@/features/people/people-api';
import { schoolDateText } from '@/lib/dates';
import { NewAbsenceForm } from './absence-form';
import { AbsencePanel } from './absence-panel';
import { absencesQuery, createAbsence, invalidateTimetable } from './timetable-api';

/**
 * The absences of the staff of the branch (task 5.7a-1, pull request #185;
 * `06`, Teachers who work in several branches: "An absence is entered once
 * for the person and covers every branch"): the list, a new absence, and in
 * the side panel the change of its dates, the withdraw and the branch's own
 * lessons inside it. The Super Admin and the Academic Vice Principal enter
 * and change (`timetable` `create` and `edit`); the Principal reads.
 */
export function AbsencesPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const search = useSearch({ from: '/app/timetable/absences' });
  const { role, branchId } = useView();
  const queryClient = useQueryClient();
  const newRecord = useNewRecord();
  const canCreate = role !== null && permits(PERMISSIONS, role, 'timetable', 'create');
  const canEdit = role !== null && permits(PERMISSIONS, role, 'timetable', 'edit');
  const absences = useQuery(absencesQuery(branchId));
  const staff = useQuery({ ...staffQuery(branchId), enabled: branchId !== null && canCreate });

  const create = useMutation({
    mutationFn: (record: AbsenceRecord) => createAbsence(record),
    onSuccess: () => invalidateTimetable(queryClient),
  });

  const people = useMemo(
    () =>
      (staff.data?.staff ?? [])
        // Decision 11: a person who is inactive or has left may still be entered.
        .map((one) => ({
          id: one.id,
          name: listName({ firstName: one.firstName, lastName: one.lastName }),
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [staff.data],
  );

  const columns = useMemo((): Column<Absence>[] => {
    const date = (value: string) => schoolDateText(value, i18n.language);
    return [
      {
        key: 'person',
        header: t('timetable.absences.person'),
        cell: (row) => row.staff.name,
        sortValue: (row) => row.staff.name,
        searchText: (row) => row.staff.name,
        opens: true,
      },
      {
        key: 'firstDay',
        header: t('timetable.absences.firstDay'),
        cell: (row) => date(row.startsOn),
        sortValue: (row) => row.startsOn,
      },
      {
        key: 'lastDay',
        header: t('timetable.absences.lastDay'),
        cell: (row) => (row.endsOn === null ? t('timetable.absences.open') : date(row.endsOn)),
        sortValue: (row) => row.endsOn ?? '9999-12-31',
      },
      {
        key: 'reason',
        header: t('timetable.absences.reason'),
        cell: (row) => row.reason,
        searchText: (row) => row.reason,
      },
      {
        key: 'state',
        header: t('timetable.absences.state'),
        cell: (row) => t(`timetable.absences.state_${row.state}`),
        sortValue: (row) => row.state,
      },
    ];
  }, [t, i18n.language]);

  const filters = useMemo(
    (): Filter<Absence>[] => [
      {
        key: 'state',
        label: t('timetable.absences.state'),
        options: (['planned', 'current', 'ended', 'withdrawn'] as const).map((state) => ({
          value: state,
          label: t(`timetable.absences.state_${state}`),
        })),
        matches: (row, value) => row.state === value,
      },
    ],
    [t],
  );

  const open = (next: ListSearch, how: 'push' | 'replace'): void => {
    void navigate({ to: '/timetable/absences', search: next, replace: how === 'replace' });
  };

  const addButton = canCreate && newRecord.value === null && (
    <Button
      id={newRecord.buttonId}
      disabled={staff.data === undefined || absences.data === undefined}
      onClick={() => {
        newRecord.start(true);
      }}
    >
      {t('timetable.absences.add')}
    </Button>
  );

  return (
    <>
      <PageHeader
        title={t('timetable.absences.title')}
        breadcrumbs={[
          { label: t('home.title'), to: '/' },
          { label: t('timetable.title'), to: '/timetable' },
        ]}
        actions={addButton === false ? undefined : addButton}
      />
      <ListPage
        listId="absences"
        caption={t('timetable.absences.caption')}
        rows={absences.data?.absences}
        error={absences.error ?? staff.error ?? undefined}
        onRetry={() => {
          void absences.refetch();
          void staff.refetch();
        }}
        rowId={(row) => row.id}
        rowName={(row) => row.staff.name}
        columns={columns}
        filters={filters}
        search={search}
        onSearchChange={open}
        empty={{
          title: t('timetable.absences.emptyTitle'),
          text: t('timetable.absences.empty'),
          action: addButton === false ? undefined : addButton,
        }}
        creating={
          newRecord.value === null
            ? undefined
            : {
                key: 'absence',
                title: t('timetable.absences.newTitle'),
                content: ({ saved, close }) => (
                  <div className="grid gap-4">
                    <NewAbsenceForm
                      people={people}
                      today={staff.data?.today ?? ''}
                      label={t('timetable.absences.newTitle')}
                      onSave={async (record) => {
                        saved((await create.mutateAsync(record)).id);
                      }}
                    />
                    <div>
                      <Button variant="ghost" onClick={close}>
                        {t('timetable.absences.cancel')}
                      </Button>
                    </div>
                  </div>
                ),
                ...newRecord.handlers,
              }
        }
        panel={(row) => (
          <AbsencePanel key={row.id} absence={row} columns={columns} canEdit={canEdit} />
        )}
      />
    </>
  );
}
