import { weekdaySchema, type GridAnswer, type RuleResultAnswer } from '@sodiq/shared';
import type { TFunction } from 'i18next';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { WarningIcon } from '@/components/icons';
import { SelectField } from '@/components/field';
import { SECTION_TITLE } from '@/components/ui/control';
import { Button } from '@/components/ui/button';
import { nameOf } from '@/features/setup/setup-api';
import { rangeText } from '@/features/setup/templates-api';
import { schoolDateText, weekdayName } from '@/lib/dates';
import { cn } from '@/lib/utils';
import { unitText } from './grid-tile';
import { ruleText } from './rule-text';

const FILTERS = ['all', 'errors', 'warnings'] as const;

type Filter = (typeof FILTERS)[number];

const filterOf = (value: string): Filter => FILTERS.find((one) => one === value) ?? 'all';

const numberOf = (detail: RuleResultAnswer['detail'], key: string): number | null => {
  const value = detail?.[key];
  return typeof value === 'number' ? value : null;
};

/**
 * The numbers of a result in words (the From 5.4a line of task 5.4b-2:
 * "numbers of a result shown there take keys of their own with plural
 * forms"; decision 6); `null` for a rule whose text says it all.
 */
export function numbersText(
  t: TFunction,
  language: string,
  result: RuleResultAnswer,
): string | null {
  const { detail } = result;
  const n = (key: string) => numberOf(detail, key);
  switch (result.rule) {
    case 'room_shared_full': {
      const count = n('lessonsAtOnce');
      return count === null ? null : t('timetable.conflict.room_shared_full', { count });
    }
    case 'room_shared_capacity':
    case 'room_capacity': {
      const count = n('capacity');
      const students = n('students');
      return count === null || students === null
        ? null
        : t('timetable.conflict.room_capacity', { count, students });
    }
    case 'split_apart': {
      const count = n('students');
      return count === null ? null : t('timetable.conflict.split_apart', { count });
    }
    case 'travel_time': {
      const count = n('minutes');
      const gap = n('gap');
      return count === null || gap === null
        ? null
        : t('timetable.conflict.travel_time', { count, gap });
    }
    case 'teacher_week_load':
    case 'teacher_day_load':
    case 'class_day_load': {
      const count = n('limit');
      const lessons = n('lessons');
      return count === null || lessons === null
        ? null
        : t(`timetable.conflict.${result.rule}`, { count, lessons });
    }
    case 'load_mismatch': {
      const count = n('lessonsPerWeek');
      const placed = n('placed');
      return count === null || placed === null
        ? null
        : t('timetable.conflict.load_mismatch', { count, placed });
    }
    case 'teacher_unavailable_later': {
      const date = detail?.date;
      return typeof date === 'string'
        ? t('timetable.conflict.teacher_unavailable_later', {
            date: schoolDateText(date, language),
          })
        : null;
    }
    case 'class_free_period': {
      const start = n('start');
      const end = n('end');
      return start === null || end === null
        ? null
        : t('timetable.conflict.class_free_period', { time: rangeText(t, start, end) });
    }
    default:
      return null;
  }
}

/** Step 7's mark: "No errors", or the errors, and the warnings when there are any. */
export const gridMarkText = (
  t: TFunction,
  counts: { readonly blocked: number; readonly warnings: number },
): string =>
  [
    counts.blocked === 0
      ? t('timetable.builder.gridClean')
      : t('timetable.builder.gridErrors', { count: counts.blocked }),
    ...(counts.warnings === 0
      ? []
      : [t('timetable.builder.gridWarnings', { count: counts.warnings })]),
  ].join(', ');

/** Errors first, each group in the engine's order (`RULE_ORDER`, as the answer gives it). */
export const errorsFirst = (results: readonly RuleResultAnswer[]): RuleResultAnswer[] => [
  ...results.filter((one) => one.severity === 'blocked'),
  ...results.filter((one) => one.severity === 'warning'),
];

/**
 * The conflict panel of step 7 (06, Editing in the grid: "A conflict panel
 * lists every error and warning in the draft, with a button that jumps to the
 * lesson"; task 5.4b-2a, decisions 6 and 8): each result with its rule, its
 * weekday and time, its lessons and its numbers. "Show" opens the class board
 * of the first lesson of this branch, or, for a row with none placed, its
 * "To place" entry; a lesson of another branch is named by its branch and has
 * no button (the From 5.4b-1 line).
 */
