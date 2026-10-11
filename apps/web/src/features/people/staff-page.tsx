import {
  INSTRUCTION_LANGUAGES,
  PERMISSIONS,
  permits,
  STAFF_STATUSES,
  SUBJECT_GRADES,
  staffCheckResultSchema,
  type StaffListItem,
  type StaffRecord,
} from '@sodiq/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, branchHeader } from '@/api/client';
import { answerOf } from '@/api/failure';
import { useConfirm } from '@/components/confirm-dialog';
import { SaveCancelled } from '@/components/form/save-cancelled';
import { ListPage } from '@/components/list/list-page';
import { type Column, type Filter, type ListSearch } from '@/components/list/list-state';
import { PageHeader } from '@/components/page-header';
import { ErrorState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { useLeave } from '@/components/unsent/unsent-changes';
import { useView } from '@/features/access/use-view';
import { divisionsQuery, nameOf } from '@/features/setup/setup-api';
import { subjectsQuery } from '@/features/setup/subjects-api';
import { invalidateStaff, staffQuery } from './people-api';
import { StaffForm } from './staff-form';
import { StaffPanel } from './staff-panel';

const fullName = (row: Pick<StaffListItem, 'firstName' | 'lastName'>) =>
  `${row.firstName} ${row.lastName}`;

/**
 * The staff of the branch (`04`, Teacher and staff record: "Teacher list
 * columns: ... name, ID, category, branches, department, subjects, grades,
 * languages of instruction, phone, status"; task 2.2a), each opened in the
 * side panel. The Super Admin adds people; the Academic Vice Principal and the
 * Principal read the list. Photos, the export and the last column come with
 * tasks 2.2c and 8.x.
 */
export function StaffPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const search = useSearch({ from: '/app/people/staff' });
  const { role, branchId } = useView();
  const queryClient = useQueryClient();
  const leave = useLeave();
  const confirm = useConfirm();
  const [adding, setAdding] = useState(false);
  const canCreate = role !== null && permits(PERMISSIONS, role, 'staff', 'create');
  const staff = useQuery(staffQuery(branchId));
  const divisions = useQuery(divisionsQuery(branchId));
  const subjects = useQuery(subjectsQuery(branchId));
  const language = i18n.language;

  const departmentNames = useMemo(
    () =>
      new Map(
        (divisions.data?.divisions ?? [])
          .flatMap((division) => division.departments)
          .map((department) => [department.id, nameOf(department.names, language)] as const),
      ),
    [divisions.data, language],
  );
  const divisionNames = useMemo(
    () =>
      new Map(
        (divisions.data?.divisions ?? []).map(
          (division) => [division.id, nameOf(division.names, language)] as const,
        ),
      ),
    [divisions.data, language],
  );
  const subjectNames = useMemo(
    () =>
      new Map(
        (subjects.data?.subjects ?? []).map(
          (subject) => [subject.id, nameOf(subject.names, language)] as const,
        ),
      ),
    [subjects.data, language],
  );

  /** The duplicate warning before a new record is saved (edge, Staff over time). */
  const create = useMutation({
    mutationFn: async (record: StaffRecord) => {
      const found = staffCheckResultSchema.parse(
        await answerOf(
          api.POST('/api/people/staff/check', {
            params: { header: branchHeader() },
            body: {
              firstName: record.firstName,
              lastName: record.lastName,
              birthDate: record.birthDate,
              phone: record.phone,
              staffRecordId: null,
            },
          }),
        ),
      );
      const names = [...found.sameNameAndBirth, ...found.samePhone].map(
        (match) => `${fullName(match)} (${match.staffId})`,
      );
      if (names.length > 0 || found.elsewhere) {
        const go = await confirm({
          title: t('people.staff.duplicateTitle'),
          text: found.elsewhere
            ? t('people.staff.duplicateElsewhere')
            : t('people.staff.duplicateHere'),
          names: [...new Set(names)],
          action: t('people.staff.saveAnyway'),
          destructive: false,
        });
        if (!go) {
          throw new SaveCancelled();
        }
      }
      return answerOf(
        api.POST('/api/people/staff', { params: { header: branchHeader() }, body: record }),
      );
    },
    onSuccess: async () => {
      setAdding(false);
      await invalidateStaff(queryClient);
    },
  });

  const columns = useMemo((): Column<StaffListItem>[] => {
    const academic = divisions.data?.divisions.find((division) => division.builtIn)?.id;
    // The teaching department (in Academic), else the department of the main division.
    const department = (row: StaffListItem) => {
      const id = (
        row.divisions.find((division) => division.divisionId === academic) ??
        row.divisions.find((division) => division.main)
      )?.departmentId;
      return id === undefined || id === null ? '' : (departmentNames.get(id) ?? '');
    };
    const grades = (row: StaffListItem) =>
      [...new Set(row.subjects.flatMap((subject) => subject.grades))].sort((a, b) => a - b);
    return [
      {
        key: 'name',
        header: t('people.staff.name'),
        cell: (row) => fullName(row),
        sortValue: (row) => `${row.lastName} ${row.firstName}`,
        searchText: (row) => `${fullName(row)} ${row.fatherName ?? ''} ${row.staffId}`,
        opens: true,
      },
      {
        key: 'staffId',
        header: t('people.staff.staffId'),
        cell: (row) => row.staffId,
        sortValue: (row) => row.staffId,
      },
      {
        key: 'category',
        header: t('people.staff.categories'),
        cell: (row) => row.categories.map((one) => t(`roles.${one}`)).join(', '),
      },
      {
        key: 'branches',
        header: t('people.staff.branches'),
        cell: (row) => row.branches.map((branch) => branch.name).join(', '),
      },
      {
        key: 'department',
        header: t('people.staff.department'),
        cell: department,
        sortValue: department,
      },
      {
        key: 'subjects',
        header: t('people.staff.subjects'),
        cell: (row) =>
          row.subjects.map((subject) => subjectNames.get(subject.subjectId) ?? '').join(', '),
      },
      {
        key: 'grades',
        header: t('people.staff.grades'),
        cell: (row) =>
          grades(row)
            .map((grade) => t('setup.subjects.grade', { grade }))
            .join(', '),
      },
      {
        key: 'languages',
        header: t('people.staff.languagesTitle'),
        cell: (row) => row.languages.map((one) => t(`people.staff.languages.${one}`)).join(', '),
      },
      {
        key: 'phone',
        header: t('people.staff.phone'),
        cell: (row) => row.phone,
      },
      {
        key: 'status',
        header: t('people.staff.statusColumn'),
        cell: (row) =>
          row.status === null
            ? t('people.staff.notStarted')
            : t(`people.staff.statuses.${row.status}`),
        sortValue: (row) => row.status ?? '',
      },
    ];
  }, [t, departmentNames, subjectNames, divisions.data]);

  const filters = useMemo(
    (): Filter<StaffListItem>[] => [
      {
        key: 'status',
        label: t('people.staff.statusColumn'),
        options: STAFF_STATUSES.map((one) => ({
          value: one,
          label: t(`people.staff.statuses.${one}`),
        })),
        matches: (row, value) => row.status === value,
      },
      {
        key: 'division',
        label: t('people.staff.divisions'),
        options: [...divisionNames].map(([id, name]) => ({ value: id, label: name })),
        matches: (row, value) => row.divisions.some((division) => division.divisionId === value),
      },
      {
        key: 'department',
        label: t('people.staff.department'),
        options: [...departmentNames].map(([id, name]) => ({ value: id, label: name })),
        matches: (row, value) => row.divisions.some((division) => division.departmentId === value),
      },
      {
        key: 'subject',
        label: t('people.staff.subjects'),
        options: [...subjectNames].map(([id, name]) => ({ value: id, label: name })),
        matches: (row, value) => row.subjects.some((subject) => subject.subjectId === value),
      },
      {
        key: 'grade',
        label: t('people.staff.grades'),
        options: SUBJECT_GRADES.map((grade) => ({
          value: String(grade),
          label: t('setup.subjects.grade', { grade }),
        })),
        matches: (row, value) =>
          row.subjects.some((subject) => subject.grades.includes(Number(value))),
      },
      {
        key: 'language',
        label: t('people.staff.languagesTitle'),
        options: INSTRUCTION_LANGUAGES.map((one) => ({
          value: one,
          label: t(`people.staff.languages.${one}`),
        })),
        matches: (row, value) => row.languages.some((one) => one === value),
      },
    ],
    [t, divisionNames, departmentNames, subjectNames],
  );

  const open = (next: ListSearch, how: 'push' | 'replace'): void => {
    void navigate({ to: '/people/staff', search: next, replace: how === 'replace' });
  };

  const addButton = canCreate && !adding && (
    <Button
      disabled={divisions.data === undefined}
      onClick={() => {
        setAdding(true);
      }}
    >
      {t('people.staff.add')}
    </Button>
  );
  const pending = divisions.data === undefined || subjects.data === undefined;
  const failed = divisions.isError ? divisions : subjects.isError ? subjects : null;

  return (
    <>
      <PageHeader
        title={t('people.staff.title')}
        breadcrumbs={[
          { label: t('home.title'), to: '/' },
          { label: t('people.title'), to: '/people' },
        ]}
        actions={addButton === false ? undefined : addButton}
      />
      {failed !== null && (
        <ErrorState
          error={failed.error}
          onRetry={() => {
            void failed.refetch();
          }}
        />
      )}
      {adding && divisions.data !== undefined && (
        <section
          aria-label={t('people.staff.newTitle')}
          className="mb-6 grid max-w-2xl gap-3 rounded-lg border p-4"
        >
          <h2 className="text-lg font-semibold">{t('people.staff.newTitle')}</h2>
          <StaffForm
            staff={null}
            divisions={divisions.data}
            contactOnly={false}
            label={t('people.staff.newTitle')}
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
              {t('people.staff.cancel')}
            </Button>
          </div>
        </section>
      )}
      <ListPage
        listId="staff"
        caption={t('people.staff.caption')}
        rows={pending ? undefined : staff.data?.staff}
        error={staff.error ?? undefined}
        onRetry={() => {
          void staff.refetch();
        }}
        rowId={(row) => row.id}
        rowName={fullName}
        columns={columns}
        filters={filters}
        search={search}
        onSearchChange={open}
        empty={{
          text: t('people.staff.empty'),
          action: addButton === false ? undefined : addButton,
        }}
        panel={(row) =>
          divisions.data === undefined ? null : (
            <StaffPanel
              key={row.id}
              id={row.id}
              name={fullName(row)}
              divisions={divisions.data}
              subjects={subjects.data?.subjects ?? []}
            />
          )
        }
      />
    </>
  );
}
