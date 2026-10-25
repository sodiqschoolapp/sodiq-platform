import { PLAN_MINIMUM_MAX, type PlanMinimums } from '@sodiq/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FailureAlert } from '@/components/failure-alert';
import { NumberField } from '@/components/field';
import { wholeNumber } from '@/components/form/form-messages';
import { EmptyState, ErrorState, LoadingOutline } from '@/components/states';
import { Button } from '@/components/ui/button';
import { PANEL, SECTION_TITLE } from '@/components/ui/control';
import { useView } from '@/features/access/use-view';
import { nameOf } from '@/features/setup/setup-api';
import { invalidatePlans, planMinimumsQuery, savePlanMinimum } from './plans-api';

type Subject = PlanMinimums['subjects'][number];

/** A typed minimum: a whole number from 0 to the limit, else `undefined`. */
const minimumOf = (typed: string): number | undefined => {
  const value = wholeNumber(typed);
  return typeof value === 'number' && value >= 0 && value <= PLAN_MINIMUM_MAX ? value : undefined;
};

/**
 * The minimum works of each subject per quarter (task 8.8, pull request #226,
 * decision 11; `edge/lesson-plans`: "Each subject can have a minimum number of
 * classworks and homeworks per quarter, set by the Academic Vice Principal.
 * Falling below it is a warning at the end of the window"). The server says
 * whether the reader sets them.
 */
export function PlanMinimumsSection() {
  const { t } = useTranslation();
  const { branchId } = useView();
  const minimums = useQuery(planMinimumsQuery(branchId));
  const data = minimums.data;
  return (
    <section className={`${PANEL} grid gap-3 p-4`} aria-labelledby="plan-minimums">
      <h2 id="plan-minimums" className={SECTION_TITLE}>
        {t('plans.minimum.title')}
      </h2>
      <p className="text-sm text-muted-foreground">{t('plans.minimum.hint')}</p>
      {minimums.isError ? (
        <ErrorState
          error={minimums.error}
          onRetry={() => {
            void minimums.refetch();
          }}
        />
      ) : data === undefined ? (
        <LoadingOutline />
      ) : data.subjects.length === 0 ? (
        <EmptyState title={t('plans.minimum.title')} text={t('plans.minimum.empty')} />
      ) : (
        <ul className="grid gap-3">
          {data.subjects.map((subject) => (
            <MinimumRow
              key={`${subject.subject.id}:${String(subject.version)}`}
              subject={subject}
              canEdit={data.canEdit}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function MinimumRow({ subject, canEdit }: { subject: Subject; canEdit: boolean }) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [classworks, setClassworks] = useState(String(subject.classworks));
  const [homeworks, setHomeworks] = useState(String(subject.homeworks));
  const save = useMutation({
    mutationFn: (values: { classworks: number; homeworks: number }) =>
      savePlanMinimum({ subjectId: subject.subject.id, ...values, version: subject.version }),
    onSettled: () => invalidatePlans(queryClient),
  });
  const name = nameOf(subject.subject.names, i18n.language);
  const errorOf = (typed: string): string => {
    const value = wholeNumber(typed);
    if (typeof value !== 'number') return t('form.wholeNumber');
    return value < 0 ? t('form.tooSmall', { min: 0 }) : t('form.tooBig', { max: PLAN_MINIMUM_MAX });
  };
  const typedClassworks = minimumOf(classworks);
  const typedHomeworks = minimumOf(homeworks);
  if (!canEdit) {
    return (
      <li className="flex flex-wrap gap-4 text-sm" data-minimum={subject.subject.id}>
        <span className="font-semibold">{name}</span>
        <span>
          {t('plans.minimum.classworks')}: {subject.classworks}
        </span>
        <span>
          {t('plans.minimum.homeworks')}: {subject.homeworks}
        </span>
      </li>
    );
  }
  return (
    <li className="grid gap-2" data-minimum={subject.subject.id}>
      <div className="flex flex-wrap items-end gap-3">
        <span className="w-44 font-semibold">{name}</span>
        <div className="w-36">
          <NumberField
            label={t('plans.minimum.classworks')}
            value={classworks}
            error={typedClassworks === undefined ? errorOf(classworks) : undefined}
            onChange={(event) => {
              setClassworks(event.target.value);
            }}
          />
        </div>
        <div className="w-36">
          <NumberField
            label={t('plans.minimum.homeworks')}
            value={homeworks}
            error={typedHomeworks === undefined ? errorOf(homeworks) : undefined}
            onChange={(event) => {
              setHomeworks(event.target.value);
            }}
          />
        </div>
        <Button
          variant="secondary"
          disabled={save.isPending || typedClassworks === undefined || typedHomeworks === undefined}
          onClick={() => {
            if (typedClassworks === undefined || typedHomeworks === undefined) return;
            save.mutate({ classworks: typedClassworks, homeworks: typedHomeworks });
          }}
        >
          {t('plans.minimum.save')}
        </Button>
        {save.isSuccess && <span className="text-sm">{t('plans.minimum.saved')}</span>}
      </div>
      {save.isError && <FailureAlert error={save.error} />}
    </li>
  );
}
