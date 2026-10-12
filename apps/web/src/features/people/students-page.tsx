import {
  PERMISSIONS,
  permits,
  STUDENT_STATUSES,
  studentCheckResultSchema,
  type StudentCreate,
  type StudentListItem,
} from '@sodiq/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, branchHeader } from '@/api/client';
import { answerOf, ApiFailure } from '@/api/failure';
import { useConfirm } from '@/components/confirm-dialog';
import { SaveCancelled } from '@/components/form/save-cancelled';
import { ListPage } from '@/components/list/list-page';
import { type Column, type Filter, type ListSearch } from '@/components/list/list-state';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { useLeave } from '@/components/unsent/unsent-changes';
import { useView } from '@/features/access/use-view';
import { invalidateStudents, studentsQuery } from './people-api';
import { PeopleTabs } from './people-tabs';
import { StudentForm } from './student-form';
import { StudentPanel } from './student-panel';

const fullName = (row: Pick<StudentListItem, 'firstName' | 'lastName'>) =>
  `${row.firstName} ${row.lastName}`;

/** No class, group or tutor exists before tasks 3.1 and 3.2 (answer 17: "every student shows No class"). */
const NO_CLASS = 'none';

/**
 * The students of the branch (`04`, Student record: "Student list columns, in
 * this order: checkbox, number, photo, UID, name and surname, class (grade
 * and name, for example 7 Oxford), groups, tutor, status"; task 2.4a), each
 * opened in the side panel. The photo comes with task 2.4b and the attendance
 * column with its task; phone numbers are never in the list. The Super Admin
 * and the Academic Vice Principal add students.
 */
