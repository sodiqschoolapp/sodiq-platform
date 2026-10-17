import { placeRecordSchema, weekdaySchema, type GridAnswer, type PlaceRecord } from '@sodiq/shared';
import type { PatternModel } from '@sodiq/timetable-rules';
import { useTranslation } from 'react-i18next';
import { SelectField } from '@/components/field';
import { SECTION_TITLE } from '@/components/ui/control';
import { wholeNumber } from '@/components/form/form-messages';
import { RecordForm } from '@/components/form/record-form';
import { useRecordForm } from '@/components/form/use-record-form';
import { nameOf } from '@/features/setup/setup-api';
import { rangeText } from '@/features/setup/templates-api';
import { weekdayName } from '@/lib/dates';
import { unitText } from './grid-tile';
import { positionFor, type BoardCell } from './use-slot-status';

type Row = GridAnswer['rows'][number];

/**
 * The rows a person may place in an empty slot of a class's board (06,
 * Editing in the grid: "added by clicking an empty lesson slot and choosing
 * subject, class or group, teacher and room"; task 5.4a, decisions 6 to 8):
 * the class's rows and the rows of groups that draw from it (review
 * correction 2), one per block, not a half of a mixed split, those with
 * lessons left first; each with the position of the slot in its own template.
 */
export function placeableRows(
  grid: GridAnswer,
  model: PatternModel,
  classId: string,
  cell: BoardCell,
): { row: Row; placed: number; position: number }[] {
  const seen = new Set<string>();
  const found: { row: Row; placed: number; position: number }[] = [];
  for (const row of grid.rows) {
    if (row.mixedBlock) continue;
    const engineRow = model.rowOf(row.id);
    const unit = model.unitOf(engineRow.classId ?? engineRow.groupId ?? '');
    if (!unit.classIds.includes(classId)) continue;
    const blockKey = engineRow.block.join(',');
    if (seen.has(blockKey)) continue;
    seen.add(blockKey);
    const position = positionFor(
      model,
      { lessons: engineRow.block.map((id) => ({ id, loadRowId: id, roomId: null })) },
      cell,
    );
    if (position === null) continue;
    const placed = placedCount(grid, row.id);
    found.push({ row, placed, position });
  }
  const left = (one: { row: Row; placed: number }) => one.placed < one.row.lessonsPerWeek;
  return [...found.filter(left), ...found.filter((one) => !left(one))];
}

const placedCount = (grid: GridAnswer, rowId: string): number =>
  grid.blocks.filter((block) => block.lessons.some((lesson) => lesson.loadRowId === rowId)).length;

/** The form of an empty slot: one row of the class, placed there with its whole block. */
export function GridPlaceForm({
  grid,
  model,
  classId,
  cell,
  failureText,
  onPlace,
  onCancel,
}: {
  grid: GridAnswer;
  model: PatternModel;
  classId: string;
  cell: BoardCell;
  failureText: (error: unknown) => string | undefined;
  onPlace: (record: PlaceRecord) => Promise<unknown>;
  onCancel: () => void;
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const offered = placeableRows(grid, model, classId, cell);
  const form = useRecordForm({
    schema: placeRecordSchema,
    initial: { loadRowId: '' },
    read: (typed) => {
      const chosen = offered.find((one) => one.row.id === typed.loadRowId);
      return {
        loadRowId: chosen?.row.id ?? '',
        weekday: weekdaySchema.parse(cell.weekday),
        slotPosition: chosen?.position ?? wholeNumber(''),
      };
    },
    save: async (record: PlaceRecord) => {
      await onPlace(record);
    },
  });
  const where = t('timetable.grid.slotAt', {
    weekday: weekdayName(language, weekdaySchema.parse(cell.weekday)),
    time: rangeText(t, cell.start, cell.end),
  });
  const bound = form.bind('loadRowId');
  return (
    <section aria-labelledby="grid-place" className="grid gap-3" data-place-form="">
      <h3 id="grid-place" className={SECTION_TITLE}>
        {t('timetable.grid.placeTitle', { where })}
      </h3>
      <RecordForm
        form={form}
        label={t('timetable.grid.placeTitle', { where })}
        onCancel={onCancel}
        failureText={failureText(form.failure)}
      >
        <SelectField
          label={t('timetable.grid.lesson')}
          options={[
            { value: '', label: t('timetable.grid.choose') },
            ...offered.map((one) => ({
              value: one.row.id,
              label: t('timetable.grid.rowOption', {
                subject: nameOf(one.row.subject.names, language),
                unit: unitText(one.row),
                placed: one.placed,
                count: one.row.lessonsPerWeek,
              }),
            })),
          ]}
          {...bound}
          value={offered.some((one) => one.row.id === bound.value) ? bound.value : ''}
        />
      </RecordForm>
    </section>
  );
}
