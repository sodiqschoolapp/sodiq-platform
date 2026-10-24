import type {
  AttendanceMark,
  JournalBottom,
  JournalFigures,
  CellMarker,
  JournalGrid as Grid,
  JournalLesson,
  JournalStudent,
} from '@sodiq/shared';
import { RATING_SCORE_MAX } from '@sodiq/shared';
import {
  AllCommunityModule,
  themeQuartz,
  type ColDef,
  type ColGroupDef,
  type GridApi,
  type CellKeyDownEvent,
  type ICellRendererParams,
  type SuppressKeyboardEventParams,
  type IHeaderParams,
} from 'ag-grid-community';
import { AgGridReact } from 'ag-grid-react';
import { cn } from 'cn';
import { useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircleIcon, ContentCopyIcon, InfoIcon, MoreHorizIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { momentText, schoolDateText, weekdayName } from '@/lib/dates';
import type { AttendanceEntry } from './attendance-entry';
import { SaveSign } from './cell-saves';
import type { CommentCell, CommentsInput } from './comment-dialog';
import { ratingEntryOf, useEntryText, type RatingInput } from './rating-entry';
import { workKey, type WorksEntry } from './works-entry';

/**
 * The journal grid (task 6.2, pull request #210; `07`, Layout): AG Grid
 * Community with the student columns and the figures pinned on the left, one
 * column group per dated lesson (row 1: date, weekday, slot; row 2: A, each
 * classwork and homework with its title, AVG; row 3: "Soni" and the total),
 * the bottom row of class or group averages pinned at the bottom, and the
 * folded section of students who left or moved. Every number is the server's,
 * from `packages/calc` (decision 7): nothing is calculated here.
 */

/** A row of the grid: a student, the line of the folded section, or the bottom row. */
export type GridRow =
  | { readonly kind: 'student'; readonly student: JournalStudent }
  | { readonly kind: 'section'; readonly count: number; readonly which: 'left' | 'exempt' }
  | { readonly kind: 'bottom'; readonly bottom: JournalBottom };

type Weekday = Parameters<typeof weekdayName>[1];

/** The school date after `date`. */
const dayAfter = (date: string): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

const weekdayOf = (date: string): Weekday => {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return (day === 0 ? 7 : day) as Weekday;
};

/** The tint of an attendance mark (docs/design-system.md, Status labels): always the digit. */
const MARK_TINT: Record<number, string> = {
  0: 'bg-destructive-bg text-destructive',
  2: 'bg-warning-bg text-warning',
  3: 'bg-destructive-bg text-destructive',
};

/** The tint of a grade: 2 danger, 3 warning, 4 info, 5 success. */
export const GRADE_TINT: Record<number, string> = {
  2: 'bg-destructive-bg text-destructive',
  3: 'bg-warning-bg text-warning',
  4: 'bg-info-bg text-info',
  5: 'bg-success-bg text-success',
};

/** The grid's look from the design tokens of `index.css`, light and dark alike. */
const THEME = themeQuartz.withParams({
  backgroundColor: 'var(--card)',
  foregroundColor: 'var(--foreground)',
  headerBackgroundColor: 'var(--muted)',
  borderColor: 'var(--border)',
  accentColor: 'var(--ring)',
  fontFamily: 'inherit',
  fontSize: 14,
  rowHeight: 36,
  headerHeight: 40,
  wrapperBorderRadius: 0,
});

/**
 * A button under a header: "all present" over the A column (`07`, Layout,
 * Lessons, row 3); the works of the lesson and of a work (task 8.1).
 */
interface HeaderAction {
  readonly label: string;
  readonly disabled: boolean;
  readonly run: () => void;
  readonly icon?: 'check' | 'more' | 'copy';
}

/** A header of two lines: the title, and "Soni" with the total under a work, or an action. */
/**
 * Task 8.4: "entered after the edit period" with the approver, or "corrected" (`edge/journal`):
 * a sign beside the value, its words in the label.
 */
function MarkerSign({ marker }: { marker: CellMarker }) {
  const { t, i18n } = useTranslation();
  if (marker === null) return null;
  // Task 8.6: an optional cell of a late move, open until a moment (`edge/students-classes-groups`).
  const text =
    marker.kind === 'optional'
      ? t('journal.grid.optionalUntil', {
          // The last minute it is open, as the edit period shows its lock (`edit-period.tsx`).
          date: momentText(
            i18n.language,
            new Date(Date.parse(marker.until) - 60_000).toISOString(),
          ),
        })
      : marker.kind === 'late'
        ? t('journal.locks.lateMarker', { name: marker.by ?? '—' })
        : t('journal.locks.correctionMarker', { name: marker.by ?? '—' });
  return (
    <span
      className="ml-0.5 align-super text-xs font-semibold text-info"
      role="img"
      aria-label={text}
      title={text}
      data-marker={marker.kind}
    >
      {marker.kind === 'optional' ? '○' : marker.kind === 'late' ? '*' : '†'}
    </span>
  );
}

/**
 * Task 8.6 (`07`, Transfers: "The new journal shows the carried-in averages with a
 * marker"): a sign on the result naming the other journals the figures come from, with
 * the days of each.
 */
function CarriedInSign({ student }: { student: JournalStudent }) {
  const { t, i18n } = useTranslation();
  const text = t('journal.grid.carriedInTitle', {
    journals: student.carriedIn
      .map((one) =>
        t('journal.grid.carriedInJournal', {
          unit: one.unitName,
          from: schoolDateText(one.from, i18n.language, false),
          to: schoolDateText(one.until, i18n.language, false),
        }),
      )
      .join('; '),
  });
  return (
    <span
      className="ml-1 text-xs font-semibold text-info"
      role="img"
      aria-label={text}
      title={text}
      data-carried-in="true"
    >
      {t('journal.grid.carriedIn')}
    </span>
  );
}

function TwoLineHeader(
  props: IHeaderParams & {
    second?: string;
    label?: string;
    action?: HeaderAction;
    copy?: HeaderAction;
    more?: HeaderAction;
  },
) {
  const buttons = [props.action, props.copy, props.more].filter(
    (one): one is HeaderAction => one !== undefined,
  );
  return (
    <div className="grid leading-tight" aria-label={props.label}>
      <span className="font-semibold">{props.displayName}</span>
      {props.second !== undefined && (
        <span className="text-xs text-muted-foreground">{props.second}</span>
      )}
      {buttons.length > 0 && (
        <span className="flex">
          {buttons.map((button) => (
            <Button
              key={button.label}
              variant="ghost"
              size="icon-sm"
              aria-label={button.label}
              title={button.label}
              disabled={button.disabled}
              onClick={button.run}
            >
              {button.icon === 'more' ? (
                <MoreHorizIcon className="size-4" aria-hidden="true" />
              ) : button.icon === 'copy' ? (
                <ContentCopyIcon className="size-4" aria-hidden="true" />
              ) : (
                <CheckCircleIcon className="size-4" aria-hidden="true" />
              )}
            </Button>
          ))}
        </span>
      )}
    </div>
  );
}

/**
 * The number typed in a work's cell (`07`: "The number typed is a whole number"; `edge/journal`:
 * "Letters, decimals and numbers above the total are refused in the cell"): the number, `null`
 * for an emptied cell, or `undefined` for what is refused.
 */
export function typedScore(typed: unknown, total: number): number | null | undefined {
  const text =
    typeof typed === 'number' ? String(typed) : typeof typed === 'string' ? typed.trim() : '';
  if (text === '') return null;
  if (!/^\d+$/.test(text)) return undefined;
  const value = Number(text);
  return value <= total ? value : undefined;
}

/** The keys that type a mark in an A cell (`edge/journal`: "An attendance digit saves at once and moves down"). */
const MARK_KEYS: Readonly<Record<string, AttendanceMark>> = { '0': 0, '1': 1, '2': 2, '3': 3 };

interface GridProps {
  readonly grid: Grid;
  /** The month whose figures the pinned columns show; `null`: the quarter. */
  readonly month: string | null;
  /** The students shown above the folded line, in order. */
  readonly members: readonly JournalStudent[];
  /** The students of the folded section shown, when it is open. */
  readonly folded: readonly JournalStudent[];
  readonly foldedCount: number;
  readonly foldedOpen: boolean;
  readonly onToggleFolded: () => void;
  /**
   * Task 8.5 (`07`, In the journal): the students exempt for every lesson on screen, in a
   * folded "Exempt" section with their dates.
   */
  readonly exempt?: readonly JournalStudent[];
  readonly exemptOpen?: boolean;
  readonly onToggleExempt?: () => void;
  /** The lesson to scroll to on opening. */
  readonly scrollTo: string | null;
  /** Attendance entry (task 6.3): a lesson with `canEnter` takes marks. */
  readonly entry?: AttendanceEntry | undefined;
  /** Works and numbers (task 8.1): a lesson with `canEnterWorks` takes them. */
  readonly works?: WorksEntry | undefined;
  /** A number refused in the cell (a letter, a decimal, above the total). */
  readonly onRefusedNumber?: (total: number) => void;
  /** The rating exam of the quarter (task 8.2): the column takes scores when `canEnter`. */
  readonly rating?: RatingInput | undefined;
  /** Comments (task 8.2): a marker on a cell with one, and the dialog at `KeyC`. */
  readonly comments?: CommentsInput | undefined;
}

/**
 * The keys that open a dialog (task 8.2, decision 11): C the comment, E a rating entry. On a
 * cell that takes a typed number they must not start an edit with the letter.
 */
const dialogKey = (params: SuppressKeyboardEventParams<GridRow>): boolean =>
  !params.editing && (params.event.code === 'KeyC' || params.event.code === 'KeyE');

/** The corner marker of a cell with a comment (task 8.2). */
const COMMENTED =
  "relative after:absolute after:right-0 after:top-0 after:size-0 after:border-4 after:border-transparent after:border-t-info after:border-r-info after:content-['']";

export function JournalGridView({
  grid,
  month,
  members,
  folded,
  foldedCount,
  foldedOpen,
  onToggleFolded,
  exempt = [],
  exemptOpen = false,
  onToggleExempt,
  scrollTo,
  entry,
  works,
  onRefusedNumber,
  rating,
  comments,
}: GridProps): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const entryText = useEntryText();
  const api = useRef<GridApi<GridRow> | null>(null);
  /** The marker class of a cell with a comment, for a student row. */
  const marked = useCallback(
    (row: GridRow | undefined, cell: (studentId: string) => CommentCell): string | undefined =>
      row?.kind === 'student' && (comments?.commentOn(cell(row.student.id))?.body ?? null) !== null
        ? COMMENTED
        : undefined,
    [comments],
  );
  const whole = grid.shape === 'whole';
  const figuresShown = grid.shape !== 'lessons';
  const graded = !grid.journal.attendanceOnly && grid.shape !== 'attendance';
  // The categories of the reasons of absence by student and date (task 6.3, decision 7).
  const reasons = useMemo(
    () => new Map(grid.absences.map((one) => [`${one.studentId}|${one.date}`, one.category])),
    [grid.absences],
  );
  const busy = entry?.busy ?? false;
  const entering = entry !== undefined;

  const figuresOf = useCallback(
    (student: JournalStudent): JournalFigures | null =>
      month === null ? student.quarter : (student.months?.[month] ?? null),
    [month],
  );
  const bottom =
    grid.bottom === null
      ? null
      : month === null
        ? grid.bottom.quarter
        : (grid.bottom.months[month] ?? null);

  const rows = useMemo((): GridRow[] => {
    const shown: GridRow[] = members.map((student) => ({ kind: 'student', student }));
    if (exempt.length > 0) {
      shown.push({ kind: 'section', count: exempt.length, which: 'exempt' });
      if (exemptOpen)
        shown.push(...exempt.map((student) => ({ kind: 'student' as const, student })));
    }
    if (foldedCount > 0) {
      shown.push({ kind: 'section', count: foldedCount, which: 'left' });
      if (foldedOpen)
        shown.push(...folded.map((student) => ({ kind: 'student' as const, student })));
    }
    return shown;
  }, [members, folded, foldedCount, foldedOpen, exempt, exemptOpen]);

  const columnDefs = useMemo((): (ColDef<GridRow> | ColGroupDef<GridRow>)[] => {
    // Task 8.5: an exemption as the teacher reads it: kind and dates (the category for the Tutor).
    const exemptionText = (one: JournalStudent['exemptions'][number]): string =>
      [
        t(`journal.exemptions.kinds.${one.kind}`),
        one.startDate === one.endDate
          ? schoolDateText(one.startDate, language, false)
          : t('journal.exemptions.datesLine', {
              from: schoolDateText(one.startDate, language, false),
              to: schoolDateText(one.endDate, language, false),
            }),
        one.slots === null ? null : `${one.slots.start}–${one.slots.end}`,
        one.category === null ? null : t(`journal.exemptions.categories.${one.category}`),
      ]
        .filter((part) => part !== null)
        .join(' · ');
    const unitAverage =
      grid.journal.unit.kind === 'class'
        ? t('journal.grid.classAverage')
        : t('journal.grid.groupAverage');
    const students: ColDef<GridRow>[] = [
      {
        colId: 'number',
        headerName: t('journal.grid.number'),
        pinned: 'left',
        width: 52,
        valueGetter: (params) =>
          params.data?.kind === 'student' ? params.data.student.number : null,
      },
      {
        colId: 'name',
        headerName: t('journal.grid.student'),
        pinned: 'left',
        width: 220,
        valueGetter: (params) => {
          const row = params.data;
          if (row?.kind === 'student') return `${row.student.lastName} ${row.student.firstName}`;
          if (row?.kind === 'bottom') return unitAverage;
          return null;
        },
        // Task 8.5 (`07`: "The teacher sees the kind and the dates, not the reason"; "a folded
        // 'Exempt' section at the bottom, with the dates"): the student's exemptions beside the
        // name, also in full on hover; the category for the class Tutor only.
        tooltipValueGetter: (params) => {
          const row = params.data;
          if (row?.kind !== 'student' || row.student.exemptions.length === 0) return null;
          return row.student.exemptions.map((one) => exemptionText(one)).join('; ');
        },
        cellRenderer: (params: ICellRendererParams<GridRow>) => {
          const row = params.data;
          if (row?.kind !== 'student')
            return params.valueFormatted ?? (params.value as string | null);
          const back = row.student.exemptions.some(
            (one) => one.slots === null && dayAfter(one.endDate) === grid.today,
          );
          return (
            <span>
              {[row.student.lastName, row.student.firstName].join(' ')}
              {row.student.exemptions.length > 0 && (
                <span className="ml-1 text-xs text-muted-foreground" data-exemption="true">
                  {row.student.exemptions.map((one) => exemptionText(one)).join('; ')}
                </span>
              )}
              {back && (
                <span className="ml-1 text-xs text-info" data-back="true">
                  {t('journal.grid.backFromExemption')}
                </span>
              )}
              {/* Task 8.6 (edge/calculation): the labels of the folded section. */}
              {row.student.folded && row.student.atLeaving !== null && (
                <span className="ml-1 text-xs text-muted-foreground" data-at-leaving="true">
                  {t('journal.grid.resultAtLeaving', {
                    date: schoolDateText(row.student.atLeaving, language, false),
                  })}
                </span>
              )}
              {row.student.folded && row.student.leftSubjectOn !== null && (
                <span className="ml-1 text-xs text-muted-foreground" data-left-subject="true">
                  {t('journal.grid.leftSubjectOn', {
                    date: schoolDateText(row.student.leftSubjectOn, language, false),
                  })}
                </span>
              )}
            </span>
          );
        },
        cellClass: (params) => (params.data?.kind === 'bottom' ? 'font-semibold' : undefined),
      },
      {
        colId: 'uid',
        headerName: t('journal.grid.uid'),
        pinned: 'left',
        width: 100,
        valueGetter: (params) => (params.data?.kind === 'student' ? params.data.student.uid : null),
      },
    ];

    const figure = (
      colId: string,
      header: string,
      pick: (figures: JournalFigures) => number | null,
      pickBottom: (row: JournalBottom) => number | null,
    ): ColDef<GridRow> => ({
      colId,
      headerName: header,
      pinned: 'left',
      width: 84,
      type: 'numericColumn',
      valueGetter: (params) => {
        const row = params.data;
        if (row?.kind === 'student') {
          const figures = figuresOf(row.student);
          return figures === null ? null : pick(figures);
        }
        if (row?.kind === 'bottom') return pickBottom(row.bottom);
        return null;
      },
    });
    const figures: ColDef<GridRow>[] = [];
    if (figuresShown) {
      figures.push(
        figure(
          'attendance',
          t('journal.grid.attendanceAverage'),
          (f) => f.attendance,
          (b) => b.attendance,
        ),
      );
      if (graded) {
        figures.push(
          figure(
            'classwork',
            t('journal.grid.classworkAverage'),
            (f) => f.classwork,
            (b) => b.classwork,
          ),
          figure(
            'homework',
            t('journal.grid.homeworkAverage'),
            (f) => f.homework,
            (b) => b.homework,
          ),
        );
        if (grid.journal.ratingExam && month === null) {
          // Task 8.2: the exam's column: its date under the title, the entries typed here.
          const exam = grid.rating;
          figures.push({
            ...figure(
              'ratingExam',
              t('journal.grid.ratingExam'),
              (f) => f.ratingExam,
              (b) => b.ratingExam,
            ),
            width: 110,
            headerComponent: TwoLineHeader,
            headerComponentParams: {
              label: t('journal.rating.column'),
              second:
                exam === null
                  ? undefined
                  : exam.notHeld
                    ? t('journal.rating.notHeldShort')
                    : exam.date === null
                      ? t('journal.rating.noDate')
                      : schoolDateText(exam.date, language, false),
              ...(rating !== undefined
                ? {
                    more: {
                      label: t('journal.rating.examTitle'),
                      icon: 'more',
                      disabled: rating.busy,
                      run: () => {
                        rating.openExam();
                      },
                    },
                  }
                : {}),
            },
            suppressKeyboardEvent: dialogKey,
            editable: (params) =>
              rating?.exam.canEnter === true &&
              params.data?.kind === 'student' &&
              ratingEntryOf(rating.exam, params.data.student.id)?.entry?.kind !== 'exempt',
            valueGetter: (params) => {
              const row = params.data;
              if (row?.kind === 'bottom') return row.bottom.ratingExam;
              if (row?.kind !== 'student' || exam === null) return null;
              const stored = ratingEntryOf(exam, row.student.id)?.entry ?? null;
              // Task 8.5 (edge/calculation): "exempt on exam day, pending".
              if (stored === null) {
                return exam.pending.includes(row.student.id) ? t('journal.rating.pending') : null;
              }
              return stored.kind === 'score' ? stored.score : entryText(stored);
            },
            // A score is saved when the cell is left; over an entry the dialog asks the reason.
            valueSetter: (params) => {
              const row = params.data;
              if (rating === undefined || row?.kind !== 'student') return false;
              const value = typedScore(params.newValue, RATING_SCORE_MAX);
              if (value === undefined) {
                onRefusedNumber?.(RATING_SCORE_MAX);
                return false;
              }
              const before = ratingEntryOf(rating.exam, row.student.id)?.entry ?? null;
              const same =
                before?.kind === 'score'
                  ? before.score === value
                  : value === null && before === null;
              if (!same) rating.score(row.student, value);
              return false;
            },
            cellClass: (params) =>
              marked(params.data, (studentId) => ({ target: 'rating', studentId })),
          });
        }
        figures.push({
          colId: 'result',
          headerName:
            month !== null && grid.journal.ratingExam
              ? t('journal.grid.monthResult')
              : month !== null
                ? t('journal.grid.monthResultPlain')
                : t('journal.grid.result'),
          pinned: 'left',
          width: month !== null && grid.journal.ratingExam ? 150 : 110,
          cellRenderer: (params: ICellRendererParams<GridRow>) => {
            const row = params.data;
            if (row?.kind === 'bottom') return row.bottom.result;
            if (row?.kind !== 'student') return null;
            const result = figuresOf(row.student)?.result ?? null;
            if (result === null) return null;
            if (result.kind === 'no_result') {
              return <span className="sr-only">{t('journal.grid.noResult')}</span>;
            }
            // Task 8.5 (07, Effect on totals): "Exempt": no number and no grade.
            if (result.kind === 'exempt') {
              return <span data-result="exempt">{t('journal.grid.exemptResult')}</span>;
            }
            return (
              <span data-result={result.shown}>
                {result.shown}
                {result.provisional && (
                  <span className="ml-1 text-xs text-muted-foreground">
                    {t('journal.grid.provisionalShort')}
                  </span>
                )}
                {result.basedOn !== null && (
                  <span className="ml-1 text-xs text-muted-foreground" data-based-on="true">
                    {t('journal.grid.basedOn', {
                      expected: result.basedOn.expected,
                      held: result.basedOn.held,
                    })}
                  </span>
                )}
                {result.leftOut.length > 0 && (
                  <span
                    className="ml-1 text-xs text-muted-foreground"
                    title={result.leftOut.map((part) => t(`journal.grid.parts.${part}`)).join(', ')}
                  >
                    {t('journal.grid.leftOutShort')}
                  </span>
                )}
                {/* Task 8.6 (07, Transfers): "the carried-in averages with a marker". */}
                {row.student.carriedIn.length > 0 && <CarriedInSign student={row.student} />}
              </span>
            );
          },
        });
        figures.push({
          colId: 'grade',
          headerName: t('journal.grid.grade'),
          pinned: 'left',
          width: 72,
          cellRenderer: (params: ICellRendererParams<GridRow>) => {
            const row = params.data;
            if (row?.kind !== 'student') return null;
            const result = figuresOf(row.student)?.result ?? null;
            if (result?.kind !== 'number') return null;
            return (
              <span
                className={cn('rounded-sm px-1.5 py-0.5 font-semibold', GRADE_TINT[result.grade])}
              >
                {result.grade}
              </span>
            );
          },
        });
      }
    }

    const lessonGroups: ColGroupDef<GridRow>[] = grid.lessons.map((lesson, index) =>
      lessonGroup(lesson, index),
    );

    function lessonGroup(lesson: JournalLesson, index: number): ColGroupDef<GridRow> {
      const cancelled = lesson.cancelled !== null;
      const struck = cancelled ? 'line-through text-muted-foreground' : '';
      const date = `${schoolDateText(lesson.date, language, false)}, ${weekdayName(language, weekdayOf(lesson.date))}`;
      const slot =
        lesson.slot === null ? '' : ` · ${t('journal.grid.slot', { number: lesson.slot })}`;
      const reason = cancelled
        ? lesson.cancelled?.reason === null || lesson.cancelled?.reason === undefined
          ? t('journal.grid.cancelled')
          : t('journal.grid.cancelledReason', { reason: lesson.cancelled.reason })
        : null;
      const closedSign = (
        <span
          className="text-muted-foreground"
          aria-label={t('journal.grid.closed')}
          title={t('journal.grid.closed')}
        >
          ·
        </span>
      );
      const children: ColDef<GridRow>[] = [
        {
          colId: `${lesson.id}:a`,
          headerName: t('journal.grid.attendanceShort'),
          headerComponentParams: {
            label: t('journal.grid.attendance'),
            // Task 8.4: the lock of the lesson for the reader, under the A.
            ...(lesson.held && lesson.lock.window === 'locked'
              ? { second: t('journal.locks.lockedShort') }
              : lesson.lock.window === 'unlocked'
                ? { second: t('journal.locks.unlockedShort') }
                : {}),
            ...(entering && lesson.canEnter
              ? {
                  action: {
                    label: t('journal.entry.allPresent'),
                    disabled: busy,
                    run: () => {
                      entry?.allPresent(lesson.id);
                    },
                  },
                }
              : {}),
            // Task 8.3a: "copy attendance" on the second lesson of a double (edge/timetable).
            ...(entering && lesson.canEnter && lesson.copyFrom !== null
              ? {
                  copy: {
                    label: t('journal.saving.copy'),
                    icon: 'copy',
                    disabled: busy,
                    run: () => {
                      entry?.copy(lesson.id);
                    },
                  },
                }
              : {}),
            // Task 8.1: the works of the lesson ("No plan", added by hand, not held, given).
            ...(works !== undefined && graded && lessonWorksShown(lesson)
              ? {
                  more: {
                    label: t('journal.works.button'),
                    icon: 'more',
                    disabled: works.busy,
                    run: () => {
                      works.openLesson(lesson);
                    },
                  },
                }
              : {}),
          },
          width: lesson.canEnter ? 64 : 52,
          cellClass: (params) =>
            cn(
              cancelled ||
                (params.data?.kind === 'student' &&
                  params.data.student.cells[index]?.closed === true)
                ? 'bg-muted'
                : undefined,
              // Task 8.2: a comment on the mark, or the student's note of the lesson.
              marked(params.data, (studentId) => ({
                target: 'mark',
                lessonId: lesson.id,
                studentId,
              })) ??
                marked(params.data, (studentId) => ({
                  target: 'note',
                  lessonId: lesson.id,
                  studentId,
                })),
            ),
          cellRenderer: (params: ICellRendererParams<GridRow>) => {
            const row = params.data;
            if (row?.kind !== 'student') return null;
            const cell = row.student.cells[index];
            if (cell === undefined) return null;
            // Task 8.3a: saving, saved or not saved (07: "shows a saved sign").
            const state = entry?.stateOf(lesson.id, row.student.id);
            const savedSign = state !== undefined && <SaveSign state={state} />;
            // Task 8.5: an exempt cell shows 4 or 5, set by the system and closed (07, In the journal).
            if (cell.exempt !== null) {
              return (
                <span
                  data-exempt={cell.exempt}
                  className="rounded-sm bg-muted px-1.5 py-0.5 text-muted-foreground"
                  title={t(`journal.grid.exemptCell.${cell.exempt}`)}
                >
                  {cell.exempt === 'full' ? 5 : 4}
                </span>
              );
            }
            if (cell.mark === null) {
              if (cell.closed) return closedSign;
              // Task 8.6: an empty optional cell shows its sign (a week late: "open as optional").
              if (cell.marker?.kind === 'optional') {
                return (
                  <span>
                    {savedSign}
                    <MarkerSign marker={cell.marker} />
                  </span>
                );
              }
              return savedSign || null;
            }
            const reason =
              cell.mark === 0 || cell.mark === 3
                ? reasons.get(`${row.student.id}|${lesson.date}`)
                : undefined;
            const reasonText =
              reason === undefined
                ? undefined
                : t('journal.entry.reason', {
                    category: t(
                      `journal.absences.categories.${reason}` as 'journal.absences.categories.unknown',
                    ),
                  });
            return (
              <span
                title={
                  [
                    cell.typedBy === null
                      ? undefined
                      : t('journal.entry.typedBy', { name: cell.typedBy }),
                    reasonText,
                  ]
                    .filter((part) => part !== undefined)
                    .join(' · ') || undefined
                }
              >
                <span
                  data-mark={cell.mark}
                  className={cn('rounded-sm px-1.5 py-0.5', MARK_TINT[cell.mark], struck)}
                >
                  {cell.mark}
                </span>
                <MarkerSign marker={cell.marker} />
                {reasonText !== undefined && (
                  <span
                    className="ml-0.5 inline-flex align-middle text-info"
                    role="img"
                    aria-label={reasonText}
                    title={reasonText}
                    data-reason={reason}
                  >
                    <InfoIcon className="size-3.5" aria-hidden="true" />
                  </span>
                )}
                {savedSign}
              </span>
            );
          },
        },
      ];
      lesson.works.forEach((work, workIndex) => {
        const short =
          work.kind === 'classwork'
            ? t('journal.grid.classworkShort', { number: work.position })
            : t('journal.grid.homeworkShort', { number: work.position });
        // The plan's title (09: "The titles come from the plan"); a work added by hand is numbered.
        const title = work.title ?? `${short} · ${t('journal.works.unplanned')}`;
        const enterable = works !== undefined && lesson.canEnterWorks && work.total !== null;
        // Task 8.7 (From 8.6): an optional cell of a locked lesson open now takes its number.
        const openCell = (cell: JournalStudent['cells'][number] | undefined) =>
          works !== undefined && work.total !== null && cell?.open === true;
        children.push({
          colId: `${lesson.id}:${workKey(work)}`,
          headerName: title,
          headerTooltip:
            work.carriedFrom === null ? title : `${title} · ${t('journal.works.carried')}`,
          headerComponentParams: {
            second:
              work.total === null
                ? t('journal.grid.soni')
                : `${t('journal.grid.soni')} ${work.total}`,
            label: work.notHeld ? `${title}, ${t('journal.grid.notHeld')}` : title,
            ...(works === undefined
              ? {}
              : {
                  more: {
                    label: t('journal.works.workTitle', { name: title }),
                    icon: 'more',
                    disabled: works.busy,
                    run: () => {
                      works.openWork(lesson, work);
                    },
                  },
                }),
          },
          width: 112,
          suppressKeyboardEvent: dialogKey,
          editable: (params) =>
            params.data?.kind === 'student' &&
            params.data.student.cells[index]?.closed !== true &&
            (enterable || openCell(params.data.student.cells[index])),
          valueGetter: (params) =>
            params.data?.kind === 'student'
              ? (params.data.student.cells[index]?.works[workIndex]?.score ?? null)
              : null,
          // A number is saved when the cell is left (edge/journal: "not per key"); the grid
          // shows the server's answer, so the row is never changed here.
          valueSetter: (params) => {
            const row = params.data;
            if (works === undefined || row?.kind !== 'student' || work.total === null) return false;
            const value = typedScore(params.newValue, work.total);
            if (value === undefined) {
              onRefusedNumber?.(work.total);
              return false;
            }
            const before = row.student.cells[index]?.works[workIndex]?.score ?? null;
            if (value !== before) works.score(lesson, work, row.student, value);
            return false;
          },
          cellClass: (params) =>
            cn(
              cancelled ||
                (params.data?.kind === 'student' &&
                  params.data.student.cells[index]?.closed === true)
                ? 'bg-muted'
                : undefined,
              work.id === null
                ? undefined
                : marked(params.data, (studentId) => ({
                    target: 'work',
                    lessonId: lesson.id,
                    workId: work.id ?? '',
                    studentId,
                  })),
            ),
          cellRenderer: (params: ICellRendererParams<GridRow>) => {
            const row = params.data;
            if (row?.kind !== 'student') return null;
            const cell = row.student.cells[index];
            const typed = cell?.works[workIndex];
            const state =
              works === undefined ? undefined : works.stateOf(lesson.id, row.student.id, work);
            if (typed === undefined || typed.score === null) {
              if (cell?.closed === true) return closedSign;
              // Task 8.7: "not graded", left out of the average (`07`, Lesson status).
              if (typed?.notGraded === true) {
                return (
                  <span
                    data-not-graded="true"
                    className="text-muted-foreground"
                    title={t('journal.notGraded.sign')}
                    aria-label={t('journal.notGraded.sign')}
                  >
                    —
                    <SaveSign state={state} />
                  </span>
                );
              }
              return (
                <span>
                  <SaveSign state={state} />
                  {typed?.marker?.kind === 'optional' && <MarkerSign marker={typed.marker} />}
                </span>
              );
            }
            return (
              <span
                className={struck}
                data-score={typed.score}
                title={typed.onAbsent ? t('journal.works.onAbsent') : undefined}
              >
                {typed.score}
                {typed.percent !== null && (
                  <span className="ml-1 text-xs text-muted-foreground">{typed.percent}%</span>
                )}
                <MarkerSign marker={typed.marker} />
                {typed.onAbsent && (
                  <span
                    className="ml-0.5 inline-flex align-middle text-warning"
                    role="img"
                    aria-label={t('journal.works.onAbsent')}
                    data-on-absent="true"
                  >
                    <InfoIcon className="size-3.5" aria-hidden="true" />
                  </span>
                )}
                <SaveSign state={state} />
              </span>
            );
          },
        });
      });
      if (whole && !grid.journal.attendanceOnly && lesson.works.length > 0) {
        children.push({
          colId: `${lesson.id}:avg`,
          headerName: t('journal.grid.avg'),
          headerComponentParams: { label: t('journal.grid.lessonScore') },
          width: 60,
          cellRenderer: (params: ICellRendererParams<GridRow>) => {
            const row = params.data;
            if (row?.kind !== 'student') return null;
            const score = row.student.cells[index]?.score ?? null;
            return score === null ? null : <span className="font-semibold">{score}</span>;
          },
        });
      }
      // "No plan" on a held lesson with no plan item (edge/journal).
      const noPlan =
        graded && lesson.held && !lesson.planItem ? ` · ${t('journal.works.noPlan')}` : '';
      // Task 8.7 (`07`, Lesson status: "in the journal header"), in words.
      const status =
        lesson.status === null ? '' : ` · ${t(`journal.lessonStatus.${lesson.status}`)}`;
      return {
        groupId: lesson.id,
        headerName:
          reason === null ? `${date}${slot}${noPlan}${status}` : `${date}${slot} · ${reason}`,
        headerTooltip: reason ?? undefined,
        headerClass: cancelled ? 'bg-muted text-muted-foreground' : undefined,
        children: children.map((child) => ({
          ...child,
          headerComponent: TwoLineHeader,
          sortable: false,
          suppressMovable: true,
          // The cancelled lesson's reason under its date (07, Layout: "grey with the reason").
          ...(reason === null ? {} : { headerTooltip: reason }),
        })),
      };
    }

    return [
      { groupId: 'students', headerName: '', children: students },
      ...(figures.length === 0
        ? []
        : [
            {
              groupId: 'figures',
              headerName:
                month === null
                  ? t('journal.grid.quarterFigures', { number: grid.quarter.number })
                  : t('journal.grid.monthFigures'),
              children: figures,
            },
          ]),
      ...lessonGroups,
    ];
  }, [
    grid,
    t,
    language,
    figuresOf,
    figuresShown,
    graded,
    whole,
    month,
    reasons,
    busy,
    entering,
    entry,
    works,
    onRefusedNumber,
    rating,
    marked,
    entryText,
  ]);

  /** The comment target of a column for a student: an A cell, a stored work's cell or the rating column. */
  const commentCellOf = useCallback(
    (colId: string, studentId: string): CommentCell | null => {
      if (colId === 'ratingExam')
        return grid.rating === null ? null : { target: 'rating', studentId };
      const lesson = grid.lessons.find((one) => colId.startsWith(`${one.id}:`));
      if (lesson === undefined) return null;
      const rest = colId.slice(lesson.id.length + 1);
      if (rest === 'a') return { target: 'mark', lessonId: lesson.id, studentId };
      const work = lesson.works.find((one) => one.id !== null && workKey(one) === rest);
      return work?.id == null
        ? null
        : { target: 'work', lessonId: lesson.id, workId: work.id, studentId };
    },
    [grid.lessons, grid.rating],
  );

  /**
   * The keyboard of an A cell (`07`, Keyboard: "digits type"; `edge/journal`: "An attendance
   * digit saves at once and moves down"): 0 to 3 save, Delete or Backspace clears, H opens the
   * history. Every other key types nothing.
   */
  const onCellKeyDown = useCallback(
    (event: CellKeyDownEvent<GridRow>) => {
      const current = entry;
      const key = event.event instanceof KeyboardEvent ? event.event.key : null;
      const colId = event.column.getColId();
      const row = event.data;
      const code = event.event instanceof KeyboardEvent ? event.event.code : null;
      // Task 8.2 (decision 11): the key at C opens the comment of the cell in every layout,
      // the key at E the rating entry's dialog.
      if (row?.kind === 'student' && code !== null) {
        const cellOf = commentCellOf(colId, row.student.id);
        if (code === 'KeyC' && cellOf !== null && comments !== undefined) {
          comments.open(cellOf);
          return;
        }
        if (code === 'KeyE' && colId === 'ratingExam' && rating !== undefined) {
          rating.openEntry(row.student);
          return;
        }
      }
      if (current === undefined || key === null || row?.kind !== 'student' || !colId.endsWith(':a'))
        return;
      const lessonId = colId.slice(0, -2);
      const index = grid.lessons.findIndex((one) => one.id === lessonId);
      const lesson = grid.lessons[index];
      if (lesson === undefined) return;
      if (key === 'h' || key === 'H') {
        current.openHistory(lessonId, row.student);
        return;
      }
      const cell = row.student.cells[index];
      if (cell === undefined || cell.closed || (!lesson.canEnter && !cell.open)) return;
      const mark = MARK_KEYS[key];
      if (mark !== undefined || key === 'Delete' || key === 'Backspace') {
        current.mark(lessonId, row.student, mark ?? null);
        if (mark !== undefined && event.rowIndex !== null) {
          event.api.setFocusedCell(event.rowIndex + 1, colId);
        }
      }
    },
    [grid.lessons, entry, comments, rating, commentCellOf],
  );

  /** Whether the works button of a lesson has anything to show. */
  function lessonWorksShown(lesson: JournalLesson): boolean {
    return (
      lesson.canEnterWorks ||
      lesson.notHeldWorks.length > 0 ||
      lesson.given.length > 0 ||
      (lesson.held && !lesson.planItem)
    );
  }

  const pinnedBottomRowData = useMemo(
    (): GridRow[] => (bottom === null ? [] : [{ kind: 'bottom', bottom }]),
    [bottom],
  );

  return (
    <div className="h-[70vh] min-h-96" data-journal-grid="true">
      <AgGridReact<GridRow>
        // Room for the "all present" button under the A of a lesson the reader enters.
        headerHeight={
          (grid.lessons.some((lesson) => lesson.canEnter) && entering) || works !== undefined
            ? 64
            : 40
        }
        singleClickEdit={false}
        stopEditingWhenCellsLoseFocus
        modules={[AllCommunityModule]}
        theme={THEME}
        rowData={rows}
        columnDefs={columnDefs}
        pinnedBottomRowData={pinnedBottomRowData}
        defaultColDef={{ sortable: false, resizable: true, suppressMovable: true }}
        getRowId={(params) =>
          params.data.kind === 'student'
            ? params.data.student.id
            : params.data.kind === 'section'
              ? `section:${params.data.which}`
              : 'bottom'
        }
        isFullWidthRow={(params) => params.rowNode.data?.kind === 'section'}
        fullWidthCellRenderer={(params: ICellRendererParams<GridRow>) =>
          params.data?.kind === 'section' && params.data.which === 'exempt' ? (
            <button
              type="button"
              className="h-full w-full px-4 text-left font-semibold"
              aria-expanded={exemptOpen}
              onClick={onToggleExempt}
            >
              {t('journal.grid.exemptSection', { count: exempt.length })}
            </button>
          ) : (
            <button
              type="button"
              className="h-full w-full px-4 text-left font-semibold"
              aria-expanded={foldedOpen}
              onClick={onToggleFolded}
            >
              {t('journal.grid.folded', { count: foldedCount })}
            </button>
          )
        }
        // jsdom has no layout: every column is drawn there, as AG Grid cannot measure.
        suppressColumnVirtualisation={import.meta.env.MODE === 'test'}
        onCellKeyDown={onCellKeyDown}
        onCellDoubleClicked={(event) => {
          const colId = event.column.getColId();
          if (event.data?.kind === 'student' && colId.endsWith(':a')) {
            entry?.openHistory(colId.slice(0, -2), event.data.student);
          }
        }}
        onGridReady={(event) => {
          api.current = event.api;
        }}
        onFirstDataRendered={(event) => {
          if (scrollTo !== null) event.api.ensureColumnVisible(`${scrollTo}:a`, 'start');
        }}
      />
    </div>
  );
}
