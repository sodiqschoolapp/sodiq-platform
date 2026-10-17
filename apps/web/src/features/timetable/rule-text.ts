import { RULE_ORDER, type RuleCode } from '@sodiq/timetable-rules';
import type { TFunction } from 'i18next';

const isRuleCode = (rule: string): rule is RuleCode =>
  (RULE_ORDER as readonly string[]).includes(rule);

/**
 * The text of a rule of the engine (`timetable.rule.<code>`, every code of
 * `RULE_ORDER`; task 5.4a), as the grid, a refusal and a tile name it; a code
 * this version of the app does not know reads as a rule of the timetable.
 */
export const ruleText = (t: TFunction, rule: string): string =>
  isRuleCode(rule) ? t(`timetable.rule.${rule}`) : t('timetable.grid.otherRule');
