import {
  listName,
  type ActingTeacher,
  type ActingTeacherBody,
  type Subject,
  type VacancyDetail,
} from '@sodiq/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useConfirm } from '@/components/confirm-dialog';
import { FailureAlert } from '@/components/failure-alert';
import { DateField, SelectField } from '@/components/field';
import { ErrorState, LoadingOutline } from '@/components/states';
import { Button } from '@/components/ui/button';
import { CHECKBOX, CHECKBOX_TARGET, SECTION_TITLE } from '@/components/ui/control';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useView } from '@/features/access/use-view';
import { schoolDateText } from '@/lib/dates';
import {
  actingCheckQuery,
  endActing,
  invalidateVacancies,
  nameActing,
  staffQuery,
} from './people-api';
import { fillRowName } from './vacancy-fill-dialog';

/**
 * The acting teachers of a vacancy's journals on its record (task 5.7a-3c;
 * `edge/timetable`, After publishing, "A vacancy lasts a quarter: who writes
 * the plan and grades?": "The Academic Vice Principal names an acting teacher
 * for the journal for a period"). Each journal the vacancy holds from today,
 * with its periods; for a role with `timetable` `edit`, Name, End and
 * Withdraw. A period's end is the first day the person no longer owns the
 * journal (review correction 2); a fill ends it at the fill date (decision 2).
 */
