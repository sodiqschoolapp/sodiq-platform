import {
  WORK_TOTAL_MAX,
  WORK_TOTAL_MIN,
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
import { NumberField } from '@/components/field';
import { wholeNumber } from '@/components/form/form-messages';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { schoolDateText } from '@/lib/dates';
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
  carryWork,
  invalidateJournal,
  removeWork,
  saveScores,
  setWorkNotHeld,
  setWorkTotal,
  showTyped,
} from './journal-api';

/**
 * Classwork and homework in the journal (task 8.1, pull request #217; `07`,
 * Entering data, The total; `09`, In the journal; `edge/journal`, Entering):
 * the numbers typed in the grid, and two dialogs, one for the works of a
 * lesson (works added by hand at a lesson with no plan item, the works marked
 * "not held" with their undo, the homeworks given) and one for a work (its
 * total, "not held", "check at the next lesson", the removal of an empty one).
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
  /** Saves a number (or clears the cell with `null`) on the version the grid read. */
  score: (
    lesson: JournalLesson,
    work: JournalWork,
    student: JournalStudent,
    score: number | null,
  ) => void;
  openLesson: (lesson: JournalLesson) => void;
  openWork: (lesson: JournalLesson, work: JournalWork) => void;
  /** Where each number typed in this visit stands, for its sign (task 8.3a). */
  stateOf: (lessonId: string, studentId: string, work: JournalWork) => SaveState | undefined;
  busy: boolean;
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
      });
      saves.set(signKey(input.lessonId, input.studentId, input.cell), 'saving');
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
  const { mutate: run, isPending: changing } = change;

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
          score: value,
          version: student.cells[index]?.works[at]?.version ?? null,
          key: crypto.randomUUID(),
        });
      },
      stateOf: (lessonId, studentId, work) =>
        states.get(signKey(lessonId, studentId, workKey(work))),
      openLesson: (lesson) => {
        setLessonOpen(lesson.id);
      },
      openWork: (lesson, work) => {
        setWorkOpen({ lessonId: lesson.id, key: workKey(work) });
      },
      busy: scoring || changing,
    }),
    [grid.lessons, saveScore, scoring, changing, states],
  );

  const lesson = grid.lessons.find((one) => one.id === (workOpen?.lessonId ?? lessonOpen));
  const work =
    workOpen === null || lesson === undefined
      ? undefined
      : [...lesson.works, ...lesson.notHeldWorks].find((one) => workKey(one) === workOpen.key);

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

  const setNotHeld = (target: JournalLesson, chosen: JournalWork, notHeld: boolean) => {
    run({
      code: 'not_held_confirm',
      run: (confirmed) =>
        setWorkNotHeld(target.id, {
          column: columnOf(chosen),
          notHeld,
          version: chosen.version,
          confirm: confirmed,
        }),
      ask: (error) =>
        confirm({
          title: t('journal.works.confirmNotHeldTitle'),
          text: t('journal.works.confirmNotHeldText', {
            count: error.details?.[0]?.count ?? 0,
          }),
          action: t('journal.works.confirmNotHeldAction'),
        }),
    });
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
      {lessonOpen !== null && lesson !== undefined && workOpen === null && (
        <LessonWorksDialog
          lesson={lesson}
          grid={grid}
          language={i18n.language}
          busy={changing}
          nameOfWork={nameOfWork}
          onAdd={(kind) => {
            run({ run: () => addWork(lesson.id, { kind }), ask: () => Promise.resolve(false) });
          }}
          onUndo={(chosen) => {
            setNotHeld(lesson, chosen, false);
          }}
          onClose={() => {
            setLessonOpen(null);
          }}
        />
      )}
      {workOpen !== null && lesson !== undefined && work !== undefined && (
        <WorkDialog
          key={workKey(work)}
          lesson={lesson}
          work={work}
          lastTotal={grid.lastTotal}
          busy={changing}
          name={nameOfWork(work)}
          onTotal={(total) => {
            setTotal(lesson, work, total);
          }}
          onNotHeld={(notHeld) => {
            setNotHeld(lesson, work, notHeld);
          }}
          onCarry={() => {
            run({
              run: () => carryWork(lesson.id, { column: columnOf(work), version: work.version }),
              ask: () => Promise.resolve(false),
            });
          }}
          onRemove={() => {
            if (work.id === null) return;
            const id = work.id;
            run({ run: () => removeWork(lesson.id, id), ask: () => Promise.resolve(false) });
            setWorkOpen(null);
          }}
          onClose={() => {
            setWorkOpen(null);
          }}
        />
      )}
    </>
  );

  return { works, dialogs };
}

