import {
  dayTemplateRecordSchema,
  dayTemplateVersionRecordSchema,
  minutesOf,
  timeOfDaySchema,
  type DayTemplateRecord,
  type DayTemplateVersionRecord,
  type SlotType,
} from '@sodiq/shared';
import { dayTimes } from '@sodiq/timetable-rules';
import { useTranslation } from 'react-i18next';
import { DateField, Field, listValue, listValues, OrderedListField } from '@/components/field';
import { RecordForm } from '@/components/form/record-form';
import { useRecordForm, type FieldBinding } from '@/components/form/use-record-form';
import { lengthOn, rangeText } from './templates-api';

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
  const lengths = ids.map((id) => {
    const slotType = known.get(id);
    return slotType === undefined ? null : lengthOn(slotType, date);
  });
  const timed =
    timeOfDaySchema.safeParse(startTime).success && lengths.every((length) => length !== null)
      ? dayTimes(
          minutesOf(startTime),
          ids.map((id, index) => ({
            kind: known.get(id)?.kind ?? 'lesson',
            lengthMinutes: lengths[index] ?? 0,
          })),
        )
      : null;
  const label = (slotType: SlotType) =>
    `${slotType.name} · ${t(`setup.slotTypes.kinds.${slotType.kind}`)}`;
  return (
    <OrderedListField
      label={t('setup.dayTemplates.slots')}
      options={[
        ...slotTypes
          .filter((slotType) => slotType.archivedAt === null)
          .map((slotType) => ({ value: slotType.id, label: label(slotType) })),
        // Archived ones still in the list are named, never offered.
        ...[...new Set(ids)]
          .map((id) => known.get(id))
          .filter(
            (slotType): slotType is SlotType =>
              slotType !== undefined && slotType.archivedAt !== null,
          )
          .map((slotType) => ({ value: slotType.id, label: label(slotType) })),
      ]}
      detail={(_id, index) => {
        const slot = timed?.slots[index];
        return slot === undefined ? '' : rangeText(slot.start, slot.end);
      }}
      {...binding}
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
    schema: dayTemplateRecordSchema,
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
    schema: dayTemplateVersionRecordSchema,
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
