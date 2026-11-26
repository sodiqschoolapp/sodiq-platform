import {
  type JournalGrid,
  type JournalLesson,
  type JournalStudent,
  type JournalWork,
  type WorkColumn,
} from '@sodiq/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiFailure } from '@/api/failure';
import { useConfirm } from '@/components/confirm-dialog';
import { FailureAlert } from '@/components/failure-alert';
import {
  StaleDialog,
  storedOf,
  useSaveStates,
  type LastAction,
  type SaveState,
  type StaleCell,
} from './cell-saves';
import {
  addWork,
  invalidateJournal,
  removePlanWork,
  removeWork,
  renamePlanWork,
  renameWork,
  saveLessonTopic,
  saveScores,
  setWorkNotHeld,
  setWorkTotal,
  showTyped,
} from './journal-api';
import type { WorkEntry } from './journal-grid';
import { LessonEditor } from './lesson-editor';

/**
 * Classwork and homework in the journal (task 8.1, pull request #217; `07`,
 * Entering data, The total; `09`, In the journal; `edge/journal`, Entering):
 * the numbers typed in the grid, and two dialogs, one for the works of a
 * lesson (works added by hand at a lesson with no plan item, the works marked
 * "not held" with their undo) and one for a work (its total, "not held", the
 * removal of an empty one). A homework is a column of the lesson where it was
 * given (`07`, Homework column), so it is removed at that lesson.
 * The server decides who may enter (`canEnterWorks` of each lesson) and every
 * percent; nothing is calculated here.
 */

/** The column a write names: its stored work, or its plan work and source before its first write. */
export const columnOf = (work: JournalWork): WorkColumn =>
  work.id === null
    ? { planWorkId: work.planWorkId ?? '', sourceLessonId: work.sourceLessonId ?? '' }
    : { workId: work.id };

/** The key of a column in a lesson, for the saved sign of its cells. */
export const workKey = (work: JournalWork) =>
  work.id ?? `${work.planWorkId ?? ''}/${work.sourceLessonId ?? ''}`;

/** What the grid calls to enter numbers and open the dialogs. */
export interface WorksEntry {
  /**
   * Saves a number, "not graded" (a typed "-"), or clears the cell with `null`, on the version
   * the grid read.
   */
  score: (
    lesson: JournalLesson,
    work: JournalWork,
    student: JournalStudent,
    score: WorkEntry,
  ) => void;
  openLesson: (lesson: JournalLesson) => void;
  openWork: (lesson: JournalLesson, work: JournalWork) => void;
  /** Where each number typed in this visit stands, for its sign (task 8.3a). */
  stateOf: (lessonId: string, studentId: string, work: JournalWork) => SaveState | undefined;
  busy: boolean;
  /** Whether a number waits for its save and the journal read after it (lesson mode). */
  waiting: (lessonId: string, studentId: string, work: JournalWork) => boolean;
}

/** A typed number on its way: the key is made once and sent again on a retry. */
interface TypedNumber {
  lessonId: string;
  column: WorkColumn;
  /** The column's key in the lesson and its place there, for the sign and the shown value. */
  cell: string;
  workIndex: number;
  kind: JournalWork['kind'];
  studentId: string;
  score: number | null;
  /** A "-": the cell is "not graded" (`score` is `null`). */
  notGraded: boolean;
  version: number | null;
  key: string;
}

/** The name of a work in a sentence: the plan's title, or "CW 2" / "HW 1". */
export function useWorkName(): (work: JournalWork) => string {
  const { t } = useTranslation();
  return (work) =>
    work.title ??
    (work.kind === 'classwork'
      ? t('journal.grid.classworkShort', { number: work.position })
      : t('journal.grid.homeworkShort', { number: work.position }));
}

const confirmCode = (error: unknown, code: string): error is ApiFailure =>
  error instanceof ApiFailure && error.code === code;

