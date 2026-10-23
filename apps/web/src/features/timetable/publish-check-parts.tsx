import { type PublishCheck, type PublishRefusal, type RuleResultAnswer } from '@sodiq/shared';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { WarningIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { SECTION_TITLE } from '@/components/ui/control';
import { schoolDateText, weekdayName } from '@/lib/dates';
import { numbersText } from './grid-conflicts';
import { ruleText } from './rule-text';
import { PlanImpactList } from '@/components/plan-impact-list';

/** How the lists of a publish check name what they show; `null` when a name is not known. */
export interface PublishNames {
  /** A load row of the version checked, as "class, subject". */
  rowName: (id: string | undefined) => string | null;
  /** The lessons of pattern entries, joined; empty when none is known. */
  lessonsText: (entryIds: readonly string[]) => string;
  branchName: (id: string | number | undefined) => string | null;
  subjectName: (id: string | undefined) => string | null;
}

/**
 * The words of a publish check's refusals and dated results (task 5.7a-3b,
 * decision 9: moved out of the publish step so a fill shows what a publish
 * shows). A row, lesson, branch or subject not named falls back to a text
 * without its name.
 */
export function publishTexts(
  t: TFunction,
  language: string,
  { rowName, lessonsText, branchName, subjectName }: PublishNames,
): {
  datedText: (result: RuleResultAnswer) => string;
  refusalText: (refusal: PublishRefusal) => string;
} {
  /** A result of a date: its date, its rule, its lessons and another branch it meets. */
  const datedText = (result: RuleResultAnswer): string => {
    const other = result.detail?.['branchId'];
    const branch = branchName(other);
    return [
      t('timetable.publish.refusals.date_blocked', {
        date: schoolDateText(result.date ?? '', language),
        rule: ruleText(t, result.rule),
      }),
      lessonsText(result.lessonIds),
      other === undefined
        ? null
        : branch === null
          ? t('timetable.publish.busyInAnother')
          : t('timetable.publish.busyIn', { branch }),
    ]
      .filter(Boolean)
      .join('. ');
  };

  /** One reason in words; a row or subject the load no longer holds falls back to a text without its name. */
  const refusalText = (refusal: PublishRefusal): string => {
    switch (refusal.code) {
      case 'draft_not_ready':
        return t('timetable.publish.refusals.draft_not_ready', {
          step: t(`timetable.builder.steps.${refusal.step ?? 'templates'}`),
        });
      case 'load_problem': {
        const name = rowName(refusal.loadRowId);
        const problem =
          refusal.problem === undefined ? '' : t(`timetable.load.problems.${refusal.problem}`);
        return name === null
          ? t('timetable.publish.refusals.load_problem_row', { problem })
          : t('timetable.publish.refusals.load_problem', { row: name, problem });
      }
      case 'load_vacancy_closed': {
        const name = rowName(refusal.loadRowId);
        return name === null
          ? t('timetable.publish.refusals.load_vacancy_closed_row')
          : t('timetable.publish.refusals.load_vacancy_closed', { row: name });
      }
      case 'load_mismatch': {
        const name = rowName(refusal.loadRowId);
        const placed = refusal.result?.detail?.['placed'];
        const wanted = refusal.result?.detail?.['lessonsPerWeek'];
        const numbers =
          typeof placed === 'number' && typeof wanted === 'number'
            ? t('timetable.publish.placedOf', { count: wanted, placed })
            : '';
        return name === null
          ? t('timetable.publish.refusals.load_mismatch_row', { numbers })
          : t('timetable.publish.refusals.load_mismatch', { row: name, numbers });
      }
      case 'pattern_blocked': {
        const result = refusal.result;
        if (result === undefined) return t('timetable.publish.refusals.pattern_blocked_any');
        const day = result.weekday === null ? null : weekdayName(language, result.weekday);
        const numbers = numbersText(t, language, result);
        const rule = ruleText(t, result.rule);
        return [day === null ? rule : `${day}: ${rule}`, numbers].filter(Boolean).join('. ');
      }
      case 'subject_daily_weights': {
        const name = subjectName(refusal.subjectId);
        return name === null
          ? t('timetable.publish.refusals.subject_daily_weights_any')
          : t('timetable.publish.refusals.subject_daily_weights', { subject: name });
      }
      case 'subject_quarter_weights': {
        const name = subjectName(refusal.subjectId);
        const quarter = refusal.quarter ?? 1;
        return name === null
          ? t('timetable.publish.refusals.subject_quarter_weights_any', { quarter })
          : t('timetable.publish.refusals.subject_quarter_weights', { subject: name, quarter });
      }
      case 'date_blocked':
        return refusal.result === undefined
          ? t('timetable.publish.refusals.pattern_blocked_any')
          : datedText(refusal.result);
      case 'version_later_published':
        return t('timetable.publish.refusals.version_later_published', {
          number: refusal.versionNumber ?? 0,
        });
      case 'chain_start_taken':
        return t('timetable.publish.refusals.chain_start_taken', {
          number: refusal.versionNumber ?? 0,
        });
      case 'chain_carry_not_offered':
      case 'chain_changed':
      case 'day_change_undecided':
      case 'day_decision_unknown':
      case 'day_changes_changed':
      case 'day_choice_not_offered':
      case 'transition_unacknowledged':
      case 'version_start_too_early':
      case 'version_start_outside_year':
      case 'draft_out_of_date':
      case 'year_quarters':
        return t(`timetable.publish.refusals.${refusal.code}`);
    }
  };

  return { datedText, refusalText };
}

/**
 * The refusals, the warnings, the lessons that will need a teacher and those
 * the days cannot hold, of a publish check (`06`, How surprises are
 * prevented; tasks 5.5a-1 and 5.5a-2a), as the publish step and the fill of
 * a vacancy show them. `onOpenGrid` offers the grid beside a blocked rule.
 */
export function PublishCheckLists({
  answer,
  names,
  onOpenGrid,
}: {
  answer: PublishCheck;
  names: PublishNames;
  onOpenGrid?: () => void;
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const { lessonsText } = names;
  const { datedText, refusalText } = publishTexts(t, language, names);
  const blocked = answer.refusals.some(
    (one) => one.code === 'pattern_blocked' || one.code === 'date_blocked',
  );
  return (
    <>
      {answer.refusals.length === 0 ? (
        <p className="text-sm font-semibold" data-can-publish="true">
          {t('timetable.publish.nothingRefused')}
        </p>
      ) : (
        <section aria-labelledby="publish-refusals" className="grid gap-2">
          <h3 id="publish-refusals" className={SECTION_TITLE}>
            {t('timetable.publish.refusalsTitle', { count: answer.refusals.length })}
          </h3>
          <ul className="grid gap-1 text-sm" data-refusals="true">
            {answer.refusals.map((refusal, index) => (
              <li key={index} data-code={refusal.code}>
                {refusalText(refusal)}
              </li>
            ))}
          </ul>
          {blocked && onOpenGrid !== undefined && (
            <div>
              <Button variant="secondary" onClick={onOpenGrid}>
                {t('timetable.publish.openGrid')}
              </Button>
            </div>
          )}
        </section>
      )}
      {answer.warnings.length > 0 && (
        <section aria-labelledby="publish-warnings" className="grid gap-2">
          <h3 id="publish-warnings" className={SECTION_TITLE}>
            {t('timetable.publish.warningsTitle', { count: answer.warnings.length })}
          </h3>
          <ul className="grid gap-1 text-sm">
            {answer.warnings.map((result, index) => (
              <li key={index} className="flex items-start gap-2">
                <WarningIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                <span data-date={result.date}>
                  {result.date === undefined
                    ? [
                        result.weekday === null ? null : weekdayName(language, result.weekday),
                        ruleText(t, result.rule),
                      ]
                        .filter(Boolean)
                        .join(': ')
                    : datedText(result)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {answer.needsTeacher.length > 0 && (
        <section aria-labelledby="publish-needs-teacher" className="grid gap-2">
          <h3 id="publish-needs-teacher" className={SECTION_TITLE}>
            {t('timetable.publish.needsTeacherTitle', { count: answer.needsTeacher.length })}
          </h3>
          <p className="text-sm">{t('timetable.publish.needsTeacherNote')}</p>
          <ul className="grid gap-1 text-sm" data-needs-teacher="true">
            {answer.needsTeacher.map((one) => (
              <li key={`${one.entryId}@${one.date}`} data-reason={one.reason}>
                {[
                  schoolDateText(one.date, language),
                  lessonsText([one.entryId]),
                  t(`timetable.publish.needsTeacher.${one.reason}`),
                ]
                  .filter(Boolean)
                  .join(': ')}
              </li>
            ))}
          </ul>
        </section>
      )}
      {answer.cancelledLessons.length > 0 && (
        <section aria-labelledby="publish-cancelled" className="grid gap-2">
          <h3 id="publish-cancelled" className={SECTION_TITLE}>
            {t('timetable.publish.cancelledTitle', {
              count: answer.cancelledLessons.reduce((sum, one) => sum + one.entryIds.length, 0),
            })}
          </h3>
          <p className="text-sm">{t('timetable.publish.cancelledNote')}</p>
          <ul className="grid gap-1 text-sm" data-cancelled="true">
            {answer.cancelledLessons.map((one, index) => (
              <li key={index} data-reason={one.reason}>
                {[
                  schoolDateText(one.date, language),
                  lessonsText(one.entryIds),
                  t(`timetable.publish.cancelled.${one.reason}`),
                ]
                  .filter(Boolean)
                  .join(': ')}
              </li>
            ))}
          </ul>
        </section>
      )}
      <PlanImpactList plans={answer.plans} />
    </>
  );
}
