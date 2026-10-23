import type { PlanImpact } from '@sodiq/shared';
import { useTranslation } from 'react-i18next';
import { SUBSECTION_TITLE } from '@/components/ui/control';

/** A subject's name in the language of the page, English when missing. */
const subjectName = (names: { uz: string; ru: string; en: string }, language: string) =>
  (language === 'uz' ? names.uz : language === 'ru' ? names.ru : names.en) || names.en;

/**
 * What a change of the timetable does to each lesson plan (task 7.1b;
 * `edge/lesson-plans`, How items stay attached: "The impact preview shows,
 * per plan, items that no longer fit and rows left empty"), shown in every
 * preview of such a change. Nothing when no plan moves.
 */
export function PlanImpactList({ plans }: { plans: readonly PlanImpact[] }) {
  const { t, i18n } = useTranslation();
  if (plans.length === 0) return null;
  return (
    <section className="grid gap-1" data-plan-impact="true" aria-labelledby="plan-impact-title">
      <h4 id="plan-impact-title" className={SUBSECTION_TITLE}>
        {t('plans.impact.title')}
      </h4>
      <p className="text-sm text-muted-foreground">{t('plans.impact.text')}</p>
      <ul className="grid gap-2 text-sm">
        {plans.map((plan) => (
          <li key={`${plan.journalId}|${String(plan.quarter)}`} className="grid gap-0.5">
            <span className="font-medium">
              {t('plans.impact.plan', {
                unit: plan.unit,
                subject: subjectName(plan.subject.names, i18n.language),
                quarter: plan.quarter,
              })}
            </span>
            {plan.moved > 0 && <span>{t('plans.impact.moved', { count: plan.moved })}</span>}
            {plan.notFitting.length > 0 && (
              <span>{t('plans.impact.notFitting', { topics: plan.notFitting.join('; ') })}</span>
            )}
            {plan.emptyRows > 0 && (
              <span>{t('plans.impact.emptyRows', { count: plan.emptyRows })}</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
