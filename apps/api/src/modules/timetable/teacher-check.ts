import {
  addedResults,
  checkCandidates,
  checkedPlacements,
  patternPlacements,
  type RuleResult,
} from '@sodiq/timetable-rules';
import type { Transaction } from '../../database/transactions.js';
import { LoadFacts, type StoredLoadRow, type VersionContext } from './load-facts.js';
import { readPatternFacts } from './pattern-facts.js';
import { readBlocks } from './pattern-queries.js';

/**
 * A new teacher of a load row with lessons placed in the grid (task 5.4b-2a,
 * review correction 1): the row's placed lessons are checked with the new
 * teacher by the rule engine, as a move is (06: "Every rule is checked on
 * screen, on the server and in the database"; 14, Timetable, One rule
 * engine). The facts are read again with the changed rows, so the new
 * teacher's availability, profile and lessons in other branches count. Gives
 * the blocked results the change adds (`addedResults`, as the room picker
 * compares); empty when the row has no placed lesson.
 */
export async function teacherChangeBlocked(
  transaction: Transaction,
  context: VersionContext,
  versionId: string,
  rows: readonly StoredLoadRow[],
  after: readonly StoredLoadRow[],
): Promise<RuleResult[]> {
  const changed = new Set(after.map((row) => row.id));
  const blocks = await readBlocks(transaction, versionId);
  const touched = blocks.filter((block) =>
    block.lessons.some((lesson) => changed.has(lesson.loadRowId)),
  );
  if (touched.length === 0) {
    return [];
  }
  const resultsOf = async (list: readonly StoredLoadRow[]) => {
    const load = await LoadFacts.of(transaction, context, list, { versionRows: list });
    const { model } = await readPatternFacts(transaction, context, list, load);
    const lessons = patternPlacements(model, touched).filter(
      (one) => one.loadRowId !== null && changed.has(one.loadRowId),
    );
    return checkCandidates(checkedPlacements(model, blocks), model.facts, lessons).filter(
      (one) => one.severity === 'blocked',
    );
  };
  const replaced = rows.map((row) => after.find((one) => one.id === row.id) ?? row);
  return addedResults(await resultsOf(rows), await resultsOf(replaced));
}