export function useWorksEntry(
  grid: JournalGrid,
  record: (action: LastAction) => void = () => undefined,
  /** Task 8.4: the correction a save of a lesson carries, if any. */
  correctionOf: (lessonId: string) => { reason: string } | undefined = () => undefined,
): {
  works: WorksEntry;
  dialogs: React.JSX.Element;
} {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const nameOfWork = useWorkName();
  const [failure, setFailure] = useState<unknown>(null);
  const [lessonOpen, setLessonOpen] = useState<string | null>(null);
  const [workOpen, setWorkOpen] = useState<{ lessonId: string; key: string } | null>(null);
  const studentName = (id: string) => {
    const found = grid.students.find((one) => one.id === id);
    return found === undefined ? '' : `${found.lastName} ${found.firstName}`;
  };

  const done = async () => {
    await invalidateJournal(queryClient);
  };

  // Task 8.3a: the sign of each typed number, the retry of one with no answer, both values.
  const saves = useSaveStates();
  const [stale, setStale] = useState<{ input: TypedNumber; cell: StaleCell } | null>(null);
  // The numbers whose save and the read after it are on their way: a second number for the
  // same cell sent before the read lands would carry the old version.
  const [inFlight, setInFlight] = useState<ReadonlySet<string>>(new Set());
  const signKey = (lessonId: string, studentId: string, cell: string) =>
    `${lessonId}/${studentId}/${cell}`;

  const score = useMutation({
    mutationFn: (input: TypedNumber) =>
      saveScores(
        input.lessonId,
        {
          saves: [
            {
              studentId: input.studentId,
              column: input.column,
              score: input.score,
              ...(input.notGraded ? { notGraded: true as const } : {}),
              version: input.version,
            },
          ],
          ...(correctionOf(input.lessonId) === undefined
            ? {}
            : { correction: correctionOf(input.lessonId) }),
        },
        input.key,
      ),
    onMutate: (input) => {
      setFailure(null);
      showTyped(queryClient, {
        lessonId: input.lessonId,
        studentId: input.studentId,
        workIndex: input.workIndex,
        value: input.score,
        notGraded: input.notGraded,
      });
      saves.set(signKey(input.lessonId, input.studentId, input.cell), 'saving');
      setInFlight((now) => new Set(now).add(signKey(input.lessonId, input.studentId, input.cell)));
    },
    // After `onSuccess` and its read of the journal, or after a failure.
    onSettled: (_answer, _error, input) => {
      setInFlight((now) => {
        const next = new Set(now);
        next.delete(signKey(input.lessonId, input.studentId, input.cell));
        return next;
      });
    },
    onSuccess: async (answer, input) => {
      const key = signKey(input.lessonId, input.studentId, input.cell);
      saves.set(key, 'saved');
      saves.keepUnsent(key, null);
      record({
        lessonId: input.lessonId,
        cells: answer.cells.map((one) => ({
          studentId: one.studentId,
          workId: one.workId,
          version: one.version,
        })),
      });
      await done();
    },
    onError: async (error, input) => {
      const key = signKey(input.lessonId, input.studentId, input.cell);
      if (
        error instanceof ApiFailure &&
        (error.code === 'no_answer' || error.code === 'app_outdated')
      ) {
        saves.set(key, 'failed');
        saves.keepUnsent(key, { retry: () => score.mutate(input) });
        return;
      }
      // Task 11.24, decision 9: an entry sent against a lesson that no longer shows its work (a
      // homework typed at its old check lesson before the move) stays "not saved" with the
      // reason; the teacher types it again at the lesson where the homework was given.
      if (error instanceof ApiFailure && error.code === 'work_not_in_lesson') {
        saves.set(key, 'failed');
        saves.keepUnsent(key, { retry: () => score.mutate(input) });
        setFailure(error);
        return;
      }
      saves.set(key, null);
      saves.keepUnsent(key, null);
      if (error instanceof ApiFailure && error.code === 'cell_stale') {
        setStale({
          input,
          cell: {
            student: studentName(input.studentId),
            attendance: false,
            workKind: input.kind,
            mine: input.score,
            stored: storedOf(error),
          },
        });
      } else {
        setFailure(error);
      }
      await done();
    },
  });

  /** A change that may ask a confirmation first (a total with numbers, "not held" with numbers). */
  const change = useMutation({
    mutationFn: async (input: {
      run: (confirmed: boolean) => Promise<unknown>;
      ask: (error: ApiFailure) => Promise<boolean>;
      code?: string;
    }) => {
      try {
        return await input.run(false);
      } catch (error) {
        if (input.code !== undefined && confirmCode(error, input.code)) {
          if (!(await input.ask(error))) return null;
          return input.run(true);
        }
        throw error;
      }
    },
    onMutate: () => {
      setFailure(null);
    },
    onSuccess: done,
    onError: async (error) => {
      setFailure(error);
      await done();
    },
  });

  const { mutate: saveScore, isPending: scoring } = score;
  const { states } = saves;
  const { mutate: run, mutateAsync: runAsync, isPending: changing } = change;

  const works = useMemo(
    (): WorksEntry => ({
      score: (lesson, work, student, value) => {
        const index = grid.lessons.findIndex((one) => one.id === lesson.id);
        const at = lesson.works.findIndex((one) => workKey(one) === workKey(work));
        saveScore({
          lessonId: lesson.id,
          column: columnOf(work),
          cell: workKey(work),
          workIndex: at,
          kind: work.kind,
          studentId: student.id,
          score: value === 'notGraded' ? null : value,
          notGraded: value === 'notGraded',
          version: student.cells[index]?.works[at]?.version ?? null,
          key: crypto.randomUUID(),
        });
      },
      stateOf: (lessonId, studentId, work) =>
        states.get(signKey(lessonId, studentId, workKey(work))),
      openLesson: (lesson) => {
        setLessonOpen(lesson.id);
      },
      // A work's header opens the lesson's editor at that work.
      openWork: (lesson, work) => {
        setLessonOpen(lesson.id);
        setWorkOpen({ lessonId: lesson.id, key: workKey(work) });
      },
      busy: scoring || changing,
      waiting: (lessonId, studentId, work) =>
        inFlight.has(signKey(lessonId, studentId, workKey(work))),
    }),
    [grid.lessons, saveScore, scoring, changing, states, inFlight],
  );

  const lesson = grid.lessons.find((one) => one.id === lessonOpen);
  const indexOf = (target: JournalLesson) => grid.lessons.findIndex((one) => one.id === target.id);

  /** The numbers and "-" typed in a work's column at a lesson, as the grid holds them. */
  const entriesIn = (target: JournalLesson, chosen: JournalWork): number => {
    const index = indexOf(target);
    const at = target.works.findIndex((one) => workKey(one) === workKey(chosen));
    if (index < 0 || at < 0) return 0;
    return grid.students.filter((student) => {
      const typed = student.cells[index]?.works[at];
      return typed !== undefined && (typed.score !== null || typed.notGraded);
    }).length;
  };

  const setTotal = (target: JournalLesson, chosen: JournalWork, total: number) => {
    run({
      code: 'total_confirm',
      run: (confirmed) =>
        setWorkTotal(target.id, {
          column: columnOf(chosen),
          total,
          version: chosen.version,
          confirm: confirmed,
          ...(correctionOf(target.id) === undefined ? {} : { correction: correctionOf(target.id) }),
        }),
      ask: (error) =>
        confirm({
          title: t('journal.works.confirmTotalTitle'),
          text: t('journal.works.confirmTotalText'),
          names: (error.details ?? []).flatMap((detail) =>
            detail.workScore === undefined || detail.recordId === undefined
              ? []
              : [
                  t('journal.works.confirmTotalLine', {
                    student: studentName(detail.recordId),
                    score: detail.workScore.score,
                    before: detail.workScore.percentBefore ?? '—',
                    after: detail.workScore.percentAfter ?? '—',
                  }),
                ],
          ),
          action: t('journal.works.confirmTotalAction'),
        }),
    });
  };

  /**
   * Deletes a work's column at the lesson that shows it (the owner, 20 November 2026). A work
   * with a total or with numbers is kept out of the journal and its averages, its numbers kept in
   * the history ("not held" underneath: records with data are archived, never deleted); an empty
   * one is removed, from the plan too.
   */
  const deleteAt = (target: JournalLesson, chosen: JournalWork, name: string) => {
    const count = entriesIn(target, chosen);
    if (chosen.total !== null || count > 0) {
      void confirm({
        title: t('journal.editor.deleteTitle', { name }),
        text:
          count > 0 ? t('journal.editor.deleteNumbers', { count }) : t('journal.editor.deleteText'),
        action: t('journal.editor.deleteAction'),
        destructive: true,
      }).then((sure) => {
        if (!sure) return;
        run({
          run: () =>
            setWorkNotHeld(target.id, {
              column: columnOf(chosen),
              notHeld: true,
              version: chosen.version,
              confirm: true,
              ...(correctionOf(target.id) === undefined
                ? {}
                : { correction: correctionOf(target.id) }),
            }),
          ask: () => Promise.resolve(false),
        });
      });
      return;
    }
    const planWorkId = chosen.planWorkId;
    if (planWorkId !== null) {
      run({ run: () => removePlanWork(target.id, planWorkId), ask: () => Promise.resolve(false) });
      return;
    }
    const id = chosen.id;
    if (id !== null)
      run({ run: () => removeWork(target.id, id), ask: () => Promise.resolve(false) });
  };

  const rename = async (target: JournalLesson, chosen: JournalWork, title: string) => {
    const planWorkId = chosen.planWorkId;
    try {
      if (planWorkId !== null) {
        await runAsync({
          run: () =>
            renamePlanWork(target.id, planWorkId, { title, baseTitle: chosen.title ?? '' }),
          ask: () => Promise.resolve(false),
        });
        return true;
      }
      if (chosen.id === null) return false;
      const id = chosen.id;
      await runAsync({
        run: () => renameWork(target.id, id, { title, version: chosen.version ?? 1 }),
        ask: () => Promise.resolve(false),
      });
      return true;
    } catch {
      return false;
    }
  };

  const aboveTotal =
    failure instanceof ApiFailure && failure.code === 'total_below_numbers'
      ? (failure.details ?? []).flatMap((detail) =>
          detail.recordId === undefined ? [] : [studentName(detail.recordId)],
        )
      : [];

  const dialogs = (
    <>
      {saves.notice}
      <FailureAlert error={failure} />
      {stale !== null && (
        <StaleDialog
          cells={[stale.cell]}
          onKeep={() => {
            setStale(null);
          }}
          onMine={() => {
            const { input, cell } = stale;
            setStale(null);
            saveScore({
              ...input,
              version: cell.stored?.version ?? null,
              key: crypto.randomUUID(),
            });
          }}
        />
      )}
      {aboveTotal.length > 0 && (
        <p className="text-sm" data-above-total="true">
          {t('journal.works.aboveTotal', { names: aboveTotal.join(', ') })}
        </p>
      )}
      {lesson !== undefined && (
        <LessonEditor
          lesson={lesson}
          grid={grid}
          language={i18n.language}
          busy={changing}
          failure={failure}
          focusKey={workOpen?.lessonId === lesson.id ? workOpen.key : null}
          nameOfWork={nameOfWork}
          keyOf={workKey}
          onTopic={(topic) =>
            runAsync({
              run: () =>
                saveLessonTopic(lesson.id, {
                  topic,
                  baseTopic: lesson.topic ?? '',
                  ...(correctionOf(lesson.id) === undefined
                    ? {}
                    : { correction: correctionOf(lesson.id) }),
                }),
              ask: () => Promise.resolve(false),
            }).then(
              () => true,
              () => false,
            )
          }
          onAdd={(kind, title) =>
            // The form stays with its title until the server took it; a refusal is shown above it.
            runAsync({
              run: () =>
                addWork(lesson.id, {
                  kind,
                  title,
                  ...(correctionOf(lesson.id) === undefined
                    ? {}
                    : { correction: correctionOf(lesson.id) }),
                }),
              ask: () => Promise.resolve(false),
            }).then(
              () => true,
              () => false,
            )
          }
          onRename={(chosen, title) => rename(lesson, chosen, title)}
          onTotal={(chosen, total) => {
            setTotal(lesson, chosen, total);
          }}
          onDelete={(chosen) => {
            deleteAt(lesson, chosen, nameOfWork(chosen));
          }}
          onClose={() => {
            setLessonOpen(null);
            setWorkOpen(null);
          }}
        />
      )}
    </>
  );

  return { works, dialogs };
}
