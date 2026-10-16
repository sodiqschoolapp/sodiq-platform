import {
  classDisplayName,
  previousDay,
  studentDeleteSchema,
  studentLeavingSchema,
  studentRestoreSchema,
  studentReturnSchema,
  studentUndoLeavingSchema,
  type StudentDelete,
  type StudentDetail,
  type StudentLeaving,
  type StudentRestore,
  type StudentReturn,
  type StudentUndoLeaving,
} from '@sodiq/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { api, branchHeader } from '@/api/client';
import { answerOf, ApiFailure } from '@/api/failure';
import { failureText } from '@/api/failure-text';
import { useConfirm } from '@/components/confirm-dialog';
import { Button } from '@/components/ui/button';
import { DateField, Field, SelectField } from '@/components/field';
import { RecordForm } from '@/components/form/record-form';
import { SaveCancelled } from '@/components/form/save-cancelled';
import { useRecordForm } from '@/components/form/use-record-form';
import { asFormSchema } from './form-schema';
import { statusCauseText } from './status-cause';
import { takenOf, takenText } from './student-form';
import { schoolDateText } from '@/lib/dates';
import { SECTION_TITLE } from '@/components/ui/control';
import type { PanelEditing } from '@/components/list/use-panel-editing';
import { ErrorState } from '@/components/states';
import { useView } from '@/features/access/use-view';
import { GroupSeatRefusal, useClassFullText } from '@/features/classes/class-members';
import { classesQuery, classMembersQuery } from '@/features/classes/classes-api';
import { yearsQuery } from '@/features/setup/setup-api';

/** Every path of an issue is the field of the same name; a contract is two fields. */
const fieldOf = (path: readonly PropertyKey[]): PropertyKey[] => {
  const [first, second] = path;
  if (first === 'contract') {
    return [second === 'signedOn' ? 'contractSignedOn' : 'contractNumber'];
  }
  return [...path];
};

const LEAVING_SCHEMA = asFormSchema<StudentLeaving>(studentLeavingSchema, fieldOf);
const UNDO_SCHEMA = asFormSchema<StudentUndoLeaving>(studentUndoLeavingSchema, fieldOf);
const RETURN_SCHEMA = asFormSchema<StudentReturn>(studentReturnSchema, fieldOf);
const RESTORE_SCHEMA = asFormSchema<StudentRestore>(studentRestoreSchema, fieldOf);
const DELETE_SCHEMA = asFormSchema<StudentDelete>(studentDeleteSchema, fieldOf);

/** The status actions the answer of the server allows, by today's conditions (task 2.4b-1). */
export interface StatusActions {
  /** "Cancel the leaving": a leaving is scheduled. */
  cancel: boolean;
  /** "Leave school": active or not started, nothing scheduled (finding 29). */
  leave: boolean;
  /** "Undo leaving": inactive after a leaving. */
  undo: boolean;
  /** "Return to school": inactive. */
  return: boolean;
  /** "Cancel the return": a return or restore is scheduled for next year's first day (L170). */
  cancelReturn: boolean;
  /** "Delete" of a student created twice: no data. */
  delete: boolean;
  /** "Restore to active": graduated, the Super Admin. */
  restore: boolean;
}

export function statusActions(student: StudentDetail): StatusActions {
  const last = student.statuses.at(-1);
  const inactive = student.status === 'inactive' && student.planned === null;
  const graduated = student.status === 'graduated' && student.planned === null;
  const scheduled = student.planned?.status === 'inactive';
  const archive = student.canArchive;
  // A return is cancelled by the holders of the return, a restore by the Super Admin only.
  const returning = student.planned?.status === 'active' && student.status === 'inactive';
  const restoring = student.planned?.status === 'active' && student.status === 'graduated';
  return {
    cancelReturn: (archive && returning) || (student.canRestoreGraduated && restoring),
    cancel: archive && scheduled,
    // A scheduled leaving is cancelled first, not recorded again (finding 29).
    leave: archive && (student.status === 'active' || student.status === null) && !scheduled,
    undo: archive && inactive && last?.cause === 'leaving',
    return: archive && inactive,
    delete: archive && student.deletable,
    restore: student.canRestoreGraduated && graduated,
  };
}

/** The keys of the status forms in the side panel, by their action. */
export const STATUS_FORMS = ['leave', 'undo', 'return', 'restore', 'delete'] as const;

