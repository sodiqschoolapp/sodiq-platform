import { weekdaySchema, type GridAnswer, type RuleResultAnswer } from '@sodiq/shared';
import type { PatternBlock } from '@sodiq/timetable-rules';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { rangeText } from '@/features/setup/templates-api';
import { weekdayName } from '@/lib/dates';
import { GridTile } from './grid-tile';
import type { ClockBoard } from './use-slot-status';

type Row = GridAnswer['rows'][number];

/**
 * The view of one teacher or one room on a clock axis (task 5.4b-1,
 * decisions 6, 7 and 9): weekdays across, the spans of time down; each
 * lesson read only, with a button to its class board, where it is moved; in a
 * teacher's view the lessons in other branches as grey blocks marked with the
 * branch, which cannot be moved from here (06, Teachers who work in several
 * branches, Busy elsewhere).
 */
export function GridClockBoard({
  board,
  name,
  rowsById,
  roomsById,
  results,
  branchName,
  classOf,
  onOpenClass,
}: {
  board: ClockBoard;
  /** What the board shows, for the table's data attribute. */
  name: string;
  rowsById: ReadonlyMap<string, Row>;
  roomsById: ReadonlyMap<string, string>;
  results: readonly RuleResultAnswer[];
  branchName: (branchId: string) => string;
  /** The class board a block opens; `null` when it has none. */
  classOf: (block: PatternBlock) => string | null;
  onOpenClass: (classId: string) => void;
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm" data-clock-board={name}>
        <thead>
          <tr>
            <th className="p-1 text-left font-semibold">
              <span className="sr-only">{t('timetable.grid.time')}</span>
            </th>
            {board.weekdays.map((weekday) => (
              <th key={weekday} className="p-1 text-left font-semibold">
                {weekdayName(language, weekdaySchema.parse(weekday))}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {board.rows.map((row) => (
            <tr key={`${String(row.start)}-${String(row.end)}`}>
              <th scope="row" className="p-1 text-left align-top font-semibold whitespace-nowrap">
                {rangeText(t, row.start, row.end)}
              </th>
              {board.weekdays.map((weekday) => {
                const blocks = board.blocksAt(weekday, row);
                const elsewhere = board.elsewhereAt(weekday, row);
                return (
                  <td
                    key={weekday}
                    className="border border-border p-1 align-top"
                    data-clock-cell={`${String(weekday)}:${String(row.start)}-${String(row.end)}`}
                  >
                    <div className="grid gap-1">
                      {blocks.map((block) => {
                        const classId = classOf(block);
                        return (
                          <div key={block.id} className="grid gap-1">
                            <GridTile
                              block={block}
                              rowsById={rowsById}
                              roomsById={roomsById}
                              results={results}
                              branchName={branchName}
                              editable={false}
                              onMove={() => undefined}
                              onRemove={() => undefined}
                            />
                            {classId !== null && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  onOpenClass(classId);
                                }}
                              >
                                {t('timetable.grid.openClass')}
                              </Button>
                            )}
                          </div>
                        );
                      })}
                      {elsewhere.map((lesson) => (
                        <div
                          key={lesson.id}
                          data-busy-elsewhere={lesson.id}
                          className="rounded-md bg-muted p-1.5 text-xs text-muted-foreground"
                        >
                          {t('timetable.grid.busyElsewhere', {
                            branch: branchName(lesson.branchId),
                          })}
                        </div>
                      ))}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
