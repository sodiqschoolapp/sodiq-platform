import { weekdaySchema, type RuleResultAnswer } from '@sodiq/shared';
import type { RuleResult } from '@sodiq/timetable-rules';
import { ApiException } from '../../http/api-exception.js';

/** `pattern_blocked` with the blocked results named, each with its weekday and lessons. */
export function blockedRefusal(blocked: readonly RuleResult[]): ApiException {
  return new ApiException(
    'pattern_blocked',
    409,
    undefined,
    blocked.map((result) => {
      const answer = resultAnswerOf(result);
      return {
        path: '',
        code: result.rule,
        message: 'A blocked rule of the timetable.',
        rule: { weekday: answer.weekday, lessonIds: answer.lessonIds },
      };
    }),
  );
}

/** A result as the answer and a refusal name it: a weekday, or `null` for the week. */
export const resultAnswerOf = (result: RuleResult): RuleResultAnswer => ({
  rule: result.rule,
  severity: result.severity,
  weekday: result.day === '' ? null : weekdaySchema.parse(Number(result.day)),
  lessonIds: [...result.lessonIds],
  ...(result.detail === undefined ? {} : { detail: { ...result.detail } }),
});
