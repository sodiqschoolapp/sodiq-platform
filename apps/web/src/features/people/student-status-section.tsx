import {
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
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, branchHeader } from '@/api/client';
import { answerOf, ApiFailure } from '@/api/failure';
import { useConfirm } from '@/components/confirm-dialog';
import { FailureAlert } from '@/components/failure-alert';
import { DateField, Field, SelectField } from '@/components/field';
import { RecordForm } from '@/components/form/record-form';
import { SaveCancelled } from '@/components/form/save-cancelled';
import { useRecordForm } from '@/components/form/use-record-form';
import { Button } from '@/components/ui/button';
import { asFormSchema } from './form-schema';
import { takenOf, takenText } from './student-form';
import { schoolDateText } from '@/lib/dates';
import { SECTION_TITLE, SUBSECTION_TITLE } from '@/components/ui/control';

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

interface StatusSectionProps {
  student: StudentDetail;
  /** The name of the student, for the forms and the confirmations. */
  label: string;
  holderText: (id: string) => string | null;
  /** After a change: the answer of the server, the student as it is now. */
  onChanged: (answer: unknown) => Promise<void>;
  /** After a refusal that says the student changed: read it again. */
  onStale: () => Promise<void>;
  onDeleted: () => Promise<void>;
}

/**
 * The status of a student and its changes (`04`, Movements;
 * edge/students-classes-groups; task 2.4b-1): the history of status rows,
 * and the actions the answer of the server allows (`canArchive`,
 * `canRestoreGraduated`, `deletable`). Each change sends the `version` the
 * panel read; a change made by someone else in between is refused and the
 * student read again (edge: "student changed, reload").
 */
export function StatusSection({
  student,
  label,
  holderText,
  onChanged,
  onStale,
  onDeleted,
}: StatusSectionProps) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const confirm = useConfirm();
  const where = { header: branchHeader(), path: { id: student.id } };
  const rereadOnStale = async (error: Error) => {
    if (error instanceof ApiFailure && error.code === 'student_changed') {
      await onStale();
    }
  };
  const cancel = useMutation({
    mutationFn: async () => {
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
          params: where,
          body: { version: student.version },
        }),
      );
    },
    onSuccess: async (answer) => {
      if (answer !== null) {
        await onChanged(answer);
      }
    },
    onError: rereadOnStale,
  });

  const last = student.statuses.at(-1);
  const inactive = student.status === 'inactive' && student.planned === null;
  const graduated = student.status === 'graduated' && student.planned === null;
  const scheduled = student.planned?.status === 'inactive';

  return (
    <section className="grid gap-4">
      <h3 className={SECTION_TITLE}>{t('people.students.statusTitle')}</h3>
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
                ? t(`people.students.causes.${row.cause}`)
                : t('people.students.causeReason', {
                    cause: t(`people.students.causes.${row.cause}`),
                    reason: row.reason,
                  })}
            </span>
          </li>
        ))}
      </ol>
      {student.canArchive && (
        <>
          {scheduled && (
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="secondary"
                disabled={cancel.isPending}
                onClick={() => {
                  cancel.mutate();
                }}
              >
                {t('people.students.cancelLeaving')}
              </Button>
              <FailureAlert error={cancel.error} />
            </div>
          )}
          {/* A scheduled leaving is cancelled first, not recorded again (finding 29). */}
          {(student.status === 'active' || student.status === null) && !scheduled && (
            <LeavingForm
              key={`leave-${String(student.version)}`}
              student={student}
              label={label}
              onChanged={onChanged}
              onStale={onStale}
            />
          )}
          {inactive && last?.cause === 'leaving' && (
            <UndoForm
              key={`undo-${String(student.version)}`}
              student={student}
              label={label}
              onChanged={onChanged}
              onStale={onStale}
            />
          )}
          {inactive && (
            <ReturnForm
              key={`return-${String(student.version)}`}
              student={student}
              label={label}
              holderText={holderText}
              onChanged={onChanged}
              onStale={onStale}
            />
          )}
          {student.deletable && (
            <DeleteForm
              key={`delete-${String(student.version)}`}
              student={student}
              label={label}
              onDeleted={onDeleted}
              onStale={onStale}
            />
          )}
        </>
      )}
      {student.canRestoreGraduated && graduated && (
        <RestoreForm
          key={`restore-${String(student.version)}`}
          student={student}
          label={label}
          onChanged={onChanged}
          onStale={onStale}
        />
      )}
    </section>
  );
}

