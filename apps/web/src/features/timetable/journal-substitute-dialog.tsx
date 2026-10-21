import {
  absenceJournalSubstituteBodySchema,
  vacancyJournalSubstituteBodySchema,
  type AbsenceJournalSubstituteBody,
  type JournalSubstituteAnswer,
  type VacancyJournalSubstituteBody,
} from '@sodiq/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiFailure } from '@/api/failure';
import { FailureAlert } from '@/components/failure-alert';
import { CHECKED, CheckboxField, DateField, SelectField, TextAreaField } from '@/components/field';
import type { FormSchema } from '@/components/form/form-messages';
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
import { schoolDateText } from '@/lib/dates';
import { ruleText } from './rule-text';
import {
  absenceJournalSubstitutesQuery,
  substituteAbsenceJournal,
  substituteVacancyJournal,
  vacancyJournalSubstitutesQuery,
} from './timetable-api';

type Field = 'teacherId' | 'reason' | 'confirm' | 'from' | 'until';

type Body = AbsenceJournalSubstituteBody | VacancyJournalSubstituteBody;

/** The text of each group of the suggestions (5.7b-1 decision 3). */
const GROUP_TEXT = {
  subject: 'timetable.day.substituteOfSubject',
  department: 'timetable.day.substituteOfDepartment',
  other: 'timetable.day.substituteOfOther',
} as const;

/** What the substitution is for: an absence, or a vacancy over a period with its acting teacher. */
export type JournalTarget =
  | { readonly kind: 'absence'; readonly absenceId: string }
  | {
      readonly kind: 'vacancy';
      readonly vacancyId: string;
      readonly from: string;
      readonly until: string | null;
    };

/**
 * One substitute for every lesson of a journal (task 5.7b-2, pull request
 * #192; `edge/timetable`, After publishing: "One substitute can be assigned
 * per journal for the whole absence in one action, each date still being
 * checked."): the suggestions with the dates each teacher can take, the
 * reason, and, for a vacancy, the period (decision 7, its acting teacher
 * first). A dialog that sends once, its key made when it opens; a refusal
 * with warnings lists them by date with a tick. The answer lists the dates
 * saved, those blocked with their rules and those already substituted,
 * kept in the dialog's own state (`.claude/rules/web.md`).
 */
