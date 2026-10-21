import {
  classDisplayName,
  listName,
  vacancyFillRowKeyOf,
  type DayChangeChoice,
  type Subject,
  type VacancyDetail,
  type VacancyFill,
  type VacancyFillCheck,
  type VacancyFillCheckBody,
  type VacancyFillRowAnswer,
  type VacancyFillUnit,
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
import {
  CHECKBOX,
  CHECKBOX_TARGET,
  SECTION_TITLE,
  SUBSECTION_TITLE,
} from '@/components/ui/control';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useView } from '@/features/access/use-view';
import { nameOf, yearsQuery } from '@/features/setup/setup-api';
import { PublishCheckLists, type PublishNames } from '@/features/timetable/publish-check-parts';
import { PublishChainQuestion } from '@/features/timetable/publish-chain';
import { dayDecisionsBodyOf, PublishDayChanges } from '@/features/timetable/publish-day-changes';
import { PublishImpact } from '@/features/timetable/publish-impact';
import { PublishShortened } from '@/features/timetable/publish-shortened';
import { invalidateTimetable, versionsQuery } from '@/features/timetable/timetable-api';
import { comingQuarterStarts, nextMonday } from '@/features/timetable/version-form';
import { schoolDateText } from '@/lib/dates';
import { fillVacancy, invalidateVacancies, staffQuery, vacancyFillCheckQuery } from './people-api';

/** The day after a school date. */
const dayAfter = (date: string): string => {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
};

/**
 * The fill of a vacancy from its record (task 5.7a-3b; `06`, Changes after
 * publishing, "Filling a vacancy": "the Academic Vice Principal fills the
 * vacancy with the person from a date, tomorrow at the earliest, for all of
 * its load rows or the chosen ones ... with the impact preview and every rule
 * of publishing"). The person, the date (next Monday by default, the coming
 * quarters' first days and the later versions' starts offered; `06`, Start
 * date), all rows or the chosen ones; then the server's check: the rows
 * filled and left, the publish's lists, the later versions the change is
 * carried into, the stored one-day changes, the impact preview, the close.
 * Every "today" is the server's (`vacancy.today`), in the branch's time zone.
 */
