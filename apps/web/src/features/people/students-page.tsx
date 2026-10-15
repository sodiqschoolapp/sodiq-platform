import {
  classDisplayName,
  classNameKey,
  INSTRUCTION_LANGUAGES,
  listName,
  PERMISSIONS,
  permits,
  STUDENT_EXPORT_COLUMNS,
  STUDENT_EXPORT_GROUPS,
  STUDENT_LIST_EXPORT_COLUMNS,
  STUDENT_STATUSES,
  studentCheckResultSchema,
  studentLeavingSchema,
  type StudentCreate,
  type StudentExportColumn,
  type StudentFieldGroup,
  type StudentLeaving,
  type StudentListItem,
} from '@sodiq/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, branchHeader } from '@/api/client';
import { answerOf, ApiFailure } from '@/api/failure';
import { uidSetText } from './uid-set';
import { useConfirm } from '@/components/confirm-dialog';
import { FailureAlert } from '@/components/failure-alert';
import { DateField, Field } from '@/components/field';
import { RecordForm } from '@/components/form/record-form';
import { SaveCancelled } from '@/components/form/save-cancelled';
import { useRecordForm } from '@/components/form/use-record-form';
import {
  ListPage,
  type BulkAction,
  type ExportExtra,
  type NewRecord,
} from '@/components/list/list-page';
import { useNewRecord } from '@/components/list/use-new-record';
import { useExport } from '@/components/list/use-export';
import { type Column, type Filter, type ListSearch } from '@/components/list/list-state';
import { PageHeader } from '@/components/page-header';
import { initialsOf, PersonPhoto } from '@/components/person-photo';
import { Button } from '@/components/ui/button';
import { useMayView, useView } from '@/features/access/use-view';
import { classesQuery } from '@/features/classes/classes-api';
import { asFormSchema } from './form-schema';
import {
  invalidateRelatives,
  invalidateStudents,
  phoneMatch,
  studentPhotoQuery,
  studentsQuery,
} from './people-api';
import { PeopleTabs } from './people-tabs';
import { GroupsPlacedNotice, PlaceTickedForm } from '@/features/classes/class-members';
import { PlaceTickedInGroupForm } from '@/features/classes/group-members';
import { StudentForm } from './student-form';
import { StudentPanel } from './student-panel';
import { IncomingMoves } from './branch-move';
import { studentStatusText } from './status-cause';
import { schoolDateText } from '@/lib/dates';

/**
 * A student in the list, a picker or a list inside a message: surname first
 * (owner's answer to finding 27).
 */
const fullName = (row: Pick<StudentListItem, 'firstName' | 'lastName'>) => listName(row);
/**
 * "First name Surname": the title of the side panel and the sentences inside
 * it (decision 3), and the search, so a name is found however it is typed.
 */
const typedName = (row: Pick<StudentListItem, 'firstName' | 'lastName'>) =>
  `${row.firstName} ${row.lastName}`;

/**
 * The "No class" option of the class filter (edge: "They appear with class
 * \"—\", under a \"No class\" filter"): active, with no class today and none
 * planned, the rule of the server's counter (task 3.1b).
 */
const NO_CLASS = 'none';

/** The class a student is shown with: the one today, else the one planned. */
const shownClass = (row: StudentListItem) => row.class ?? row.plannedClass;

/** The one option of the consent filter (answer 23: "a list shows active students without it"). */
const NO_CONSENT = 'missing';

type ExtraColumn = Exclude<StudentExportColumn, (typeof STUDENT_LIST_EXPORT_COLUMNS)[number]>;

