import { phoneText, type RelativeListItem } from '@sodiq/shared';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ListPage } from '@/components/list/list-page';
import { type Column, type Filter, type ListSearch } from '@/components/list/list-state';
import { PageHeader } from '@/components/page-header';
import { useView } from '@/features/access/use-view';
import { ParentPanel } from './parent-panel';
import { relativesQuery } from './people-api';
import { PeopleTabs } from './people-tabs';

/** The one option of the phone filter (`edge/close-relatives`, row 2; task 2.5b-1). */
const NO_VALID_PHONE = 'no_valid_phone';

/**
 * The Parents of the branch (`04`, Close relatives: "The Academic Vice
 * Principal has a Relatives list with search by name and phone"; task 2.5a):
 * the relatives with a student of the branch, each opened in the side panel.
 * The main phone is shown (decision 7); the search takes it only for the
 * readers that may search by phone (`edge/people-roles-accounts`, Ctrl+K row).
 * Relatives are added with their students.
 */
export function ParentsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const search = useSearch({ from: '/app/people/parents' });
  const { branchId } = useView();
  const all = useQuery(relativesQuery(branchId));
  // "No valid phone" comes from the server, which knows the active students
  // of the branch (task 2.5b-1, decision 3).
  const wantsInvalid = search.f?.phone === NO_VALID_PHONE;
  const invalid = useQuery({
    ...relativesQuery(branchId, NO_VALID_PHONE),
    enabled: branchId !== null && wantsInvalid,
  });
  const relatives = wantsInvalid ? invalid : all;
  const searchesPhone = all.data?.searchesPhone === true;

  const columns = useMemo((): Column<RelativeListItem>[] => {
    const students = (row: RelativeListItem) =>
      row.students.map((student) => `${student.lastName} ${student.firstName}`).join(', ');
    return [
      {
        key: 'name',
        header: t('people.relatives.fullName'),
        cell: (row) => row.fullName,
        sortValue: (row) => row.fullName,
        searchText: (row) =>
          // The phone as stored and as shown, so it is found typed with or without spaces.
          searchesPhone && row.phone !== null
            ? `${row.fullName} ${row.phone} ${phoneText(row.phone)}`
            : row.fullName,
        opens: true,
      },
      {
        key: 'phone',
        header: t('people.relatives.phone'),
        cell: (row) =>
          (row.phone === null ? null : phoneText(row.phone)) ??
          t(
            row.phoneInvalidSince === null
              ? 'people.relatives.noPhone'
              : 'people.relatives.noValidPhone',
          ),
      },
      {
        key: 'students',
        header: t('people.relatives.students'),
        cell: students,
        sortValue: students,
        searchText: students,
      },
      {
        key: 'elsewhere',
        header: t('people.relatives.elsewhere'),
        cell: (row) => (row.elsewhere === 0 ? '' : String(row.elsewhere)),
        sortValue: (row) => String(row.elsewhere).padStart(4, '0'),
      },
    ];
  }, [t, searchesPhone]);

  const filters = useMemo(
    (): Filter<RelativeListItem>[] => [
      {
        key: 'phone',
        label: t('people.relatives.phone'),
        options: [{ value: NO_VALID_PHONE, label: t('people.relatives.noValidPhoneFilter') }],
        matches: (row) => row.phoneInvalidSince !== null,
      },
    ],
    [t],
  );

  const open = (next: ListSearch, how: 'push' | 'replace'): void => {
    void navigate({ to: '/people/parents', search: next, replace: how === 'replace' });
  };

  return (
    <>
      <PageHeader
        title={t('people.relatives.title')}
        breadcrumbs={[
          { label: t('home.title'), to: '/' },
          { label: t('people.title'), to: '/people' },
        ]}
      />
      <PeopleTabs current="parents" />
      <ListPage
        listId="parents"
        caption={t('people.relatives.caption')}
        rows={relatives.data?.relatives}
        error={relatives.error ?? undefined}
        onRetry={() => {
          void relatives.refetch();
        }}
        rowId={(row) => row.id}
        rowName={(row) => row.fullName}
        columns={columns}
        filters={filters}
        search={search}
        onSearchChange={open}
        empty={{ title: t('people.relatives.emptyTitle'), text: t('people.relatives.empty') }}
        panel={(row) => <ParentPanel key={row.id} id={row.id} name={row.fullName} />}
      />
    </>
  );
}