export type StatusForm = (typeof STATUS_FORMS)[number];

export const isStatusForm = (key: string | null): key is StatusForm =>
  STATUS_FORMS.some((one) => one === key);

/**
 * The status of a student and its history (`04`, Movements;
 * edge/students-classes-groups; task 2.4b-1). Its changes are actions of the
 * side panel (task 2.7c-2b-2b): each opens its form below this section. The
 * heading takes the focus after a change takes its button away.
 */
export function StatusSection({ student, panel }: { student: StudentDetail; panel: PanelEditing }) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  return (
    <section className="grid gap-4">
      <h3 className={SECTION_TITLE} tabIndex={-1} {...panel.opener('status')}>
        {t('people.students.statusTitle')}
      </h3>
      <ol className="grid gap-2 text-sm">
        {student.statuses.map((row) => (
          <li key={`${row.from}-${row.cause}`} className="grid gap-0.5">
            <span>
              {row.until === null
                ? t('people.students.statusRow', {
                    status: t(`people.students.statuses.${row.status}`),
                    from: schoolDateText(row.from, language),
                  })
                : t('people.students.statusRowUntil', {
                    status: t(`people.students.statuses.${row.status}`),
                    from: schoolDateText(row.from, language),
                    // A row ends before `until`: the text names its last day.
                    until: schoolDateText(previousDay(row.until), language),
                  })}
            </span>
            <span className="text-muted-foreground">
              {row.reason === null
                ? statusCauseText(t, row, student.today, language)
                : t('people.students.causeReason', {
                    cause: statusCauseText(t, row, student.today, language),
                    reason: row.reason,
                  })}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * "Cancel the leaving" (edge: "It can be changed or cancelled until the
 * date"), after a confirmation naming the student; `null` when the person
 * keeps the leaving. Each change sends the `version` the panel read; a change
 * made by someone else in between is refused (edge: "student changed, reload").
 */
export function useCancelLeaving(
  student: StudentDetail | undefined,
  label: string,
  onChanged: (answer: unknown) => Promise<void>,
  onStale: () => Promise<void>,
) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  return useMutation({
    mutationFn: async () => {
      if (student === undefined) {
        return null;
      }
      const go = await confirm({
        title: t('people.students.cancelConfirmTitle'),
        text: t('people.students.cancelConfirmText'),
        names: [label],
        action: t('people.students.cancelLeaving'),
        // Finding 26: two buttons that both say "Cancel" do not tell which one
        // keeps the leaving.
        cancel: t('people.students.keepLeaving'),
        destructive: false,
      });
      if (!go) {
        return null;
      }
      return answerOf(
        api.POST('/api/people/students/{id}/leaving/cancel', {
          params: { header: branchHeader(), path: { id: student.id } },
          body: { version: student.version },
        }),
      );
    },
    onSuccess: async (answer) => {
      if (answer !== null) {
        await onChanged(answer);
      }
    },
    onError: async (error) => {
      if (error instanceof ApiFailure && error.code === 'student_changed') {
        await onStale();
      }
    },
  });
}

/**
 * "Cancel the return" of a return or restore scheduled for the first day of
 * next year (edge: "It can be changed or cancelled until the date"; task
 * 3.6b-2), after a confirmation naming the student; `null` when the person
 * keeps it.
 */
export function useCancelReturn(
  student: StudentDetail | undefined,
  label: string,
  onChanged: (answer: unknown) => Promise<void>,
  onStale: () => Promise<void>,
) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  return useMutation({
    mutationFn: async () => {
      if (student === undefined) {
        return null;
      }
      const go = await confirm({
        title: t('people.students.cancelReturnConfirmTitle'),
        text: t('people.students.cancelReturnConfirmText'),
        names: [label],
        action: t('people.students.cancelReturn'),
        cancel: t('people.students.keepReturn'),
        destructive: false,
      });
      if (!go) {
        return null;
      }
      return answerOf(
        api.POST('/api/people/students/{id}/return/cancel', {
          params: { header: branchHeader(), path: { id: student.id } },
          body: { version: student.version },
        }),
      );
    },
    onSuccess: async (answer) => {
      if (answer !== null) {
        await onChanged(answer);
      }
    },
    onError: async (error) => {
      if (error instanceof ApiFailure && error.code === 'student_changed') {
        await onStale();
      }
    },
  });
}

/**
 * The button that fills the date with the first day of the branch's next
 * planned year (owner's answer L170); the server decides whether it may be
 * used. Nothing is drawn when the branch has no planned year.
 */
function NextYearStart({ onPick }: { onPick: (date: string) => void }) {
  const { t, i18n } = useTranslation();
  const { branchId } = useView();
  const years = useQuery({ ...yearsQuery(branchId), enabled: branchId !== null });
  const next = (years.data?.years ?? [])
    .filter((one) => one.status === 'planned')
    .sort((a, b) => (a.startDate < b.startDate ? -1 : 1))[0];
  if (next === undefined) {
    return null;
  }
  return (
    <Button
      type="button"
      variant="secondary"
      onClick={() => {
        onPick(next.startDate);
      }}
    >
      {t('people.students.nextYearStart', { date: schoolDateText(next.startDate, i18n.language) })}
    </Button>
  );
}

interface ChangeFormProps {
  student: StudentDetail;
  label: string;
  onChanged: (answer: unknown) => Promise<void>;
  onStale: () => Promise<void>;
  /** Closes the form without a change (`RecordForm`'s Cancel). */
  onCancel: () => void;
}

/** Sends a change; on "student changed" the student is read again before the refusal shows. */
async function sending(send: () => Promise<unknown>, onStale: () => Promise<void>) {
  try {
    return await send();
  } catch (error) {
    if (error instanceof ApiFailure && error.code === 'student_changed') {
      await onStale();
    }
    throw error;
  }
}

/** Leaving the school: the last day and a reason, after a confirmation naming the student. */
export function LeavingForm({ student, label, onChanged, onStale, onCancel }: ChangeFormProps) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const form = useRecordForm<'lastDay' | 'reason', StudentLeaving>({
    schema: LEAVING_SCHEMA,
    initial: { lastDay: '', reason: '' },
    read: (typed) => ({ ...typed, version: student.version }),
    save: async (input) => {
      const go = await confirm({
        title: t('people.students.leaveConfirmTitle'),
        text: t('people.students.leaveConfirmText'),
        names: [label],
        action: t('people.students.leaveAction'),
        destructive: true,
      });
      if (!go) {
        throw new SaveCancelled();
      }
      await onChanged(
        await sending(
          () =>
            answerOf(
              api.POST('/api/people/students/{id}/leaving', {
                params: { header: branchHeader(), path: { id: student.id } },
                body: input,
              }),
            ),
          onStale,
        ),
      );
    },
  });
  return (
    <section className="grid gap-3">
      <h3 className={SECTION_TITLE}>{t('people.students.leaveTitle')}</h3>
      <RecordForm form={form} label={t('people.students.leaveTitle')} onCancel={onCancel}>
        <DateField label={t('people.students.lastDay')} {...form.bind('lastDay')} />
        <Field label={t('people.students.reason')} {...form.bind('reason')} />
      </RecordForm>
    </section>
  );
}

/** "Undo leaving" with a reason. */
export function UndoForm({ student, onChanged, onStale, onCancel }: ChangeFormProps) {
  const { t } = useTranslation();
  const form = useRecordForm<'reason', StudentUndoLeaving>({
    schema: UNDO_SCHEMA,
    initial: { reason: '' },
    read: (typed) => ({ ...typed, version: student.version }),
    save: async (input) => {
      await onChanged(
        await sending(
          () =>
            answerOf(
              api.POST('/api/people/students/{id}/leaving/undo', {
                params: { header: branchHeader(), path: { id: student.id } },
                body: input,
              }),
            ),
          onStale,
        ),
      );
    },
  });
  return (
    <section className="grid gap-3">
      <h3 className={SECTION_TITLE}>{t('people.students.undoTitle')}</h3>
      <RecordForm form={form} label={t('people.students.undoTitle')} onCancel={onCancel}>
        <Field label={t('people.students.reason')} {...form.bind('reason')} />
      </RecordForm>
    </section>
  );
}

/**
 * The text of a refusal that the server named on a field (task 3.3b,
 * decision 11: the class rules answer at `classId` or `from`).
 */
function refusalOn(t: Parameters<typeof failureText>[0], failure: unknown, field: string) {
  return failure instanceof ApiFailure && failure.details?.some((one) => one.path === field)
    ? failureText(t, failure)
    : undefined;
}

/**
 * The classes a return or a restore can name (task 3.3b): active, in the
 * year that holds the date, of the grade when one is given; the choice kept
 * follows them (`.claude/rules/web.md`): a class no longer offered falls back
 * to `preferred` when that is offered, else to none. The note under the field
 * is the fewest free seats of the class chosen from today on, or why nothing
 * is offered.
 */
function useClassChoice(input: {
  from: string;
  grade: number | null;
  preferred: string | null;
  chosen: string;
  choose: (value: string) => void;
}) {
  const { t } = useTranslation();
  const { branchId } = useView();
  const classes = useQuery({ ...classesQuery(branchId), enabled: branchId !== null });
  const years = useQuery({ ...yearsQuery(branchId), enabled: branchId !== null });
  const year = years.data?.years.find(
    (one) => one.startDate <= input.from && input.from <= one.endDate,
  );
  const offered = (classes.data?.classes ?? [])
    .filter(
      (one) =>
        input.from !== '' &&
        !one.archived &&
        one.yearStatus !== 'closed' &&
        (input.grade === null || one.grade === input.grade) &&
        one.academicYearId === year?.id,
    )
    .sort((a, b) => a.grade - b.grade || a.name.localeCompare(b.name));
  const preferred =
    input.preferred !== null && offered.some((one) => one.id === input.preferred)
      ? input.preferred
      : '';
  const kept = input.chosen !== '' && offered.some((one) => one.id === input.chosen);
  const { choose } = input;
  const ready = classes.data !== undefined && years.data !== undefined;
  useEffect(() => {
    if (ready && !kept && input.chosen !== preferred) {
      choose(preferred);
    }
  }, [ready, kept, input.chosen, preferred, choose]);
  const members = useQuery({
    ...classMembersQuery(branchId, input.chosen),
    enabled: branchId !== null && kept,
  });
  const none = ready && input.from !== '' && offered.length === 0;
  const note = none
    ? t(input.grade === null ? 'people.students.restoreNoClass' : 'people.students.returnNoClass')
    : kept && members.data !== undefined
      ? t('classes.freeLeast', { n: members.data.freeLeast })
      : undefined;
  return {
    offered,
    none,
    note,
    /** The classes or the years could not be read: the field cannot be drawn. */
    failed: classes.isError || years.isError,
    error: classes.error ?? years.error,
    retry: () => {
      void classes.refetch();
      void years.refetch();
    },
    /** The seats of the class chosen could not be read: said under the field, with a retry. */
    seats: members,
    nameOf: (id: string) => {
      const found = offered.find((one) => one.id === id);
      return found === undefined ? undefined : classDisplayName(found.grade, found.name);
    },
    languageOf: (id: string) => offered.find((one) => one.id === id)?.language,
  };
}

type ReturnField = 'from' | 'grade' | 'classId' | 'contractNumber' | 'contractSignedOn' | 'reason';

/**
 * Coming back from the Inactive list: the first day back, the grade, the
 * class from that day (task 3.3b: `04`, Movements, "is placed in a class from
 * the return date"; the class left first) and a new contract. A class of
 * another language than the class left is confirmed (decision 2).
 */
export function ReturnForm({
  student,
  label,
  onChanged,
  onStale,
  onCancel,
  holderText,
}: ChangeFormProps & { holderText: (id: string) => string | null }) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const left = student.classLeft ?? null;
  const form = useRecordForm<ReturnField, StudentReturn>({
    schema: RETURN_SCHEMA,
    initial: {
      from: '',
      grade: String(student.grade),
      classId: '',
      contractNumber: '',
      contractSignedOn: '',
      reason: '',
    },
    read: (typed) => ({
      from: typed.from,
      grade: Number(typed.grade),
      classId: typed.classId,
      contract: { number: typed.contractNumber, signedOn: typed.contractSignedOn },
      reason: typed.reason.trim() === '' ? null : typed.reason,
      version: student.version,
    }),
    save: async (input) => {
      const chosen = choice.nameOf(input.classId);
      const chosenLanguage = choice.languageOf(input.classId);
      const go = await confirm({
        title: t('people.students.returnConfirmTitle'),
        text: t('people.students.returnConfirmText'),
        names: chosen === undefined ? [label] : [label, chosen],
        action: t('people.students.returnTitle'),
        destructive: false,
      });
      if (!go) {
        throw new SaveCancelled();
      }
      const send = (confirmLanguage: boolean) =>
        answerOf(
          api.POST('/api/people/students/{id}/return', {
            params: { header: branchHeader(), path: { id: student.id } },
            body: { ...input, ...(confirmLanguage ? { confirmLanguage } : {}) },
          }),
        );
      await onChanged(
        await sending(async () => {
          try {
            return await send(false);
          } catch (error) {
            if (!(error instanceof ApiFailure) || error.code !== 'return_language_differs') {
              throw error;
            }
            const sure = await confirm({
              title: t('people.students.returnLanguageTitle'),
              text:
                left === null || chosen === undefined || chosenLanguage === undefined
                  ? t('people.students.returnLanguageText')
                  : t('people.students.returnLanguageTextNamed', {
                      from: classDisplayName(left.grade, left.name),
                      fromLanguage: t(`classes.inLanguage.${left.language}`),
                      to: chosen,
                      toLanguage: t(`classes.inLanguage.${chosenLanguage}`),
                    }),
              names: [
                ...(left === null ? [] : [classDisplayName(left.grade, left.name)]),
                ...(chosen === undefined ? [] : [chosen]),
              ],
              action: t('people.students.returnTitle'),
              destructive: false,
            });
            if (!sure) {
              throw new SaveCancelled();
            }
            return send(true);
          }
        }, onStale),
      );
    },
  });
  const taken = takenOf(form.failure);
  const contractNumber = form.bind('contractNumber');
  const from = form.bind('from');
  const grade = form.bind('grade');
  const classId = form.bind('classId');
  const { onChange: chooseClass } = classId;
  const choice = useClassChoice({
    from: from.value,
    grade: Number(grade.value),
    preferred: left?.id ?? null,
    chosen: classId.value,
    choose: useCallback(
      (value: string) => {
        chooseClass({ target: { value } });
      },
      [chooseClass],
    ),
  });
  // H24: a full class named with its first day without a seat.
  const classFullText = useClassFullText(form.failure);
  return (
    <section className="grid gap-3">
      <h3 className={SECTION_TITLE}>{t('people.students.returnTitle')}</h3>
      <RecordForm
        form={form}
        failureText={classFullText}
        label={t('people.students.returnTitle')}
        onCancel={onCancel}
      >
        <DateField
          label={t('people.students.returnFrom')}
          {...from}
          error={from.error ?? refusalOn(t, form.failure, 'from')}
        />
        <NextYearStart
          onPick={(date) => {
            from.onChange({ target: { value: date } });
          }}
        />
        <SelectField
          label={t('people.students.grade')}
          options={Array.from({ length: 11 }, (_unused, index) => ({
            value: String(index + 1),
            label: t('setup.subjects.grade', { grade: index + 1 }),
          }))}
          {...grade}
        />
        {choice.failed ? (
          <ErrorState error={choice.error} onRetry={choice.retry} />
        ) : (
          <SelectField
            label={t('people.students.class')}
            options={[
              { value: '', label: t('people.students.choose') },
              ...choice.offered.map((one) => ({
                value: one.id,
                label: classDisplayName(one.grade, one.name),
              })),
            ]}
            disabled={choice.none}
            note={choice.note}
            {...classId}
            error={classId.error ?? refusalOn(t, form.failure, 'classId')}
          />
        )}
        {choice.seats.isError && (
          <ErrorState
            error={choice.seats.error}
            onRetry={() => {
              void choice.seats.refetch();
            }}
          />
        )}
        <GroupSeatRefusal error={form.failure} />
        <Field
          label={t('people.students.contractNumber')}
          autoComplete="off"
          {...contractNumber}
          error={
            contractNumber.error ??
            (taken?.field === 'contractNumber' ? t(...takenText(taken, holderText)) : undefined)
          }
        />
        <DateField
          label={t('people.students.contractSignedOn')}
          {...form.bind('contractSignedOn')}
        />
        <Field label={t('people.students.reason')} {...form.bind('reason')} />
      </RecordForm>
    </section>
  );
}

type RestoreField = 'from' | 'classId' | 'reason';

/**
 * The Super Admin's restore of a graduated student, from a date into a class
 * with a reason (edge: "restores the student to active with a class and a
 * reason"); the student takes the grade of the class (task 3.3b, decision 6).
 */
export function RestoreForm({ student, label, onChanged, onStale, onCancel }: ChangeFormProps) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const form = useRecordForm<RestoreField, StudentRestore>({
    schema: RESTORE_SCHEMA,
    initial: { from: student.statuses.at(-1)?.from ?? '', classId: '', reason: '' },
    read: (typed) => ({ ...typed, version: student.version }),
    save: async (input) => {
      const chosen = choice.nameOf(input.classId);
      const go = await confirm({
        title: t('people.students.restoreConfirmTitle'),
        text: t('people.students.restoreConfirmText'),
        names: chosen === undefined ? [label] : [label, chosen],
        action: t('people.students.restoreTitle'),
        destructive: false,
      });
      if (!go) {
        throw new SaveCancelled();
      }
      await onChanged(
        await sending(
          () =>
            answerOf(
              api.POST('/api/people/students/{id}/restore', {
                params: { header: branchHeader(), path: { id: student.id } },
                body: input,
              }),
            ),
          onStale,
        ),
      );
    },
  });
  const from = form.bind('from');
  const classId = form.bind('classId');
  const { onChange: chooseClass } = classId;
  const choice = useClassChoice({
    from: from.value,
    grade: null,
    preferred: null,
    chosen: classId.value,
    choose: useCallback(
      (value: string) => {
        chooseClass({ target: { value } });
      },
      [chooseClass],
    ),
  });
  // H24: a full class named with its first day without a seat.
  const classFullText = useClassFullText(form.failure);
  return (
    <section className="grid gap-3">
      <h3 className={SECTION_TITLE}>{t('people.students.restoreTitle')}</h3>
      <RecordForm
        form={form}
        failureText={classFullText}
        label={t('people.students.restoreTitle')}
        onCancel={onCancel}
      >
        <DateField
          label={t('people.students.restoreFrom')}
          {...from}
          error={from.error ?? refusalOn(t, form.failure, 'from')}
        />
        <NextYearStart
          onPick={(date) => {
            from.onChange({ target: { value: date } });
          }}
        />
        {choice.failed ? (
          <ErrorState error={choice.error} onRetry={choice.retry} />
        ) : (
          <SelectField
            label={t('people.students.class')}
            options={[
              { value: '', label: t('people.students.choose') },
              ...choice.offered.map((one) => ({
                value: one.id,
                label: classDisplayName(one.grade, one.name),
              })),
            ]}
            disabled={choice.none}
            note={
              choice.none ? choice.note : (choice.note ?? t('people.students.restoreClassNote'))
            }
            {...classId}
            error={classId.error ?? refusalOn(t, form.failure, 'classId')}
          />
        )}
        {choice.seats.isError && (
          <ErrorState
            error={choice.seats.error}
            onRetry={() => {
              void choice.seats.refetch();
            }}
          />
        )}
        <GroupSeatRefusal error={form.failure} />
        <Field label={t('people.students.reason')} {...form.bind('reason')} />
      </RecordForm>
    </section>
  );
}

