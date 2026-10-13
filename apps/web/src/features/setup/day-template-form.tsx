import {
  dayTemplateRecordSchema,
  dayTemplateVersionRecordSchema,
  minutesOf,
  timeOfDaySchema,
  type DayTemplateRecord,
  type DayTemplateVersionRecord,
  type SlotType,
} from '@sodiq/shared';
import { dayEndsAfterMidnight, dayTimes } from '@sodiq/timetable-rules';
import { useTranslation } from 'react-i18next';
import { DateField, Field, listValue, listValues, OrderedListField } from '@/components/field';
import { RecordForm } from '@/components/form/record-form';
import type { FormSchema } from '@/components/form/form-messages';
import { useRecordForm, type FieldBinding } from '@/components/form/use-record-form';
import { lengthOn, rangeText } from './templates-api';

/**
 * The times of a day as typed, by the rule engine's `dayTimes`; `null` while
 * the start time is not a time or a slot type has no length on the date.
 */
function typedDay(
  startTime: string,
  ids: readonly string[],
  date: string,
  slotTypes: readonly SlotType[],
) {
  const known = new Map(slotTypes.map((slotType) => [slotType.id, slotType]));
  const lengths = ids.map((id) => {
    const slotType = known.get(id);
    return slotType === undefined ? null : lengthOn(slotType, date);
  });
  return timeOfDaySchema.safeParse(startTime).success && lengths.every((length) => length !== null)
    ? dayTimes(
        minutesOf(startTime),
        ids.map((id, index) => ({
          kind: known.get(id)?.kind ?? 'lesson',
          lengthMinutes: lengths[index] ?? 0,
        })),
      )
    : null;
}

/**
 * The record's schema, and a day that runs past midnight refused on the
 * slots before anything is sent (finding 16; task 2.7b-1, decision 9): the
 * rule engine's `dayEndsAfterMidnight`, which the server also applies.
 */
function withinTheDay<Values extends { startTime: string; slotTypeIds: readonly string[] }>(
  schema: FormSchema<Values>,
  slotTypes: readonly SlotType[],
  dateOf: (values: Values) => string,
): FormSchema<Values> {
  return {
    safeParse: (input) => {
      const parsed = schema.safeParse(input);
      if (!parsed.success) {
        return parsed;
      }
      const day = typedDay(
        parsed.data.startTime,
        parsed.data.slotTypeIds,
        dateOf(parsed.data),
        slotTypes,
      );
      return day !== null && dayEndsAfterMidnight(day)
        ? { success: false, error: { issues: [{ code: 'custom', path: ['slotTypeIds'] }] } }
        : parsed;
    },
  };
}

interface SlotsProps {
  binding: FieldBinding;
  /** The start time as typed. */
  startTime: string;
  /** The date the times are shown for: the lengths in force on it apply. */
  date: string;
  slotTypes: readonly SlotType[];
}

/**
 * The slots of a template in their order, each with its calculated times
 * (`03`: "every start and end time is calculated from the order and the
 * lengths. Times are never typed by hand"), by the rule engine's `dayTimes`.
 * Only active slot types can be added; one already in the template stays named.
 */
function SlotsField({ binding, startTime, date, slotTypes }: SlotsProps) {
  const { t } = useTranslation();
  const ids = listValues(binding.value);
  const known = new Map(slotTypes.map((slotType) => [slotType.id, slotType]));
  const timed = typedDay(startTime, ids, date, slotTypes);
  // Said as soon as the day runs past midnight, before Save (finding 16).
  const pastMidnight = timed !== null && dayEndsAfterMidnight(timed);
  const active = slotTypes.filter((slotType) => slotType.archivedAt === null);
  const label = (slotType: SlotType) =>
    `${slotType.name} · ${t(`setup.slotTypes.kinds.${slotType.kind}`)}`;
  return (
    <OrderedListField
      label={t('setup.dayTemplates.slots')}
      options={[
        ...active.map((slotType) => ({ value: slotType.id, label: label(slotType) })),
        // Archived ones still in the list are named, never offered.
        ...[...new Set(ids)]
          .map((id) => known.get(id))
          .filter(
            (slotType): slotType is SlotType =>
              slotType !== undefined && slotType.archivedAt !== null,
          )
          .map((slotType) => ({ value: slotType.id, label: label(slotType) })),
      ]}
      addable={active.map((slotType) => slotType.id)}
      detail={(_id, index) => {
        const slot = timed?.slots[index];
        return slot === undefined ? '' : rangeText(t, slot.start, slot.end);
      }}
      {...binding}
      error={pastMidnight ? t('errors.day_past_midnight') : binding.error}
    />
  );
}

interface NewTemplateFormProps {
  slotTypes: readonly SlotType[];
  /** Today in branch time: a new template is in force from today (decision 4). */
  today: string;
  onSave: (record: DayTemplateRecord) => Promise<void>;
}

/** A new template: its name, its start time and its slots (owner's answer 10). */
export function NewTemplateForm({ slotTypes, today, onSave }: NewTemplateFormProps) {
  const { t } = useTranslation();
  const form = useRecordForm({
    schema: withinTheDay(dayTemplateRecordSchema, slotTypes, () => today),
    initial: { name: '', startTime: '08:00', slotTypeIds: '' },
    read: (typed) => ({
      name: typed.name,
      startTime: typed.startTime,
      slotTypeIds: listValues(typed.slotTypeIds),
    }),
    save: onSave,
  });
  const start = form.bind('startTime');
  return (
    <RecordForm form={form} label={t('setup.dayTemplates.newTitle')}>
      <Field label={t('setup.dayTemplates.name')} autoComplete="off" {...form.bind('name')} />
      <Field label={t('setup.dayTemplates.startTime')} type="time" {...start} />
      <SlotsField
        binding={form.bind('slotTypeIds')}
        startTime={start.value}
        date={today}
        slotTypes={slotTypes}
      />
    </RecordForm>
  );
}

interface VersionFormProps {
  slotTypes: readonly SlotType[];
  /** What stands in the form: the version in force on the first date offered. */
  initial: { startTime: string; slotTypeIds: readonly string[]; from: string };
  label: string;
  onSave: (record: DayTemplateVersionRecord) => Promise<void>;
}

/**
 * New slots or a new start time from a date, tomorrow at the earliest (answer
 * 12). The times are shown with the lengths in force on that date.
 */
export function VersionForm({ slotTypes, initial, label, onSave }: VersionFormProps) {
  const { t } = useTranslation();
  const form = useRecordForm({
    schema: withinTheDay(dayTemplateVersionRecordSchema, slotTypes, (values) => values.from),
    initial: {
      from: initial.from,
      startTime: initial.startTime,
      slotTypeIds: listValue(initial.slotTypeIds),
    },
    read: (typed) => ({
      from: typed.from,
      startTime: typed.startTime,
      slotTypeIds: listValues(typed.slotTypeIds),
    }),
    save: onSave,
  });
  const start = form.bind('startTime');
  const from = form.bind('from');
  return (
    <RecordForm form={form} label={label}>
      <DateField label={t('setup.dayTemplates.from')} {...from} />
      <Field label={t('setup.dayTemplates.startTime')} type="time" {...start} />
      <SlotsField
        binding={form.bind('slotTypeIds')}
        startTime={start.value}
        date={from.value === '' ? initial.from : from.value}
        slotTypes={slotTypes}
      />
    </RecordForm>
  );
}
