import { timeText, type PortalExam, type PortalLesson, type PortalMark } from '@sodiq/shared';
import { useTranslation } from 'react-i18next';
import { CloseIcon, EditIcon } from '@/components/icons';
import { SubjectSwatch } from '@/features/setup/subject-colour';
import { cn } from '@/lib/utils';

export type Language = 'uz' | 'ru' | 'en';

export const languageOf = (language: string): Language =>
  language === 'ru' || language === 'en' ? language : 'uz';

/**
 * The look of an attendance mark (docs/design-system.md, This app, Status labels: "1 plain; 0
 * and 3 danger tint; 2 warning tint; 4 and 5 (exempt) muted fill with muted text"). Always the
 * word; exempt never looks like an absence (`10`, What parents see).
 */
const MARK_STYLE: Record<PortalMark, string> = {
  present: 'text-foreground',
  late: 'bg-warning-bg text-warning',
  absent: 'bg-destructive-bg text-destructive',
  skipped: 'bg-destructive-bg text-destructive',
  exempt: 'bg-muted text-muted-foreground',
  unmarked: 'text-muted-foreground',
};

/** An attendance mark as a status label: a rectangle with corner 6 and its word. */
export function MarkLabel({ mark }: { mark: PortalMark }): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-md px-2 py-0.5 text-sm font-semibold',
        MARK_STYLE[mark],
      )}
      data-mark={mark}
    >
      {t(`portal.attendance.marks.${mark}`)}
    </span>
  );
}

/** A row of a day's list: the time at the left, the subject and its line, and an end slot. */
function Row({
  start,
  end,
  children,
  aside,
}: {
  start: number;
  end: number;
  children: React.ReactNode;
  aside?: React.ReactNode;
}): React.JSX.Element {
  return (
    <li className="grid grid-cols-[3.25rem_1fr_auto] items-start gap-x-3 border-b border-border py-3 first:pt-0 last:border-b-0 last:pb-0">
      <span className="grid tabular-nums">
        <span className="font-semibold">{timeText(start)}</span>
        <span className="text-sm text-muted-foreground">{timeText(end)}</span>
      </span>
      <span className="grid min-w-0 gap-0.5">{children}</span>
      <span className="self-center">{aside}</span>
    </li>
  );
}

/**
 * A lesson of the child (`10`: "with rooms and teachers, and changes marked"): the subject in its
 * colour and written, the lesson's number, teacher and room; "Cancelled" and "Changed" in words
 * with their icon, never by colour alone (`12`).
 */
export function LessonRow({
  lesson,
  language,
  mark,
}: {
  lesson: PortalLesson;
  language: Language;
  /** The attendance mark of the lesson, shown at the right (the Today page). */
  mark?: PortalMark | undefined;
}): React.JSX.Element {
  const { t } = useTranslation();
  const cancelled = lesson.state === 'cancelled';
  const line = [
    lesson.lessonNumber === null ? null : t('portal.timetable.lesson', { n: lesson.lessonNumber }),
    lesson.teacher ?? t('portal.timetable.teacherToCome'),
    lesson.room ?? t('portal.timetable.roomToCome'),
  ].filter((one): one is string => one !== null);
  return (
    <Row
      start={lesson.start}
      end={lesson.end}
      aside={mark === undefined || mark === 'unmarked' ? null : <MarkLabel mark={mark} />}
    >
      <span
        className={cn(
          'flex min-w-0 items-center gap-2 font-semibold',
          cancelled && 'text-muted-foreground line-through',
        )}
        data-subject=""
      >
        <SubjectSwatch colour={lesson.subject.colour} />
        <span className="truncate">{lesson.subject.names[language]}</span>
      </span>
      <span className="text-sm text-muted-foreground">{line.join(' · ')}</span>
      {cancelled && (
        <span className="flex items-center gap-1 text-sm font-semibold text-destructive">
          <CloseIcon aria-hidden className="size-4" />
          {lesson.exam ? t('portal.timetable.replacedByExam') : t('portal.timetable.cancelled')}
        </span>
      )}
      {lesson.changed && !cancelled && (
        <span className="flex items-center gap-1 text-sm font-semibold text-warning">
          <EditIcon aria-hidden className="size-4" />
          {t('portal.timetable.changed')}
        </span>
      )}
    </Row>
  );
}

/** An exam the child sits: its title, the subject and the room. */
export function ExamRow({
  exam,
  language,
}: {
  exam: PortalExam;
  language: Language;
}): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <Row start={exam.start} end={exam.end}>
      <span className="flex min-w-0 items-center gap-2 font-semibold">
        {exam.subject !== null && <SubjectSwatch colour={exam.subject.colour} />}
        <span className="truncate">{t('portal.timetable.exam', { title: exam.title })}</span>
      </span>
      <span className="text-sm text-muted-foreground">
        {exam.subject === null ? null : <>{exam.subject.names[language]} · </>}
        {exam.room ?? t('portal.timetable.roomToCome')}
      </span>
    </Row>
  );
}

/** The lessons and exams of a day in time order. */
export function dayItems(
  date: string,
  lessons: readonly PortalLesson[],
  exams: readonly PortalExam[],
): (
  | { start: number; lesson: PortalLesson; exam: null }
  | { start: number; lesson: null; exam: PortalExam }
)[] {
  return [
    ...lessons
      .filter((one) => one.date === date)
      .map((lesson) => ({ start: lesson.start, lesson, exam: null })),
    ...exams
      .filter((one) => one.date === date)
      .map((exam) => ({ start: exam.start, lesson: null, exam })),
  ].sort((a, b) => a.start - b.start);
}
