import type { ResultFlag } from '@sodiq/calc';
import type { ClosingFlagged, ClosingItem } from '@sodiq/shared';
import type { Transaction } from '../../database/transactions.js';
import { exemptOnDate } from '../journal/exemption-read.js';
import { ratingDateOf } from '../journal/rating.js';
import { exemptedIn } from './closing.query.js';
import type { QuarterRef } from './grade-changes.js';
import { allowedDecisions, quarterOutcomes, type JournalOutcomes } from './quarter-outcomes.js';

/**
 * The items of the closing checklist that come from the results of the quarter (task 9.2a;
 * `07`, Closing a quarter): flags, decisions, rating entries, no result, parts without data and
 * weights. Task 10.1b: one function for the checklist read from source, the close, and the
 * `closing` unit of the prepared totals (a quarter and a subject), which stores what it gives;
 * students are named by id, their names read on each request, and the teacher of each item (the
 * journal's owner on the reference date) is named by the reader too.
 */

/** A flagged student of the checklist, with the journal it is listed under. */
export interface Flagged {
  readonly journalId: string;
  readonly subjectId: string;
  readonly studentId: string;
  readonly row: Omit<ClosingFlagged, 'student'>;
  readonly stale: boolean;
}

/** One result item of a journal, its students by id. */
export interface ResultDraft {
  readonly kind: Extract<
    ClosingItem['kind'],
    'undecided' | 'decision_outdated' | 'rating_missing' | 'no_result' | 'part_without_data'
  >;
  readonly journalId: string;
  /** `undecided`, `decision_outdated`: the flagged rows; `rating_missing`: id and pending. */
  readonly students?: readonly ({ readonly studentId: string } & Record<string, unknown>)[];
  /** `no_result`: the students. */
  readonly studentIds?: readonly string[];
  /** `part_without_data`: the parts. */
  readonly parts?: readonly string[];
}

export interface ResultItems {
  /**
   * The journals whose quarterly weights do not total 100: an item once the journal has a held
   * lesson (`07`; decision 4 of 9.2a), which the reader decides at its own moment.
   */
  readonly weightsMissing: readonly string[];
  readonly drafts: readonly ResultDraft[];
}

export interface ResultScene {
  readonly branchId: string;
  readonly timeZone: string;
  readonly now: Date;
  readonly today: string;
  readonly quarter: QuarterRef;
}

/** The journal a student who moved between journals of a subject is listed under. */
export function listedJournalOf(
  spans: readonly { journalId: string; from: string }[],
  fallback: string,
): string {
  const latest = [...spans].sort((a, b) => a.from.localeCompare(b.from)).at(-1);
  return latest?.journalId ?? fallback;
}

/** The flagged students of the journals given, each once, under the journal it is listed. */
export function flaggedIn(journals: ReadonlyMap<string, JournalOutcomes>): Flagged[] {
  const found: Flagged[] = [];
  for (const [journalId, one] of journals) {
    for (const [studentId, member] of one.members) {
      const { outcome, input } = member;
      if (outcome === null || input === null || outcome.atLeaving !== null) continue;
      if (listedJournalOf(member.found?.spans ?? [], journalId) !== journalId) continue;
      if (outcome.flags.length === 0 && !outcome.staleDecision) continue;
      const stored = member.stored;
      found.push({
        journalId,
        subjectId: one.journal.subjectId,
        studentId,
        stale: outcome.staleDecision,
        row: {
          flags: [...outcome.flags] satisfies ResultFlag[],
          basedOn: outcome.basedOn,
          leftSubjectOn: outcome.leftSubjectOn,
          decision: stored?.decision ?? null,
          version: stored?.version ?? null,
          allowed: allowedDecisions(input),
        },
      });
    }
  }
  return found;
}

/** The result items of the journals of the subjects named (`null`: every subject). */
export async function resultItemsOf(
  transaction: Transaction,
  scene: ResultScene,
  subjectIds: readonly string[] | null,
): Promise<ResultItems> {
  const { branchId, quarter } = scene;
  const { journals: outcomes } = await quarterOutcomes(transaction, {
    branchId,
    timeZone: scene.timeZone,
    now: scene.now,
    quarter,
    subjectIds,
  });
  const studentIds = new Set<string>();
  for (const one of outcomes.values()) for (const id of one.members.keys()) studentIds.add(id);
  const flagged = flaggedIn(outcomes);
  const exempted = await exemptedIn(transaction, quarter, [...studentIds]);
  const weightsMissing: string[] = [];
  const drafts: ResultDraft[] = [];
  for (const [journalId, one] of outcomes) {
    // `07`: "A graded subject has weights that do not total 100 for this quarter" (decision 4).
    if (one.weights.quarterly === null) {
      weightsMissing.push(journalId);
      continue;
    }
    const listedHere = [...one.members].filter(
      ([, member]) =>
        member.outcome !== null &&
        member.outcome.atLeaving === null &&
        listedJournalOf(member.found?.spans ?? [], journalId) === journalId,
    );
    const own = flagged.filter((row) => row.journalId === journalId);
    const undecided = own.filter((row) => !row.stale && row.row.decision === null);
    const stale = own.filter((row) => row.stale);
    const flaggedRow = (row: Flagged) => ({ studentId: row.studentId, ...row.row });
    if (undecided.length > 0) {
      drafts.push({ kind: 'undecided', journalId, students: undecided.map(flaggedRow) });
    }
    if (stale.length > 0) {
      drafts.push({
        kind: 'decision_outdated',
        journalId,
        students: stale.map(flaggedRow),
      });
    }
    // `07`: "A rating exam entry is missing"; From 8.5: a pending entry blocks closing.
    if (one.ratingShown) {
      const missing = listedHere.filter(([, member]) => member.found?.ratingExam === null);
      if (missing.length > 0) {
        const { date } = await ratingDateOf(transaction, journalId, quarter.id);
        const pending =
          date === null
            ? new Set<string>()
            : await exemptOnDate(
                transaction,
                missing.map(([id]) => id),
                one.journal.subjectId,
                date,
              );
        drafts.push({
          kind: 'rating_missing',
          journalId,
          students: missing.map(([id]) => ({ studentId: id, pending: pending.has(id) })),
        });
      }
    }
    // `07`: "Students with no result in a subject and no exemption" (From 8.5).
    const noResult = listedHere.filter(
      ([id, member]) =>
        member.outcome?.kind === 'no_result' &&
        !exempted.has(`${id}|${one.journal.subjectId}`) &&
        !exempted.has(`${id}|*`),
    );
    if (noResult.length > 0) {
      drafts.push({
        kind: 'no_result',
        journalId,
        studentIds: noResult.map(([id]) => id),
      });
    }
    // `edge/calculation`: "The checklist warns when a part has a weight but no data in a
    // whole journal." Only once some student of the journal has a number.
    const numbers = listedHere.flatMap(([, member]) =>
      member.outcome?.kind === 'number' ? [member.outcome.result] : [],
    );
    if (numbers.length > 0) {
      const parts = (['attendance', 'classwork', 'homework', 'ratingExam'] as const).filter(
        (part) =>
          (part !== 'ratingExam' || one.ratingShown) &&
          numbers.every((result) =>
            result.leftOut.some((left) => left.part === part && left.reason === 'no_data'),
          ),
      );
      if (parts.length > 0) drafts.push({ kind: 'part_without_data', journalId, parts });
    }
  }
  return { weightsMissing, drafts };
}

/** The students a result item names. */
export function studentsOfDraft(draft: ResultDraft): string[] {
  return [...(draft.students ?? []).map((one) => one.studentId), ...(draft.studentIds ?? [])];
}
