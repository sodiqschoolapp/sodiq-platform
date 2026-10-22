import type {
  JournalBottom,
  JournalFigures,
  JournalGrid as Grid,
  JournalLesson,
  JournalStudent,
} from '@sodiq/shared';
import {
  AllCommunityModule,
  themeQuartz,
  type ColDef,
  type ColGroupDef,
  type GridApi,
  type ICellRendererParams,
  type IHeaderParams,
} from 'ag-grid-community';
import { AgGridReact } from 'ag-grid-react';
import { cn } from 'cn';
import { useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { schoolDateText, weekdayName } from '@/lib/dates';

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
  | { readonly kind: 'section'; readonly count: number }
  | { readonly kind: 'bottom'; readonly bottom: JournalBottom };

type Weekday = Parameters<typeof weekdayName>[1];

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
  accentColor: 'var(--primary)',
  fontFamily: 'inherit',
  fontSize: 14,
  rowHeight: 36,
  headerHeight: 40,
  wrapperBorderRadius: 0,
});

/** A header of two lines: the title, and "Soni" with the total under a work. */
function TwoLineHeader(props: IHeaderParams & { second?: string; label?: string }) {
  return (
    <div className="grid leading-tight" aria-label={props.label}>
      <span className="font-semibold">{props.displayName}</span>
      {props.second !== undefined && (
        <span className="text-xs text-muted-foreground">{props.second}</span>
      )}
    </div>
  );
}

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
  /** The lesson to scroll to on opening. */
  readonly scrollTo: string | null;
}

export function JournalGridView({
  grid,
  month,
  members,
  folded,
  foldedCount,
  foldedOpen,
  onToggleFolded,
  scrollTo,
}: GridProps): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const api = useRef<GridApi<GridRow> | null>(null);
  const whole = grid.shape === 'whole';
  const figuresShown = grid.shape !== 'lessons';
  const graded = !grid.journal.attendanceOnly && grid.shape !== 'attendance';

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
    if (foldedCount > 0) {
      shown.push({ kind: 'section', count: foldedCount });
      if (foldedOpen)
        shown.push(...folded.map((student) => ({ kind: 'student' as const, student })));
    }
    return shown;
  }, [members, folded, foldedCount, foldedOpen]);

  const columnDefs = useMemo((): (ColDef<GridRow> | ColGroupDef<GridRow>)[] => {
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
          figures.push(
            figure(
              'ratingExam',
              t('journal.grid.ratingExam'),
              (f) => f.ratingExam,
              (b) => b.ratingExam,
            ),
          );
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
            return (
              <span data-result={result.shown}>
                {result.shown}
                {result.provisional && (
                  <span className="ml-1 text-xs text-muted-foreground">
                    {t('journal.grid.provisionalShort')}
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
          headerComponentParams: { label: t('journal.grid.attendance') },
          width: 52,
          cellClass: (params) =>
            params.data?.kind === 'student' && params.data.student.cells[index]?.closed === true
              ? 'bg-muted'
              : undefined,
          cellRenderer: (params: ICellRendererParams<GridRow>) => {
            const row = params.data;
            if (row?.kind !== 'student') return null;
            const cell = row.student.cells[index];
            if (cell === undefined) return null;
            if (cell.mark === null) return cell.closed ? closedSign : null;
            return (
              <span
                data-mark={cell.mark}
                className={cn('rounded-sm px-1.5 py-0.5', MARK_TINT[cell.mark], struck)}
              >
                {cell.mark}
              </span>
            );
          },
        },
      ];
      lesson.works.forEach((work, workIndex) => {
        const title =
          work.kind === 'classwork'
            ? t('journal.grid.classworkShort', { number: work.position })
            : t('journal.grid.homeworkShort', { number: work.position });
        children.push({
          colId: `${lesson.id}:${work.id}`,
          headerName: title,
          headerComponentParams: {
            second:
              work.total === null
                ? t('journal.grid.soni')
                : `${t('journal.grid.soni')} ${work.total}`,
            label: work.notHeld ? `${title}, ${t('journal.grid.notHeld')}` : title,
          },
          width: 96,
          cellClass: (params) =>
            params.data?.kind === 'student' && params.data.student.cells[index]?.closed === true
              ? 'bg-muted'
              : undefined,
          cellRenderer: (params: ICellRendererParams<GridRow>) => {
            const row = params.data;
            if (row?.kind !== 'student') return null;
            const cell = row.student.cells[index];
            const typed = cell?.works[workIndex];
            if (typed === undefined || typed.score === null)
              return cell?.closed === true ? closedSign : null;
            return (
              <span className={struck} data-score={typed.score}>
                {typed.score}
                {typed.percent !== null && (
                  <span className="ml-1 text-xs text-muted-foreground">{typed.percent}%</span>
                )}
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
      return {
        groupId: lesson.id,
        headerName: `${date}${slot}`,
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
  }, [grid, t, language, figuresOf, figuresShown, graded, whole, month]);

  const pinnedBottomRowData = useMemo(
    (): GridRow[] => (bottom === null ? [] : [{ kind: 'bottom', bottom }]),
    [bottom],
  );

  return (
    <div className="h-[70vh] min-h-96" data-journal-grid="true">
      <AgGridReact<GridRow>
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
              ? 'section'
              : 'bottom'
        }
        isFullWidthRow={(params) => params.rowNode.data?.kind === 'section'}
        fullWidthCellRenderer={() => (
          <button
            type="button"
            className="h-full w-full px-4 text-left font-semibold"
            aria-expanded={foldedOpen}
            onClick={onToggleFolded}
          >
            {t('journal.grid.folded', { count: foldedCount })}
          </button>
        )}
        // jsdom has no layout: every column is drawn there, as AG Grid cannot measure.
        suppressColumnVirtualisation={import.meta.env.MODE === 'test'}
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
