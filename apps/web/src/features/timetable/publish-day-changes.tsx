import {
  classDisplayName,
  type DayChangeChoice,
  type DayChangeItemAnswer,
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
 * The stored one-day changes of the dates a publish writes, in step 8 (task
 * 5.6a-5a, pull request #164; `edge/timetable`, Versions and drafts: "The
 * preview sorts them into kept, needs a decision and dropped. Publish waits
 * until every 'needs a decision' item is settled."): each change with its
 * class or group, subject, date, what it does and its reason; for "needs a
 * decision" the rule that blocks it and the two choices (decision 2). The
 * server sorts; this shows its answer and keeps the choices.
 */
export function PublishDayChanges({
  impact,
  choices,
  onChoose,
  canEdit,
}: {
  impact: PublishImpactAnswer;
  choices: Readonly<Record<string, DayChangeChoice>>;
  onChoose: (key: string, choice: DayChangeChoice) => void;
  canEdit: boolean;
}): React.JSX.Element | null {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const { names, dayChanges } = impact;
  if (
    dayChanges.kept.length === 0 &&
    dayChanges.decide.length === 0 &&
    dayChanges.dropped.length === 0
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
    id === null ? null : (impact.carried.find((one) => one.versionId === id)?.number ?? null);

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

  const list = (
    category: 'kept' | 'dropped',
    items: readonly DayChangeItemAnswer[],
  ): React.JSX.Element | null =>
    items.length === 0 ? null : (
      <div className="grid gap-1">
        <h4 className={SUBSECTION_TITLE}>
          {t(`timetable.publish.dayChanges.${category}Title`, { count: items.length })}
        </h4>
        <ul className="grid gap-1 text-sm" data-day-changes={category}>
          {items.map((item) => (
            <li key={item.key} data-key={item.key} data-kind={item.kind}>
              {itemText(item)}
            </li>
          ))}
        </ul>
      </div>
    );

  return (
    <section aria-labelledby="publish-day-changes" className="grid gap-4">
      <h3 id="publish-day-changes" className={SECTION_TITLE}>
        {t('timetable.publish.dayChanges.title')}
      </h3>
      {dayChanges.decide.length > 0 && (
        <div className="grid gap-2">
          <h4 className={SUBSECTION_TITLE}>
            {t('timetable.publish.dayChanges.decideTitle', { count: dayChanges.decide.length })}
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
          </ul>
        </div>
      )}
      {list('kept', dayChanges.kept)}
      {list('dropped', dayChanges.dropped)}
    </section>
  );
}
