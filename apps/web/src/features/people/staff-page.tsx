import {
  listName,
  phoneText,
  gradeRanges,
  INSTRUCTION_LANGUAGES,
  PERMISSIONS,
  permits,
  STAFF_CATEGORY_ROLES,
  STAFF_STATUSES,
  SUBJECT_GRADES,
  staffCheckResultSchema,
  type StaffListItem,
  type StaffRecord,
} from '@sodiq/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { api, branchHeader } from '@/api/client';
import { answerOf, ApiFailure } from '@/api/failure';
import { useConfirm } from '@/components/confirm-dialog';
import { SaveCancelled } from '@/components/form/save-cancelled';
import { ListPage } from '@/components/list/list-page';
import { useExport } from '@/components/list/use-export';
import { useNewRecord } from '@/components/list/use-new-record';
import { type Column, type Filter, type ListSearch } from '@/components/list/list-state';
import { PageHeader } from '@/components/page-header';
import { initialsOf, PersonPhoto } from '@/components/person-photo';
import { ErrorState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { useView } from '@/features/access/use-view';
import { divisionsQuery, nameOf } from '@/features/setup/setup-api';
import { subjectsQuery } from '@/features/setup/subjects-api';
import { invalidateStaff, staffPhotoQuery, staffQuery } from './people-api';
import { PeopleTabs } from './people-tabs';
import { StaffForm } from './staff-form';
import { StaffPanel } from './staff-panel';

/**
 * A member of staff in the list, a picker or a list inside a message: surname first
 * (owner's answer to finding 27).
 */
const fullName = (row: Pick<StaffListItem, 'firstName' | 'lastName'>) => listName(row);
/**
 * "First name Surname": the title of the side panel and the sentences inside
 * it (decision 3), and the search, so a name is found however it is typed.
 */
const typedName = (row: Pick<StaffListItem, 'firstName' | 'lastName'>) =>
  `${row.firstName} ${row.lastName}`;

/**
 * The staff of the branch (`04`, Teacher and staff record: "Teacher list
 * columns: ... name, ID, category, branches, department, subjects, grades,
 * languages of instruction, phone, status"; task 2.2a), each opened in the
 * side panel. The Super Admin adds people; the Academic Vice Principal and the
 * Principal read the list and export it (task 2.2c-1; the server leaves the
 * phone out of the Principal's file). Photos and the last column come with
 * tasks 2.2c-2 and 8.x.
 */
export function StaffPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const search = useSearch({ from: '/app/people/staff' });
  const { role, branchId } = useView();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const newRecord = useNewRecord();
  const canCreate = role !== null && permits(PERMISSIONS, role, 'staff', 'create');
  const canExport = role !== null && permits(PERMISSIONS, role, 'staff', 'export');
  const exporter = useExport<StaffListItem>('staff', (row) => row.id);
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
      // A phone of another staff record is refused before Save, the record
      // named in the branch (task 3.6b-1), as the server refuses it.
      if (found.phoneTaken !== null) {
        const match = found.phoneTaken.match;
        throw new ApiFailure('staff_phone_taken', undefined, [
          {
            path: 'phone',
            code: 'staff_phone_taken',
            message: '',
            ...(match === null ? {} : { recordId: match.id, staffName: fullName(match) }),
          },
        ]);
      }
      const names = found.sameNameAndBirth.map((match) => `${fullName(match)} (${match.staffId})`);
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
      // A parent's main phone: the two records will be the same person
      // (task 3.6b-1), and the parent's email is taken when none is typed.
      if (found.relative !== null || found.relativeElsewhere) {
        const go = await confirm({
          title: t('people.staff.sameAsParentTitle'),
          text:
            found.relative === null
              ? t('people.staff.sameAsParentElsewhere')
              : t('people.staff.sameAsParent'),
          names: found.relative === null ? [] : [found.relative.fullName],
          action: t('people.staff.saveSamePerson'),
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
        // `04`: "checkbox, number, photo, name, ..."; not a cell of the Excel file.
        key: 'photo',
        header: t('people.staff.photo.column'),
        cell: (row) => (
          <PersonPhoto
            name={fullName(row)}
            initials={initialsOf(row.firstName, row.lastName)}
            photo={row.photoId === null ? null : staffPhotoQuery(branchId, row.id, row.photoId)}
          />
        ),
        exported: false,
      },
      {
        key: 'name',
        header: t('people.staff.name'),
        cell: (row) => fullName(row),
        sortValue: (row) => `${row.lastName} ${row.firstName}`,
        // Both orders, so a name is found however it is typed.
        searchText: (row) =>
          `${fullName(row)} ${typedName(row)} ${row.fatherName ?? ''} ${row.staffId}`,
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
        cell: (row) => gradeRanges(grades(row)),
      },
      {
        key: 'languages',
        header: t('people.staff.languagesTitle'),
        cell: (row) => row.languages.map((one) => t(`people.staff.languages.${one}`)).join(', '),
      },
      {
        key: 'phone',
        header: t('people.staff.phone'),
        cell: (row) => (row.phone === null ? '' : phoneText(row.phone)),
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
  }, [t, departmentNames, subjectNames, divisions.data, branchId]);

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
        // Every role (`04`, the teacher list: "the category filter offers every role").
        key: 'category',
        label: t('people.staff.categories'),
        options: STAFF_CATEGORY_ROLES.map((one) => ({ value: one, label: t(`roles.${one}`) })),
        matches: (row, value) => row.categories.some((one) => one === value),
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

  const addButton = canCreate && newRecord.value === null && (
    <Button
      id={newRecord.buttonId}
      disabled={divisions.data === undefined}
      onClick={() => {
        newRecord.start(true);
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
      <PeopleTabs current="staff" />
      {failed !== null && (
        <ErrorState
          error={failed.error}
          onRetry={() => {
            void failed.refetch();
          }}
        />
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
        panelName={typedName}
        columns={columns}
        filters={filters}
        onExport={canExport ? exporter.onExport : undefined}
        exportState={exporter.state}
        search={search}
        onSearchChange={open}
        empty={{
          title: t('people.staff.emptyTitle'),
          text: t('people.staff.empty'),
          action: addButton === false ? undefined : addButton,
        }}
        creating={
          newRecord.value === null || divisions.data === undefined
            ? undefined
            : {
                key: 'staff',
                title: t('people.staff.newTitle'),
                content: ({ saved, close }) => (
                  <div className="grid gap-4">
                    <StaffForm
                      staff={null}
                      divisions={divisions.data}
                      contactOnly={false}
                      label={t('people.staff.newTitle')}
                      onSave={async (record) => {
                        saved((await create.mutateAsync(record)).id);
                      }}
                    />
                    <div>
                      <Button variant="ghost" onClick={close}>
                        {t('people.staff.cancel')}
                      </Button>
                    </div>
                  </div>
                ),
                ...newRecord.handlers,
              }
        }
        panel={(row) =>
          divisions.data === undefined ? null : (
            <StaffPanel
              key={row.id}
              id={row.id}
              name={typedName(row)}
              divisions={divisions.data}
              subjects={subjects.data?.subjects ?? []}
            />
          )
        }
      />
    </>
  );
}
