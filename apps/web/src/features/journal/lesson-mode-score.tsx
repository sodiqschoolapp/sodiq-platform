import type { JournalLesson, JournalStudent, JournalWork } from '@sodiq/shared';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FIELD } from '@/components/ui/control';
import { cn } from '@/lib/utils';
import { SaveSign } from './cell-saves';
import { typedScore } from './journal-grid';
import { useWorkLabel } from './work-kind-tag';
import type { WorksEntry } from './works-entry';

/**
 * A number of one work for one student in lesson mode (`07`, Lesson mode: "attendance, then
 * each classwork, then each homework"; found missing on the test site, 5 November 2026). It
 * saves as the grid does: when the field is left or Enter is pressed, through `works.score`
 * on the version the grid read, and a number over the total or not whole is refused there.
 *
 * On a phone (owner, 20 November 2026: "it is impossible to write the number"): the field is
 * large, never switched off while another number is saved (the grid never is either; a field
 * switched off took the focus and the keyboard away from the next student), and Enter, the
 * keyboard's "Next", saves and goes on to the next student's field of the same work.
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
  const workLabel = useWorkLabel();
  const typedCell = student.cells[index]?.works[workIndex];
  const stored = typedCell?.score ?? null;
  const shown = stored === null ? '' : String(stored);
  // What the person types, until it is sent; the server's value again after each answer.
  const [typed, setTyped] = useState<{ from: string; text: string } | null>(null);
  const text = typed !== null && typed.from === shown ? typed.text : shown;
  // The same entry, read at once: Enter sends it and moves the focus on, and the blur that follows
  // must not send it a second time (a second save on the old version was refused as stale).
  const unsent = useRef<{ from: string; text: string } | null>(null);
  const [refused, setRefused] = useState(false);

  /** Sends what was typed; false when the number is refused, so Enter stays on it. */
  const send = (): boolean => {
    const entry = unsent.current;
    unsent.current = null;
    if (entry === null || entry.from !== shown) return true;
    const value = typedScore(entry.text, work.total);
    if (value === undefined) {
      // The refused number stays in its field, marked, until it is corrected: on a phone the
      // page's message is out of view.
      setRefused(true);
      onRefusedNumber(work.total);
      return false;
    }
    setTyped(null);
    setRefused(false);
    if (value !== stored) works.score(lesson, work, student, value);
    return true;
  };

  return (
    <span className="flex shrink-0 items-center gap-2" data-lesson-mode-work={work.id ?? ''}>
      <input
        className={cn(FIELD, 'w-20 text-center text-lg font-semibold')}
        inputMode="numeric"
        enterKeyHint="next"
        autoComplete="off"
        data-lesson-mode-field="true"
        aria-label={t('journal.lessonMode.score', {
          work: workLabel(work.kind, name),
          name: `${student.lastName} ${student.firstName}`,
        })}
        value={text}
        // Its own save and the read after it are on their way: a second number would be sent on
        // the old version. Read only, not switched off, so the focus and keyboard stay.
        readOnly={works.waiting(lesson.id, student.id, work)}
        aria-invalid={refused && typed !== null ? true : undefined}
        title={
          refused && typed !== null
            ? t('journal.works.wholeNumber', { total: work.total })
            : undefined
        }
        onChange={(event) => {
          const next = { from: shown, text: event.target.value };
          unsent.current = next;
          setTyped(next);
          setRefused(false);
        }}
        onBlur={() => {
          send();
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          if (!send()) return;
          // The next student's field of this work, as Enter moves down in the grid.
          const fields = [
            ...(event.currentTarget
              .closest('[data-lesson-mode]')
              ?.querySelectorAll<HTMLInputElement>('input[data-lesson-mode-field]') ?? []),
          ];
          const next = fields[fields.indexOf(event.currentTarget) + 1];
          if (next === undefined) {
            event.currentTarget.blur();
            return;
          }
          next.focus();
          if (typeof next.scrollIntoView === 'function') {
            next.scrollIntoView({ block: 'center', behavior: 'smooth' });
          }
        }}
      />
      {/* The percent the server worked out, as in the grid's cell; the total is in the header. */}
      <span className="w-11 text-sm text-muted-foreground" data-lesson-mode-percent="true">
        {typedCell?.percent !== null && typedCell?.percent !== undefined && (
          <>{typedCell.percent}%</>
        )}
      </span>
      <SaveSign state={works.stateOf(lesson.id, student.id, work)} />
    </span>
  );
}
