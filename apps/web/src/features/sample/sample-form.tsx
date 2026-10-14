import { sampleRecordSchema, type SampleRecord } from '@sodiq/shared';
import { useTranslation } from 'react-i18next';
import { Field, NumberField, SelectField } from '@/components/field';
import { wholeNumber } from '@/components/form/form-messages';
import { RecordForm } from '@/components/form/record-form';
import { useRecordForm } from '@/components/form/use-record-form';
import type { SampleRow } from './sample-rows';

interface SampleFormProps {
  row: SampleRow;
  /** Keeps the record; a refusal is thrown. */
  onSave: (record: SampleRecord) => Promise<void>;
  /** Closes the form (opened by Edit in the side panel). */
  onCancel?: () => void;
}

/**
 * Task 0.8b-2, done when: "a sample form uses only the shared pieces". The
 * record of a sample row, edited in the side panel of the sample list. The
 * page gives it `key={row.id}`: another record is another form.
 */
export function SampleForm({ row, onSave, onCancel }: SampleFormProps) {
  const { t } = useTranslation();
  const form = useRecordForm({
    schema: sampleRecordSchema,
    initial: {
      name: row.name,
      className: row.className,
      grade: String(row.grade),
      language: row.language,
      score: row.score === null ? '' : String(row.score),
    },
    read: (typed) => ({
      ...typed,
      grade: wholeNumber(typed.grade),
      // An empty field is a record without a score.
      score: wholeNumber(typed.score) ?? null,
    }),
    save: onSave,
  });

  return (
    <RecordForm form={form} label={row.name} onCancel={onCancel}>
      <Field label={t('sample.name')} autoComplete="off" {...form.bind('name')} />
      <NumberField label={t('sample.grade')} {...form.bind('grade')} />
      <Field label={t('sample.className')} autoComplete="off" {...form.bind('className')} />
      <SelectField
        label={t('sample.language')}
        options={[
          { value: 'uz', label: t('sample.uzbek') },
          { value: 'ru', label: t('sample.russian') },
        ]}
        {...form.bind('language')}
      />
      <NumberField label={t('sample.score')} note={t('sample.scoreNote')} {...form.bind('score')} />
    </RecordForm>
  );
}
