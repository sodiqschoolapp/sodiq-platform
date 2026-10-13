import { WEIGHTS_TOTAL, dailyWeightsSchema, quarterWeightsSchema } from '@sodiq/shared';
import { useTranslation } from 'react-i18next';
import { NumberField } from '@/components/field';
import { wholeNumber } from '@/components/form/form-messages';
import { RecordForm } from '@/components/form/record-form';
import { useRecordForm, type RecordFormState } from '@/components/form/use-record-form';

/** The parts of a distribution (`05`, Grading weights on a subject). */
export const WEIGHT_PARTS = ['attendance', 'classwork', 'homework', 'ratingExam'] as const;

export type WeightPart = (typeof WEIGHT_PARTS)[number];

/** The parts and the total, which the schemas refuse under `total`. */
type WeightField = WeightPart | 'total';

export interface Weights {
  attendance: number;
  classwork: number;
  homework: number;
  ratingExam?: number | null;
}

/** "10 · 50 · 40", or with the rating exam "10 · 30 · 20 · 40", in the order of `05`. */
export function weightsText(weights: Weights, language: string): string {
  const number = new Intl.NumberFormat(language);
  return [weights.attendance, weights.classwork, weights.homework, weights.ratingExam]
    .filter((part): part is number => typeof part === 'number')
    .map((part) => number.format(part))
    .join(' · ');
}

/** The sum of what is typed in the parts shown, whole numbers only; `null` while one is not a number. */
function typedTotal(
  parts: readonly WeightPart[],
  typed: (part: WeightPart) => string,
): number | null {
  let total = 0;
  for (const part of parts) {
    const value = wholeNumber(typed(part));
    if (typeof value !== 'number') {
      return null;
    }
    total += value;
  }
  return total;
}

/**
 * The fields of a distribution and its running total. The total is refused
 * by the schema of `packages/shared` under `total` (`05`: "Each distribution
 * must total 100. The form will not save otherwise"); its text is written
 * under the total, after Save was pressed.
 */
export function WeightFields<Field extends string>({
  form,
  parts,
  prefix = '',
}: {
  form: RecordFormState<Field>;
  parts: readonly WeightPart[];
  /** The names of the fields in a form that holds more than the weights. */
  prefix?: string;
}) {
  const { t, i18n } = useTranslation();
  const number = new Intl.NumberFormat(i18n.language);
  const name = (part: WeightField) => `${prefix}${part}` as Field;
  const total = typedTotal(parts, (part) => form.bind(name(part)).value);
  const totalError = form.bind(name('total')).error;
  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {parts.map((part) => (
          <NumberField
            key={part}
            label={t(`setup.subjects.parts.${part}`)}
            {...form.bind(name(part))}
          />
        ))}
      </div>
      <p
        className={totalError === undefined ? 'text-sm' : 'text-sm text-destructive'}
        role={totalError === undefined ? undefined : 'alert'}
      >
        {total === null
          ? t('setup.subjects.totalUnknown', { required: number.format(WEIGHTS_TOTAL) })
          : t('setup.subjects.total', {
              total: number.format(total),
              required: number.format(WEIGHTS_TOTAL),
            })}
        {totalError !== undefined && <> {totalError}</>}
      </p>
    </div>
  );
}

interface WeightsFormProps {
  /** The parts shown: three, or four with the rating exam. */
  parts: readonly WeightPart[];
  /** What is stored; `null` when nothing is. */
  weights: Weights | null;
  /** A daily distribution has no rating exam key; a quarterly one has it, `null` when not shown. */
  kind: 'daily' | 'quarter';
  label: string;
  onSave: (weights: Weights) => Promise<void>;
  /** Closes the form (opened in the side panel). */
  onCancel?: () => void;
}

/** One distribution saved on its own: the daily one of the branch, or one quarter's. */
export function WeightsForm({ parts, weights, kind, label, onSave, onCancel }: WeightsFormProps) {
  const { t } = useTranslation();
  const initial = (part: WeightPart): string => {
    const value = weights?.[part];
    return typeof value === 'number' ? String(value) : '';
  };
  const form = useRecordForm<WeightField, Weights>({
    schema: kind === 'daily' ? dailyWeightsSchema : quarterWeightsSchema,
    initial: {
      attendance: initial('attendance'),
      classwork: initial('classwork'),
      homework: initial('homework'),
      ratingExam: initial('ratingExam'),
      total: '',
    },
    read: (typed) => ({
      attendance: wholeNumber(typed.attendance),
      classwork: wholeNumber(typed.classwork),
      homework: wholeNumber(typed.homework),
      ...(kind === 'quarter'
        ? { ratingExam: parts.includes('ratingExam') ? wholeNumber(typed.ratingExam) : null }
        : {}),
    }),
    message: (field) => (field === 'total' ? t('setup.subjects.totalWrong') : undefined),
    // A saved distribution shows "Saved." and a change from elsewhere (finding 18).
    followInitial: true,
    save: onSave,
  });
  return (
    <RecordForm form={form} label={label} onCancel={onCancel}>
      <WeightFields form={form} parts={parts} />
    </RecordForm>
  );
}