export function GridConflicts({
  grid,
  branchName,
  onShowBlock,
  onShowRow,
}: {
  grid: GridAnswer;
  branchName: (branchId: string) => string;
  onShowBlock: (blockId: string) => void;
  onShowRow: (rowId: string) => void;
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const [filter, setFilter] = useState<Filter>('all');
  const rowsById = new Map(grid.rows.map((row) => [row.id, row]));
  const lessons = new Map(
    grid.blocks.flatMap((block) => block.lessons.map((lesson) => [lesson.id, { block, lesson }])),
  );
  const busy = new Map(grid.facts.busyElsewhere.map((one) => [one.id, one]));
  const drafts = new Map(grid.facts.otherDrafts.map((one) => [one.id, one]));
  const blocked = grid.results.filter((one) => one.severity === 'blocked').length;
  const shown = errorsFirst(grid.results).filter(
    (one) =>
      filter === 'all' ||
      (filter === 'errors' ? one.severity === 'blocked' : one.severity === 'warning'),
  );

  /** The weekday and time of a result: of its first lesson of this branch, else of one elsewhere. */
  const whenOf = (result: RuleResultAnswer): string | null => {
    if (result.weekday === null) return null;
    const day = weekdayName(language, weekdaySchema.parse(result.weekday));
    const first = result.lessonIds
      .map((id) => lessons.get(id)?.block ?? busy.get(id) ?? drafts.get(id))
      .find((one) => one !== undefined);
    return first === undefined
      ? day
      : t('timetable.grid.slotAt', { weekday: day, time: rangeText(t, first.start, first.end) });
  };

  const lessonText = (id: string): string | null => {
    const own = lessons.get(id);
    if (own !== undefined) {
      const row = rowsById.get(own.lesson.loadRowId);
      if (row === undefined) return null;
      const teacher =
        row.teacher.kind === 'vacancy'
          ? t('timetable.load.vacancyOption', { name: row.teacher.name ?? '' })
          : (row.teacher.name ?? '');
      return `${nameOf(row.subject.names, language)}, ${unitText(row)} · ${teacher}`;
    }
    const elsewhere = busy.get(id);
    if (elsewhere !== undefined) {
      return t('timetable.grid.busyIn', { branch: branchName(elsewhere.branchId) });
    }
    const draft = drafts.get(id);
    if (draft !== undefined) {
      return t('timetable.grid.draftIn', { branch: branchName(draft.branchId) });
    }
    return null;
  };

  return (
    <section aria-labelledby="grid-conflicts" className="grid content-start gap-2">
      <h3 id="grid-conflicts" className={SECTION_TITLE}>
        {t('timetable.grid.conflicts')}
      </h3>
      <p className="text-sm" data-conflict-count="">
        {gridMarkText(t, { blocked, warnings: grid.results.length - blocked })}
      </p>
      {grid.results.length > 0 && (
        <SelectField
          label={t('timetable.grid.conflictFilter')}
          name="conflict-filter"
          value={filter}
          options={FILTERS.map((one) => ({
            value: one,
            label: t(`timetable.grid.conflictFilters.${one}`),
          }))}
          onChange={(event) => {
            setFilter(filterOf(event.target.value));
          }}
        />
      )}
      <ul className="grid gap-1" data-conflicts="">
        {shown.map((result, index) => {
          const firstOwn = result.lessonIds.find((id) => lessons.has(id));
          const rowId = result.detail?.loadRowId;
          const when = whenOf(result);
          const numbers = numbersText(t, language, result);
          const named = result.lessonIds
            .map(lessonText)
            .filter((one): one is string => one !== null);
          return (
            <li
              // A result has no id; its place in the answer and its rule name it.
              key={`${result.rule}-${String(index)}`}
              data-conflict={result.rule}
              data-severity={result.severity}
              className="grid gap-1 rounded-md bg-card p-1.5 text-xs shadow-sm"
            >
              <span
                className={cn(
                  'inline-flex items-start gap-1 font-semibold',
                  result.severity === 'blocked' ? 'text-destructive' : 'text-warning',
                )}
              >
                <WarningIcon aria-hidden className="size-4 shrink-0" />
                <span>
                  {result.severity === 'blocked'
                    ? t('timetable.grid.error')
                    : t('timetable.grid.warning')}
                  : {ruleText(t, result.rule)}
                </span>
              </span>
              {when !== null && <span>{when}</span>}
              {named.map((text, at) => (
                <span key={`${text}-${String(at)}`}>{text}</span>
              ))}
              {numbers !== null && <span data-conflict-numbers="">{numbers}</span>}
              {firstOwn !== undefined ? (
                <div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      const own = lessons.get(firstOwn);
                      if (own !== undefined) onShowBlock(own.block.id);
                    }}
                  >
                    {t('timetable.grid.show')}
                  </Button>
                </div>
              ) : (
                typeof rowId === 'string' &&
                rowsById.has(rowId) && (
                  <div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        onShowRow(rowId);
                      }}
                    >
                      {t('timetable.grid.show')}
                    </Button>
                  </div>
                )
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
