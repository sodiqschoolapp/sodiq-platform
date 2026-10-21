import {
  lessonSubstituteBodySchema,
  substitutionWithdrawBodySchema,
  timeText,
  type DayLesson,
  type LessonSubstituteBody,
  type SubstitutionWithdrawBody,
} from '@sodiq/shared';
import { useQuery } from '@tanstack/react-query';
import { useRef, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiFailure } from '@/api/failure';
import { FailureAlert } from '@/components/failure-alert';
import { CHECKED, CheckboxField, SelectField, TextAreaField } from '@/components/field';
import { useRecordForm } from '@/components/form/use-record-form';
import { EmptyState, ErrorState, LoadingOutline } from '@/components/states';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { BlockedRules } from './blocked-rules';
import { ruleText } from './rule-text';
import { substituteLesson, substitutesQuery, withdrawSubstitution } from './timetable-api';

type Field = 'teacherId' | 'reason' | 'confirm';

/** The text of each group of the suggestions (decision 3). */
const GROUP_TEXT = {
  subject: 'timetable.day.substituteOfSubject',
  department: 'timetable.day.substituteOfDepartment',
  other: 'timetable.day.substituteOfOther',
} as const;

/**
 * The substitution of a lesson (task 5.7b-1, pull request #191; `06`,
 * Changes after publishing: "Substitution. ... suggests teachers who are
 * free in that slot: same subject first, then same department. Teachers who
 * cannot teach in the class's language are listed last and marked"): a
 * dialog that sends once (`.claude/rules/web.md`), its key made when it
 * opens. The teachers come in the server's order with their group and mark;
 * a refusal with warnings (`substitution_needs_confirm`) lists them with a
 * tick, and the substitution is sent again with it (decision 2; `05`,
 * Substitution: "Choosing one needs a confirmation").
 */
