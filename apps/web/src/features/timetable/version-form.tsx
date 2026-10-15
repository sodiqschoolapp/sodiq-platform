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
import { RecordForm } from '@/components/form/record-form';
import { useRecordForm } from '@/components/form/use-record-form';

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
      <DateField label={t('timetable.load.startsOn')} {...form.bind('startsOn')} />
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
  onSave: (edit: TimetableVersionEdit) => Promise<void>;
  onCancel: () => void;
}

/** The intended start date of a draft (decision 5). */
export function StartForm({ version, onSave, onCancel }: StartFormProps) {
  const { t } = useTranslation();
  const form = useRecordForm({
    schema: timetableVersionEditSchema,
    initial: { startsOn: version.startsOn },
    save: onSave,
  });
  return (
    <RecordForm form={form} label={t('timetable.load.changeStart')} onCancel={onCancel}>
      <DateField label={t('timetable.load.startsOn')} {...form.bind('startsOn')} />
    </RecordForm>
  );
}
