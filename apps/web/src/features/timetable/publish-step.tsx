import {
  classDisplayName,
  type CarryChangeAnswer,
  type DayChangeChoice,
  type LoadRow,
  type PublishChain,
  type TimetableVersion,
} from '@sodiq/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useConfirm } from '@/components/confirm-dialog';
import { FailureAlert } from '@/components/failure-alert';
import { DateField } from '@/components/field';
import { ErrorState, LoadingOutline } from '@/components/states';
import { Button } from '@/components/ui/button';
import { useView } from '@/features/access/use-view';
import { nameOf } from '@/features/setup/setup-api';
import { schoolDateText } from '@/lib/dates';
import { PublishCheckLists, type PublishNames } from './publish-check-parts';
import { PublishChainQuestion } from './publish-chain';
import { dayDecisionsBodyOf, PublishDayChanges } from './publish-day-changes';
import { PublishImpact } from './publish-impact';
import { classNameFrom, PublishShortened } from './publish-shortened';
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
  const subjectName = (id: string | undefined): string | null => {
    const row = rows.find((one) => one.subject.id === id);
    return row === undefined ? null : nameOf(row.subject.names, language);
  };
  const names: PublishNames = { rowName, lessonsText, branchName, subjectName };

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
    body = (
      <div className="grid gap-4">
        <PublishCheckLists answer={answer} names={names} onOpenGrid={onOpenGrid} />
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