export function SubstituteDialog({
  lesson,
  branchId,
  subject,
  onClose,
  onSubstituted,
}: {
  lesson: DayLesson;
  branchId: string | null;
  subject: string;
  onClose: () => void;
  onSubstituted: (warnings: string[]) => Promise<void>;
}) {
  const { t } = useTranslation();
  const done = useRef<string[] | null>(null);
  const key = useRef(crypto.randomUUID());
  const suggestions = useQuery(substitutesQuery(branchId, lesson.id));
  const form = useRecordForm<Field, LessonSubstituteBody>({
    schema: lessonSubstituteBodySchema,
    initial: { teacherId: '', reason: '', confirm: '' },
    read: (typed) => ({
      teacherId: typed.teacherId,
      reason: typed.reason,
      ...(typed.confirm === CHECKED ? { confirm: true } : {}),
    }),
    save: async (body) => {
      const answer = await substituteLesson(lesson.id, body, key.current);
      done.current = answer.warnings.map((one) => one.rule);
    },
    message: (field) =>
      field === 'reason'
        ? t('timetable.day.reasonNeededChange')
        : field === 'teacherId'
          ? t('timetable.day.substituteNeeded')
          : undefined,
  });
  // A tick is for the warnings shown: another teacher takes it away
  // (`.claude/rules/web.md`, a tick belongs to its list of warnings).
  const teacherField = form.bind('teacherId');
  const pickTeacher = {
    ...teacherField,
    onChange: (event: { target: { value: string } }) => {
      form.bind('confirm').onChange({ target: { value: '' } });
      teacherField.onChange(event);
    },
  };
  const element = useRef<HTMLFormElement>(null);
  const title = t('timetable.day.substituteTitle', { subject, time: timeText(lesson.start) });
  const failure = form.failure;
  const code = failure instanceof ApiFailure ? failure.code : null;
  const details =
    failure instanceof ApiFailure &&
    (code === 'substitution_blocked' || code === 'substitution_needs_confirm')
      ? (failure.details ?? [])
      : [];

  const send = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const checked = await form.submit();
    if (!checked) {
      element.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      return;
    }
    if (done.current !== null) {
      await onSubstituted(done.current);
    }
  };

  const teachers = suggestions.data?.teachers ?? [];
  const labelOf = (one: (typeof teachers)[number]) =>
    [
      one.name,
      t(GROUP_TEXT[one.group]),
      ...(one.language ? [t('timetable.day.substituteLanguage')] : []),
    ].join(' · ');

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form
          ref={element}
          aria-label={title}
          className="grid gap-4"
          onSubmit={(event) => {
            void send(event);
          }}
        >
          {suggestions.isError ? (
            <ErrorState error={suggestions.error} onRetry={() => void suggestions.refetch()} />
          ) : suggestions.data === undefined ? (
            <LoadingOutline />
          ) : teachers.length === 0 ? (
            <EmptyState text={t('timetable.day.substituteNone')} />
          ) : (
            <>
              {suggestions.data.noSubjectTeacherFree && (
                <p className="text-sm" data-no-subject-teacher-free="true">
                  {t('timetable.day.substituteNoneOfSubject')}
                </p>
              )}
              <SelectField
                label={t('timetable.day.substitute')}
                options={[
                  { value: '', label: t('timetable.day.teacherChoose') },
                  ...teachers.map((one) => ({ value: one.id, label: labelOf(one) })),
                ]}
                {...pickTeacher}
              />
            </>
          )}
          <TextAreaField label={t('timetable.day.reason')} rows={3} {...form.bind('reason')} />
          <FailureAlert error={failure} />
          {code === 'substitution_blocked' && details.length > 0 && (
            <BlockedRules details={details} intoText={(name) => name} />
          )}
          {code === 'substitution_needs_confirm' && details.length > 0 && (
            <div className="grid gap-2" data-substitution-ticks="true">
              <p className="text-sm font-medium">{t('timetable.day.ticks')}</p>
              <ul className="grid gap-1 text-sm">
                {details.map((detail, index) => (
                  <li key={`${detail.path}-${String(index)}`}>{ruleText(t, detail.code)}</li>
                ))}
              </ul>
              <CheckboxField
                label={t('timetable.day.substituteConfirm')}
                {...form.bind('confirm')}
              />
            </div>
          )}
          <DialogFooter>
            <DialogClose render={<Button variant="ghost" />}>{t('timetable.day.back')}</DialogClose>
            <Button type="submit" disabled={form.status === 'saving'}>
              {t('timetable.day.substituteSend')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The withdrawal of a substitution in force, with a reason (task 5.7b-1, decision 12). */
export function WithdrawSubstitutionDialog({
  lesson,
  subject,
  onClose,
  onWithdrawn,
}: {
  lesson: DayLesson;
  subject: string;
  onClose: () => void;
  onWithdrawn: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const done = useRef(false);
  const key = useRef(crypto.randomUUID());
  const form = useRecordForm<'reason', SubstitutionWithdrawBody>({
    schema: substitutionWithdrawBodySchema,
    initial: { reason: '' },
    save: async (body) => {
      await withdrawSubstitution(lesson.id, body, key.current);
      done.current = true;
    },
    message: (field) => (field === 'reason' ? t('timetable.day.reasonNeededChange') : undefined),
  });
  const element = useRef<HTMLFormElement>(null);
  const title = t('timetable.day.withdrawSubstitutionTitle', {
    subject,
    time: timeText(lesson.start),
  });
  const failure = form.failure;
  const details =
    failure instanceof ApiFailure && failure.code === 'substitution_return_blocked'
      ? (failure.details ?? [])
      : [];

  const send = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const checked = await form.submit();
    if (!checked) {
      element.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      return;
    }
    if (done.current) {
      await onWithdrawn();
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form
          ref={element}
          aria-label={title}
          className="grid gap-4"
          onSubmit={(event) => {
            void send(event);
          }}
        >
          <TextAreaField label={t('timetable.day.reason')} rows={3} {...form.bind('reason')} />
          <FailureAlert error={failure} />
          {details.length > 0 && <BlockedRules details={details} intoText={(name) => name} />}
          <DialogFooter>
            <DialogClose render={<Button variant="ghost" />}>{t('timetable.day.keep')}</DialogClose>
            <Button type="submit" disabled={form.status === 'saving'}>
              {t('timetable.day.withdrawSubstitutionSend')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