/** The works of a lesson: added by hand, marked "not held", and the homeworks given. */
function LessonWorksDialog({
  lesson,
  grid,
  language,
  busy,
  nameOfWork,
  onAdd,
  onUndo,
  onClose,
}: {
  lesson: JournalLesson;
  grid: JournalGrid;
  language: string;
  busy: boolean;
  nameOfWork: (work: JournalWork) => string;
  onAdd: (kind: 'classwork' | 'homework') => void;
  onUndo: (work: JournalWork) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const dateOf = (id: string | null) => {
    const found = grid.lessons.find((one) => one.id === id);
    return found === undefined ? null : schoolDateText(found.date, language);
  };
  const title = t('journal.works.title', { date: schoolDateText(lesson.date, language) });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent aria-label={title}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 text-sm">
          {!lesson.planItem && (
            <div className="grid gap-2" data-no-plan="true">
              <p className="font-semibold">{t('journal.works.noPlan')}</p>
              {lesson.canEnterWorks && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() => {
                      onAdd('classwork');
                    }}
                  >
                    {t('journal.works.addClasswork')}
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() => {
                      onAdd('homework');
                    }}
                  >
                    {t('journal.works.addHomework')}
                  </Button>
                </div>
              )}
            </div>
          )}
          {lesson.given.length > 0 && (
            <div className="grid gap-1">
              <p className="font-semibold">{t('journal.works.given')}</p>
              <ul className="grid list-disc gap-1 pl-5">
                {lesson.given.map((given, index) => (
                  <li key={`${given.title ?? ''}:${String(index)}`}>
                    {given.title ?? t('journal.grid.homeworkShort', { number: index + 1 })}
                    {' · '}
                    {given.ungraded === null
                      ? t('journal.works.checkedOn', { date: dateOf(given.checkAt) ?? '—' })
                      : t(`journal.works.ungraded.${given.ungraded}`)}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {lesson.notHeldWorks.length > 0 && (
            <div className="grid gap-1">
              <p className="font-semibold">{t('journal.works.notHeldList')}</p>
              <ul className="grid gap-2">
                {lesson.notHeldWorks.map((work) => (
                  <li key={workKey(work)} className="flex flex-wrap items-center gap-2">
                    <span>{nameOfWork(work)}</span>
                    {lesson.canEnterWorks && (
                      <Button
                        variant="ghost"
                        disabled={busy}
                        onClick={() => {
                          onUndo(work);
                        }}
                      >
                        {t('journal.works.undoNotHeld')}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t('journal.entry.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** One work: its total, "not held", the carry of a homework and the removal of an empty one. */
function WorkDialog({
  lesson,
  work,
  lastTotal,
  busy,
  name,
  onTotal,
  onNotHeld,
  onCarry,
  onRemove,
  onClose,
}: {
  lesson: JournalLesson;
  work: JournalWork;
  lastTotal: number | null;
  busy: boolean;
  name: string;
  onTotal: (total: number) => void;
  onNotHeld: (notHeld: boolean) => void;
  onCarry: () => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  // `07`: "The last total the teacher used in that journal is offered for the next work."
  const [typed, setTyped] = useState(String(work.total ?? lastTotal ?? ''));
  const read = wholeNumber(typed);
  const valid = typeof read === 'number' && read >= WORK_TOTAL_MIN && read <= WORK_TOTAL_MAX;
  const enter = lesson.canEnterWorks;
  const title = t('journal.works.workTitle', { name });
  // A homework at its check lesson: "not checked" or "check at the next lesson" (once).
  const checking = work.kind === 'homework';
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent aria-label={title}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (valid) onTotal(read);
          }}
        >
          <NumberField
            label={t('journal.works.total')}
            value={typed}
            disabled={!enter || work.notHeld}
            error={
              typed === '' || valid
                ? undefined
                : t('journal.works.wholeNumber', { total: WORK_TOTAL_MAX })
            }
            onChange={(event) => {
              setTyped(event.target.value);
            }}
          />
          {enter && !work.notHeld && (
            <div>
              <Button type="submit" disabled={busy || !valid}>
                {t('journal.works.saveTotal')}
              </Button>
            </div>
          )}
        </form>
        {enter && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                onNotHeld(!work.notHeld);
              }}
            >
              {work.notHeld
                ? t('journal.works.undoNotHeld')
                : checking
                  ? t('journal.works.notChecked')
                  : t('journal.works.notHeld')}
            </Button>
            {checking && work.carriedFrom === null && !work.notHeld && (
              <Button variant="secondary" disabled={busy} onClick={onCarry}>
                {t('journal.works.carry')}
              </Button>
            )}
            {work.unplanned && work.id !== null && work.total === null && !work.notHeld && (
              <Button variant="ghost" disabled={busy} onClick={onRemove}>
                {t('journal.works.remove')}
              </Button>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t('journal.entry.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
