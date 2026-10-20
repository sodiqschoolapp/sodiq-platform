import {
  absenceEditSchema,
  absenceRecordSchema,
  type Absence,
  type AbsenceEdit,
  type AbsenceRecord,
} from '@sodiq/shared';
import { useTranslation } from 'react-i18next';
import { CHECKED, CheckboxField, DateField, Field, SelectField } from '@/components/field';
import { RecordForm } from '@/components/form/record-form';
import { useRecordForm } from '@/components/form/use-record-form';

interface NewAbsenceFormProps {
  /** The persons of the branch who may be absent, by name. */
  people: readonly { id: string; name: string }[];
  /** The first day offered: today in branch time. */
  today: string;
  label: string;
  onSave: (record: AbsenceRecord) => Promise<void>;
}

/**
 * A new absence (task 5.7a-1): the person, the first day, the last day or
 * "no return date yet", and the reason, checked with the schema the server
 * checks.
 */
export function NewAbsenceForm({ people, today, label, onSave }: NewAbsenceFormProps) {
  const { t } = useTranslation();
  const form = useRecordForm({
    schema: absenceRecordSchema,
    initial: { staffId: '', startsOn: today, endsOn: today, open: '', reason: '' },
    read: (typed) => ({
      staffId: typed.staffId,
      startsOn: typed.startsOn,
      endsOn: typed.open === CHECKED ? null : typed.endsOn,
      reason: typed.reason,
    }),
    message: (field) => (field === 'staffId' ? t('timetable.absences.personChoose') : undefined),
    save: onSave,
  });
  const open = form.bind('open').value === CHECKED;
  return (
    <RecordForm form={form} label={label}>
      <SelectField
        label={t('timetable.absences.person')}
        options={[
          { value: '', label: t('timetable.absences.personChoose') },
          ...people.map((one) => ({ value: one.id, label: one.name })),
        ]}
        {...form.bind('staffId')}
      />
      <DateField label={t('timetable.absences.firstDay')} {...form.bind('startsOn')} />
      <CheckboxField label={t('timetable.absences.openEnded')} {...form.bind('open')} />
      {!open && <DateField label={t('timetable.absences.lastDay')} {...form.bind('endsOn')} />}
      <Field label={t('timetable.absences.reason')} autoComplete="off" {...form.bind('reason')} />
    </RecordForm>
  );
}

interface AbsenceDatesFormProps {
  absence: Absence;
  label: string;
  onSave: (edit: AbsenceEdit) => Promise<void>;
  onCancel: () => void;
}

/**
 * A change of the days of an absence (task 5.7a-1, decision 5): the first
 * day only while the absence has not started (the server refuses it
 * afterwards), the last day or "no return date yet".
 */
export function AbsenceDatesForm({ absence, label, onSave, onCancel }: AbsenceDatesFormProps) {
  const { t } = useTranslation();
  const form = useRecordForm({
    schema: absenceEditSchema,
    initial: {
      startsOn: absence.startsOn,
      endsOn: absence.endsOn ?? absence.startsOn,
      open: absence.endsOn === null ? CHECKED : '',
    },
    read: (typed) => ({
      startsOn: typed.startsOn,
      endsOn: typed.open === CHECKED ? null : typed.endsOn,
    }),
    save: onSave,
  });
  const open = form.bind('open').value === CHECKED;
  const started = absence.state !== 'planned';
  return (
    <RecordForm form={form} label={label} onCancel={onCancel}>
      <DateField
        label={t('timetable.absences.firstDay')}
        disabled={started}
        {...form.bind('startsOn')}
      />
      <CheckboxField label={t('timetable.absences.openEnded')} {...form.bind('open')} />
      {!open && <DateField label={t('timetable.absences.lastDay')} {...form.bind('endsOn')} />}
    </RecordForm>
  );
}