/** The words of the student record that name each export-only column, as the profile names the field. */
const EXTRA_HEADERS = {
  paternalName: 'people.students.paternalName',
  sex: 'people.students.sex',
  grade: 'people.students.grade',
  startsOn: 'people.students.startsOn',
  phone: 'people.students.phone',
  email: 'people.students.email',
  birthDate: 'people.students.birthDate',
  documentType: 'people.students.documentType',
  documentNumber: 'people.students.documentNumber',
  jshshir: 'people.students.jshshir',
  address: 'people.students.address',
  region: 'people.students.region',
  contractNumber: 'people.students.contractNumber',
  contractSignedOn: 'people.students.contractSignedOn',
  scholarshipType: 'people.students.scholarshipType',
  scholarshipCoverage: 'people.students.scholarshipCoverage',
  scholarshipAmount: 'people.students.scholarshipAmount',
  previousSchool: 'people.students.previousSchool',
  diagnosticScore: 'people.students.diagnosticScore',
  consentSignedOn: 'people.students.consentSignedOn',
  // Task 2.5b-2: the relatives, in the Contact group.
  mainContactName: 'people.students.mainContactName',
  mainContactRelationship: 'people.students.mainContactRelationship',
  mainContactPhone: 'people.students.mainContactPhone',
  mainContactExtraPhones: 'people.students.mainContactExtraPhones',
  otherRelatives: 'people.students.otherRelatives',
} as const satisfies Record<ExtraColumn, string>;

/** The export-only columns of the file (task 2.4b-2): those after the list's own, in its order. */
const EXTRA_COLUMNS = STUDENT_EXPORT_COLUMNS.filter(
  (column): column is ExtraColumn =>
    !(STUDENT_LIST_EXPORT_COLUMNS as readonly StudentExportColumn[]).includes(column),
);

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

/** What the side panel holds besides a student: a new student, or a bulk change of the ticked ones. */
type NewForm =
  | { kind: 'student' }
  | { kind: 'leaving'; rows: StudentListItem[] }
  | { kind: 'place'; rows: StudentListItem[] }
  | { kind: 'placeGroup'; rows: StudentListItem[] };

/** What a bulk leaving did: how many went through, the names of those refused, and a failure that stopped it. */
interface Outcome {
  done: number;
  refused: string[];
  failure: unknown;
}

/**
 * The students of the branch (`04`, Student record: "Student list columns, in
 * this order: checkbox, number, photo, UID, name and surname, class (grade
 * and name, for example 7 Oxford), groups, tutor, status"; task 2.4a), each
 * opened in the side panel. The attendance column comes with its task; phone
 * numbers are never in the list, only in the export-only columns of the file
 * (task 2.4b-2). The Super Admin and the Academic Vice Principal add students.
 */
