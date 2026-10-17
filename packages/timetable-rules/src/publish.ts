/**
 * Publish (task 5.5a-1, pull request #139): the start dates offered and the
 * results of the pattern check that refuse a publish.
 *
 * docs/spec/06-timetable.md, How surprises are prevented, Start date: "A
 * permanent change starts on a chosen date, next Monday by default and
 * tomorrow at the earliest, with the first day of each coming quarter offered
 * as a shortcut." Editing in the grid: "A draft with errors cannot be
 * published." Rules, last row: the difference from the load "blocks
 * publishing, unless the load row is marked 'deliberately short' with a
 * reason".
 */
import type { RuleResult } from './rules.js';
import { firstOn } from './templates.js';
import type { EngineYear } from './placement.js';

export interface StartChoices {
  /** Tomorrow in branch time. */
  readonly earliest: string;
  /** The later of next Monday and the year's first day (decision 15). */
  readonly defaultStart: string;
  /** The first days of the year's quarters on or after the earliest. */
  readonly quarterStarts: readonly string[];
}

const nextDay = (date: string): string => {
  const moved = new Date(`${date}T00:00:00Z`);
  moved.setUTCDate(moved.getUTCDate() + 1);
  return moved.toISOString().slice(0, 10);
};

/** The start dates a publish offers on `today` (branch time) in a year. */
export function startChoices(today: string, year: EngineYear): StartChoices {
  const earliest = nextDay(today);
  const monday = firstOn(earliest, 1);
  return {
    earliest,
    defaultStart: monday < year.firstDate ? year.firstDate : monday,
    quarterStarts: year.quarters
      .map((quarter) => quarter.firstDate)
      .filter((date) => date >= earliest)
      .sort(),
  };
}

export interface PublishResults {
  /** Blocked results: each refuses the publish. */
  readonly blocked: readonly RuleResult[];
  /**
   * `load_mismatch`: fewer lessons than the load on a row not marked
   * "deliberately short", or more lessons on any row (the engine leaves out a
   * short row so marked); each refuses the publish.
   */
  readonly mismatched: readonly RuleResult[];
  /** The other warnings: shown, never refusing (decision 11). */
  readonly warnings: readonly RuleResult[];
}

/** The results of a draft's pattern check, sorted by what they do to a publish. */
export function publishRefusals(results: readonly RuleResult[]): PublishResults {
  return {
    blocked: results.filter((one) => one.severity === 'blocked'),
    mismatched: results.filter((one) => one.severity !== 'blocked' && one.rule === 'load_mismatch'),
    warnings: results.filter((one) => one.severity !== 'blocked' && one.rule !== 'load_mismatch'),
  };
}
