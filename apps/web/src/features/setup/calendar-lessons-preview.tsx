import { classDisplayName, type CalendarLesson, type CalendarLessons } from '@sodiq/shared';
import { useTranslation } from 'react-i18next';
import { SECTION_TITLE, SUBSECTION_TITLE } from '@/components/ui/control';
import { ruleText } from '@/features/timetable/rule-text';
import { schoolDateText } from '@/lib/dates';
import { nameOf } from './setup-api';
import { rangeText } from './templates-api';

/** Whether a calendar save's lessons hold anything to show. */
export function hasLessons(lessons: CalendarLessons): boolean {
  return (
    lessons.removed.length > 0 ||
    lessons.created.length > 0 ||
    lessons.cancelled.length > 0 ||
    lessons.needsTeacher.length > 0 ||
    lessons.blocked.length > 0 ||
    lessons.stored.length > 0
  );
}

/** Whether the server will refuse the save: a blocked conflict or a stored record (task 5.6b-1). */
export function refusesSave(lessons: CalendarLessons): boolean {
  return lessons.blocked.length > 0 || lessons.stored.length > 0;
}

/**
 * What a calendar save does to the published timetable (task 5.6b-1;
 * `edge/time-dates-calendar`: "the impact preview is shown first"): the
 * lessons removed, created and created cancelled with the reason, those that
 * will need a teacher, how many teachers are told, and what refuses the
 * save: the blocked conflicts by date and the stored records of those dates.
 * The server decides; this shows its answer.
 */
export function CalendarLessonsPreview({
  lessons,
}: {
  lessons: CalendarLessons;
}): React.JSX.Element | null {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  if (!hasLessons(lessons)) return null;
  const { names } = lessons;

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
  const lessonText = (one: CalendarLesson): string =>
    [
      schoolDateText(one.date, language),
      rangeText(t, one.start, one.end),
      unitName(one.unitId),
      subjectName(one.subjectId),
    ].join(' · ');

  const list = (title: string, lines: readonly { key: string; text: string }[]) =>
    lines.length === 0 ? null : (
      <section className="space-y-1">
        <h3 className={SUBSECTION_TITLE}>{title}</h3>
        <ul className="list-disc space-y-0.5 ps-5 text-sm">
          {lines.map((line) => (
            <li key={line.key}>{line.text}</li>
          ))}
        </ul>
      </section>
    );

  return (
    <div className="space-y-3" data-testid="calendar-lessons">
      <h2 className={SECTION_TITLE}>{t('setup.calendar.lessons.title')}</h2>
      {list(
        t('setup.calendar.lessons.stored', { count: lessons.stored.length }),
        lessons.stored.map((one) => ({
          key: `${one.kind}-${one.id}`,
          text: `${schoolDateText(one.date, language)} · ${t(`setup.calendar.lessons.storedKinds.${one.kind}`)}`,
        })),
      )}
      {list(
        t('setup.calendar.lessons.blocked', { count: lessons.blocked.length }),
        lessons.blocked.map((one, index) => ({
          key: `${one.date}-${one.rule}-${String(index)}`,
          text: [
            schoolDateText(one.date, language),
            ruleText(t, one.rule),
            ...one.lessons.map(
              (lesson) => `${unitName(lesson.unitId)} ${subjectName(lesson.subjectId)}`,
            ),
          ].join(' · '),
        })),
      )}
      {list(
        t('setup.calendar.lessons.removed', { count: lessons.removed.length }),
        lessons.removed.map((one, index) => ({
          key: `removed-${String(index)}`,
          text: lessonText(one),
        })),
      )}
      {list(
        t('setup.calendar.lessons.created', { count: lessons.created.length }),
        lessons.created.map((one, index) => ({
          key: `created-${String(index)}`,
          text: lessonText(one),
        })),
      )}
      {list(
        t('setup.calendar.lessons.cancelled', { count: lessons.cancelled.length }),
        lessons.cancelled.map((one, index) => ({
          key: `cancelled-${String(index)}`,
          text: `${lessonText(one)} · ${t(`setup.calendar.lessons.causes.${one.cause}`)}`,
        })),
      )}
      {list(
        t('setup.calendar.lessons.needsTeacher', { count: lessons.needsTeacher.length }),
        lessons.needsTeacher.map((one, index) => ({
          key: `needs-${String(index)}`,
          text: [
            schoolDateText(one.date, language),
            unitName(one.unitId),
            subjectName(one.subjectId),
            t(`timetable.publish.needsTeacher.${one.reason}`),
          ].join(' · '),
        })),
      )}
      {lessons.notified.length > 0 && (
        <p className="text-sm">
          {t('setup.calendar.lessons.notified', { count: lessons.notified.length })}
        </p>
      )}
      {refusesSave(lessons) && (
        <p className="text-sm font-medium text-destructive" role="alert">
          {t('setup.calendar.lessons.refused')}
        </p>
      )}
    </div>
  );
}
