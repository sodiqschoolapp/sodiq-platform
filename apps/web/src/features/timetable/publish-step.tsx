import {
  classDisplayName,
  type CarryChangeAnswer,
  type DayChangeChoice,
  type LoadRow,
  type PublishChain,
  type PublishRefusal,
  type RuleResultAnswer,
  type TimetableVersion,
} from '@sodiq/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useConfirm } from '@/components/confirm-dialog';
import { FailureAlert } from '@/components/failure-alert';
import { DateField } from '@/components/field';
import { WarningIcon } from '@/components/icons';
import { ErrorState, LoadingOutline } from '@/components/states';
import { Button } from '@/components/ui/button';
import { SECTION_TITLE } from '@/components/ui/control';
import { useView } from '@/features/access/use-view';
import { nameOf } from '@/features/setup/setup-api';
import { schoolDateText, weekdayName } from '@/lib/dates';
import { numbersText } from './grid-conflicts';
import { PublishChainQuestion } from './publish-chain';
import { dayDecisionsBodyOf, PublishDayChanges } from './publish-day-changes';
import { PublishImpact } from './publish-impact';
import { classNameFrom, PublishShortened } from './publish-shortened';
import { ruleText } from './rule-text';
import {
  gridQuery,
  invalidateTimetable,
  loadQuery,
  publishCheckQuery,
  publishVersion,
} from './timetable-api';

/** The class or group of a row as a person reads it. */
const unitOf = (row: LoadRow): string =>
  row.unit.kind === 'class'
    ? classDisplayName(row.unit.grades[0] ?? 0, row.unit.name)
    : row.unit.name;

/**
 * Step 8 of the builder, "Review and publish" (`06`, Building a timetable;
 * Editing in the grid: "Publish: confirm the start date set at step 1, or
 * change it — next Monday by default, the first day of a coming quarter as a
 * shortcut, or any date"; task 5.5a-1, pull request #139): the start date,
 * every reason the draft cannot be published on it and the warnings, then
 * Publish after a confirmation. The server decides; this shows its check.
 * Task 5.5a-2a: the reasons and warnings of a date, the lessons the day cannot
 * hold and those that will need a teacher, each with its date. Task
 * 5.5a-2b-2: the lessons kept on a shortened day.
 */
