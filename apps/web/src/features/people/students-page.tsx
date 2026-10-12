import {
  PERMISSIONS,
  permits,
  STUDENT_STATUSES,
  studentCheckResultSchema,
  studentLeavingSchema,
  type StudentCreate,
  type StudentLeaving,
  type StudentListItem,
} from '@sodiq/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, branchHeader } from '@/api/client';
import { answerOf, ApiFailure } from '@/api/failure';
import { useConfirm } from '@/components/confirm-dialog';
import { DateField, Field } from '@/components/field';
import { RecordForm } from '@/components/form/record-form';
import { SaveCancelled } from '@/components/form/save-cancelled';
import { useRecordForm } from '@/components/form/use-record-form';
import { ListPage, type BulkAction } from '@/components/list/list-page';
import { type Column, type Filter, type ListSearch } from '@/components/list/list-state';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { useLeave } from '@/components/unsent/unsent-changes';
import { useView } from '@/features/access/use-view';
import { schoolDateText } from '@/features/setup/setup-api';
import { asFormSchema } from './form-schema';
import { invalidateStudents, studentsQuery } from './people-api';
import { PeopleTabs } from './people-tabs';
import { StudentForm } from './student-form';
import { StudentPanel } from './student-panel';

const fullName = (row: Pick<StudentListItem, 'firstName' | 'lastName'>) =>
  `${row.firstName} ${row.lastName}`;

/** No class, group or tutor exists before tasks 3.1 and 3.2 (answer 17: "every student shows No class"). */
const NO_CLASS = 'none';

/** One last day and reason for every ticked student (task 2.4b-1, decision 12). */
type BulkLeaving = Omit<StudentLeaving, 'version'>;

const BULK_LEAVING_SCHEMA = asFormSchema<BulkLeaving>(
  studentLeavingSchema.omit({ version: true }),
  (path) => [...path],
);

/** The refusals the bulk leaving names instead of stopping at: the others go on. */
const BULK_REFUSALS: ReadonlySet<string> = new Set([
  'student_not_active',
  'leaving_before_start',
  'date_in_closed_year',
  'student_changed',
  'not_found',
]);

/** What a bulk leaving did: how many went through, and the names of those refused. */
interface Outcome {
  done: number;
  refused: string[];
}

/**
 * The students of the branch (`04`, Student record: "Student list columns, in
 * this order: checkbox, number, photo, UID, name and surname, class (grade
 * and name, for example 7 Oxford), groups, tutor, status"; task 2.4a), each
 * opened in the side panel. The photo comes with task 2.4b and the attendance
 * column with its task; phone numbers are never in the list. The Super Admin
 * and the Academic Vice Principal add students.
 */
