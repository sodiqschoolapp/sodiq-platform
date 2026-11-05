import type { JournalLesson, JournalStudent, JournalWork } from '@sodiq/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FIELD } from '@/components/ui/control';
import { SaveSign } from './cell-saves';
import { typedScore } from './journal-grid';
import type { WorksEntry } from './works-entry';

/**
 * A number of one work for one student in lesson mode (`07`, Lesson mode: "attendance, then
 * each classwork, then each homework"; found missing on the test site, 5 November 2026). It
 * saves as the grid does: when the field is left or Enter is pressed, through `works.score`
 * on the version the grid read, and a number over the total or not whole is refused there.
 */
export function LessonModeScore({
  lesson,
  index,
  work,
  workIndex,
  student,
  name,
  works,
  onRefusedNumber,
}: {
  lesson: JournalLesson;
  /** The place of the lesson in the grid: a student's cells follow the grid's lessons. */
  index: number;
  work: JournalWork & { total: number };
  workIndex: number;
  student: JournalStudent;
  /** The work's name in a sentence: the plan's title, or "CW 1" / "HW 1". */
  name: string;
  works: WorksEntry;
  onRefusedNumber: (total: number) => void;
}) {
  const { t } = useTranslation();
  const stored = student.cells[index]?.works[workIndex]?.score ?? null;
  const shown = stored === null ? '' : String(stored);
  // What the person types, until it is sent; the server's value again after each answer.
  const [typed, setTyped] = useState<{ from: string; text: string } | null>(null);
  const text = typed !== null && typed.from === shown ? typed.text : shown;

  const send = () => {
    if (typed === null || typed.from !== shown) return;
    setTyped(null);
    const value = typedScore(typed.text, work.total);
    if (value === undefined) {
      onRefusedNumber(work.total);
      return;
    }
    if (value !== stored) works.score(lesson, work, student, value);
  };

  return (
    <label className="flex items-center gap-1 text-sm" data-lesson-mode-work={work.id ?? ''}>
      <span className="text-muted-foreground">{name}</span>
      <input
        className={`${FIELD} w-16 text-center`}
        inputMode="numeric"
        aria-label={t('journal.lessonMode.score', {
          work: name,
          name: `${student.lastName} ${student.firstName}`,
        })}
        value={text}
        disabled={works.busy}
        onChange={(event) => {
          setTyped({ from: shown, text: event.target.value });
        }}
        onBlur={send}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            send();
          }
        }}
      />
      <span className="text-muted-foreground">
        {t('journal.lessonMode.outOf', { total: work.total })}
      </span>
      <SaveSign state={works.stateOf(lesson.id, student.id, work)} />
    </label>
  );
}