export function StudentsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const search = useSearch({ from: '/app/people/students' });
  const { role, branchId } = useView();
  const queryClient = useQueryClient();
  const leave = useLeave();
  const confirm = useConfirm();
  const [adding, setAdding] = useState(false);
  const canCreate = role !== null && permits(PERMISSIONS, role, 'students', 'create');
  const students = useQuery(studentsQuery(branchId));

  const byId = useMemo(
    () => new Map((students.data?.students ?? []).map((row) => [row.id, row] as const)),
    [students.data],
  );
  const holderText = (id: string): string | null => {
    const found = byId.get(id);
    return found === undefined ? null : `${fullName(found)} (${found.uid})`;
  };

  /**
   * The duplicate warning before a new student is saved (edge: "A matching
   * name and date of birth ... gives a warning that must be confirmed"), and
   * the UID set warning the server answers (`04`, UID sets, Release 1).
   */
  const create = useMutation({
    mutationFn: async (record: StudentCreate) => {
      const found = studentCheckResultSchema.parse(
        await answerOf(
          api.POST('/api/people/students/check', {
            params: { header: branchHeader() },
            body: {
              firstName: record.firstName,
              lastName: record.lastName,
              birthDate: record.birthDate,
              studentId: null,
            },
          }),
        ),
      );
      if (found.sameNameAndBirth.length > 0 || found.elsewhere) {
        const go = await confirm({
          title: t('people.students.duplicateTitle'),
          text: found.elsewhere
            ? t('people.students.duplicateElsewhere')
            : t('people.students.duplicateHere'),
          names: found.sameNameAndBirth.map((match) => `${fullName(match)} (${match.uid})`),
          action: t('people.students.saveAnyway'),
          destructive: false,
        });
        if (!go) {
          throw new SaveCancelled();
        }
      }
      const send = (confirmUidSet: boolean) =>
        answerOf(
          api.POST('/api/people/students', {
            params: { header: branchHeader() },
            body: { ...record, confirmUidSet },
          }),
        );
      try {
        return await send(false);
      } catch (error) {
        if (!(error instanceof ApiFailure) || error.code !== 'uid_set_mismatch') {
          throw error;
        }
        const go = await confirm({
          title: t('people.students.setTitle'),
          text: t('people.students.setText'),
          names: [record.uid],
          action: t('people.students.saveAnyway'),
          destructive: false,
        });
        if (!go) {
          throw new SaveCancelled();
        }
        return send(true);
      }
    },
    onSuccess: async () => {
      setAdding(false);
      await invalidateStudents(queryClient);
    },
    // A holder saved after the list was read: the list is read again, so the
    // refusal can name them (spec review of the build).
    onError: async (error) => {
      if (error instanceof ApiFailure && error.code === 'student_value_taken') {
        await invalidateStudents(queryClient);
      }
    },
  });

  const columns = useMemo(
    (): Column<StudentListItem>[] => [
      {
        key: 'uid',
        header: t('people.students.uid'),
        cell: (row) => row.uid,
        sortValue: (row) => row.uid,
        searchText: (row) => row.uid,
      },
      {
        key: 'name',
        header: t('people.students.name'),
        cell: (row) => fullName(row),
        sortValue: (row) => `${row.lastName} ${row.firstName}`,
        searchText: (row) => `${fullName(row)} ${row.paternalName ?? ''}`,
        opens: true,
      },
      {
        // `04`: "class (grade and name, for example 7 Oxford)". No class
        // exists before task 3.1, so the cell shows the grade the student
        // joins and "No class" (answer 17; spec review of the build).
        key: 'class',
        header: t('people.students.class'),
        cell: (row) =>
          t('people.students.gradeNoClass', {
            grade: t('setup.subjects.grade', { grade: row.grade }),
          }),
        sortValue: (row) => row.grade,
      },
      {
        key: 'groups',
        header: t('people.students.groups'),
        cell: () => '—',
      },
      {
        key: 'tutor',
        header: t('people.students.tutor'),
        cell: () => '—',
      },
      {
        key: 'status',
        header: t('people.students.status'),
        cell: (row) =>
          row.status === null
            ? t('people.students.notStarted')
            : t(`people.students.statuses.${row.status}`),
        sortValue: (row) => row.status ?? '',
      },
    ],
    [t],
  );

  const filters = useMemo(
    (): Filter<StudentListItem>[] => [
      {
        key: 'grade',
        label: t('people.students.grade'),
        options: Array.from({ length: 11 }, (_unused, index) => ({
          value: String(index + 1),
          label: t('setup.subjects.grade', { grade: index + 1 }),
        })),
        matches: (row, value) => row.grade === Number(value),
      },
      {
        key: 'class',
        label: t('people.students.class'),
        options: [{ value: NO_CLASS, label: t('people.students.noClass') }],
        matches: (_row, value) => value === NO_CLASS,
      },
      {
        key: 'status',
        label: t('people.students.status'),
        options: STUDENT_STATUSES.map((one) => ({
          value: one,
          label: t(`people.students.statuses.${one}`),
        })),
        matches: (row, value) => row.status === value,
      },
    ],
    [t],
  );

  const open = (next: ListSearch, how: 'push' | 'replace'): void => {
    void navigate({ to: '/people/students', search: next, replace: how === 'replace' });
  };

  const addButton = canCreate && !adding && (
    <Button
      onClick={() => {
        setAdding(true);
      }}
    >
      {t('people.students.add')}
    </Button>
  );

  return (
    <>
      <PageHeader
        title={t('people.students.title')}
        breadcrumbs={[
          { label: t('home.title'), to: '/' },
          { label: t('people.title'), to: '/people' },
        ]}
        actions={addButton === false ? undefined : addButton}
      />
      <PeopleTabs current="students" />
      {adding && (
        <section
          aria-label={t('people.students.newTitle')}
          className="mb-6 grid max-w-2xl gap-3 rounded-xl bg-card p-6 max-sm:p-4"
        >
          <h2 className="text-lg font-semibold">{t('people.students.newTitle')}</h2>
          <StudentForm
            student={null}
            label={t('people.students.newTitle')}
            holderText={holderText}
            onCreate={async (record) => {
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
              {t('people.students.cancel')}
            </Button>
          </div>
        </section>
      )}
      <ListPage
        listId="students"
        caption={t('people.students.caption')}
        rows={students.data?.students}
        error={students.error ?? undefined}
        onRetry={() => {
          void students.refetch();
        }}
        rowId={(row) => row.id}
        rowName={fullName}
        columns={columns}
        filters={filters}
        search={search}
        onSearchChange={open}
        empty={{
          title: t('people.students.emptyTitle'),
          text: t('people.students.empty'),
          action: addButton === false ? undefined : addButton,
        }}
        panel={(row) => (
          <StudentPanel key={row.id} id={row.id} name={fullName(row)} holderText={holderText} />
        )}
      />
    </>
  );
}
