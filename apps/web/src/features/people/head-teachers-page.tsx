import { APPOINTMENT_ROLES, listName, PERMISSIONS, permits, type Appointment } from '@sodiq/shared';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ListPage } from '@/components/list/list-page';
import { type Column, type Filter, type ListSearch } from '@/components/list/list-state';
import { PageHeader } from '@/components/page-header';
import { buttonVariants } from '@/components/ui/button';
import { useView } from '@/features/access/use-view';
import { nameOf } from '@/features/setup/setup-api';
import { headTeachersQuery } from './people-api';
import { PeopleTabs } from './people-tabs';
import { schoolDateText } from '@/lib/dates';

/**
 * The holder: the name, surname first (finding 27), in every branch (task
 * 3.6a, L32); the login for an account with no staff record.
 */
const personText = (row: Appointment): string =>
  row.person.name === null ? row.person.login : listName(row.person.name);

/**
 * The Head Teachers of the branch (`02`, Head Teachers and Senior Head
 * Teachers; task 2.3b-2): the current and planned appointments, each with its
 * subjects; a Head Teacher or Senior Head Teacher sees their own subjects
 * only, as the server answers. Read only, with no side panel (decision 5 of
 * #64): the Super Admin appoints on the account section of a staff record.
 */
export function HeadTeachersPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const search = useSearch({ from: '/app/people/head-teachers' });
  const { role, branchId } = useView();
  const appointments = useQuery(headTeachersQuery(branchId));
  const language = i18n.language;
  const canAppoint = role !== null && permits(PERMISSIONS, role, 'accounts', 'edit');

  const subjectsText = useMemo(
    () => (row: Appointment) =>
      row.subjects
        .map((subject) =>
          subject.archived
            ? t('people.account.archivedSubject', { name: nameOf(subject.names, language) })
            : nameOf(subject.names, language),
        )
        .join(', '),
    [t, language],
  );

  const columns = useMemo(
    (): Column<Appointment>[] => [
      {
        key: 'person',
        header: t('people.headTeachers.person'),
        cell: personText,
        sortValue: personText,
        searchText: (row) => `${personText(row)} ${subjectsText(row)}`,
        fixed: true,
      },
      {
        key: 'role',
        header: t('people.headTeachers.role'),
        cell: (row) => t(`roles.${row.role}`),
        sortValue: (row) => row.role,
      },
      {
        key: 'subjects',
        header: t('people.headTeachers.subjects'),
        cell: subjectsText,
      },
      {
        key: 'from',
        header: t('people.headTeachers.from'),
        cell: (row) => schoolDateText(row.from, language),
        sortValue: (row) => row.from,
      },
      {
        key: 'until',
        header: t('people.headTeachers.until'),
        cell: (row) => (row.until === null ? '' : schoolDateText(row.until, language)),
        sortValue: (row) => row.until ?? '9999-12-31',
      },
      {
        key: 'state',
        header: t('people.headTeachers.state'),
        // Plain words, never a pill (docs/design-system.md, What we never do).
        cell: (row) =>
          row.state === 'planned'
            ? t('people.headTeachers.states.planned')
            : t('people.headTeachers.states.current'),
        sortValue: (row) => row.state,
      },
    ],
    [t, language, subjectsText],
  );

  const filters = useMemo(
    (): Filter<Appointment>[] => [
      {
        key: 'role',
        label: t('people.headTeachers.role'),
        options: APPOINTMENT_ROLES.map((one) => ({ value: one, label: t(`roles.${one}`) })),
        matches: (row, value) => row.role === value,
      },
    ],
    [t],
  );

  const open = (next: ListSearch, how: 'push' | 'replace'): void => {
    void navigate({ to: '/people/head-teachers', search: next, replace: how === 'replace' });
  };

  return (
    <>
      <PageHeader
        title={t('people.headTeachers.title')}
        breadcrumbs={[
          { label: t('home.title'), to: '/' },
          { label: t('people.title'), to: '/people' },
        ]}
      />
      <PeopleTabs current="head-teachers" />
      <ListPage
        listId="head-teachers"
        caption={t('people.headTeachers.caption')}
        rows={appointments.data?.appointments}
        error={appointments.error ?? undefined}
        onRetry={() => {
          void appointments.refetch();
        }}
        rowId={(row) => row.id}
        rowName={personText}
        columns={columns}
        filters={filters}
        search={search}
        onSearchChange={open}
        empty={{
          title: t('people.headTeachers.emptyTitle'),
          text: canAppoint ? t('people.headTeachers.empty') : t('people.headTeachers.emptyView'),
          action: canAppoint ? (
            <Link to="/people/staff" className={buttonVariants()}>
              {t('people.headTeachers.toStaff')}
            </Link>
          ) : undefined,
        }}
      />
    </>
  );
}