export function StudentsPage() {
  const { t, i18n } = useTranslation();
  const number = useMemo(() => new Intl.NumberFormat(i18n.language), [i18n.language]);
  const navigate = useNavigate();
  const search = useSearch({ from: '/app/people/students' });
  const { role, branchId } = useView();
  const queryClient = useQueryClient();
  const leave = useLeave();
  const confirm = useConfirm();
  const [adding, setAdding] = useState(false);
  const [leaving, setLeaving] = useState<StudentListItem[] | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
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
  const holderRestorable = (id: string): boolean => {
    const status = byId.get(id)?.status;
    return status === 'inactive' || status === 'graduated';
  };
  const canArchive = students.data?.canArchive === true;

  /**
   * The bulk "Leave school" (`04`: "Bulk actions on ticked rows: ... archive"):
   * one leaving per student with the version the list read, each its own
   * change; a refused one is named and the others go on.
   */
  const leaveMany = useMutation({
    mutationFn: async ({ rows, input }: { rows: StudentListItem[]; input: BulkLeaving }) => {
      const result: Outcome = { done: 0, refused: [] };
      for (const row of rows) {
        try {
          await answerOf(
            api.POST('/api/people/students/{id}/leaving', {
              params: { header: branchHeader(), path: { id: row.id } },
              body: { ...input, version: row.version },
            }),
          );
          result.done += 1;
        } catch (error) {
          if (!(error instanceof ApiFailure) || !BULK_REFUSALS.has(error.code)) {
            throw error;
          }
          result.refused.push(fullName(row));
        }
      }
      return result;
    },
    onSuccess: (result) => {
      setOutcome(result);
      setLeaving(null);
    },
    onSettled: () => invalidateStudents(queryClient),
  });

  const bulkActions = useMemo(
    (): BulkAction<StudentListItem>[] =>
      canArchive
        ? [
            {
              key: 'leave',
              label: t('people.students.bulkLeave'),
              run: (rows) => {
                setOutcome(null);
                setLeaving(rows);
              },
            },
          ]
        : [],
    [canArchive, t],
  );

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
        cell: (row) => (
          <>
            {row.status === null
              ? t('people.students.notStarted')
              : t(`people.students.statuses.${row.status}`)}
            {row.planned?.status === 'inactive' && (
              <span className="ml-2 rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                {t('people.students.inactiveFrom', {
                  date: schoolDateText(row.planned.from, i18n.language),
                })}
              </span>
            )}
          </>
        ),
        sortValue: (row) => row.status ?? '',
      },
    ],
    [t, i18n.language],
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
            holderRestorable={holderRestorable}
            onOpenHolder={(id) => {
              open({ ...search, open: id }, 'push');
            }}
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
      {leaving !== null && (
        <BulkLeavingForm
          key={leaving.map((row) => row.id).join()}
          title={t('people.students.bulkLeaveTitle', {
            count: leaving.length,
            n: number.format(leaving.length),
          })}
          onSave={async (input) => {
            const go = await confirm({
              title: t('people.students.leaveConfirmTitle'),
              text: t('people.students.leaveConfirmText'),
              names: leaving.map(fullName),
              action: t('people.students.leaveAction'),
              destructive: true,
            });
            if (!go) {
              throw new SaveCancelled();
            }
            await leaveMany.mutateAsync({ rows: leaving, input });
          }}
          onCancel={() => {
            setLeaving(null);
          }}
        />
      )}
      {outcome !== null && (
        <p role="status" className="mb-3 text-sm">
          {t('people.students.bulkLeft', { count: outcome.done, n: number.format(outcome.done) })}
          {outcome.refused.length > 0 && (
            <> {t('people.students.bulkRefused', { names: outcome.refused.join(', ') })}</>
          )}
        </p>
      )}
      <ListPage
        listId="students"
        caption={t('people.students.caption')}
        rows={students.data?.students}
        error={students.error ?? leaveMany.error ?? undefined}
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
        bulkActions={bulkActions}
        panel={(row) => (
          <StudentPanel key={row.id} id={row.id} name={fullName(row)} holderText={holderText} />
        )}
      />
    </>
  );
}

/** The one last day and reason of a bulk leaving, above the list. */
function BulkLeavingForm({
  title,
  onSave,
  onCancel,
}: {
  title: string;
  onSave: (input: BulkLeaving) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const leave = useLeave();
  const form = useRecordForm<'lastDay' | 'reason', BulkLeaving>({
    schema: BULK_LEAVING_SCHEMA,
    initial: { lastDay: '', reason: '' },
    save: onSave,
  });
  return (
    <section
      aria-label={title}
      className="mb-6 grid max-w-2xl gap-3 rounded-xl bg-card p-6 max-sm:p-4"
    >
      <h2 className="text-lg font-semibold">{title}</h2>
      <RecordForm form={form} label={title}>
        <DateField label={t('people.students.lastDay')} {...form.bind('lastDay')} />
        <Field label={t('people.students.reason')} {...form.bind('reason')} />
      </RecordForm>
      <div>
        <Button
          variant="ghost"
          onClick={() => {
            void leave.leave().then((leaves) => {
              if (leaves) {
                onCancel();
              }
            });
          }}
        >
          {t('people.students.cancel')}
        </Button>
      </div>
    </section>
  );
}
