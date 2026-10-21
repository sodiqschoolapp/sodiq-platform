import {
  classDisplayName,
  weekdaySchema,
  type GridAnswer,
  type LeftBlockReason,
  type LoadRow,
} from '@sodiq/shared';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { SUBSECTION_TITLE } from '@/components/ui/control';
import { nameOf } from '@/features/setup/setup-api';
import { weekdayName } from '@/lib/dates';

type LeftBlock = GridAnswer['left']['blocks'][number];
type LeftLesson = LeftBlock['lessons'][number];

/** Why a copy did not keep a lesson: a load problem of its row, or a reason of the copy (task 5.8a). */
export const leftReasonText = (t: TFunction, reason: LeftBlockReason): string =>
  reason.startsWith('copy_')
    ? t(`timetable.history.left.${reason as Exclude<LeftBlockReason, `load_${string}`>}`)
    : t(`timetable.load.problems.${reason as Extract<LeftBlockReason, `load_${string}`>}`);

/** The class or group and subject of a lesson the copy left, named by its row of the version copied. */
function lessonName(rows: readonly LoadRow[], lesson: LeftLesson, language: string): string | null {
  const row = rows.find((one) => one.id === lesson.sourceRowId);
  if (row === undefined) return null;
  const unit =
    row.unit.kind === 'class'
      ? classDisplayName(row.unit.grades[0] ?? 0, row.unit.name)
      : row.unit.name;
  return `${unit}, ${nameOf(row.subject.names, language)}`;
}

/** One line per lesson of a left block: what, where in the week, and why. */
export function leftLines(
  t: TFunction,
  language: string,
  left: GridAnswer['left'],
  blocks: readonly LeftBlock[],
): string[] {
  return blocks.flatMap((block) =>
    block.lessons.map((lesson) =>
      t('timetable.history.leftLine', {
        lesson: lessonName(left.rows, lesson, language) ?? t('timetable.load.gone'),
        day: weekdayName(language, weekdaySchema.parse(block.weekday)),
        slot: block.slotPosition,
        reason: leftReasonText(t, lesson.reason),
      }),
    ),
  );
}

/**
 * The blocks of the weekly pattern a copy of a version did not keep, with
 * their reasons (task 5.8a, decision 7; `edge/academic-year`: "Entries whose
 * teacher, room, subject or class is no longer active go to the 'to place'
 * list with the reason"), those of rows the copy did not keep included.
 */
export function GridLeft({ grid }: { grid: GridAnswer }): React.JSX.Element | null {
  const { t, i18n } = useTranslation();
  if (grid.left.blocks.length === 0) return null;
  const from = grid.version.fromVersion;
  const lines = leftLines(t, i18n.language, grid.left, grid.left.blocks);
  return (
    <div className="grid gap-1" data-left-blocks="">
      <h4 className={SUBSECTION_TITLE}>
        {from === null
          ? t('timetable.history.leftTitle')
          : t('timetable.history.leftFrom', { number: from.number })}
      </h4>
      <ul className="grid gap-1 text-xs">
        {lines.map((line, index) => (
          <li key={index} data-left-block="">
            {line}
          </li>
        ))}
      </ul>
    </div>
  );
}