export function StudentsPage() {
  const { t, i18n } = useTranslation();
  const number = useMemo(() => new Intl.NumberFormat(i18n.language), [i18n.language]);
  const navigate = useNavigate();
  const search = useSearch({ from: '/app/people/students' });
  const { role, branchId } = useView();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  // A new student, or the bulk leaving of the ticked students, in the side
  // panel of the list (task 2.7c-2a).
  const newRecord = useNewRecord<NewForm>();
  const { start: startNew } = newRecord;
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const canCreate = role !== null && permits(PERMISSIONS, role, 'students', 'create');
  // "Put into a class" (task 3.1b, decision 9): the editors of classes; the server decides.
  const canPlace = role !== null && permits(PERMISSIONS, role, 'classes', 'edit');
  // "Put into a group" (task 3.2b, decision 6): the editors of groups; the server decides.
  const canPlaceInGroup = role !== null && permits(PERMISSIONS, role, 'groups', 'edit');
  const [placedInGroup, setPlacedInGroup] = useState<number | null>(null);
  const [placed, setPlaced] = useState<number | null>(null);
  // Task 3.2c: the students the last placement put into groups automatically.
  const [groupsPlaced, setGroupsPlaced] = useState(0);
  const exporter = useExport<StudentListItem>('students', (row) => row.id);
  const all = useQuery(studentsQuery(branchId));
  // The consent list comes from the server, which gives it to the Financial
  // readers only (correction 1 of the review of pull request #70).
  const wantsConsent = search.f?.consent === NO_CONSENT && all.data?.readsFinancial === true;
  const withoutConsent = useQuery({
    ...studentsQuery(branchId, NO_CONSENT),
    enabled: branchId !== null && wantsConsent,
  });
  const students = wantsConsent ? withoutConsent : all;
  const exportGroups = all.data?.exportGroups;
  const readsFinancial = all.data?.readsFinancial === true;
  const today = students.data?.today ?? null;
  // Issue #105, H18: the Class filter offers every class of the branch that
  // is not archived and whose year is not closed, the empty ones too, for a
  // reader of the class list; the rows' classes meanwhile and without it.
  const readsClasses = useMayView('classes');
  const classList = useQuery({
    ...classesQuery(branchId),
    enabled: branchId !== null && readsClasses,
  });

  const byId = useMemo(
    () => new Map((all.data?.students ?? []).map((row) => [row.id, row] as const)),
    [all.data],
  );
  const holderText = (id: string): string | null => {
    const found = byId.get(id);
    return found === undefined ? null : `${fullName(found)} (${found.uid})`;
  };
  // A graduated holder is offered only to a reader who may restore one (the Super Admin).
  const canRestoreGraduated =
    role !== null && permits(PERMISSIONS, role, 'student_graduates', 'edit');
  const holderRestorable = (id: string): boolean => {
    const status = byId.get(id)?.status;
    return status === 'inactive' || (status === 'graduated' && canRestoreGraduated);
  };
  const canArchive = all.data?.canArchive === true;

  /**
   * The bulk "Leave school" (`04`: "Bulk actions on ticked rows: ... archive"):
   * one leaving per student with the version the list read, each its own
   * change; a refused one is named and the others go on.
   */
  const leaveMany = useMutation({
    mutationFn: async ({ rows, input }: { rows: StudentListItem[]; input: BulkLeaving }) => {
      const result: Outcome = { done: 0, refused: [], failure: null };
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
            // Anything else stops the rest; what was done is still said.
            result.failure = error;
            break;
          }
          result.refused.push(fullName(row));
        }
      }
      return result;
    },
    onSuccess: setOutcome,
    onSettled: () => invalidateStudents(queryClient),
  });

  const bulkActions = useMemo(
    (): BulkAction<StudentListItem>[] => [
      ...(canPlace
        ? [
            {
              key: 'place',
              label: t('classes.putIntoClass'),
              run: (rows: StudentListItem[]) => {
                setPlaced(null);
                startNew({ kind: 'place', rows });
              },
            },
          ]
        : []),
      ...(canPlaceInGroup
        ? [
            {
              key: 'placeGroup',
              label: t('groups.putIntoGroup'),
              run: (rows: StudentListItem[]) => {
                setPlacedInGroup(null);
                startNew({ kind: 'placeGroup', rows });
              },
            },
          ]
        : []),
      ...(canArchive
        ? [
            {
              key: 'leave',
              label: t('people.students.bulkLeave'),
              run: (rows: StudentListItem[]) => {
                setOutcome(null);
                startNew({ kind: 'leaving', rows });
              },
            },
          ]
        : []),
    ],
    [canArchive, canPlace, canPlaceInGroup, t, startNew],
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
          text: uidSetText(t, error, record.grade),
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
    // The list holds the new student before the panel shows it.
    onSuccess: () => invalidateRelatives(queryClient),
    // A holder saved after the list was read: the list is read again, so the
    // refusal can name them (spec review of the build).
    onError: async (error) => {
      if (error instanceof ApiFailure && error.code === 'student_value_taken') {
        await invalidateStudents(queryClient);
      }
    },
  });

  /** The groups of export-only columns this reader may add (`exportGroups` of the server). */
  const exportExtras = useMemo(
    (): ExportExtra[] =>
      (exportGroups ?? []).map((group: StudentFieldGroup) => ({
        key: group,
        label: t(`people.students.exportGroups.${group}`),
        columns: EXTRA_COLUMNS.filter((column) => STUDENT_EXPORT_GROUPS[column] === group).map(
          (column) => ({ key: column, header: t(EXTRA_HEADERS[column]) }),
        ),
      })),
    [exportGroups, t],
  );

  const columns = useMemo(
    (): Column<StudentListItem>[] => [
      {
        // `04`: "checkbox, number, photo, UID, ..."; not a cell of the Excel file.
        key: 'photo',
        header: t('people.staff.photo.column'),
        cell: (row) => (
          <PersonPhoto
            name={fullName(row)}
            initials={initialsOf(row.firstName, row.lastName)}
            photo={row.photoId === null ? null : studentPhotoQuery(branchId, row.id, row.photoId)}
          />
        ),
        exported: false,
      },
      {
        key: 'uid',
        header: t('people.students.uid'),
        cell: (row) => row.uid,
        sortValue: (row) => row.uid,
        // Task 3.3d: a UID of a record merged into this one finds it too.
        searchText: (row) => [row.uid, ...row.mergedUids].join(' '),
      },
      {
        key: 'name',
        header: t('people.students.name'),
        cell: (row) => fullName(row),
        sortValue: (row) => `${row.lastName} ${row.firstName}`,
        // Both orders, so a name is found however it is typed.
        searchText: (row) => `${fullName(row)} ${typedName(row)} ${row.paternalName ?? ''}`,
        opens: true,
      },
      {
        // `04`: "class (grade and name, for example 7 Oxford)"; "—" with
        // none (edge, "A student is enrolled in August"); a planned one with
        // its first day (task 3.1b).
        key: 'class',
        header: t('people.students.class'),
        cell: (row) =>
          row.class !== null
            ? classDisplayName(row.class.grade, row.class.name)
            : row.plannedClass !== null
              ? t('people.students.classFrom', {
                  class: classDisplayName(row.plannedClass.grade, row.plannedClass.name),
                  date: schoolDateText(row.plannedClass.from, i18n.language),
                })
              : '—',
        sortValue: (row) => {
          const shown = shownClass(row);
          return shown === null ? null : `${String(shown.grade).padStart(2, '0')} ${shown.name}`;
        },
        searchText: (row) => {
          const shown = shownClass(row);
          return shown === null ? '' : classDisplayName(shown.grade, shown.name);
        },
      },
      {
        // `04`: "groups" (task 3.2b): in force today, else the first planned
        // with its first day, one per subject; a Tutor's rows of other classes
        // hold none (decision 4).
        key: 'groups',
        header: t('people.students.groups'),
        cell: (row) =>
          row.groups.length === 0
            ? '—'
            : row.groups
                .map((group) =>
                  group.state === 'planned'
                    ? t('people.students.groupFrom', {
                        group: group.name,
                        date: schoolDateText(group.from, i18n.language),
                      })
                    : group.name,
                )
                .join(', '),
        sortValue: (row) => row.groups.map((group) => group.name).join(', ') || null,
        searchText: (row) => row.groups.map((group) => group.name).join(' '),
        searchFold: classNameKey,
      },
      {
        // The Tutor of the class in force today, the acting one beside them (task 3.1b).
        key: 'tutor',
        header: t('people.students.tutor'),
        cell: (row) =>
          [row.tutor, row.actingTutor]
            .filter((name) => name !== null)
            .map((name) => listName(name))
            .join(', ') || '—',
        sortValue: (row) => (row.tutor === null ? null : listName(row.tutor)),
      },
      {
        key: 'status',
        header: t('people.students.status'),
        cell: (row) => (
          <>
            {today === null
              ? row.status === null
                ? t('people.students.notStarted')
                : t(`people.students.statuses.${row.status}`)
              : studentStatusText(t, row, today, i18n.language)}
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
    [t, i18n.language, branchId, today],
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
        // Every active class of the branch (H18) and the classes the rows
        // name (a planned class of the next year), and "No class" (task 3.1b).
        key: 'class',
        label: t('people.students.class'),
        options: [
          ...[
            ...new Map<string, { id: string; grade: number; name: string }>([
              ...(classList.data?.classes ?? [])
                .filter((one) => !one.archived && one.yearStatus !== 'closed')
                .map((one) => [one.id, { id: one.id, grade: one.grade, name: one.name }] as const),
              ...(all.data?.students ?? []).flatMap((row) => {
                const shown = shownClass(row);
                return shown === null ? [] : [[shown.id, shown] as const];
              }),
            ]).values(),
          ]
            .sort((a, b) => a.grade - b.grade || a.name.localeCompare(b.name))
            .map((one) => ({ value: one.id, label: classDisplayName(one.grade, one.name) })),
          { value: NO_CLASS, label: t('people.students.noClass') },
        ],
        // "No class" is the server's rule of the counter whose link opens it:
        // active today (before the start date included), no class now or planned.
        matches: (row, value) =>
          value === NO_CLASS
            ? shownClass(row) === null && (row.status === 'active' || row.status === null)
            : shownClass(row)?.id === value,
      },
      {
        // The groups the rows name, current or planned: the server's rule of
        // the column (task 3.2b).
        key: 'group',
        label: t('people.students.groups'),
        options: [
          ...new Map(
            (all.data?.students ?? []).flatMap((row) =>
              row.groups.map((group) => [group.id, group.name] as const),
            ),
          ),
        ]
          .sort((a, b) => classNameKey(a[1]).localeCompare(classNameKey(b[1])))
          .map(([value, label]) => ({ value, label })),
        matches: (row, value) => row.groups.some((group) => group.id === value),
      },
      {
        key: 'language',
        label: t('people.students.language'),
        options: INSTRUCTION_LANGUAGES.map((language) => ({
          value: language,
          label: t(`people.staff.languages.${language}`),
        })),
        matches: (row, value) => shownClass(row)?.language === value,
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
      ...(readsFinancial
        ? [
            {
              key: 'consent',
              label: t('people.students.consent'),
              options: [{ value: NO_CONSENT, label: t('people.students.activeNoConsent') }],
              matches: (row: StudentListItem) =>
                row.status === 'active' && row.consentMissing === true,
            },
          ]
        : []),
    ],
    [t, readsFinancial, all.data, classList.data],
  );

  const open = (next: ListSearch, how: 'push' | 'replace'): void => {
    void navigate({ to: '/people/students', search: next, replace: how === 'replace' });
  };

  const addButton = canCreate && newRecord.value === null && (
    <Button
      id={newRecord.buttonId}
      onClick={() => {
        newRecord.start({ kind: 'student' });
      }}
    >
      {t('people.students.add')}
    </Button>
  );

  /** "Put into a class" of the ticked students (task 3.1b), in the side panel of the list. */
  const placePanel = (rows: StudentListItem[]): NewRecord => {
    const title = t('classes.placeTitle', { count: rows.length, n: number.format(rows.length) });
    return {
      key: `place:${rows.map((row) => row.id).join()}`,
      title,
      content: ({ close }) => (
        <div className="grid gap-4">
          <PlaceTickedForm
            key={rows.map((row) => row.id).join()}
            rows={rows}
            title={title}
            onPlaced={(count, inGroups) => {
              setPlaced(count);
              setGroupsPlaced(inGroups);
              close();
            }}
          />
          <div>
            <Button variant="ghost" onClick={close}>
              {t('people.students.cancel')}
            </Button>
          </div>
        </div>
      ),
      ...newRecord.handlers,
    };
  };

  /** "Put into a group" of the ticked students (task 3.2b), in the side panel of the list. */
  const placeGroupPanel = (rows: StudentListItem[]): NewRecord => {
    const title = t('groups.placeTitle', { count: rows.length, n: number.format(rows.length) });
    return {
      key: `placeGroup:${rows.map((row) => row.id).join()}`,
      title,
      content: ({ close }) => (
        <div className="grid gap-4">
          <PlaceTickedInGroupForm
            key={rows.map((row) => row.id).join()}
            rows={rows}
            title={title}
            onPlaced={(count) => {
              setPlacedInGroup(count);
              close();
            }}
          />
          <div>
            <Button variant="ghost" onClick={close}>
              {t('people.students.cancel')}
            </Button>
          </div>
        </div>
      ),
      ...newRecord.handlers,
    };
  };

  const leavingPanel = (rows: StudentListItem[]): NewRecord => {
    const title = t('people.students.bulkLeaveTitle', {
      count: rows.length,
      n: number.format(rows.length),
    });
    return {
      key: `leaving:${rows.map((row) => row.id).join()}`,
      title,
      content: ({ saved, close }) => (
        <BulkLeavingForm
          key={rows.map((row) => row.id).join()}
          title={title}
          onSave={async (input) => {
            const go = await confirm({
              title: t('people.students.leaveConfirmTitle'),
              text: t('people.students.leaveConfirmText'),
              names: rows.map(fullName),
              action: t('people.students.leaveAction'),
              destructive: true,
            });
            if (!go) {
              throw new SaveCancelled();
            }
            await leaveMany.mutateAsync({ rows, input });
            saved();
          }}
          onCancel={close}
        />
      ),
      ...newRecord.handlers,
    };
  };

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
      <IncomingMoves />
      {outcome !== null && (
        <p role="status" className="mb-3 text-sm">
          {t('people.students.bulkLeft', { count: outcome.done, n: number.format(outcome.done) })}
          {outcome.refused.length > 0 && (
            <> {t('people.students.bulkRefused', { names: outcome.refused.join(', ') })}</>
          )}
        </p>
      )}
      {placed !== null && (
        <p role="status" className="mb-3 text-sm">
          {t('classes.placed', { count: placed, n: number.format(placed) })}
        </p>
      )}
      {placed !== null && (
        <div className="mb-3">
          <GroupsPlacedNotice count={groupsPlaced} />
        </div>
      )}
      {placedInGroup !== null && (
        <p role="status" className="mb-3 text-sm">
          {t('groups.placed', { count: placedInGroup, n: number.format(placedInGroup) })}
        </p>
      )}
      {outcome !== null && outcome.failure !== null && (
        <div className="mb-3">
          <FailureAlert error={outcome.failure} />
        </div>
      )}
      {classList.isError && (
        // The class list did not load: the filter keeps the rows' classes
        // (`.claude/rules/web.md`: a part drawn from a second query shows its failure).
        <p role="status" className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          {t('people.students.classesNotRead')}
          <Button
            variant="ghost"
            onClick={() => {
              void classList.refetch();
            }}
          >
            {t('problems.retry')}
          </Button>
        </p>
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
        panelName={typedName}
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
        onExport={
          exportGroups !== undefined && exportGroups.length > 0 ? exporter.onExport : undefined
        }
        exportState={exporter.state}
        exportExtras={exportExtras}
        creating={
          newRecord.value === null
            ? undefined
            : newRecord.value.kind === 'student'
              ? {
                  key: 'student',
                  title: t('people.students.newTitle'),
                  content: ({ saved, close, open: openHolder }) => (
                    <div className="grid gap-4">
                      <StudentForm
                        student={null}
                        label={t('people.students.newTitle')}
                        holderText={holderText}
                        holderRestorable={holderRestorable}
                        onOpenHolder={openHolder}
                        onCreate={async (record) => {
                          const created = await create.mutateAsync(record);
                          // The consent filter holds the active students without
                          // consent only, as the server reads it: any other saved
                          // student would be hidden, so it is turned off and the
                          // panel shows the student (pull request #81, correction 1).
                          const hidden =
                            wantsConsent &&
                            !(created.status === 'active' && created.consentMissing === true);
                          saved(
                            created.id,
                            hidden
                              ? {
                                  f: Object.fromEntries(
                                    Object.entries(search.f ?? {}).filter(
                                      ([key]) => key !== 'consent',
                                    ),
                                  ),
                                }
                              : {},
                          );
                        }}
                        onPhoneMatch={phoneMatch}
                      />
                      <div>
                        <Button variant="ghost" onClick={close}>
                          {t('people.students.cancel')}
                        </Button>
                      </div>
                    </div>
                  ),
                  ...newRecord.handlers,
                }
              : newRecord.value.kind === 'place'
                ? placePanel(newRecord.value.rows)
                : newRecord.value.kind === 'placeGroup'
                  ? placeGroupPanel(newRecord.value.rows)
                  : leavingPanel(newRecord.value.rows)
        }
        rowOpens={(row) => row.opens}
        panel={(row) => (
          <StudentPanel key={row.id} id={row.id} name={typedName(row)} holderText={holderText} />
        )}
      />
    </>
  );
}

/** The one last day and reason of a bulk leaving, in the side panel of the list. */
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
  const form = useRecordForm<'lastDay' | 'reason', BulkLeaving>({
    schema: BULK_LEAVING_SCHEMA,
    initial: { lastDay: '', reason: '' },
    save: onSave,
  });
  return (
    <div className="grid gap-4">
      <RecordForm form={form} label={title}>
        <DateField label={t('people.students.lastDay')} {...form.bind('lastDay')} />
        <Field label={t('people.students.reason')} {...form.bind('reason')} />
      </RecordForm>
      <div>
        <Button variant="ghost" onClick={onCancel}>
          {t('people.students.cancel')}
        </Button>
      </div>
    </div>
  );
}