export function ActingSection({
  vacancy,
  name,
  subjects,
  canAct,
}: {
  vacancy: VacancyDetail;
  name: string;
  subjects: readonly Subject[];
  canAct: boolean;
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [naming, setNaming] = useState(false);
  const [ending, setEnding] = useState<ActingTeacher | null>(null);
  const key = useRef<string | null>(null);
  const withdraw = useMutation({
    mutationFn: (period: ActingTeacher) => {
      key.current ??= crypto.randomUUID();
      return endActing(period.id, period.from, key.current);
    },
    onSettled: async () => {
      key.current = null;
      await invalidateVacancies(queryClient);
    },
  });
  const journalName = (journal: VacancyDetail['journals'][number]) =>
    fillRowName(t, language, journal, vacancy.fillUnits, subjects);
  const open = vacancy.journals.filter((one) => one.runs.length > 0);
  return (
    <section className="grid gap-3" data-vacancy-acting="true">
      <h3 className={SECTION_TITLE}>{t('people.vacancies.acting.title')}</h3>
      {vacancy.journals.length === 0 ? (
        <p className="text-sm">{t('people.vacancies.acting.none')}</p>
      ) : (
        <ul className="grid gap-3 text-sm">
          {vacancy.journals.map((journal) => (
            <li key={journal.id} className="grid gap-1" data-acting-journal={journal.id}>
              <span className="font-semibold">{journalName(journal)}</span>
              {journal.acting.length === 0 ? (
                <span>{t('people.vacancies.acting.noTeacher')}</span>
              ) : (
                <ul className="grid gap-1">
                  {journal.acting.map((period) => (
                    <li
                      key={period.id}
                      className="flex flex-wrap items-center gap-2"
                      data-acting-period={period.id}
                      data-state={period.state}
                    >
                      <span>{periodLine(t, language, period)}</span>
                      {canAct && period.canWithdraw && (
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={withdraw.isPending}
                          onClick={() => {
                            void confirm({
                              title: t('people.vacancies.acting.withdrawTitle'),
                              text: t('people.vacancies.acting.withdrawText'),
                              names: [`${journalName(journal)}: ${period.person.name}`],
                              action: t('people.vacancies.acting.withdraw'),
                            }).then((go) => {
                              if (go) withdraw.mutate(period);
                            });
                          }}
                        >
                          {t('people.vacancies.acting.withdraw')}
                        </Button>
                      )}
                      {canAct && period.canEnd && period.state === 'current' && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            withdraw.reset();
                            setEnding(period);
                          }}
                        >
                          {t('people.vacancies.acting.end')}
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
      {withdraw.isError && <FailureAlert error={withdraw.error} />}
      {canAct && open.length > 0 && (
        <div>
          <Button
            variant="secondary"
            onClick={() => {
              withdraw.reset();
              setNaming(true);
            }}
          >
            {t('people.vacancies.acting.open')}
          </Button>
        </div>
      )}
      {naming && (
        <NameDialog
          vacancy={vacancy}
          name={name}
          journals={open.map((one) => ({
            id: one.id,
            name: journalName(one),
            firstDay: one.runs[0]?.from ?? vacancy.today,
          }))}
          onClose={() => {
            setNaming(false);
          }}
        />
      )}
      {ending !== null && (
        <EndDialog
          period={ending}
          today={vacancy.today}
          onClose={() => {
            setEnding(null);
          }}
        />
      )}
    </section>
  );
}

/** A period as one line: the person, the days, and why it ends. */
function periodLine(t: TFunction, language: string, period: ActingTeacher): string {
  const parts = [
    t('people.vacancies.acting.line', {
      person: period.person.name,
      from: schoolDateText(period.from, language),
    }),
  ];
  if (period.state === 'withdrawn') {
    parts.push(t('people.vacancies.acting.states.withdrawn'));
    return parts.join(', ');
  }
  // Decision 2: a fill, another teacher of the row or no run ends it there, before the typed end.
  if (period.endsOn !== null) {
    parts.push(
      t('people.vacancies.acting.endsOnRow', { date: schoolDateText(period.endsOn, language) }),
    );
  } else if (period.until !== null) {
    parts.push(
      t('people.vacancies.acting.until', { date: schoolDateText(period.until, language) }),
    );
  } else {
    parts.push(t('people.vacancies.acting.openEnded'));
  }
  parts.push(t(`people.vacancies.acting.states.${period.state}`));
  return parts.join(', ');
}

/** Names an acting teacher: the journal, the person, the first day and, if known, the first day without them. */
function NameDialog({
  vacancy,
  name,
  journals,
  onClose,
}: {
  vacancy: VacancyDetail;
  name: string;
  journals: readonly { id: string; name: string; firstDay: string }[];
  onClose: () => void;
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const { branchId } = useView();
  const queryClient = useQueryClient();
  const [chosenJournal, setJournal] = useState(
    journals.length === 1 ? (journals[0]?.id ?? '') : '',
  );
  const [personId, setPersonId] = useState('');
  // Empty: the first day the chosen journal is under the vacancy from today.
  const [typedFrom, setFrom] = useState('');
  const [until, setUntil] = useState('');
  // The tick belongs to the answer it was given on (`.claude/rules/web.md`).
  const [confirmedFor, setConfirmedFor] = useState<string | null>(null);
  const key = useRef<string | null>(null);
  const staff = useQuery(staffQuery(branchId));

  // A journal no longer offered falls back to none (a field follows its options).
  const journalId = journals.some((one) => one.id === chosenJournal) ? chosenJournal : '';
  const from =
    typedFrom !== ''
      ? typedFrom
      : (journals.find((one) => one.id === journalId)?.firstDay ?? vacancy.today);
  const fromOk = from !== '' && from >= vacancy.today;
  const untilOk = until === '' || (fromOk && until > from);
  const body: ActingTeacherBody | null =
    journalId !== '' && personId !== '' && fromOk && untilOk
      ? {
          vacancyId: vacancy.id,
          journalId,
          personId,
          from,
          ...(until === '' ? {} : { until }),
        }
      : null;
  const check = useQuery(actingCheckQuery(branchId, body));
  const bodyKey = JSON.stringify(body);
  const confirmed = confirmedFor === bodyKey;

  const save = useMutation({
    mutationFn: (sent: ActingTeacherBody) => {
      key.current ??= crypto.randomUUID();
      return nameActing(sent, key.current);
    },
    onSuccess: () => {
      onClose();
    },
    onSettled: async () => {
      key.current = null;
      await invalidateVacancies(queryClient);
    },
  });

  const people = (staff.data?.staff ?? [])
    .filter((one) => one.status === null || one.status === 'active')
    .map((one) => ({
      id: one.id,
      name: listName(one),
      fits: one.subjects.some((own) =>
        vacancy.subjects.some((wanted) => wanted.subjectId === own.subjectId),
      ),
    }))
    .sort((a, b) => Number(b.fits) - Number(a.fits) || a.name.localeCompare(b.name, language));

  let answer: React.ReactNode = null;
  if (body !== null) {
    if (check.isError) {
      answer = (
        <ErrorState
          error={check.error}
          onRetry={() => {
            void check.refetch();
          }}
        />
      );
    } else if (check.data === undefined) {
      answer = <LoadingOutline lines={2} />;
    } else if (check.data.problems.length > 0) {
      answer = (
        <ul className="grid gap-1 text-sm" data-acting-problems="true">
          {check.data.problems.map((code) => (
            <li key={code} data-problem={code}>
              {t(`errors.${code}`)}
            </li>
          ))}
        </ul>
      );
    } else if (check.data.language) {
      answer = (
        <label className={CHECKBOX_TARGET}>
          <input
            type="checkbox"
            className={CHECKBOX}
            checked={confirmed}
            onChange={(event) => {
              setConfirmedFor(event.target.checked ? bodyKey : null);
            }}
          />
          <span className="text-sm">{t('people.vacancies.acting.language')}</span>
        </label>
      );
    }
  }
  const ready =
    body !== null &&
    check.data !== undefined &&
    check.data.problems.length === 0 &&
    (!check.data.language || confirmed);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('people.vacancies.acting.dialogTitle', { name })}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3" data-acting-dialog="true">
          <SelectField
            label={t('people.vacancies.acting.journal')}
            name="actingJournal"
            value={journalId}
            options={[
              { value: '', label: t('people.vacancies.acting.chooseJournal') },
              ...journals.map((one) => ({ value: one.id, label: one.name })),
            ]}
            onChange={(event) => {
              setJournal(event.target.value);
            }}
          />
          {staff.isError ? (
            <ErrorState
              error={staff.error}
              onRetry={() => {
                void staff.refetch();
              }}
            />
          ) : (
            <SelectField
              label={t('people.vacancies.acting.person')}
              name="actingPerson"
              value={personId}
              disabled={staff.data === undefined}
              options={[
                { value: '', label: t('people.vacancies.acting.choosePerson') },
                ...people.map((one) => ({ value: one.id, label: one.name })),
              ]}
              onChange={(event) => {
                setPersonId(event.target.value);
              }}
            />
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <DateField
              label={t('people.vacancies.acting.from')}
              name="actingFrom"
              value={from}
              min={vacancy.today}
              error={
                from < vacancy.today
                  ? t('people.vacancies.acting.tooEarly', {
                      date: schoolDateText(vacancy.today, language),
                    })
                  : undefined
              }
              onChange={(event) => {
                setFrom(event.target.value);
              }}
            />
            <DateField
              label={t('people.vacancies.acting.untilField')}
              name="actingUntil"
              value={until}
              error={until !== '' && !untilOk ? t('people.vacancies.acting.untilAfter') : undefined}
              onChange={(event) => {
                setUntil(event.target.value);
              }}
            />
          </div>
          {answer}
          {save.isError && <FailureAlert error={save.error} />}
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="secondary" />}>
            {t('people.vacancies.acting.cancel')}
          </DialogClose>
          <Button
            disabled={!ready || save.isPending}
            onClick={() => {
              if (body !== null) {
                save.mutate(confirmed ? { ...body, confirmLanguage: true } : body);
              }
            }}
          >
            {t('people.vacancies.acting.name')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Ends a current period: the first day the person no longer owns the journal, today at the earliest. */
function EndDialog({
  period,
  today,
  onClose,
}: {
  period: ActingTeacher;
  today: string;
  onClose: () => void;
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const queryClient = useQueryClient();
  const [until, setUntil] = useState(today);
  const key = useRef<string | null>(null);
  const save = useMutation({
    mutationFn: (day: string) => {
      key.current ??= crypto.randomUUID();
      return endActing(period.id, day, key.current);
    },
    onSuccess: () => {
      onClose();
    },
    onSettled: async () => {
      key.current = null;
      await invalidateVacancies(queryClient);
    },
  });
  const tooLate = period.until !== null && until > period.until;
  const valid = until !== '' && until >= today && !tooLate;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {t('people.vacancies.acting.endTitle', { person: period.person.name })}
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-3" data-acting-end="true">
          <DateField
            label={t('people.vacancies.acting.endOn')}
            name="actingEnd"
            value={until}
            min={today}
            error={
              until === ''
                ? t('people.vacancies.acting.chooseDate')
                : until < today
                  ? t('people.vacancies.acting.tooEarly', { date: schoolDateText(today, language) })
                  : tooLate
                    ? t('errors.acting_end_later')
                    : undefined
            }
            onChange={(event) => {
              setUntil(event.target.value);
            }}
          />
          {save.isError && <FailureAlert error={save.error} />}
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="secondary" />}>
            {t('people.vacancies.acting.cancel')}
          </DialogClose>
          <Button
            disabled={!valid || save.isPending}
            onClick={() => {
              save.mutate(until);
            }}
          >
            {t('people.vacancies.acting.end')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
