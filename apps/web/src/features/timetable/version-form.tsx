import {
  timetableVersionCreateSchema,
  timetableVersionEditSchema,
  type AcademicYear,
  type TimetableVersion,
  type TimetableVersionCreate,
  type TimetableVersionEdit,
} from '@sodiq/shared';
import { weekdayOf } from '@sodiq/timetable-rules';
import { useTranslation } from 'react-i18next';
import { DateField, SelectField } from '@/components/field';
import { Button } from '@/components/ui/button';
import { schoolDateText } from '@/lib/dates';
import { RecordForm } from '@/components/form/record-form';
import { useRecordForm, type FieldBinding } from '@/components/form/use-record-form';

/** The Monday after `today` (`06`, Building a timetable, step 1: "next Monday by default"). */
export function nextMonday(today: string): string {
  const ahead = 8 - weekdayOf(today);
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + ahead);
  return date.toISOString().slice(0, 10);
}

/** Decision 5: next Monday, or the year's first day when that is later. */
const defaultStart = (today: string, year: AcademicYear | undefined): string => {
  const monday = nextMonday(today);
  return year !== undefined && year.startDate > monday ? year.startDate : monday;
};

/** A first day of a quarter offered as a start date. */
export interface QuarterStart {
  number: number;
  date: string;
}

/**
 * The first day of each quarter of the year on or after today (`06`,
 * Building a timetable, step 1: "the first day of a coming quarter as a
 * shortcut"; task 5.3a, decision 6). A quarter that starts today is offered
 * too, as 3.4a decision 5 allows a start today; a quarter with no dates never.
 */
export function comingQuarterStarts(year: AcademicYear | undefined, today: string): QuarterStart[] {
  return (year?.quarters ?? []).flatMap((quarter) =>
    quarter.startDate !== null && quarter.startDate >= today
      ? [{ number: quarter.number, date: quarter.startDate }]
      : [],
  );
}

/** The quarter shortcuts beside a start date field: a click puts the date in the field. */
function QuarterShortcuts({
  starts,
  field,
}: {
  starts: readonly QuarterStart[];
  field: FieldBinding;
}) {
  const { t, i18n } = useTranslation();
  if (starts.length === 0) {
    return null;
  }
  return (
    <div
      role="group"
      aria-label={t('timetable.load.quarterShortcuts')}
      className="flex flex-wrap gap-2"
    >
      {starts.map((start) => (
        <Button
          key={start.number}
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => {
            field.onChange({ target: { value: start.date } });
          }}
        >
          {t('timetable.load.quarterShortcut', {
            number: start.number,
            date: schoolDateText(start.date, i18n.language),
          })}
        </Button>
      ))}
    </div>
  );
}

interface NewDraftFormProps {
  /** The planned and current years of the branch. */
  years: readonly AcademicYear[];
  /** The versions of the branch, to copy one of the same year (decision 10). */
  versions: readonly TimetableVersion[];
  today: string;
  onSave: (record: TimetableVersionCreate) => Promise<void>;
  onCancel: () => void;
}

/** A new draft: its year, its intended start date, and empty or a copy (`06`, step 1 and 2). */
export function NewDraftForm({ years, versions, today, onSave, onCancel }: NewDraftFormProps) {
  const { t } = useTranslation();
  const current = years.find((year) => year.status === 'current') ?? years[0];
  const form = useRecordForm({
    schema: timetableVersionCreateSchema,
    initial: {
      academicYearId: current?.id ?? '',
      startsOn: defaultStart(today, current),
      copyFrom: '',
    },
    read: (typed) => ({
      academicYearId: typed.academicYearId,
      startsOn: typed.startsOn,
      // A copy no longer offered for the year chosen is not sent: the field
      // shows "Empty" then (spec review of the build, should-fix 1).
      copyFrom: versions.some(
        (version) =>
          version.id === typed.copyFrom && version.academicYearId === typed.academicYearId,
      )
        ? typed.copyFrom
        : null,
    }),
    save: onSave,
  });
  const yearId = form.bind('academicYearId').value;
  const startField = form.bind('startsOn');
  const copyField = form.bind('copyFrom');
  const sameYear = versions.filter((version) => version.academicYearId === yearId);
  // A copy of another year's version is not offered (decision 10).
  const copyValue = sameYear.some((version) => version.id === copyField.value)
    ? copyField.value
    : '';
  return (
    <RecordForm form={form} label={t('timetable.load.newDraftTitle')} onCancel={onCancel}>
      <SelectField
        label={t('timetable.load.year')}
        options={years.map((year) => ({ value: year.id, label: year.name }))}
        {...form.bind('academicYearId')}
      />
      <DateField label={t('timetable.load.startsOn')} {...startField} />
      <QuarterShortcuts
        starts={comingQuarterStarts(
          years.find((year) => year.id === yearId),
          today,
        )}
        field={startField}
      />
      <SelectField
        label={t('timetable.load.copyFrom')}
        options={[
          { value: '', label: t('timetable.load.startEmpty') },
          ...sameYear.map((version) => ({
            value: version.id,
            label: t('timetable.load.copyOption', { number: version.number }),
          })),
        ]}
        {...copyField}
        value={copyValue}
      />
    </RecordForm>
  );
}

interface StartFormProps {
  version: TimetableVersion;
  /** The first days of the coming quarters of the draft's year (`comingQuarterStarts`). */
  quarterStarts?: readonly QuarterStart[];
  onSave: (edit: TimetableVersionEdit) => Promise<void>;
  onCancel: () => void;
}

/** The intended start date of a draft (decision 5). */
export function StartForm({ version, quarterStarts = [], onSave, onCancel }: StartFormProps) {
  const { t } = useTranslation();
  const form = useRecordForm({
    schema: timetableVersionEditSchema,
    initial: { startsOn: version.startsOn },
    save: onSave,
  });
  return (
    <RecordForm form={form} label={t('timetable.load.changeStart')} onCancel={onCancel}>
      <DateField label={t('timetable.load.startsOn')} {...form.bind('startsOn')} />
      <QuarterShortcuts starts={quarterStarts} field={form.bind('startsOn')} />
    </RecordForm>
  );
}