export function JournalSubstituteDialog({
  title,
  target,
  journalId,
  branchId,
  onClose,
  onDone,
}: {
  title: string;
  target: JournalTarget;
  journalId: string;
  branchId: string | null;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const key = useRef(crypto.randomUUID());
  const [answer, setAnswer] = useState<JournalSubstituteAnswer | null>(null);
  const schema: FormSchema<Body> =
    target.kind === 'absence'
      ? absenceJournalSubstituteBodySchema
      : vacancyJournalSubstituteBodySchema;
  const form = useRecordForm<Field, Body>({
    schema,
    initial: {
      teacherId: '',
      reason: '',
      confirm: '',
      from: target.kind === 'vacancy' ? target.from : '',
      until: target.kind === 'vacancy' ? (target.until ?? '') : '',
    },
    read: (typed) => ({
      journalId,
      teacherId: typed.teacherId,
      reason: typed.reason,
      ...(typed.confirm === CHECKED ? { confirm: true } : {}),
      ...(target.kind === 'vacancy'
        ? { from: typed.from, until: typed.until === '' ? null : typed.until }
        : {}),
    }),
    save: async (body) => {
      const saved =
        target.kind === 'absence'
          ? await substituteAbsenceJournal(
              target.absenceId,
              body,
              key.current,
            )
          : await substituteVacancyJournal(
              target.vacancyId,
              body as VacancyJournalSubstituteBody,
              key.current,
            );
      setAnswer(saved);
    },
    message: (field) =>
      field === 'reason'
        ? t('timetable.day.reasonNeededChange')
        : field === 'teacherId'
          ? t('timetable.day.substituteNeeded')
          : undefined,
  });
  const from = form.bind('from').value;
  const until = form.bind('until').value;
  const suggestions = useQuery(
    target.kind === 'absence'
      ? absenceJournalSubstitutesQuery(branchId, target.absenceId, journalId)
      : vacancyJournalSubstitutesQuery(
          branchId,
          target.vacancyId,
          journalId,
          from,
          until === '' ? null : until,
        ),
  );
  // A tick is for the warnings shown, and the teachers follow the period:
  // another teacher or period takes the tick away (`.claude/rules/web.md`).
  const clearTick = () => {
    form.bind('confirm').onChange({ target: { value: '' } });
  };
  const rebind = (field: 'teacherId' | 'from' | 'until') => {
    const bound = form.bind(field);
    return {
      ...bound,
      onChange: (event: { target: { value: string } }) => {
        clearTick();
        if (field !== 'teacherId') form.bind('teacherId').onChange({ target: { value: '' } });
        bound.onChange(event);
      },
    };
  };
  // Decision 7: the vacancy's acting teacher in force is chosen first, once
  // for each list of suggestions; any other teacher can be chosen.
  const actingId = suggestions.data?.teachers.find((one) => one.acting)?.id;
  const preselected = useRef<unknown>(null);
  const teacherBinding = form.bind('teacherId');
  useEffect(() => {
    if (suggestions.data === undefined || preselected.current === suggestions.data) return;
    preselected.current = suggestions.data;
    if (actingId !== undefined && teacherBinding.value === '') {
      teacherBinding.onChange({ target: { value: actingId } });
    }
  }, [suggestions.data, actingId, teacherBinding]);
  const element = useRef<HTMLFormElement>(null);
  const failure = form.failure;
  const code = failure instanceof ApiFailure ? failure.code : null;
  const details =
    failure instanceof ApiFailure &&
    (code === 'journal_substitute_none' || code === 'substitution_needs_confirm')
      ? (failure.details ?? [])
      : [];
  const teachers = suggestions.data?.teachers ?? [];
  const dates = suggestions.data?.dates ?? [];
  const dateText = (date: string) => schoolDateText(date, language, false);
  // A substitute away is a refusal of the server, not a rule of the engine.
  const reasonText = (rule: string) =>
    rule === 'substitute_away' ? t('errors.substitute_away') : ruleText(t, rule);

  const send = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const checked = await form.submit();
    if (!checked) {
      element.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
    }
  };

  const labelOf = (one: (typeof teachers)[number]) =>
    [
      one.name,
      ...(one.acting ? [t('timetable.journalSubstitute.acting')] : []),
      t(GROUP_TEXT[one.group]),
      ...(one.language ? [t('timetable.day.substituteLanguage')] : []),
      t('timetable.journalSubstitute.canTake', {
        dates: one.dates.length,
        all: dates.length,
      }),
    ].join(' · ');

  const chosen = teachers.find((one) => one.id === form.bind('teacherId').value);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          if (answer === null) onClose();
          else void onDone();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {answer !== null ? (
          <div className="grid gap-4" data-journal-substitute-answer="true">
            <p className="text-sm" data-saved-dates={answer.saved.map((one) => one.date).join(',')}>
              {t('timetable.journalSubstitute.saved', {
                dates: answer.saved.map((one) => dateText(one.date)).join(', '),
              })}
            </p>
            {answer.blocked.length > 0 && (
              <div className="grid gap-1 text-sm" data-blocked-dates="true">
                <p className="font-medium">{t('timetable.journalSubstitute.blocked')}</p>
                <ul className="grid gap-1">
                  {answer.blocked.map((one) => (
                    <li key={one.date} data-blocked-date={one.date}>
                      {t('timetable.journalSubstitute.dateLine', {
                        date: dateText(one.date),
                        text: one.rules.map(reasonText).join('; '),
                      })}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {answer.taken.length > 0 && (
              <p className="text-sm" data-taken-dates="true">
                {t('timetable.journalSubstitute.taken', {
                  dates: answer.taken.map((one) => dateText(one.date)).join(', '),
                })}
              </p>
            )}
            <DialogFooter>
              <Button
                onClick={() => {
                  void onDone();
                }}
              >
                {t('timetable.journalSubstitute.close')}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form
            ref={element}
            aria-label={title}
            className="grid gap-4"
            onSubmit={(event) => {
              void send(event);
            }}
          >
            {target.kind === 'vacancy' && (
              <div className="grid gap-4 sm:grid-cols-2">
                <DateField label={t('timetable.journalSubstitute.from')} {...rebind('from')} />
                <DateField label={t('timetable.journalSubstitute.until')} {...rebind('until')} />
              </div>
            )}
            {suggestions.isError ? (
              <ErrorState error={suggestions.error} onRetry={() => void suggestions.refetch()} />
            ) : suggestions.data === undefined ? (
              <LoadingOutline />
            ) : teachers.length === 0 ? (
              <EmptyState
                text={
                  dates.length === 0
                    ? t('timetable.journalSubstitute.noDates')
                    : t('timetable.day.substituteNone')
                }
              />
            ) : (
              <SelectField
                label={t('timetable.day.substitute')}
                options={[
                  { value: '', label: t('timetable.day.teacherChoose') },
                  ...teachers.map((one) => ({ value: one.id, label: labelOf(one) })),
                ]}
                {...rebind('teacherId')}
              />
            )}
            {chosen !== undefined && chosen.blockedDates.length > 0 && (
              <p className="text-sm" data-chosen-blocked="true">
                {t('timetable.journalSubstitute.cannotTake', {
                  dates: chosen.blockedDates.map(dateText).join(', '),
                })}
              </p>
            )}
            <TextAreaField label={t('timetable.day.reason')} rows={3} {...form.bind('reason')} />
            <FailureAlert error={failure} />
            {code === 'journal_substitute_none' && details.length > 0 && (
              <ul className="grid gap-1 text-sm" data-none-dates="true">
                {details.map((detail, index) => (
                  <li key={`${detail.path}-${String(index)}`}>
                    {detail.day === undefined
                      ? reasonText(detail.code)
                      : t('timetable.journalSubstitute.dateLine', {
                          date: dateText(detail.day),
                          text: reasonText(detail.code),
                        })}
                  </li>
                ))}
              </ul>
            )}
            {code === 'substitution_needs_confirm' && details.length > 0 && (
              <div className="grid gap-2" data-substitution-ticks="true">
                <p className="text-sm font-medium">{t('timetable.day.ticks')}</p>
                <ul className="grid gap-1 text-sm">
                  {details.map((detail, index) => (
                    <li key={`${detail.path}-${String(index)}`}>
                      {detail.day === undefined
                        ? reasonText(detail.code)
                        : t('timetable.journalSubstitute.dateLine', {
                            date: dateText(detail.day),
                            text: reasonText(detail.code),
                          })}
                    </li>
                  ))}
                </ul>
                <CheckboxField
                  label={t('timetable.day.substituteConfirm')}
                  {...form.bind('confirm')}
                />
              </div>
            )}
            <DialogFooter>
              <DialogClose render={<Button variant="ghost" />}>
                {t('timetable.day.back')}
              </DialogClose>
              <Button type="submit" disabled={form.status === 'saving'}>
                {t('timetable.day.substituteSend')}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
