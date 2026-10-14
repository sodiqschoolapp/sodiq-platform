import {
  classDisplayName,
  classParamsSchema,
  classPlacementSchema,
  listName,
  type AcademicYear,
  type ClassDetail,
  type ClassMember,
  type ClassPlacement,
  type StudentListItem,
} from '@sodiq/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiFailure } from '@/api/failure';
import { useConfirm } from '@/components/confirm-dialog';
import { CheckboxGroupField, DateField, listValues, SelectField } from '@/components/field';
import { FailureAlert } from '@/components/failure-alert';
import { RecordForm } from '@/components/form/record-form';
import { useRecordForm, type FieldBinding } from '@/components/form/use-record-form';
import type { PanelEditing } from '@/components/list/use-panel-editing';
import { ErrorState, LoadingOutline } from '@/components/states';
import { Button } from '@/components/ui/button';
import { SECTION_TITLE } from '@/components/ui/control';
import { useView } from '@/features/access/use-view';
import { asFormSchema } from '@/features/people/form-schema';
import { invalidateStudents, studentsQuery } from '@/features/people/people-api';
import { yearsQuery } from '@/features/setup/setup-api';
import { schoolDateText } from '@/lib/dates';
import {
  classMembersQuery,
  classesQuery,
  invalidateClasses,
  placeStudents,
  withdrawMember,
} from './classes-api';

/** Whether a student of the list can be put into a class: active (or before the start), with no class now or planned. */
export const placeable = (row: StudentListItem): boolean =>
  (row.status === 'active' || row.status === null) &&
  row.class === null &&
  row.plannedClass === null;

/**
 * The first day a placement takes by default (decision 6): the latest of
 * today, the start of the class's year and the start date of each student
 * placed.
 */
export function placementDay(
  today: string,
  yearStart: string | undefined,
  starts: readonly string[],
): string {
  return [yearStart ?? today, ...starts].reduce(
    (latest, day) => (day > latest ? day : latest),
    today,
  );
}

/**
 * Keeps a date field on its default while the person has not typed another
 * date: when the default moves (a student ticked, a class chosen), a field
 * still showing the last default takes the new one.
 */
export function useFollowingDefault(binding: FieldBinding, value: string): void {
  const last = useRef(binding.value);
  const { value: shown, onChange } = binding;
  useEffect(() => {
    if (shown === last.current && value !== last.current) {
      last.current = value;
      onChange({ target: { value } });
    }
  }, [shown, value, onChange]);
}

/**
 * The students a refused placement names (`details` of the answer, one per
 * student), by the names the list read; a student the list does not hold is
 * left out of the sentence, never a blank (.claude/rules/web.md).
 */
export function refusedNames(error: unknown, nameOf: (id: string) => string | undefined): string[] {
  if (!(error instanceof ApiFailure)) {
    return [];
  }
  return (error.details ?? []).flatMap((detail) => {
    const name = detail.recordId === undefined ? undefined : nameOf(detail.recordId);
    return name === undefined ? [] : [name];
  });
}

/** After a placement or a withdraw: the classes (their counts and tabs) and the students (their classes and the counter). */
const refreshAll = (queryClient: ReturnType<typeof useQueryClient>) =>
  Promise.all([invalidateClasses(queryClient), invalidateStudents(queryClient)]);

/** An issue of a placement names the field: every issue of a student is the field of the students. */
const placementField = (path: readonly PropertyKey[]): PropertyKey[] =>
  path[0] === 'students' ? ['students'] : [...path];

const PICKED_SCHEMA = asFormSchema<ClassPlacement>(classPlacementSchema, placementField);

/** "Put into a class" of the ticked students of the list: the placement and its class. */
type ChosenPlacement = ClassPlacement & { classId: string };

const CHOSEN_SCHEMA = asFormSchema<ChosenPlacement>(
  classPlacementSchema.extend({ classId: classParamsSchema.shape.id }),
  placementField,
);

interface ClassMembersProps {
  schoolClass: ClassDetail;
  years: readonly AcademicYear[];
  /** Places and withdraws: `classes` `edit`, a class that is active in an open year. */
  canEdit: boolean;
  panel: PanelEditing;
}

/**
 * The Students tab of a class (task 3.1b): the members in force today and the
 * planned ones with their first day, the free seats today and the fewest free
 * seats from today on (edge, "A class is full": "counting scheduled joins and
 * leaves"), "Put into a class" and the withdraw of a planned placement
 * (decision 10).
 */