interface ChangeFormProps {
  student: StudentDetail;
  label: string;
  onChanged: (answer: unknown) => Promise<void>;
  onStale: () => Promise<void>;
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
function LeavingForm({ student, label, onChanged, onStale }: ChangeFormProps) {
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
      <h4 className={SUBSECTION_TITLE}>{t('people.students.leaveTitle')}</h4>
      <RecordForm form={form} label={t('people.students.leaveTitle')}>
        <DateField label={t('people.students.lastDay')} {...form.bind('lastDay')} />
        <Field label={t('people.students.reason')} {...form.bind('reason')} />
      </RecordForm>
    </section>
  );
}

/** "Undo leaving" with a reason. */
function UndoForm({ student, onChanged, onStale }: ChangeFormProps) {
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
      <h4 className={SUBSECTION_TITLE}>{t('people.students.undoTitle')}</h4>
      <RecordForm form={form} label={t('people.students.undoTitle')}>
        <Field label={t('people.students.reason')} {...form.bind('reason')} />
      </RecordForm>
    </section>
  );
}

type ReturnField = 'from' | 'grade' | 'contractNumber' | 'contractSignedOn' | 'reason';

/** Coming back from the Inactive list: the first day back, the grade and a new contract. */
function ReturnForm({
  student,
  label,
  onChanged,
  onStale,
  holderText,
}: ChangeFormProps & { holderText: (id: string) => string | null }) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const form = useRecordForm<ReturnField, StudentReturn>({
    schema: RETURN_SCHEMA,
    initial: {
      from: '',
      grade: String(student.grade),
      contractNumber: '',
      contractSignedOn: '',
      reason: '',
    },
    read: (typed) => ({
      from: typed.from,
      grade: Number(typed.grade),
      contract: { number: typed.contractNumber, signedOn: typed.contractSignedOn },
      reason: typed.reason.trim() === '' ? null : typed.reason,
      version: student.version,
    }),
    save: async (input) => {
      const go = await confirm({
        title: t('people.students.returnConfirmTitle'),
        text: t('people.students.returnConfirmText'),
        names: [label],
        action: t('people.students.returnTitle'),
        destructive: false,
      });
      if (!go) {
        throw new SaveCancelled();
      }
      await onChanged(
        await sending(
          () =>
            answerOf(
              api.POST('/api/people/students/{id}/return', {
                params: { header: branchHeader(), path: { id: student.id } },
                body: input,
              }),
            ),
          onStale,
        ),
      );
    },
  });
  const taken = takenOf(form.failure);
  const contractNumber = form.bind('contractNumber');
  return (
    <section className="grid gap-3">
      <h4 className={SUBSECTION_TITLE}>{t('people.students.returnTitle')}</h4>
      <RecordForm form={form} label={t('people.students.returnTitle')}>
        <DateField label={t('people.students.returnFrom')} {...form.bind('from')} />
        <SelectField
          label={t('people.students.grade')}
          options={Array.from({ length: 11 }, (_unused, index) => ({
            value: String(index + 1),
            label: t('setup.subjects.grade', { grade: index + 1 }),
          }))}
          {...form.bind('grade')}
        />
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

/** The Super Admin's restore of a graduated student, from a date with a reason. */
function RestoreForm({ student, label, onChanged, onStale }: ChangeFormProps) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const form = useRecordForm<'from' | 'reason', StudentRestore>({
    schema: RESTORE_SCHEMA,
    initial: { from: student.statuses.at(-1)?.from ?? '', reason: '' },
    read: (typed) => ({ ...typed, version: student.version }),
    save: async (input) => {
      const go = await confirm({
        title: t('people.students.restoreConfirmTitle'),
        text: t('people.students.restoreConfirmText'),
        names: [label],
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
  return (
    <section className="grid gap-3">
      <h4 className={SUBSECTION_TITLE}>{t('people.students.restoreTitle')}</h4>
      <RecordForm form={form} label={t('people.students.restoreTitle')}>
        <DateField label={t('people.students.restoreFrom')} {...form.bind('from')} />
        <Field label={t('people.students.reason')} {...form.bind('reason')} />
      </RecordForm>
    </section>
  );
}

/** The delete of a student created twice, with a reason, after a confirmation naming the student. */
function DeleteForm({
  student,
  label,
  onDeleted,
  onStale,
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
      <h4 className={SUBSECTION_TITLE}>{t('people.students.deleteTitle')}</h4>
      <RecordForm form={form} label={t('people.students.deleteTitle')}>
        <Field label={t('people.students.reason')} {...form.bind('reason')} />
      </RecordForm>
    </section>
  );
}
