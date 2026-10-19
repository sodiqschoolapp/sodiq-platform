import {
  classDisplayName,
  dayDecisionKeyOf,
  type BulkBlockAnswer,
  type BulkItemAnswer,
  type DayChangeChoice,
  type DayChangeItemAnswer,
  type DayChangesAnswer,
  type DayDecisionsBody,
  type PublishImpactAnswer,
} from '@sodiq/shared';
import { useTranslation } from 'react-i18next';
import {
  CHECKBOX,
  CHECKBOX_TARGET,
  SECTION_TITLE,
  SUBSECTION_TITLE,
} from '@/components/ui/control';
import { nameOf } from '@/features/setup/setup-api';
import { rangeText } from '@/features/setup/templates-api';
import { schoolDateText } from '@/lib/dates';
import { ruleText } from './rule-text';

/**
 * The body that settles a sorting with the choices made (task 5.6a-5b-2; a
 * calendar save too, task 5.6b-2a): the key shown and a choice for each
 * "needs a decision" item and each bulk cancel's open block; `null` while
 * one has no choice.
 */
export function dayDecisionsBodyOf(
  dayChanges: DayChangesAnswer,
  choices: Readonly<Record<string, DayChangeChoice>>,
): DayDecisionsBody | null {
  const dayDecisions: NonNullable<DayDecisionsBody['dayDecisions']> = [];
  for (const item of dayChanges.decide) {
    const choice = choices[item.key];
    if (choice !== undefined) dayDecisions.push({ key: item.key, choice });
  }
  const bulkOpen = dayChanges.bulk.flatMap((item) =>
    item.blocks
      .filter((block) => block.choice === null)
      .map((block) => ({ key: item.key, blockId: block.blockId, blockDate: block.blockDate })),
  );
  for (const block of bulkOpen) {
    const choice = choices[dayDecisionKeyOf(block)];
    if (choice !== undefined) dayDecisions.push({ ...block, choice });
  }
  return dayDecisions.length === dayChanges.decide.length + bulkOpen.length
    ? { dayChangesKey: dayChanges.key, dayDecisions }
    : null;
}

/**
 * The stored one-day changes of the dates a publish writes, in step 8 (task
 * 5.6a-5a, pull request #164; `edge/timetable`, Versions and drafts: "The
 * preview sorts them into kept, needs a decision and dropped. Publish waits
 * until every 'needs a decision' item is settled."): each change with its
 * class or group, subject, date, what it does and its reason; for "needs a
 * decision" the rule that blocks it and the two choices (decision 2). The
 * server sorts; this shows its answer and keeps the choices.
 *
 * Task 5.6a-5b-1 (pull request #165): each bulk cancel once, with how many of
 * the new version's lessons lie under it; a block shared with classes not
 * chosen that needs a decision offers the bulk cancel's own two choices,
 * kept by `dayDecisionKeyOf`.
 */
