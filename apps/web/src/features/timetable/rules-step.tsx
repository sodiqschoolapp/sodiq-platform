import {
  PREFERENCE_CODES,
  PREFERENCE_WEIGHT_MAX,
  preferenceWeightsSchema,
  type DraftReadiness,
  type PreferenceCode,
  type PreferenceWeights,
} from '@sodiq/shared';
import { FIXED_RULES } from '@sodiq/timetable-rules';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { FailureAlert } from '@/components/failure-alert';
import { SelectField } from '@/components/field';
import { wholeNumber } from '@/components/form/form-messages';
import { RecordForm } from '@/components/form/record-form';
import { useRecordForm } from '@/components/form/use-record-form';
import { StatusMark } from '@/components/status-mark';
import { Button } from '@/components/ui/button';
import { SECTION_TITLE } from '@/components/ui/control';
import { PinsSection } from './pins-section';
import { confirmRules, saveWeights } from './timetable-api';

type Typed = Record<PreferenceCode, string>;

const typedOf = (weights: PreferenceWeights): Typed => {
  const typed = {} as Typed;
  for (const code of PREFERENCE_CODES) {
    typed[code] = String(weights[code]);
  }
  return typed;
};

const readTyped = (typed: Typed): Record<PreferenceCode, number | string | undefined> => {
  const read = {} as Record<PreferenceCode, number | string | undefined>;
  for (const code of PREFERENCE_CODES) {
    read[code] = wholeNumber(typed[code]);
  }
  return read;
};

/**
 * Step 5 of the draft builder (06, Building a timetable: "Reviews the fixed
 * rules, sets the weight of each preference ... Ready when: Confirmed"; task
 * 5.3b-1, pull request #128): the fixed rules of the rule engine, the weight
 * of each preference from 0 (not used) to 10, and the confirmation of the
 * weights shown. Confirm is off while the form holds weights not saved
 * (decision 9); without `timetable` `edit` the weights are shown only.
 * Task 5.3b-2: the pinned lessons, which the confirmation covers.
 */
export function RulesStep({
  versionId,
  rules,
  cells,
  canEdit,
  onChanged,
}: {
  versionId: string;
  rules: DraftReadiness['rules'];
  /** The table of step 1, whose slots a pin names. */
  cells: DraftReadiness['templates']['cells'];
  canEdit: boolean;
  onChanged: () => Promise<unknown>;
}): React.JSX.Element {
  const { t } = useTranslation();
  const form = useRecordForm({
    schema: preferenceWeightsSchema,
    initial: typedOf(rules.weights),
    read: readTyped,
    save: async (weights: PreferenceWeights) => {
      await saveWeights(versionId, weights);
      await onChanged();
    },
    followInitial: true,
  });
  const confirm = useMutation({
    mutationFn: () =>
      confirmRules(
        versionId,
        rules.weights,
        rules.pins.map((pin) => pin.id),
      ),
    onSuccess: onChanged,
  });
  const options = Array.from({ length: PREFERENCE_WEIGHT_MAX + 1 }, (_, weight) => ({
    value: String(weight),
    label: weight === 0 ? t('timetable.builder.rulesStep.weightOption0') : String(weight),
  }));

  return (
    <div className="grid gap-6">
      <section aria-labelledby="fixed-rules" className="grid gap-2">
        <h3 id="fixed-rules" className={SECTION_TITLE}>
          {t('timetable.builder.rulesStep.fixedRules')}
        </h3>
        <ul className="grid list-disc gap-1 pl-5 text-sm">
          {FIXED_RULES.map((code) => (
            <li key={code} data-rule={code}>
              {t(`timetable.rule.${code}`)}
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="preference-weights" className="grid gap-3">
        <h3 id="preference-weights" className={SECTION_TITLE}>
          {t('timetable.builder.rulesStep.weights')}
        </h3>
        {canEdit ? (
          <RecordForm form={form} label={t('timetable.builder.rulesStep.weights')}>
            {PREFERENCE_CODES.map((code) => (
              <SelectField
                key={code}
                label={t(`timetable.preference.${code}`)}
                options={options}
                {...form.bind(code)}
              />
            ))}
          </RecordForm>
        ) : (
          <dl className="grid gap-2 text-sm">
            {PREFERENCE_CODES.map((code) => (
              <div key={code} data-preference={code} className="grid gap-0.5">
                <dt>{t(`timetable.preference.${code}`)}</dt>
                <dd className="font-semibold">
                  {rules.weights[code] === 0
                    ? t('timetable.builder.rulesStep.weightOption0')
                    : rules.weights[code]}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </section>
      <PinsSection
        versionId={versionId}
        rules={rules}
        cells={cells}
        canEdit={canEdit}
        onChanged={onChanged}
      />
      <div className="flex flex-wrap items-center gap-3">
        <StatusMark
          done={rules.confirmed}
          text={
            rules.confirmed
              ? t('timetable.builder.confirmed')
              : rules.changed.length > 0
                ? t('timetable.builder.rulesStep.changedSince', {
                    names: rules.changed
                      .map((code) => t(`timetable.preference.${code}`))
                      .join('; '),
                  })
                : rules.pinsChanged
                  ? t('timetable.builder.rulesStep.pinsChangedSince')
                  : t('timetable.builder.notConfirmed')
          }
        />
        {canEdit && !rules.confirmed && (
          <Button
            disabled={confirm.isPending || form.dirty}
            onClick={() => {
              confirm.mutate();
            }}
          >
            {t('timetable.builder.rulesStep.confirm')}
          </Button>
        )}
        {canEdit && !rules.confirmed && form.dirty && (
          <p className="text-sm text-muted-foreground" data-reason="saveFirst">
            {t('timetable.builder.rulesStep.saveFirst')}
          </p>
        )}
      </div>
      {confirm.isError && <FailureAlert error={confirm.error} />}
    </div>
  );
}
