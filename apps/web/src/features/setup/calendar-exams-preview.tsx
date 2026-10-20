import { classDisplayName, type CalendarExamBlocks, type CalendarLessons } from '@sodiq/shared';
import { useTranslation } from 'react-i18next';
import { CHECKBOX, CHECKBOX_TARGET, SUBSECTION_TITLE } from '@/components/ui/control';
import { ruleText } from '@/features/timetable/rule-text';
import { schoolDateText } from '@/lib/dates';
import { nameOf } from './setup-api';
import { rangeText, slotTimeText } from './templates-api';

type Choice = CalendarExamBlocks[number]['choice'];

/** The key of an exam, a sitting class and a shared block (its first minute) in the choices. */
export const examBlockKeyOf = (examId: string, classId: string, start: number): string =>
  `${examId}|${classId}|${String(start)}`;

/** The choices to send, in the shape of the API. */
export function examBlocksOf(choices: Readonly<Record<string, Choice>>): CalendarExamBlocks {
  return Object.entries(choices)
    .map(([key, choice]) => {
      const [examId = '', classId = '', start = '0'] = key.split('|');
      return { examId, classId, start: Number(start), choice };
    })
    .sort((a, b) =>
      examBlockKeyOf(a.examId, a.classId, a.start).localeCompare(
        examBlockKeyOf(b.examId, b.classId, b.start),
      ),
    );
}

/**
 * Whether the save is refused for its exams: an exam refused, or a shared
 * block newly under one with no choice yet (task 5.6b-2c-1).
 */
export function examsRefuseSave(
  lessons: CalendarLessons,
  choices: Readonly<Record<string, Choice>>,
): boolean {
  return lessons.exams.some(
    (exam) =>
      exam.outcome === 'refused' ||
      exam.blocks.some(
        (block) => choices[examBlockKeyOf(exam.id, block.classId, block.start)] === undefined,
      ),
  );
}

/**
 * The exams on the dates a calendar save writes (task 5.6b-2c-1;
 * `edge/timetable`, Exams): each as the save leaves it (cancelled for a day
 * off, moved with its slots, kept, refused with the reason) and, for a
 * sitting class whose lesson the save newly puts in a block shared with
 * classes that do not sit, the two choices of the Exams row. The server
 * decides; this shows its answer and sends the choices with the save.
 */
export function CalendarExamsPreview({
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
  if (lessons.exams.length === 0) return null;
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

  return (
    <section className="space-y-2" data-testid="calendar-exams">
      <h4 className={SUBSECTION_TITLE}>{t('setup.calendar.lessons.exams.title')}</h4>
      <ul className="grid gap-3 text-sm">
        {lessons.exams.map((exam) => (
          <li key={exam.id} data-exam={exam.id} data-outcome={exam.outcome}>
            <p>
              {[
                schoolDateText(exam.date, language),
                rangeText(t, exam.before.start, exam.before.end),
                exam.title,
                exam.outcome === 'moved' && exam.after !== null
                  ? t('setup.calendar.lessons.exams.outcomes.moved', {
                      time: rangeText(t, exam.after.start, exam.after.end),
                    })
                  : t(`setup.calendar.lessons.exams.outcomes.${exam.outcome}`),
                ...(exam.code === null
                  ? []
                  : [t(`setup.calendar.lessons.exams.codes.${exam.code}`)]),
              ].join(' · ')}
            </p>
            {exam.blockedRules.length > 0 && (
              <p className="text-destructive" data-blocked="true">
                {t('setup.calendar.lessons.exams.blocked', {
                  rules: exam.blockedRules.map((rule) => ruleText(t, rule)).join('; '),
                })}
              </p>
            )}
            {exam.blocks.map((block) => {
              const key = examBlockKeyOf(exam.id, block.classId, block.start);
              const unit = unitName(block.classId);
              return (
                <fieldset key={key} className="mt-1 grid gap-1" data-block={key}>
                  <legend>
                    {t('setup.calendar.lessons.exams.block', {
                      unit,
                      // A class can have two shared blocks under one exam: each
                      // is named by its time.
                      lessons: `${slotTimeText(t, block.start)} ${block.lessons
                        .map(
                          (lesson) => `${unitName(lesson.unitId)} ${subjectName(lesson.subjectId)}`,
                        )
                        .join(', ')}`,
                    })}
                  </legend>
                  {(['cancel', 'keep'] as const).map((choice) => (
                    <label key={choice} className={CHECKBOX_TARGET}>
                      <input
                        type="radio"
                        name={`exam-block-${key}`}
                        className={CHECKBOX}
                        value={choice}
                        checked={choices[key] === choice}
                        onChange={() => {
                          onChoose(key, choice);
                        }}
                      />
                      <span>{t(`setup.calendar.lessons.exams.choice_${choice}`, { unit })}</span>
                    </label>
                  ))}
                </fieldset>
              );
            })}
          </li>
        ))}
      </ul>
    </section>
  );
}