export function VacancyFillDialog({
  vacancy,
  name,
  subjects,
  onClose,
}: {
  vacancy: VacancyDetail;
  name: string;
  subjects: readonly Subject[];
  onClose: () => void;
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const { branchId } = useView();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const tomorrow = dayAfter(vacancy.today);
  const [personId, setPersonId] = useState('');
  const [startsOn, setStartsOn] = useState(nextMonday(vacancy.today));
  // The rows chosen by their keys; `null`: all rows.
  const [chosen, setChosen] = useState<readonly string[] | null>(null);
  const [tickedKey, setTickedKey] = useState<string | null>(null);
  const [dayChosen, setDayChosen] = useState<{
    key: string | null;
    choices: Record<string, DayChangeChoice>;
    reasons: Record<string, string>;
  }>({ key: null, choices: {}, reasons: {} });
  // One key per fill the person asks for: a retry of the same click repeats it harmlessly.
  const key = useRef<string | null>(null);
  const [done, setDone] = useState<VacancyFill | null>(null);

  const staff = useQuery(staffQuery(branchId));
  const versions = useQuery(versionsQuery(branchId));
  const years = useQuery(yearsQuery(branchId));

  const dated = startsOn !== '' && startsOn >= tomorrow;
  const base: VacancyFillCheckBody | null =
    personId !== '' && dated ? { vacancyId: vacancy.id, personId, startsOn } : null;
  // The rows offered: those of the check with all rows for this person and date.
  const all = useQuery(vacancyFillCheckQuery(branchId, done === null ? base : null));
  const offered = all.data?.rows ?? [];
  // A chosen row no longer offered (another date or person) is dropped; when
  // none of the chosen rows is left, all rows are back (`.claude/rules/web.md`,
  // a field follows its options). Rows unticked by the person: none chosen.
  const kept =
    chosen === null || all.data === undefined
      ? null
      : offered.filter((row) => chosen.includes(vacancyFillRowKeyOf(rowOf(row))));
  const picked =
    kept !== null && kept.length === 0 && chosen !== null && chosen.length > 0 ? null : kept;
  const noRow = picked !== null && picked.length === 0;
  const choosing = picked !== null && picked.length > 0 && picked.length < offered.length;
  const body: VacancyFillCheckBody | null =
    base === null || noRow ? null : !choosing ? base : { ...base, rows: picked.map(rowOf) };
  const some = useQuery({
    ...vacancyFillCheckQuery(branchId, done === null && choosing ? body : null),
  });
  const check = choosing ? some : all;

  const fill = useMutation({
    mutationFn: (sent: Parameters<typeof fillVacancy>[0]) => {
      key.current ??= crypto.randomUUID();
      return fillVacancy(sent, key.current);
    },
    onSuccess: (answer) => {
      setDone(answer);
    },
    onError: async () => {
      // A refused fill reads the check again: what it showed may have changed.
      await queryClient.invalidateQueries({
        queryKey: ['people', 'vacancies', branchId, 'fill-check'],
      });
    },
    onSettled: async () => {
      key.current = null;
      await Promise.all([invalidateVacancies(queryClient), invalidateTimetable(queryClient)]);
    },
  });

  const units = [...(all.data?.units ?? []), ...(check.data?.units ?? [])];
  const rowName = (row: { classId: string | null; groupId: string | null; subjectId: string }) =>
    fillRowName(t, language, row, units, subjects);

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

  const year = years.data?.years.find((one) => one.status === 'current');
  const shortcuts = [
    ...comingQuarterStarts(year, tomorrow).map((one) => ({
      date: one.date,
      text: t('timetable.load.quarterShortcut', {
        number: one.number,
        date: schoolDateText(one.date, language),
      }),
    })),
    ...(versions.data?.versions ?? [])
      .filter((one) => one.status === 'published' && one.startsOn >= tomorrow)
      .map((one) => ({
        date: one.startsOn,
        text: t('people.vacancies.fill.versionStart', {
          number: one.number,
          date: schoolDateText(one.startsOn, language),
        }),
      })),
  ];

  let result: React.ReactNode;
  if (done !== null) {
    result = <FillDone fill={done} rowName={rowName} />;
  } else if (base === null) {
    result = null;
  } else if (noRow) {
    result = (
      <p className="text-sm" data-no-row="true">
        {t('people.vacancies.fill.chooseRow')}
      </p>
    );
  } else if (check.isError) {
    result = (
      <ErrorState
        error={check.error}
        onRetry={() => {
          void check.refetch();
        }}
      />
    );
  } else if (check.data === undefined) {
    result = <LoadingOutline lines={4} />;
  } else {
    result = (
      <CheckParts
        answer={check.data}
        startsOn={startsOn}
        rowName={rowName}
        subjects={subjects}
        tickedKey={tickedKey}
        onTick={setTickedKey}
        dayChosen={dayChosen}
        onDayChosen={setDayChosen}
        pending={fill.isPending}
        onFill={async (sent) => {
          if (
            await confirm({
              title: t('people.vacancies.fill.confirmTitle', { name }),
              text: t('people.vacancies.fill.confirmText', {
                person: people.find((one) => one.id === personId)?.name ?? '',
                date: schoolDateText(startsOn, language),
              }),
              names: (check.data?.rows ?? []).filter((one) => one.filled).map(rowName),
              action: t('people.vacancies.fill.action'),
            })
          ) {
            fill.mutate(sent);
          }
        }}
        body={body}
      />
    );
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('people.vacancies.fill.title', { name })}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4" data-vacancy-fill="true">
          {done === null && (
            <div className="grid gap-3">
              {staff.isError ? (
                <ErrorState
                  error={staff.error}
                  onRetry={() => {
                    void staff.refetch();
                  }}
                />
              ) : (
                <SelectField
                  label={t('people.vacancies.fill.person')}
                  name="fillPerson"
                  value={personId}
                  disabled={staff.data === undefined}
                  options={[
                    { value: '', label: t('people.vacancies.fill.choosePerson') },
                    ...people.map((one) => ({ value: one.id, label: one.name })),
                  ]}
                  onChange={(event) => {
                    setPersonId(event.target.value);
                  }}
                />
              )}
              <div className="max-w-56">
                <DateField
                  label={t('people.vacancies.fill.startsOn')}
                  name="fillStartsOn"
                  value={startsOn}
                  min={tomorrow}
                  error={
                    startsOn !== '' && startsOn < tomorrow
                      ? t('people.vacancies.fill.tooEarly', {
                          date: schoolDateText(tomorrow, language),
                        })
                      : startsOn === ''
                        ? t('people.vacancies.fill.chooseDate')
                        : undefined
                  }
                  onChange={(event) => {
                    setStartsOn(event.target.value);
                  }}
                />
              </div>
              <div
                className="flex flex-wrap gap-2"
                role="group"
                aria-label={t('people.vacancies.fill.shortcuts')}
              >
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setStartsOn(nextMonday(vacancy.today));
                  }}
                >
                  {t('timetable.publish.defaultStart', {
                    date: schoolDateText(nextMonday(vacancy.today), language),
                  })}
                </Button>
                {shortcuts.map((one) => (
                  <Button
                    key={`${one.date}|${one.text}`}
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setStartsOn(one.date);
                    }}
                  >
                    {one.text}
                  </Button>
                ))}
              </div>
              {all.data !== undefined && offered.length > 1 && (
                <fieldset className="grid gap-1" data-fill-rows="true">
                  <legend className="mb-1 text-sm font-semibold">
                    {t('people.vacancies.fill.rows')}
                  </legend>
                  <label className={CHECKBOX_TARGET}>
                    <input
                      type="checkbox"
                      className={CHECKBOX}
                      checked={picked === null || picked.length === offered.length}
                      onChange={(event) => {
                        setChosen(event.target.checked ? null : []);
                      }}
                    />
                    <span className="text-sm">{t('people.vacancies.fill.allRows')}</span>
                  </label>
                  {offered.map((row) => {
                    const rowKey = vacancyFillRowKeyOf(rowOf(row));
                    const on = picked === null || picked.includes(row);
                    return (
                      <label key={rowKey} className={CHECKBOX_TARGET}>
                        <input
                          type="checkbox"
                          className={CHECKBOX}
                          checked={on}
                          onChange={(event) => {
                            const now = (picked ?? offered).map((one) =>
                              vacancyFillRowKeyOf(rowOf(one)),
                            );
                            const next = event.target.checked
                              ? [...now, rowKey]
                              : now.filter((one) => one !== rowKey);
                            setChosen(next.length === offered.length ? null : next);
                          }}
                        />
                        <span className="text-sm">{rowName(row)}</span>
                      </label>
                    );
                  })}
                </fieldset>
              )}
            </div>
          )}
          {result}
          {fill.isError && <FailureAlert error={fill.error} />}
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="secondary" />}>
            {t('people.vacancies.fill.close')}
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A row of an answer as the check's body names it. */
function rowOf(row: { classId: string | null; groupId: string | null; subjectId: string }) {
  return row.classId === null
    ? { groupId: row.groupId ?? '', subjectId: row.subjectId }
    : { classId: row.classId, subjectId: row.subjectId };
}