export function PublishDayChanges({
  impact,
  choices,
  onChoose,
  canEdit,
}: {
  /** The sorting and its names: a publish's impact, or a withdraw's check (task 5.6a-5b-2). */
  impact: Pick<PublishImpactAnswer, 'names' | 'dayChanges'> &
    Partial<Pick<PublishImpactAnswer, 'carried'>>;
  choices: Readonly<Record<string, DayChangeChoice>>;
  onChoose: (key: string, choice: DayChangeChoice) => void;
  canEdit: boolean;
}): React.JSX.Element | null {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const { names, dayChanges } = impact;
  const bulkKept = dayChanges.bulk.filter((one) => one.category === 'kept');
  const bulkDecide = dayChanges.bulk.filter((one) => one.category === 'decide');
  if (
    dayChanges.kept.length === 0 &&
    dayChanges.decide.length === 0 &&
    dayChanges.dropped.length === 0 &&
    dayChanges.bulk.length === 0
  ) {
    return null;
  }

  const unitName = (id: string): string => {
    const unit = names.units.find((one) => one.id === id);
    if (unit === undefined) return t('timetable.publish.impact.unknownUnit');
    return unit.kind === 'class' ? classDisplayName(unit.grades[0] ?? 0, unit.name) : unit.name;
  };
  const subjectName = (id: string): string => {
    const subject = names.subjects.find((one) => one.id === id);
    return subject === undefined
      ? t('timetable.publish.impact.unknownSubject')
      : nameOf(subject.names, language);
  };
  const roomName = (id: string | null): string =>
    id === null
      ? t('timetable.publish.impact.unknownRoom')
      : (names.rooms.find((one) => one.id === id)?.name ??
        t('timetable.publish.impact.unknownRoom'));
  const versionNumber = (id: string | null): number | null =>
    id === null
      ? null
      : ((impact.carried ?? []).find((one) => one.versionId === id)?.number ?? null);

  const itemText = (item: DayChangeItemAnswer): string => {
    const date = schoolDateText(item.from.date, language);
    const time = rangeText(t, item.from.start, item.from.end);
    const change =
      item.kind === 'cancel'
        ? t('timetable.publish.dayChanges.cancel')
        : item.kind === 'room'
          ? t('timetable.publish.dayChanges.room', { room: roomName(item.to.roomId) })
          : t('timetable.publish.dayChanges.move', {
              date: schoolDateText(item.to.date, language),
              time: rangeText(t, item.to.start, item.to.end),
            });
    const number = versionNumber(item.carriedVersionId);
    return [
      `${unitName(item.unitId)}, ${subjectName(item.subjectId)}`,
      `${date} ${time}`,
      change,
      t('timetable.publish.dayChanges.reason', { reason: item.reason }),
      number === null ? null : t('timetable.publish.dayChanges.inVersion', { number }),
    ]
      .filter(Boolean)
      .join('. ');
  };

  const classesText = (ids: readonly string[]): string => ids.map(unitName).join(', ');
  const bulkText = (item: BulkItemAnswer): string => {
    const number = versionNumber(item.carriedVersionId);
    return [
      t('timetable.publish.dayChanges.bulk', {
        classes: classesText(item.classIds),
        date: schoolDateText(item.date, language),
      }),
      t('timetable.publish.dayChanges.bulkLessons', { count: item.cancelled }),
      t('timetable.publish.dayChanges.reason', { reason: item.reason }),
      number === null ? null : t('timetable.publish.dayChanges.inVersion', { number }),
    ]
      .filter(Boolean)
      .join('. ');
  };
  const blockText = (block: BulkBlockAnswer): string =>
    t('timetable.publish.dayChanges.bulkBlock', {
      lessons: block.lessons
        .map((one) => `${unitName(one.unitId)}, ${subjectName(one.subjectId)}`)
        .join('; '),
      time: rangeText(t, block.start, block.end),
      classes: classesText(block.otherClassIds),
    });
  const bulkLine = (item: BulkItemAnswer): React.JSX.Element => (
    <li
      key={`bulk-${item.key}-${item.carriedVersionId ?? ''}`}
      data-key={item.key}
      data-kind="bulk"
    >
      {bulkText(item)}
      {item.blocks.some((one) => one.choice !== null) && (
        <ul className="grid gap-1 ps-4">
          {item.blocks.map((block) =>
            block.choice === null ? null : (
              <li key={`${block.blockId}@${block.blockDate}`}>
                {blockText(block)}: {t(`timetable.publish.dayChanges.bulkKept_${block.choice}`)}
              </li>
            ),
          )}
        </ul>
      )}
    </li>
  );

  const list = (
    category: 'kept' | 'dropped',
    items: readonly DayChangeItemAnswer[],
    bulk: readonly BulkItemAnswer[] = [],
  ): React.JSX.Element | null =>
    items.length + bulk.length === 0 ? null : (
      <div className="grid gap-1">
        <h4 className={SUBSECTION_TITLE}>
          {t(`timetable.publish.dayChanges.${category}Title`, {
            count: items.length + bulk.length,
          })}
        </h4>
        <ul className="grid gap-1 text-sm" data-day-changes={category}>
          {items.map((item) => (
            <li key={item.key} data-key={item.key} data-kind={item.kind}>
              {itemText(item)}
            </li>
          ))}
          {bulk.map(bulkLine)}
        </ul>
      </div>
    );

  return (
    <section aria-labelledby="publish-day-changes" className="grid gap-4">
      <h3 id="publish-day-changes" className={SECTION_TITLE}>
        {t('timetable.publish.dayChanges.title')}
      </h3>
      {dayChanges.decide.length + bulkDecide.length > 0 && (
        <div className="grid gap-2">
          <h4 className={SUBSECTION_TITLE}>
            {t('timetable.publish.dayChanges.decideTitle', {
              count: dayChanges.decide.length + bulkDecide.length,
            })}
          </h4>
          <ul className="grid gap-3 text-sm" data-day-changes="decide">
            {dayChanges.decide.map((item) => (
              <li key={item.key} data-key={item.key} data-kind={item.kind}>
                <fieldset className="grid gap-1">
                  <legend>{itemText(item)}</legend>
                  {item.blocked.length > 0 && (
                    <p data-blocked="true">
                      {item.blocked.map((one) => ruleText(t, one.rule)).join('; ')}
                    </p>
                  )}
                  {(['drop', 'cancel'] as const).map((choice) => (
                    <label key={choice} className={CHECKBOX_TARGET}>
                      <input
                        type="radio"
                        name={`day-change-${item.key}`}
                        className={CHECKBOX}
                        value={choice}
                        disabled={!canEdit}
                        checked={choices[item.key] === choice}
                        onChange={() => {
                          onChoose(item.key, choice);
                        }}
                      />
                      <span>{t(`timetable.publish.dayChanges.choice_${choice}`)}</span>
                    </label>
                  ))}
                </fieldset>
              </li>
            ))}
            {bulkDecide.map((item) => (
              <li
                key={`bulk-${item.key}-${item.carriedVersionId ?? ''}`}
                data-key={item.key}
                data-kind="bulk"
                className="grid gap-2"
              >
                <p>{bulkText(item)}</p>
                {item.blocks.map((block) => {
                  const decisionKey = dayDecisionKeyOf({
                    key: item.key,
                    blockId: block.blockId,
                    blockDate: block.blockDate,
                  });
                  return block.choice !== null ? null : (
                    <fieldset key={decisionKey} className="grid gap-1 ps-4">
                      <legend>{blockText(block)}</legend>
                      {(['cancel', 'keep'] as const).map((choice) => (
                        <label key={choice} className={CHECKBOX_TARGET}>
                          <input
                            type="radio"
                            name={`bulk-block-${decisionKey}`}
                            className={CHECKBOX}
                            value={choice}
                            disabled={!canEdit}
                            checked={choices[decisionKey] === choice}
                            onChange={() => {
                              onChoose(decisionKey, choice);
                            }}
                          />
                          <span>{t(`timetable.publish.dayChanges.bulkChoice_${choice}`)}</span>
                        </label>
                      ))}
                    </fieldset>
                  );
                })}
              </li>
            ))}
          </ul>
        </div>
      )}
      {list('kept', dayChanges.kept, bulkKept)}
      {list('dropped', dayChanges.dropped)}
    </section>
  );
}
