import {
  classDisplayName,
  pinRecordSchema,
  type DraftReadiness,
  type LoadRow,
  type PinAnswer,
  type PinRecord,
  type Weekday,
} from '@sodiq/shared';
import { FIXED_RULES, sharedLessonSlots, type Day, type FixedRule } from '@sodiq/timetable-rules';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { FailureAlert } from '@/components/failure-alert';
import { ErrorState, LoadingOutline } from '@/components/states';
import { SelectField } from '@/components/field';
import { wholeNumber } from '@/components/form/form-messages';
import { RecordForm } from '@/components/form/record-form';
import { useRecordForm } from '@/components/form/use-record-form';
import { Button } from '@/components/ui/button';
import { SECTION_TITLE } from '@/components/ui/control';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useView } from '@/features/access/use-view';
import { nameOf } from '@/features/setup/setup-api';
import { rangeText } from '@/features/setup/templates-api';
import { weekdayName } from '@/lib/dates';
import { createPin, deletePin, loadQuery } from './timetable-api';

type Cell = DraftReadiness['templates']['cells'][number];

const unitText = (unit: LoadRow['unit']): string =>
  unit.kind === 'class' ? classDisplayName(unit.grades[0] ?? 0, unit.name) : unit.name;

/** The day of a cell as the rule engine reads it. */
const dayOf = (cell: Cell | undefined): Day | null =>
  cell?.template == null
    ? null
    : {
        start: cell.template.start,
        end: cell.template.end,
        slots: cell.template.slots.map((slot, index, all) => ({
          ...slot,
          lessonNumber:
            slot.kind === 'lesson'
              ? all.slice(0, index + 1).filter((one) => one.kind === 'lesson').length
              : null,
        })),
      };

/**
 * The lesson slots a row may be pinned to on a weekday, by position in the
 * template of its lowest grade (task 5.3b-2, decisions 2 and 10): for a
 * group of two grades only the slots with the same times in both templates,
 * as the rule engine reads them (`sharedLessonSlots`).
 */
export function pinSlots(
  cells: readonly Cell[],
  grades: readonly number[],
  weekday: number,
): { position: number; start: number; end: number }[] {
  const sorted = [...new Set(grades)].sort((a, b) => a - b);
  const days = sorted.map((grade) =>
    dayOf(cells.find((cell) => cell.weekday === weekday && cell.grade === grade)),
  );
  const [first, ...others] = days;
  if (first == null || others.some((day) => day === null)) return [];
  return first.slots
    .filter((slot) => slot.kind === 'lesson')
    .filter((slot) =>
      others.every(
        (day) =>
          day !== null &&
          sharedLessonSlots(first, day).some(
            (shared) => shared.start === slot.start && shared.end === slot.end,
          ),
      ),
    )
    .map((slot) => ({ position: slot.position, start: slot.start, end: slot.end }));
}

/** A blocked result of a weekly pattern is one of `FIXED_RULES`, each with its text (5.3b-1). */
const isFixedRule = (rule: string): rule is FixedRule =>
  (FIXED_RULES as readonly string[]).includes(rule);

const FIELDS = { loadRowId: '', weekday: '', slotPosition: '' };

/**
 * The pinned lessons of step 5 (06, Building a timetable, step 5: "pins
 * lessons that must stay at a fixed time (for example the Homework slot at
 * the end of the day)"; task 5.3b-2): the pins with the time of their slot
 * today, the blocked conflicts of the pins checked on their own and the pins
 * the engine cannot check, and, with `timetable` `edit`, Pin and Remove.
 */
