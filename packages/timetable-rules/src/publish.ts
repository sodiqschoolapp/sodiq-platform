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
import { patternIdOf, type DatedLesson, type DatedNoTutor } from './dated.js';
import type { RuleCode, RuleResult } from './rules.js';
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

/** Why a dated lesson of a publish is "needs a teacher", listed, not refused (task 5.5a-2a). */
export type NeedsTeacherReason =
  'no_tutor' | 'tutor_clash' | 'not_available_real_day' | 'teacher_out';

export interface NeedsTeacher {
  readonly date: string;
  /** The pattern entry. */
  readonly entryId: string;
  readonly reason: NeedsTeacherReason;
}

/** The results of the dated check of a publish, sorted (task 5.5a-2a, decisions 3, 5, 6 and 9 to 11). */
export interface DatedPublishResults {
  /** Blocked results that only a date shows: each refuses the publish (`date_blocked`). */
  readonly blocked: readonly RuleResult[];
  /** `teacher_unavailable_later` by date (decision 6). */
  readonly warnings: readonly RuleResult[];
  readonly needsTeacher: readonly NeedsTeacher[];
}

export interface DatedPublishInput {
  /** The blocked results of the pattern check of the same publish. */
  readonly patternBlocked: readonly RuleResult[];
  /** Every result of the per-date checks. */
  readonly dated: readonly RuleResult[];
  /** The own lessons of the dates by placement id. */
  readonly lessons: ReadonlyMap<string, DatedLesson>;
  readonly noTutor: readonly DatedNoTutor[];
  /** The branch of a busy-elsewhere placement, of the pattern or of a date; `null` for an own one. */
  readonly fixedBranch: (id: string) => string | null;
  /** Whether the date follows another weekday than its own (a worked Saturday). */
  readonly followsOther: (date: string) => boolean;
  /** Whether the teacher is inactive or left on the start date already. */
  readonly outOnStart: (teacherId: string) => boolean;
}

/** The rules of a teacher that a Tutor lesson yields on, to "needs a teacher" (decision 11). */
const TEACHER_RULES: readonly RuleCode[] = [
  'teacher_double',
  'teacher_branch',
  'teacher_inactive',
  'teacher_subject',
  'teacher_grade',
  'teacher_language',
  'teacher_unavailable',
  'travel_time',
  'travel_time_not_set',
];

/**
 * The key a dated result repeats a pattern result by (decision 5 with review
 * correction 1): the rule, the own pattern entries, the branch of every other
 * branch's placement, and the detail without the date.
 */
function repeatKey(result: RuleResult, fixedBranch: (id: string) => string | null): string {
  const own = new Set<string>();
  const elsewhere = new Set<string>();
  for (const id of result.lessonIds) {
    const branch = fixedBranch(id);
    if (branch !== null) {
      elsewhere.add(branch);
    } else {
      own.add(patternIdOf(id)?.id ?? id);
    }
  }
  const detail = Object.entries(result.detail ?? {})
    .filter(([name]) => name !== 'date')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return [
    result.rule,
    [...own].sort().join(','),
    [...elsewhere].sort().join(','),
    JSON.stringify(detail),
  ].join('|');
}

/**
 * What the dated check of a publish does to it. A blocked result is, in this
 * order: "needs a teacher" for a Tutor lesson whose Tutor of the date is not
 * the entry's teacher (decision 11), for a teacher outside their hours on the
 * real day of a date that follows another weekday (decision 9), and for a
 * teacher inactive or left from a date after the start (decision 10); left out
 * when it repeats a blocked result of the pattern (decision 5); else a refusal.
 * Of the warnings only `teacher_unavailable_later` is kept (decisions 3, 6).
 */
export function datedPublishResults(input: DatedPublishInput): DatedPublishResults {
  const seen = new Set(input.patternBlocked.map((one) => repeatKey(one, input.fixedBranch)));
  const blocked: RuleResult[] = [];
  const needs = new Map<string, NeedsTeacher>();
  const need = (lesson: DatedLesson, reason: NeedsTeacherReason) => {
    const key = `${lesson.entryId}@${lesson.date}`;
    if (!needs.has(key)) {
      needs.set(key, { date: lesson.date, entryId: lesson.entryId, reason });
    }
  };
  for (const one of input.noTutor) {
    needs.set(`${one.entryId}@${one.date}`, { ...one, reason: 'no_tutor' });
  }
  for (const result of input.dated) {
    if (result.severity !== 'blocked') continue;
    const own = result.lessonIds.flatMap((id) => {
      const lesson = input.lessons.get(id);
      return lesson === undefined ? [] : [lesson];
    });
    const teacherRule = TEACHER_RULES.includes(result.rule);
    const followed = own.filter((lesson) => lesson.tutorFollowed);
    if (teacherRule && followed.length > 0) {
      followed.forEach((lesson) => need(lesson, 'tutor_clash'));
      continue;
    }
    const [first] = own;
    if (
      result.rule === 'teacher_unavailable' &&
      first !== undefined &&
      input.followsOther(first.date)
    ) {
      need(first, 'not_available_real_day');
      continue;
    }
    if (result.rule === 'teacher_inactive' && first !== undefined) {
      const teacherId = first.placement.teacherIds[0];
      if (teacherId !== undefined && !input.outOnStart(teacherId)) {
        need(first, 'teacher_out');
        continue;
      }
    }
    if (seen.has(repeatKey(result, input.fixedBranch))) continue;
    blocked.push(result);
  }
  return {
    blocked,
    warnings: input.dated.filter(
      (one) => one.severity === 'warning' && one.rule === 'teacher_unavailable_later',
    ),
    needsTeacher: [...needs.values()].sort(
      (a, b) =>
        (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) ||
        (a.entryId < b.entryId ? -1 : a.entryId > b.entryId ? 1 : 0),
    ),
  };
}
