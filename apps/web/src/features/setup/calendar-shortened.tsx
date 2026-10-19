import { classDisplayName, type CalendarLessons } from '@sodiq/shared';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { CHECKBOX, CHECKBOX_TARGET, SECTION_TITLE } from '@/components/ui/control';
import { schoolDateText } from '@/lib/dates';
import { nameOf } from './setup-api';

type ShortenedDay = CalendarLessons['shortenedDays'][number];

/** The key of a date and class in the ticks. */
export const keepKeyOf = (one: { date: string; classId: string }): string =>
  `${one.date}|${one.classId}`;

/** The choices to send: one per date and class the person ticked, in the shape of the API. */
export function dayKeepsOf(
  ticks: Readonly<Record<string, readonly number[]>>,
): { date: string; classId: string; slotPositions: number[] }[] {
  return Object.entries(ticks)
    .map(([key, positions]) => {
      const [date = '', classId = ''] = key.split('|');
      return { date, classId, slotPositions: [...positions].sort((a, b) => a - b) };
    })
    .sort((a, b) => keepKeyOf(a).localeCompare(keepKeyOf(b)));
}

/** Whether the ticks cannot be saved: a day with more ticked than its lesson slots. */
export function ticksRefused(
  lessons: CalendarLessons,
  ticks: Readonly<Record<string, readonly number[]>>,
): boolean {
  return lessons.shortenedDays.some((day) => {
    const ticked = ticks[keepKeyOf(day)];
    return ticked !== undefined && ticked.length > day.lessonSlots;
  });
}

/**
 * The shortened days of a calendar save over published dates (task 5.6b-2b,
 * pull request #171; `edge/time-dates-calendar`, "A shortened day ... listed
 * per class in the preview. The Academic Vice Principal can choose which
 * lessons are kept"): each class's lessons of the day with those kept ticked;
 * a change of the ticks is sent with the preview again and then with the
 * save. "Back to the default" sends an empty list, which removes a stored
 * choice. The server decides what fits; a tick it cannot take is listed.
 */
export function CalendarShortened({
  lessons,
  ticks,
  onTicks,
  disabled,
}: {
  lessons: CalendarLessons;
  ticks: Readonly<Record<string, readonly number[]>>;
  /** The positions ticked for a date and class. */
  onTicks: (key: string, positions: number[]) => void;
  disabled: boolean;
}): React.JSX.Element | null {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  if (lessons.shortenedDays.length === 0 && lessons.keepRefusals.length === 0) return null;
  const { names } = lessons;

  const unitName = (id: string): string => {
    const unit = names.units.find((one) => one.id === id);
    if (unit === undefined) return t('timetable.publish.shortened.aClass');
    return unit.kind === 'class' ? classDisplayName(unit.grades[0] ?? 0, unit.name) : unit.name;
  };
  const subjectName = (id: string): string => {
    const subject = names.subjects.find((one) => one.id === id);
    return subject === undefined
      ? t('timetable.publish.impact.unknownSubject')
      : nameOf(subject.names, language);
  };
  const dayName = (one: { date: string; classId: string }) =>
    t('timetable.publish.shortened.day', {
      date: schoolDateText(one.date, language),
      class: unitName(one.classId),
    });

  const dayItem = (day: ShortenedDay) => {
    const key = keepKeyOf(day);
    const sent = ticks[key];
    const ticked = sent === undefined || sent.length === 0 ? day.kept : sent;
    const tooMany = ticked.length > day.lessonSlots;
    return (
      <li key={key} className="grid gap-2" data-shortened={key}>
        <p className="text-sm font-semibold">
          {dayName(day)}
          {day.chosen && (
            <span className="ml-2 font-normal" data-chosen="true">
              {t('timetable.publish.shortened.chosen')}
            </span>
          )}
        </p>
        {day.missingPositions.length > 0 && (
          <p className="text-sm" data-missing="true">
            {t('timetable.publish.shortened.missing')}
          </p>
        )}
        <ul className="grid gap-1 text-sm">
          {day.lessons.map((lesson, index) => (
            <li key={lesson.slotPosition}>
              <label className={CHECKBOX_TARGET}>
                <input
                  type="checkbox"
                  className={CHECKBOX}
                  checked={ticked.includes(lesson.slotPosition)}
                  disabled={disabled}
                  onChange={(event) => {
                    const next = event.target.checked
                      ? [...ticked, lesson.slotPosition]
                      : ticked.filter((one) => one !== lesson.slotPosition);
                    // Nothing ticked is no choice: the default stands until a lesson is ticked.
                    if (next.length > 0)
                      onTicks(
                        key,
                        next.sort((a, b) => a - b),
                      );
                  }}
                />
                <span>
                  {t('timetable.publish.shortened.lesson', {
                    number: index + 1,
                    lessons: lesson.subjects
                      .map((one) => `${unitName(one.unitId)} · ${subjectName(one.subjectId)}`)
                      .join(', '),
                  })}
                </span>
              </label>
            </li>
          ))}
        </ul>
        <p className="text-sm" data-kept-count="true">
          {t('timetable.publish.shortened.keeps', { kept: ticked.length, slots: day.lessonSlots })}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {(day.chosen || (sent !== undefined && sent.length > 0)) && (
            <Button
              variant="secondary"
              disabled={disabled}
              onClick={() => {
                onTicks(key, []);
              }}
            >
              {t('timetable.publish.shortened.reset')}
            </Button>
          )}
          {tooMany && (
            <span className="text-sm" data-too-many="true">
              {t('timetable.publish.shortened.tooMany', { slots: day.lessonSlots })}
            </span>
          )}
        </div>
      </li>
    );
  };

  return (
    <section aria-labelledby="calendar-shortened" className="grid gap-2">
      <h3 id="calendar-shortened" className={SECTION_TITLE}>
        {t('timetable.publish.shortened.title', { count: lessons.shortenedDays.length })}
      </h3>
      {lessons.shortenedDays.length > 0 && (
        <ul className="grid gap-4">{lessons.shortenedDays.map(dayItem)}</ul>
      )}
      {lessons.keepRefusals.length > 0 && (
        <ul className="grid gap-1 text-sm" data-keep-refusals="true">
          {lessons.keepRefusals.map((one) => (
            <li key={keepKeyOf(one)}>
              {t('setup.calendar.lessons.keepRefused', {
                day: dayName(one),
                reason: t(`errors.${one.code}`),
              })}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