export function ClassMembers({ schoolClass, years, canEdit, panel }: ClassMembersProps) {
  const { t, i18n } = useTranslation();
  const { branchId } = useView();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const members = useQuery(classMembersQuery(branchId, schoolClass.id));
  const name = classDisplayName(schoolClass.grade, schoolClass.name);
  const withdraw = useMutation({
    mutationFn: async (member: ClassMember) => {
      const go = await confirm({
        title: t('classes.withdrawTitle'),
        text: t('classes.withdrawText'),
        names: [
          `${listName(member)}, ${t('classes.joinsOn', {
            date: schoolDateText(member.from, i18n.language),
          })}`,
        ],
        action: t('classes.withdraw'),
        destructive: true,
      });
      return go ? withdrawMember(schoolClass.id, member.id) : null;
    },
    onSuccess: async (answer) => {
      if (answer !== null) {
        await refreshAll(queryClient);
      }
    },
  });

  if (members.isError) {
    return (
      <ErrorState
        error={members.error}
        onRetry={() => {
          void members.refetch();
        }}
      />
    );
  }
  if (members.data === undefined) {
    return <LoadingOutline lines={3} />;
  }
  const tab = members.data;
  const yearStart = years.find((year) => year.id === schoolClass.academicYearId)?.startDate;
  return (
    <section className="grid gap-3">
      <h3 className={SECTION_TITLE}>{t('classes.students')}</h3>
      <p className="text-sm text-muted-foreground">
        {t('classes.freeToday', { n: tab.freeToday })} ·{' '}
        {t('classes.freeLeast', { n: tab.freeLeast })}
      </p>
      {tab.members.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('classes.noMembers')}</p>
      ) : (
        <ul className="grid gap-2">
          {tab.members.map((member) => (
            <li key={member.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="font-semibold">{listName(member)}</span>
              <span className="text-muted-foreground">{member.uid}</span>
              {member.state === 'planned' && (
                <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                  {t('classes.joinsOn', { date: schoolDateText(member.from, i18n.language) })}
                </span>
              )}
              {canEdit && member.state === 'planned' && panel.editing === null && (
                <Button
                  variant="secondary"
                  disabled={withdraw.isPending}
                  onClick={() => {
                    withdraw.mutate(member);
                  }}
                >
                  {t('classes.withdraw')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {withdraw.error !== null && <FailureAlert error={withdraw.error} />}
      {canEdit && panel.editing === 'place' && (
        <PickForm
          schoolClass={schoolClass}
          label={t('classes.putIntoNamed', { class: name })}
          yearStart={yearStart}
          onPlaced={() => {
            panel.stop({ saved: true, key: 'place' });
          }}
          onCancel={() => {
            panel.stop();
          }}
        />
      )}
      {canEdit && panel.editing === null && (
        <div>
          <Button
            variant="secondary"
            {...panel.opener('place')}
            onClick={() => {
              panel.start('place');
            }}
          >
            {t('classes.putIntoClass')}
          </Button>
        </div>
      )}
    </section>
  );
}

/**
 * "Put into a class" from the class: the branch's students of the class's
 * grade who can be placed (active or before their start, with no class now or
 * planned), and the first day.
 */
function PickForm({
  schoolClass,
  label,
  yearStart,
  onPlaced,
  onCancel,
}: {
  schoolClass: ClassDetail;
  label: string;
  yearStart: string | undefined;
  onPlaced: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const { branchId } = useView();
  const queryClient = useQueryClient();
  const students = useQuery(studentsQuery(branchId));
  const candidates = (students.data?.students ?? []).filter(
    (row) => row.grade === schoolClass.grade && placeable(row),
  );
  const byId = new Map(candidates.map((row) => [row.id, row] as const));
  const place = useMutation({
    mutationFn: (placement: ClassPlacement) => placeStudents(schoolClass.id, placement),
    onSuccess: () => refreshAll(queryClient),
    // A student changed meanwhile: the list is read again for the next try.
    onError: () => invalidateStudents(queryClient),
  });
  const form = useRecordForm<'students' | 'from', ClassPlacement>({
    schema: PICKED_SCHEMA,
    initial: { students: '', from: placementDay(schoolClass.today, yearStart, []) },
    read: (typed) => ({
      students: listValues(typed.students).flatMap((id) => {
        const row = byId.get(id);
        return row === undefined ? [] : [{ id, version: row.version }];
      }),
      from: typed.from,
    }),
    // A ticked student is asked for on Save, not as they are ticked (.claude/rules/web.md).
    checkedOnSave: ['students'],
    save: async (placement) => {
      await place.mutateAsync(placement);
      onPlaced();
    },
  });
  useFollowingDefault(
    form.bind('from'),
    placementDay(
      schoolClass.today,
      yearStart,
      listValues(form.bind('students').value).flatMap((id) => {
        const row = byId.get(id);
        return row === undefined ? [] : [row.startsOn];
      }),
    ),
  );
  if (students.isError) {
    return (
      <ErrorState
        error={students.error}
        onRetry={() => {
          void students.refetch();
        }}
      />
    );
  }
  if (students.data === undefined) {
    return <LoadingOutline lines={2} />;
  }
  const names = refusedNames(form.failure, (id) => {
    const row = byId.get(id);
    return row === undefined ? undefined : listName(row);
  });
  return (
    <RecordForm form={form} label={label} onCancel={onCancel}>
      {candidates.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('classes.noPlaceable')}</p>
      ) : (
        <CheckboxGroupField
          label={t('classes.pickStudents')}
          options={candidates.map((row) => ({
            value: row.id,
            label: `${listName(row)} (${row.uid})`,
          }))}
          {...form.bind('students')}
        />
      )}
      <DateField label={t('classes.from')} {...form.bind('from')} />
      {names.length > 0 && (
        <p className="text-sm">{t('classes.refusedNames', { names: names.join(', ') })}</p>
      )}
    </RecordForm>
  );
}

/**
 * "Put into a class" of the students ticked in the student list (task 3.1b):
 * one class of their grade, active in an open year, and the first day; all
 * or none, the refused students named.
 */
export function PlaceTickedForm({
  rows,
  title,
  onPlaced,
}: {
  rows: readonly StudentListItem[];
  title: string;
  onPlaced: (placed: number) => void;
}) {
  const { t } = useTranslation();
  const { branchId } = useView();
  const queryClient = useQueryClient();
  const classes = useQuery(classesQuery(branchId));
  const years = useQuery(yearsQuery(branchId));
  // Today in the branch, as the list read it (the list opened this form).
  const today = useQuery(studentsQuery(branchId)).data?.today;
  const starts = rows.map((row) => row.startsOn);
  const grades = new Set(rows.map((row) => row.grade));
  const [grade] = grades;
  const offered = (classes.data?.classes ?? []).filter(
    (one) => one.grade === grade && !one.archived && one.yearStatus !== 'closed',
  );
  const place = useMutation({
    mutationFn: (input: { classId: string; placement: ClassPlacement }) =>
      placeStudents(input.classId, input.placement),
    onSuccess: () => refreshAll(queryClient),
    onError: () => invalidateStudents(queryClient),
  });
  const form = useRecordForm<'classId' | 'from', ChosenPlacement>({
    schema: CHOSEN_SCHEMA,
    initial: {
      classId: '',
      from: today === undefined ? '' : placementDay(today, undefined, starts),
    },
    read: (typed) => ({
      classId: typed.classId,
      students: rows.map((row) => ({ id: row.id, version: row.version })),
      from: typed.from,
    }),
    save: async ({ classId, ...placement }) => {
      await place.mutateAsync({ classId, placement });
      onPlaced(rows.length);
    },
  });
  const chosen = offered.find((one) => one.id === form.bind('classId').value);
  useFollowingDefault(
    form.bind('from'),
    today === undefined
      ? ''
      : placementDay(
          today,
          years.data?.years.find((year) => year.id === chosen?.academicYearId)?.startDate,
          starts,
        ),
  );
  if (classes.isError || years.isError) {
    return (
      <ErrorState
        error={classes.error ?? years.error}
        onRetry={() => {
          void classes.refetch();
          void years.refetch();
        }}
      />
    );
  }
  if (classes.data === undefined || years.data === undefined) {
    return <LoadingOutline lines={2} />;
  }
  if (grades.size !== 1) {
    return <p className="text-sm">{t('classes.oneGradeOnly')}</p>;
  }
  const names = refusedNames(form.failure, (id) => {
    const row = rows.find((one) => one.id === id);
    return row === undefined ? undefined : listName(row);
  });
  return (
    <RecordForm form={form} label={title}>
      <p className="text-sm">{rows.map((row) => listName(row)).join(', ')}</p>
      {offered.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('classes.noClassOfGrade')}</p>
      ) : (
        <SelectField
          label={t('classes.name')}
          options={[
            { value: '', label: t('classes.chooseClass') },
            ...offered.map((one) => ({
              value: one.id,
              label: t('classes.classYear', {
                class: classDisplayName(one.grade, one.name),
                year: one.yearName,
              }),
            })),
          ]}
          {...form.bind('classId')}
        />
      )}
      <DateField label={t('classes.from')} {...form.bind('from')} />
      {names.length > 0 && (
        <p className="text-sm">{t('classes.refusedNames', { names: names.join(', ') })}</p>
      )}
    </RecordForm>
  );
}