/** The delete of a student created twice, with a reason, after a confirmation naming the student. */
export function DeleteForm({
  student,
  label,
  onDeleted,
  onStale,
  onCancel,
}: Omit<ChangeFormProps, 'onChanged'> & { onDeleted: () => Promise<void> }) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const form = useRecordForm<'reason', StudentDelete>({
    schema: DELETE_SCHEMA,
    initial: { reason: '' },
    read: (typed) => ({ ...typed, version: student.version }),
    save: async (input) => {
      const go = await confirm({
        title: t('people.students.deleteConfirmTitle'),
        text: t('people.students.deleteConfirmText'),
        names: [label],
        action: t('people.students.deleteAction'),
        destructive: true,
      });
      if (!go) {
        throw new SaveCancelled();
      }
      await sending(
        () =>
          answerOf(
            api.POST('/api/people/students/{id}/delete', {
              params: { header: branchHeader(), path: { id: student.id } },
              body: input,
            }),
          ),
        onStale,
      );
      await onDeleted();
    },
  });
  return (
    <section className="grid gap-3">
      <h3 className={SECTION_TITLE}>{t('people.students.deleteTitle')}</h3>
      <RecordForm form={form} label={t('people.students.deleteTitle')} onCancel={onCancel}>
        <Field label={t('people.students.reason')} {...form.bind('reason')} />
      </RecordForm>
    </section>
  );
}