export function PublishStep({
  version,
  canEdit,
  onOpenGrid,
}: {
  version: TimetableVersion;
  canEdit: boolean;
  onOpenGrid: () => void;
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const { branchId } = useView();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [startsOn, setStartsOn] = useState(version.startsOn);
  // One key per publish the person asks for: a retry of the same click repeats it harmlessly.
  const key = useRef<string | null>(null);
  // Task 5.5a-2b-1: the transition key ticked; a new answer with another key is not ticked.
  const [tickedKey, setTickedKey] = useState<string | null>(null);
  // Task 5.5a-3a: the answer to the later published versions, chosen by the person.
  const [chain, setChain] = useState<PublishChain | null>(null);
  // Task 5.6a-5a: the choice for each "needs a decision" one-day change, by
  // its key, for the sorting of one key: a new sorting starts with none.
  const [dayChosen, setDayChosen] = useState<{
    key: string | null;
    choices: Record<string, DayChangeChoice>;
    /** Task 5.6c-3a: the reasons typed for exams' choices. */
    reasons: Record<string, string>;
  }>({ key: null, choices: {}, reasons: {} });
  const check = useQuery(
    publishCheckQuery(branchId, version.id, startsOn === '' ? null : startsOn, chain),
  );
  const load = useQuery(loadQuery(branchId, version.id));
  // The load row of each pattern entry, and the other branches' names, for the lists of dates.
  const grid = useQuery(gridQuery(branchId, version.id));
  const publish = useMutation({
    mutationFn: ({
      date,
      transitionKey,
      answered,
      days,
    }: {
      date: string;
      transitionKey: string | null;
      answered: { chain: PublishChain; laterKey: string } | null;
      days: {
        dayChangesKey: string;
        dayDecisions: {
          key: string;
          blockId?: string;
          blockDate?: string;
          choice: DayChangeChoice;
          reason?: string;
        }[];
      } | null;
    }) => {
      key.current ??= crypto.randomUUID();
      return publishVersion(version.id, date, key.current, transitionKey, answered, days);
    },
    onSettled: async () => {
      key.current = null;
      await invalidateTimetable(queryClient);
    },
  });

  if (version.status === 'published') {
    return (
      <p className="text-sm font-semibold" data-published="true">
        {t('timetable.publish.published', { date: schoolDateText(version.startsOn, language) })}
      </p>
    );
  }
  if (version.status !== 'draft') {
    return <p className="text-sm">{t('timetable.publish.notDraft')}</p>;
  }

  const rows = load.data?.rows ?? [];
  const rowName = (id: string | undefined): string | null => {
    const row = rows.find((one) => one.id === id);
    return row === undefined ? null : `${unitOf(row)}, ${nameOf(row.subject.names, language)}`;
  };
  const entryRow = new Map(
    (grid.data?.blocks ?? []).flatMap((block) =>
      block.lessons.map((lesson) => [lesson.id, lesson.loadRowId] as const),
    ),
  );
  /** The lessons of entries as their rows read, joined. */
  const lessonsText = (entryIds: readonly string[]): string =>
    [...new Set(entryIds.flatMap((id) => rowName(entryRow.get(id)) ?? []))].join('; ');
  const branchName = (id: string | number | undefined): string | null =>
    grid.data?.facts.branches.find((one) => one.id === id)?.name ?? null;
  /** A result of a date: its date, its rule, its lessons and another branch it meets. */
  const datedText = (result: RuleResultAnswer): string => {
    const other = result.detail?.['branchId'];
    const branch = branchName(other);
    return [
      t('timetable.publish.refusals.date_blocked', {
        date: schoolDateText(result.date ?? '', language),
        rule: ruleText(t, result.rule),
      }),
      lessonsText(result.lessonIds),
      other === undefined
        ? null
        : branch === null
          ? t('timetable.publish.busyInAnother')
          : t('timetable.publish.busyIn', { branch }),
    ]
      .filter(Boolean)
      .join('. ');
  };
  const subjectName = (id: string | undefined): string | null => {
    const row = rows.find((one) => one.subject.id === id);
    return row === undefined ? null : nameOf(row.subject.names, language);
  };

  /** One reason in words; a row or subject the load no longer holds falls back to a text without its name. */
  const refusalText = (refusal: PublishRefusal): string => {
    switch (refusal.code) {
      case 'draft_not_ready':
        return t('timetable.publish.refusals.draft_not_ready', {
          step: t(`timetable.builder.steps.${refusal.step ?? 'templates'}`),
        });
      case 'load_problem': {
        const name = rowName(refusal.loadRowId);
        const problem =
          refusal.problem === undefined ? '' : t(`timetable.load.problems.${refusal.problem}`);
        return name === null
          ? t('timetable.publish.refusals.load_problem_row', { problem })
          : t('timetable.publish.refusals.load_problem', { row: name, problem });
      }
      case 'load_vacancy_closed': {
        const name = rowName(refusal.loadRowId);
        return name === null
          ? t('timetable.publish.refusals.load_vacancy_closed_row')
          : t('timetable.publish.refusals.load_vacancy_closed', { row: name });
      }
      case 'load_mismatch': {
        const name = rowName(refusal.loadRowId);
        const placed = refusal.result?.detail?.['placed'];
        const wanted = refusal.result?.detail?.['lessonsPerWeek'];
        const numbers =
          typeof placed === 'number' && typeof wanted === 'number'
            ? t('timetable.publish.placedOf', { count: wanted, placed })
            : '';
        return name === null
          ? t('timetable.publish.refusals.load_mismatch_row', { numbers })
          : t('timetable.publish.refusals.load_mismatch', { row: name, numbers });
      }
      case 'pattern_blocked': {
        const result = refusal.result;
        if (result === undefined) return t('timetable.publish.refusals.pattern_blocked_any');
        const day = result.weekday === null ? null : weekdayName(language, result.weekday);
        const numbers = numbersText(t, language, result);
        const rule = ruleText(t, result.rule);
        return [day === null ? rule : `${day}: ${rule}`, numbers].filter(Boolean).join('. ');
      }
      case 'subject_daily_weights': {
        const name = subjectName(refusal.subjectId);
        return name === null
          ? t('timetable.publish.refusals.subject_daily_weights_any')
          : t('timetable.publish.refusals.subject_daily_weights', { subject: name });
      }
      case 'subject_quarter_weights': {
        const name = subjectName(refusal.subjectId);
        const quarter = refusal.quarter ?? 1;
        return name === null
          ? t('timetable.publish.refusals.subject_quarter_weights_any', { quarter })
          : t('timetable.publish.refusals.subject_quarter_weights', { subject: name, quarter });
      }
      case 'date_blocked':
        return refusal.result === undefined
          ? t('timetable.publish.refusals.pattern_blocked_any')
          : datedText(refusal.result);
      case 'version_later_published':
        return t('timetable.publish.refusals.version_later_published', {
          number: refusal.versionNumber ?? 0,
        });
      case 'chain_start_taken':
        return t('timetable.publish.refusals.chain_start_taken', {
          number: refusal.versionNumber ?? 0,
        });
      case 'chain_carry_not_offered':
      case 'chain_changed':
      case 'day_change_undecided':
      case 'day_decision_unknown':
      case 'day_changes_changed':
      case 'day_choice_not_offered':
      case 'transition_unacknowledged':
      case 'version_start_too_early':
      case 'version_start_outside_year':
      case 'draft_out_of_date':
      case 'year_quarters':
        return t(`timetable.publish.refusals.${refusal.code}`);
    }
  };

  const answer = check.data;
  let body;
  if (check.isError) {
    body = (
      <ErrorState
        error={check.error}
        onRetry={() => {
          void check.refetch();
        }}
      />
    );
  } else if (answer === undefined) {
    body = <LoadingOutline lines={4} />;
  } else {
    const transitionKey = answer.impact?.transition?.key ?? null;
    // A choice counts only while later versions are shown; the key goes with it.
    const answered =
      answer.chain === null || chain === null ? null : { chain, laterKey: answer.chain.key };
    /** The class or group and subject of a change to carry, from the draft's load. */
    const changeLesson = (change: CarryChangeAnswer): string => {
      const row = rows.find(
        (one) =>
          one.subject.id === change.subjectId && one.unit.id === (change.classId ?? change.groupId),
      );
      return row === undefined
        ? t('timetable.publish.impact.unknownSubject')
        : `${unitOf(row)}, ${nameOf(row.subject.names, language)}`;
    };
    const ticked = transitionKey === null || tickedKey === transitionKey;
    // Task 5.6a-5a: a choice counts only for an item shown now.
    const daysKey = answer.impact?.dayChanges.key ?? null;
    const dayChoices = dayChosen.key === daysKey ? dayChosen.choices : {};
    const dayReasons = dayChosen.key === daysKey ? dayChosen.reasons : {};
    // Task 5.6c-3a: the one-day changes, bulk cancels and exams settled
    // together; `null` while one still needs a choice or a reason.
    const settled =
      answer.impact === null
        ? null
        : dayDecisionsBodyOf(answer.impact.dayChanges, dayChoices, dayReasons);
    const decided = answer.impact === null || settled !== null;
    const days =
      answer.impact === null
        ? null
        : {
            dayChangesKey: answer.impact.dayChanges.key,
            dayDecisions: settled?.dayDecisions ?? [],
          };
    const blocked = answer.refusals.some(
      (one) => one.code === 'pattern_blocked' || one.code === 'date_blocked',
    );
    body = (
      <div className="grid gap-4">
        {answer.refusals.length === 0 ? (
          <p className="text-sm font-semibold" data-can-publish="true">
            {t('timetable.publish.nothingRefused')}
          </p>
        ) : (
          <section aria-labelledby="publish-refusals" className="grid gap-2">
            <h3 id="publish-refusals" className={SECTION_TITLE}>
              {t('timetable.publish.refusalsTitle', { count: answer.refusals.length })}
            </h3>
            <ul className="grid gap-1 text-sm" data-refusals="true">
              {answer.refusals.map((refusal, index) => (
                <li key={index} data-code={refusal.code}>
                  {refusalText(refusal)}
                </li>
              ))}
            </ul>
            {blocked && (
              <div>
                <Button variant="secondary" onClick={onOpenGrid}>
                  {t('timetable.publish.openGrid')}
                </Button>
              </div>
            )}
          </section>
        )}
        {answer.warnings.length > 0 && (
          <section aria-labelledby="publish-warnings" className="grid gap-2">
            <h3 id="publish-warnings" className={SECTION_TITLE}>
              {t('timetable.publish.warningsTitle', { count: answer.warnings.length })}
            </h3>
            <ul className="grid gap-1 text-sm">
              {answer.warnings.map((result, index) => (
                <li key={index} className="flex items-start gap-2">
                  <WarningIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                  <span data-date={result.date}>
                    {result.date === undefined
                      ? [
                          result.weekday === null ? null : weekdayName(language, result.weekday),
                          ruleText(t, result.rule),
                        ]
                          .filter(Boolean)
                          .join(': ')
                      : datedText(result)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {answer.needsTeacher.length > 0 && (
          <section aria-labelledby="publish-needs-teacher" className="grid gap-2">
            <h3 id="publish-needs-teacher" className={SECTION_TITLE}>
              {t('timetable.publish.needsTeacherTitle', { count: answer.needsTeacher.length })}
            </h3>
            <p className="text-sm">{t('timetable.publish.needsTeacherNote')}</p>
            <ul className="grid gap-1 text-sm" data-needs-teacher="true">
              {answer.needsTeacher.map((one) => (
                <li key={`${one.entryId}@${one.date}`} data-reason={one.reason}>
                  {[
                    schoolDateText(one.date, language),
                    lessonsText([one.entryId]),
                    t(`timetable.publish.needsTeacher.${one.reason}`),
                  ]
                    .filter(Boolean)
                    .join(': ')}
                </li>
              ))}
            </ul>
          </section>
        )}
        {answer.cancelledLessons.length > 0 && (
          <section aria-labelledby="publish-cancelled" className="grid gap-2">
            <h3 id="publish-cancelled" className={SECTION_TITLE}>
              {t('timetable.publish.cancelledTitle', {
                count: answer.cancelledLessons.reduce((sum, one) => sum + one.entryIds.length, 0),
              })}
            </h3>
            <p className="text-sm">{t('timetable.publish.cancelledNote')}</p>
            <ul className="grid gap-1 text-sm" data-cancelled="true">
              {answer.cancelledLessons.map((one, index) => (
                <li key={index} data-reason={one.reason}>
                  {[
                    schoolDateText(one.date, language),
                    lessonsText(one.entryIds),
                    t(`timetable.publish.cancelled.${one.reason}`),
                  ]
                    .filter(Boolean)
                    .join(': ')}
                </li>
              ))}
            </ul>
          </section>
        )}
        {answer.chain !== null && (
          <PublishChainQuestion
            answer={answer.chain}
            impact={answer.impact}
            chosen={chain}
            onChoose={setChain}
            canEdit={canEdit}
            lessonName={changeLesson}
          />
        )}
        <PublishShortened
          versionId={version.id}
          answer={answer}
          canEdit={canEdit}
          className={classNameFrom([
            ...rows.map((row) => row.unit),
            ...(answer.impact?.names.units ?? []),
          ])}
          lessonsText={lessonsText}
        />
        {answer.impact !== null && (
          <PublishDayChanges
            impact={answer.impact}
            choices={dayChoices}
            reasons={dayReasons}
            canEdit={canEdit}
            onChoose={(itemKey, choice) => {
              setDayChosen({
                key: daysKey,
                choices: { ...dayChoices, [itemKey]: choice },
                reasons: dayReasons,
              });
            }}
            onReason={(itemKey, reason) => {
              setDayChosen({
                key: daysKey,
                choices: dayChoices,
                reasons: { ...dayReasons, [itemKey]: reason },
              });
            }}
          />
        )}
        {answer.impact !== null && (
          <PublishImpact
            impact={answer.impact}
            ticked={ticked}
            canEdit={canEdit}
            onTick={(on) => {
              setTickedKey(on ? transitionKey : null);
            }}
          />
        )}
        {publish.isError && <FailureAlert error={publish.error} />}
        {canEdit && (
          <div>
            <Button
              disabled={!answer.canPublish || !ticked || !decided || publish.isPending}
              onClick={() => {
                void (async () => {
                  if (
                    await confirm({
                      title: t('timetable.publish.confirmTitle', { number: version.number }),
                      text: t('timetable.publish.confirmText', {
                        date: schoolDateText(startsOn, language),
                      }),
                      action: t('timetable.publish.action'),
                    })
                  ) {
                    publish.mutate({
                      date: startsOn,
                      transitionKey,
                      answered,
                      days,
                    });
                  }
                })();
              }}
            >
              {t('timetable.publish.action')}
            </Button>
            {answer.canPublish && !ticked && (
              <p className="mt-2 text-sm" data-tick-needed="true">
                {t('timetable.publish.transition.tickNeeded')}
              </p>
            )}
            {answer.canPublish && !decided && (
              <p className="mt-2 text-sm" data-decision-needed="true">
                {t('timetable.publish.dayChanges.decisionNeeded')}
              </p>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <div className="max-w-56">
          <DateField
            label={t('timetable.publish.startsOn')}
            name="publishStartsOn"
            value={startsOn}
            min={answer?.earliest}
            disabled={!canEdit}
            onChange={(event) => {
              setStartsOn(event.target.value);
            }}
          />
        </div>
        {canEdit && answer !== undefined && (
          <div className="flex flex-wrap gap-2" aria-label={t('timetable.publish.shortcuts')}>
            <Button
              variant="secondary"
              onClick={() => {
                setStartsOn(answer.defaultStart);
              }}
            >
              {t('timetable.publish.defaultStart', {
                date: schoolDateText(answer.defaultStart, language),
              })}
            </Button>
            {answer.quarterStarts.map((date) => (
              <Button
                key={date}
                variant="secondary"
                onClick={() => {
                  setStartsOn(date);
                }}
              >
                {t('timetable.publish.quarterStart', { date: schoolDateText(date, language) })}
              </Button>
            ))}
          </div>
        )}
      </div>
      {body}
    </div>
  );
}