export function PinsSection({
  versionId,
  rules,
  cells,
  canEdit,
  onChanged,
}: {
  versionId: string;
  rules: DraftReadiness['rules'];
  cells: readonly Cell[];
  canEdit: boolean;
  onChanged: () => Promise<unknown>;
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const { branchId } = useView();
  const load = useQuery({ ...loadQuery(branchId, versionId), enabled: canEdit });
  const rows = (load.data?.rows ?? []).filter((row) => !row.mixedBlock);
  const weekdays = [...new Set(cells.map((cell) => cell.weekday))].sort((a, b) => a - b);

  // A choice no longer offered (the load or the templates changed) falls back
  // to none, so what the form sends is what the fields show.
  const offered = (typed: Record<keyof typeof FIELDS, string>) => {
    const row = rows.find((one) => one.id === typed.loadRowId);
    const weekday = weekdays.find((one) => String(one) === typed.weekday);
    const slots =
      row === undefined || weekday === undefined ? [] : pinSlots(cells, row.unit.grades, weekday);
    const slot = slots.find((one) => String(one.position) === typed.slotPosition);
    return { row, weekday, slots, slot };
  };
  const form = useRecordForm({
    schema: pinRecordSchema,
    initial: FIELDS,
    read: (typed) => {
      const { row, weekday, slot } = offered(typed);
      return {
        loadRowId: row?.id ?? '',
        weekday: weekday ?? wholeNumber(''),
        slotPosition: slot?.position ?? wholeNumber(''),
      };
    },
    save: async (pin: PinRecord) => {
      await createPin(versionId, pin);
      await onChanged();
    },
  });
  const remove = useMutation({
    mutationFn: (pinId: string) => deletePin(versionId, pinId),
    onSuccess: onChanged,
  });

  const ruleText = (rule: string) =>
    isFixedRule(rule) ? t(`timetable.rule.${rule}`) : t('timetable.builder.pins.otherRule');
  const pinText = (pin: PinAnswer) =>
    t('timetable.builder.pins.pinText', {
      unit: unitText(pin.unit),
      subject: nameOf(pin.subject.names, language),
      weekday: weekdayName(language, pin.weekday),
      position: pin.slotPosition,
    });
  const named = (ids: readonly string[]) =>
    ids
      .map((id) => rules.pins.find((pin) => pin.id === id))
      .filter((pin): pin is PinAnswer => pin !== undefined)
      .map(pinText)
      .join('; ');

  const shown = offered({
    loadRowId: form.bind('loadRowId').value,
    weekday: form.bind('weekday').value,
    slotPosition: form.bind('slotPosition').value,
  });
  const slots = shown.slots;
  const valueOf = (field: keyof typeof FIELDS, kept: unknown) => ({
    ...form.bind(field),
    value: kept === undefined ? '' : form.bind(field).value,
  });

  return (
    <section aria-labelledby="pinned-lessons" className="grid gap-3">
      <h3 id="pinned-lessons" className={SECTION_TITLE}>
        {t('timetable.builder.pins.title')}
      </h3>
      {rules.pins.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('timetable.builder.pins.none')}</p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('timetable.builder.pins.unit')}</TableHead>
                <TableHead>{t('timetable.builder.pins.subject')}</TableHead>
                <TableHead>{t('timetable.builder.pins.teacher')}</TableHead>
                <TableHead>{t('timetable.builder.pins.weekday')}</TableHead>
                <TableHead>{t('timetable.builder.pins.slot')}</TableHead>
                {canEdit && (
                  <TableHead>
                    <span className="sr-only">{t('timetable.builder.pins.remove')}</span>
                  </TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rules.pins.map((pin) => (
                <TableRow key={pin.id} data-pin={pin.id}>
                  <TableCell className="font-semibold">{unitText(pin.unit)}</TableCell>
                  <TableCell>{nameOf(pin.subject.names, language)}</TableCell>
                  <TableCell>
                    {pin.teacher.kind === 'vacancy'
                      ? t('timetable.load.vacancyOption', { name: pin.teacher.name ?? '' })
                      : (pin.teacher.name ?? '')}
                  </TableCell>
                  <TableCell>{weekdayName(language, pin.weekday)}</TableCell>
                  <TableCell>
                    {pin.time === null
                      ? t('timetable.builder.pins.slotMissing', { position: pin.slotPosition })
                      : t('timetable.builder.pins.slotOption', {
                          position: pin.slotPosition,
                          time: rangeText(t, pin.time.start, pin.time.end),
                        })}
                  </TableCell>
                  {canEdit && (
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={remove.isPending}
                        onClick={() => {
                          remove.mutate(pin.id);
                        }}
                      >
                        {t('timetable.builder.pins.remove')}
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {rules.conflicts.length > 0 && (
        <div className="grid gap-1" data-pin-conflicts="">
          <p className="text-sm font-semibold text-destructive">
            {t('timetable.builder.pins.conflicts')}
          </p>
          <ul className="grid list-disc gap-1 pl-5 text-sm">
            {rules.conflicts.map((conflict) => (
              <li key={`${conflict.rule}|${conflict.pinIds.join(',')}`} data-rule={conflict.rule}>
                <span className="font-semibold">{ruleText(conflict.rule)}</span>
                {' · '}
                {named(conflict.pinIds)}
              </li>
            ))}
          </ul>
        </div>
      )}
      {rules.problems.length > 0 && (
        <ul className="grid list-disc gap-1 pl-5 text-sm text-destructive" data-pin-problems="">
          {rules.problems.map((problem) => (
            <li key={`${problem.pinId}|${problem.problem}`} data-problem={problem.problem}>
              {t(`timetable.builder.pins.problems.${problem.problem}`)} · {named([problem.pinId])}
            </li>
          ))}
        </ul>
      )}
      {canEdit && load.isError && (
        <ErrorState
          error={load.error}
          onRetry={() => {
            void load.refetch();
          }}
        />
      )}
      {canEdit && load.isPending && <LoadingOutline lines={2} />}
      {canEdit && load.isSuccess && (
        <RecordForm form={form} label={t('timetable.builder.pins.add')}>
          <SelectField
            label={t('timetable.builder.pins.row')}
            options={[
              { value: '', label: t('timetable.builder.pins.choose') },
              ...rows.map((row) => ({
                value: row.id,
                label: `${unitText(row.unit)}, ${nameOf(row.subject.names, language)}`,
              })),
            ]}
            {...valueOf('loadRowId', shown.row)}
          />
          <SelectField
            label={t('timetable.builder.pins.weekday')}
            options={[
              { value: '', label: t('timetable.builder.pins.choose') },
              ...weekdays.map((weekday: Weekday) => ({
                value: String(weekday),
                label: weekdayName(language, weekday),
              })),
            ]}
            {...valueOf('weekday', shown.weekday)}
          />
          <SelectField
            label={t('timetable.builder.pins.slot')}
            options={[
              { value: '', label: t('timetable.builder.pins.choose') },
              ...slots.map((slot) => ({
                value: String(slot.position),
                label: t('timetable.builder.pins.slotOption', {
                  position: slot.position,
                  time: rangeText(t, slot.start, slot.end),
                }),
              })),
            ]}
            {...valueOf('slotPosition', shown.slot)}
          />
        </RecordForm>
      )}
      {remove.isError && <FailureAlert error={remove.error} />}
    </section>
  );
}
