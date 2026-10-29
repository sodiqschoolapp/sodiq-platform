import { type BranchListItem, type BranchRecord } from '@sodiq/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { answerOf } from '@/api/failure';
import { ListPage } from '@/components/list/list-page';
import { type Column, type ListSearch } from '@/components/list/list-state';
import { useNewRecord } from '@/components/list/use-new-record';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { useSwitchBranch } from '@/features/access/use-switch-branch';
import { invalidateBranchesWithoutVice } from '@/features/access/vice-principal-banner';
import { refreshSession } from '@/features/auth/session';
import { weekdayName } from '@/lib/dates';
import { BranchForm } from './branch-page';
import { branchesQuery, SETUP_KEY } from './setup-api';

/**
 * The Branches list of the Super Admin (`03`, Branch: "The Super Admin sees
 * every branch in one list under School setup: name, address, working
 * weekdays, number of buildings and of rooms. Opening a branch switches the
 * current branch to it. A new branch is added from this list, in the side
 * panel"; issue #39, item 1; task 2.7c-3). Opening a branch switches the
 * tab to it and shows its Branch page (decision 4); a saved new branch does
 * the same. No export, filter or bulk action (decision 6).
 */
export function BranchesPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const search = useSearch({ from: '/app/setup/branches' });
  const switchBranch = useSwitchBranch();
  const queryClient = useQueryClient();
  const newRecord = useNewRecord();
  const branches = useQuery(branchesQuery());
  const number = useMemo(() => new Intl.NumberFormat(i18n.language), [i18n.language]);

  const create = useMutation({
    mutationFn: (record: BranchRecord) =>
      answerOf(api.POST('/api/setup/branches', { body: record })),
    onSuccess: async () => {
      // The switcher and the alert of a branch without an Academic Vice
      // Principal show the new branch; the list counts it.
      await refreshSession(queryClient);
      await queryClient.invalidateQueries({ queryKey: SETUP_KEY });
      await invalidateBranchesWithoutVice(queryClient);
    },
  });

  /** The branch becomes the current branch of the tab, and its Branch page opens. */
  const openBranch = (id: string): void => {
    void switchBranch(id, '/setup/branch');
  };

  const columns = useMemo(
    (): Column<BranchListItem>[] => [
      {
        key: 'name',
        header: t('setup.branches.name'),
        cell: (row) =>
          row.monitoring ? (
            <>
              {row.name}{' '}
              <span className="text-muted-foreground">({t('setup.branches.monitoring')})</span>
            </>
          ) : (
            row.name
          ),
        sortValue: (row) => row.name,
        searchText: (row) => row.name,
        opens: true,
      },
      {
        key: 'address',
        header: t('setup.branches.address'),
        cell: (row) => row.address ?? '',
        sortValue: (row) => row.address ?? '',
        searchText: (row) => row.address ?? '',
      },
      {
        key: 'weekdays',
        header: t('setup.branches.weekdays'),
        cell: (row) => row.workingWeekdays.map((day) => weekdayName(i18n.language, day)).join(', '),
      },
      {
        key: 'buildings',
        header: t('setup.branches.buildings'),
        cell: (row) => number.format(row.buildingCount),
        sortValue: (row) => row.buildingCount,
        numeric: true,
      },
      {
        key: 'rooms',
        header: t('setup.branches.rooms'),
        cell: (row) => number.format(row.roomCount),
        sortValue: (row) => row.roomCount,
        numeric: true,
      },
    ],
    [t, i18n.language, number],
  );

  const open = (next: ListSearch, how: 'push' | 'replace'): void => {
    void navigate({ to: '/setup/branches', search: next, replace: how === 'replace' });
  };

  const addButton = newRecord.value === null && (
    <Button
      id={newRecord.buttonId}
      onClick={() => {
        newRecord.start(true);
      }}
    >
      {t('setup.branch.newBranch')}
    </Button>
  );

  return (
    <>
      <PageHeader
        title={t('setup.branches.title')}
        breadcrumbs={[
          { label: t('home.title'), to: '/' },
          { label: t('setup.title'), to: '/setup' },
        ]}
        actions={addButton === false ? undefined : addButton}
      />
      <ListPage
        listId="branches"
        caption={t('setup.branches.caption')}
        rows={branches.data?.branches}
        error={branches.error ?? undefined}
        onRetry={() => {
          void branches.refetch();
        }}
        rowId={(row) => row.id}
        rowName={(row) => row.name}
        columns={columns}
        search={search}
        onSearchChange={open}
        empty={{
          title: t('setup.branches.emptyTitle'),
          text: t('setup.branches.empty'),
          action: addButton === false ? undefined : addButton,
        }}
        onOpenRow={(row) => {
          openBranch(row.id);
        }}
        creating={
          newRecord.value === null
            ? undefined
            : {
                key: 'branch',
                title: t('setup.branch.newBranchTitle'),
                content: ({ saved, close }) => (
                  <div className="grid gap-4">
                    <BranchForm
                      branch={null}
                      label={t('setup.branch.newBranchTitle')}
                      onSave={async (record) => {
                        saved((await create.mutateAsync(record)).id);
                      }}
                    />
                    <div>
                      <Button variant="ghost" onClick={close}>
                        {t('setup.branch.cancel')}
                      </Button>
                    </div>
                  </div>
                ),
                ...newRecord.handlers,
                onSaved: (id) => {
                  newRecord.handlers.onSaved();
                  if (id !== undefined) {
                    openBranch(id);
                  }
                },
              }
        }
      />
    </>
  );
}
