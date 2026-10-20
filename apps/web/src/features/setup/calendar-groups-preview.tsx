import { groupBlockKeyOf, type CalendarGroupBlocks, type CalendarLessons } from '@sodiq/shared';
import { useTranslation } from 'react-i18next';
import { CHECKBOX, CHECKBOX_TARGET, SUBSECTION_TITLE } from '@/components/ui/control';
import { schoolDateText, weekdayName } from '@/lib/dates';
import { rangeText } from './templates-api';

type Choice = CalendarGroupBlocks[number]['choice'];
type Line = CalendarLessons['groupBlocks'][number];

/** The key of a split group's block in the choices: as the server names it. */
export const groupLineKeyOf = (line: {
  weekday: number;
  start: number;
  groupIds: readonly string[];
}): string => groupBlockKeyOf(line);

/** The choices made in the dialog, in the shape of the API, for the blocks listed. */
export function groupBlocksOf(
  lessons: CalendarLessons,
  choices: Readonly<Record<string, Choice>>,
): CalendarGroupBlocks {
  return lessons.groupBlocks.flatMap((line) => {
    const choice = choices[groupLineKeyOf(line)];
    return choice === undefined
      ? []
      : [{ weekday: line.weekday, start: line.start, groupIds: [...line.groupIds], choice }];
  });
}

/** The choice shown for a block: the one made here, else the server's (sent or stored). */
const choiceOf = (line: Line, choices: Readonly<Record<string, Choice>>): Choice | null =>
  choices[groupLineKeyOf(line)] ?? line.choice;

/** Whether the save is refused: a block listed with no choice yet (task 5.6b-3). */
export const groupsRefuseSave = (
  lessons: CalendarLessons,
  choices: Readonly<Record<string, Choice>>,
): boolean => lessons.groupBlocks.some((line) => choiceOf(line, choices) === null);

/**
 * The blocks of two-grade groups a day off for one grade leaves with the
 * other at school (task 5.6b-3; `edge/time-dates-calendar`, "A day off for
 * grade 9 only, and a group joins 9 Edinburgh and 10 Brown"): one choice per
 * block, for every date of the entry: cancel it "day off", or keep it for the
 * grade that has school. A stored choice is shown chosen; the server decides,
 * this shows its answer and sends the choices with the save.
 */
export function CalendarGroupsPreview({
  lessons,
  choices,
  onChoose,
}: {
  lessons: CalendarLessons;
  choices: Readonly<Record<string, Choice>>;
  onChoose: (key: string, choice: Choice) => void;
}): React.JSX.Element | null {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  if (lessons.groupBlocks.length === 0) return null;
  const groupName = (id: string): string =>
    lessons.names.units.find((one) => one.id === id)?.name ??
    t('timetable.publish.impact.unknownUnit');

  return (
    <section className="space-y-2" data-testid="calendar-groups">
      <h4 className={SUBSECTION_TITLE}>{t('setup.calendar.lessons.groups.title')}</h4>
      <ul className="grid gap-3 text-sm">
        {lessons.groupBlocks.map((line) => {
          const key = groupLineKeyOf(line);
          const chosen = choiceOf(line, choices);
          return (
            <li key={key}>
              <fieldset className="grid gap-1" data-block={key}>
                <legend>
                  {t('setup.calendar.lessons.groups.block', {
                    groups: line.groupIds.map(groupName).join(', '),
                    weekday: weekdayName(language, line.weekday),
                    time: rangeText(t, line.start, line.end),
                    dates: line.dates.map((date) => schoolDateText(date, language)).join(', '),
                  })}
                </legend>
                {(['cancel', 'keep'] as const).map((choice) => (
                  <label key={choice} className={CHECKBOX_TARGET}>
                    <input
                      type="radio"
                      name={`group-block-${key}`}
                      className={CHECKBOX}
                      value={choice}
                      checked={chosen === choice}
                      onChange={() => {
                        onChoose(key, choice);
                      }}
                    />
                    <span>
                      {t(`setup.calendar.lessons.groups.choice_${choice}`, {
                        grades: line.gradesAtSchool.join(', '),
                      })}
                    </span>
                  </label>
                ))}
              </fieldset>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