/** A row as "class, subject"; a class, group or subject not known falls back to a text without it. */
export function fillRowName(
  t: TFunction,
  language: string,
  row: { classId: string | null; groupId: string | null; subjectId: string },
  units: readonly VacancyFillUnit[],
  subjects: readonly Subject[],
): string {
  const unit = units.find((one) => one.id === (row.classId ?? row.groupId));
  const subject = subjects.find((one) => one.id === row.subjectId);
  return [
    unit === undefined
      ? t('people.vacancies.fill.unknownUnit')
      : unit.kind === 'class'
        ? classDisplayName(unit.grades[0] ?? 0, unit.name)
        : unit.name,
    subject === undefined
      ? t('people.vacancies.fill.unknownSubject')
      : nameOf(subject.names, language),
  ].join(', ');
}

/** The check's answer: the rows, the publish's parts, the close, and Fill. */
function CheckParts({
  answer,
  startsOn,
  rowName,
  subjects,
  tickedKey,
  onTick,
  dayChosen,
  onDayChosen,
  pending,
  onFill,
  body,
}: {
  answer: VacancyFillCheck;
  startsOn: string;
  rowName: (row: VacancyFillRowAnswer) => string;
  subjects: readonly Subject[];
  tickedKey: string | null;
  onTick: (key: string | null) => void;
  dayChosen: {
    key: string | null;
    choices: Record<string, DayChangeChoice>;
    reasons: Record<string, string>;
  };
  onDayChosen: (chosen: {
    key: string | null;
    choices: Record<string, DayChangeChoice>;
    reasons: Record<string, string>;
  }) => void;
  pending: boolean;
  onFill: (body: Parameters<typeof fillVacancy>[0]) => Promise<void>;
  body: VacancyFillCheckBody | null;
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const filled = answer.rows.filter((one) => one.filled);
  const left = answer.rows.filter((one) => !one.filled);
  const publish = answer.publish;
  const names: PublishNames = {
    // The fill's draft is not kept: its rows and lessons are not named here.
    rowName: () => null,
    lessonsText: () => '',
    branchName: () => null,
    subjectName: (id) => {
      const subject = subjects.find((one) => one.id === id);
      return subject === undefined ? null : nameOf(subject.names, language);
    },
  };
  const transitionKey = publish?.impact?.transition?.key ?? null;
  const ticked = transitionKey === null || tickedKey === transitionKey;
  const daysKey = publish?.impact?.dayChanges.key ?? null;
  const dayChoices = dayChosen.key === daysKey ? dayChosen.choices : {};
  const dayReasons = dayChosen.key === daysKey ? dayChosen.reasons : {};
  const settled =
    publish?.impact == null
      ? null
      : dayDecisionsBodyOf(publish.impact.dayChanges, dayChoices, dayReasons);
  const decided = publish?.impact == null || settled !== null;

  return (
    <div className="grid gap-4" data-fill-check="true">
      <section aria-labelledby="fill-rows" className="grid gap-2">
        <h3 id="fill-rows" className={SECTION_TITLE}>
          {t('people.vacancies.fill.rowsTitle')}
        </h3>
        {filled.length > 0 && (
          <ul className="grid gap-1 text-sm" data-rows-filled="true">
            {filled.map((row) => (
              <li key={vacancyFillRowKeyOf(rowOf(row))}>
                {t('people.vacancies.fill.rowFilled', { row: rowName(row) })}
              </li>
            ))}
          </ul>
        )}
        {left.length > 0 && (
          <div className="grid gap-1">
            <h4 className={SUBSECTION_TITLE}>
              {t('people.vacancies.fill.leftTitle', { count: left.length })}
            </h4>
            <ul className="grid gap-1 text-sm" data-rows-left="true">
              {left.map((row) => (
                <li key={vacancyFillRowKeyOf(rowOf(row))} data-reason={row.reason}>
                  {row.reason === 'blocked'
                    ? t('people.vacancies.fill.leftBlocked', {
                        row: rowName(row),
                        dates: row.dates.map((one) => schoolDateText(one, language)).join(', '),
                      })
                    : t('people.vacancies.fill.leftProfile', { row: rowName(row) })}
                </li>
              ))}
            </ul>
          </div>
        )}
        {answer.inPlace && (
          <p className="text-sm" data-in-place="true">
            {t('people.vacancies.fill.inPlace', { date: schoolDateText(startsOn, language) })}
          </p>
        )}
        <p className="text-sm" data-closes={answer.closes ? 'true' : 'false'}>
          {answer.closes
            ? t('people.vacancies.fill.closes', { date: schoolDateText(startsOn, language) })
            : t('people.vacancies.fill.staysOpen')}
        </p>
        {answer.holders.length > 0 && (
          <ul className="grid gap-1 text-sm" data-holders="true">
            {answer.holders.map((one, index) => (
              <li key={index}>
                {one.versionNumber !== null
                  ? t('people.vacancies.fill.holderVersion', { number: one.versionNumber })
                  : one.lessonDate !== null
                    ? t('people.vacancies.fill.holderLesson', {
                        date: schoolDateText(one.lessonDate, language),
                      })
                    : t('people.vacancies.fill.holderOther')}
              </li>
            ))}
          </ul>
        )}
      </section>
      {publish !== null && (
        <>
          <PublishCheckLists answer={publish} names={names} />
          {publish.chain !== null && (
            <PublishChainQuestion
              answer={publish.chain}
              impact={publish.impact}
              chosen="carry"
              onChoose={() => undefined}
              canEdit={false}
              lessonName={(change) => rowName({ ...change, filled: true, reason: null, dates: [] })}
              fixed
            />
          )}
          <PublishShortened
            versionId={null}
            answer={publish}
            canEdit={false}
            className={(classId) => {
              const unit = publish.impact?.names.units.find((one) => one.id === classId);
              return unit === undefined ? null : classDisplayName(unit.grades[0] ?? 0, unit.name);
            }}
            lessonsText={() => ''}
          />
          {publish.impact !== null && (
            <PublishDayChanges
              impact={publish.impact}
              choices={dayChoices}
              reasons={dayReasons}
              canEdit
              onChoose={(itemKey, choice) => {
                onDayChosen({
                  key: daysKey,
                  choices: { ...dayChoices, [itemKey]: choice },
                  reasons: dayReasons,
                });
              }}
              onReason={(itemKey, reason) => {
                onDayChosen({
                  key: daysKey,
                  choices: dayChoices,
                  reasons: { ...dayReasons, [itemKey]: reason },
                });
              }}
            />
          )}
          {publish.impact !== null && (
            <PublishImpact
              impact={publish.impact}
              ticked={ticked}
              canEdit
              onTick={(on) => {
                onTick(on ? transitionKey : null);
              }}
            />
          )}
        </>
      )}
      <div>
        <Button
          disabled={
            publish === null ||
            !publish.canPublish ||
            !ticked ||
            !decided ||
            pending ||
            body === null
          }
          onClick={() => {
            if (publish === null || body === null) return;
            void onFill({
              ...body,
              rowsKey: answer.rowsKey,
              ...(transitionKey === null ? {} : { transitionKey }),
              ...(publish.chain === null ? {} : { laterKey: publish.chain.key }),
              ...(publish.impact === null
                ? {}
                : {
                    dayChangesKey: publish.impact.dayChanges.key,
                    dayDecisions: settled?.dayDecisions ?? [],
                  }),
            });
          }}
        >
          {t('people.vacancies.fill.action')}
        </Button>
        {publish === null && (
          <p className="mt-2 text-sm" data-nothing-filled="true">
            {t('people.vacancies.fill.nothingFilled')}
          </p>
        )}
        {publish !== null && publish.canPublish && !ticked && (
          <p className="mt-2 text-sm" data-tick-needed="true">
            {t('timetable.publish.transition.tickNeeded')}
          </p>
        )}
        {publish !== null && publish.canPublish && !decided && (
          <p className="mt-2 text-sm" data-decision-needed="true">
            {t('timetable.publish.dayChanges.decisionNeeded')}
          </p>
        )}
      </div>
    </div>
  );
}

/** What the fill did, and how it is taken back (`12`: "The last action can be undone"). */
function FillDone({
  fill,
  rowName,
}: {
  fill: VacancyFill;
  rowName: (row: VacancyFillRowAnswer) => string;
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const date = schoolDateText(fill.startsOn, language);
  const left = fill.rows.filter((one) => !one.filled);
  return (
    <section aria-labelledby="fill-done" className="grid gap-2" data-fill-done="true">
      <h3 id="fill-done" className={SECTION_TITLE}>
        {t('people.vacancies.fill.doneTitle')}
      </h3>
      <ul className="grid gap-1 text-sm">
        {fill.rows
          .filter((one) => one.filled)
          .map((row) => (
            <li key={vacancyFillRowKeyOf(rowOf(row))}>
              {t('people.vacancies.fill.rowFilled', { row: rowName(row) })}
            </li>
          ))}
        {left.map((row) => (
          <li key={vacancyFillRowKeyOf(rowOf(row))} data-reason={row.reason}>
            {row.reason === 'blocked'
              ? t('people.vacancies.fill.leftBlocked', {
                  row: rowName(row),
                  dates: row.dates.map((one) => schoolDateText(one, language)).join(', '),
                })
              : t('people.vacancies.fill.leftProfile', { row: rowName(row) })}
          </li>
        ))}
      </ul>
      <p className="text-sm" data-closed={fill.closed ? 'true' : 'false'}>
        {fill.closed
          ? t('people.vacancies.fill.closed', { date })
          : t('people.vacancies.fill.staysOpen')}
      </p>
      <p className="text-sm">{t('people.vacancies.fill.undo', { date })}</p>
    </section>
  );
}
