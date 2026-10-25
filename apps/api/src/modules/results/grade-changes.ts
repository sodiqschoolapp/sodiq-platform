import type { StudentQuarterOutcome } from '@sodiq/calc';
import { schoolDateOf, subjectColourSchema, type GradeChanges } from '@sodiq/shared';
import { sql } from 'kysely';
import type { Transaction } from '../../database/transactions.js';
import type { JournalRow } from '../journal/journal-grid.query.js';
import { quarterOutcomes } from './quarter-outcomes.js';

/**
 * The shown result of every member of the graded journals of a quarter
 * (task 9.1, From 1.6 decision 3 and From 2.1 decision 4; `edge/calculation`,
 * "Before saving, the system shows how many grades will change in each
 * journal"). Read once before a change and once after it inside the change's
 * transaction (`compareGrades`): the figures come from `studentQuarterOutcome`
 * of `packages/calc` with the inputs the grid gives it, the stored weights and
 * values as they stand in the transaction, so the preview counts exactly what
 * every reader shows after the commit. Each member of a journal in the quarter
 * counts once (decision 2, Look first).
 */

export interface QuarterRef {
  readonly id: string;
  readonly number: number;
  readonly academicYearId: string;
  readonly startDate: string;
  readonly endDate: string;
}

interface ShownState {
  /** The result state with its grade ("number:3", "exempt", ...). */
  readonly grade: string;
  /** The result as shown ("number:49", ...). */
  readonly result: string;
}

export interface QuarterGrades {
  readonly quarter: QuarterRef;
  readonly journals: ReadonlyMap<string, JournalRow>;
  /** By journal, then student. */
  readonly states: ReadonlyMap<string, ReadonlyMap<string, ShownState>>;
}

const stateOf = (outcome: StudentQuarterOutcome | null): ShownState => {
  if (outcome === null) return { grade: 'none', result: 'none' };
  if (outcome.kind !== 'number') return { grade: outcome.kind, result: outcome.kind };
  return {
    grade: `number:${outcome.result.grade}`,
    result: `number:${outcome.result.shown.toString()}`,
  };
};

/**
 * The shown results of the quarter's graded journals of the subjects named
 * (every subject when `subjectIds` is `null`), in the branch of the transaction.
 */
export async function quarterGrades(
  transaction: Transaction,
  input: {
    readonly branchId: string;
    readonly timeZone: string;
    readonly now: Date;
    readonly quarter: QuarterRef;
    readonly subjectIds: readonly string[] | null;
  },
): Promise<QuarterGrades> {
  const found = await quarterOutcomes(transaction, input);
  const states = new Map<string, Map<string, ShownState>>();
  for (const [journalId, one] of found.journals) {
    states.set(
      journalId,
      new Map([...one.members].map(([studentId, member]) => [studentId, stateOf(member.outcome)])),
    );
  }
  return {
    quarter: input.quarter,
    journals: new Map([...found.journals].map(([id, one]) => [id, one.journal])),
    states,
  };
}

/** The journals where a member's shown grade or result changed, with the counts. */
export function compareGrades(
  before: QuarterGrades,
  after: QuarterGrades,
): GradeChanges['quarters'][number] {
  const journals: GradeChanges['quarters'][number]['journals'] = [];
  for (const [journalId, journal] of after.journals) {
    const old = before.states.get(journalId) ?? new Map<string, ShownState>();
    const now = after.states.get(journalId) ?? new Map<string, ShownState>();
    let grades = 0;
    let results = 0;
    for (const studentId of new Set([...old.keys(), ...now.keys()])) {
      const a = old.get(studentId) ?? stateOf(null);
      const b = now.get(studentId) ?? stateOf(null);
      if (a.grade !== b.grade) grades += 1;
      if (a.result !== b.result) results += 1;
    }
    if (grades === 0 && results === 0) continue;
    journals.push({
      journalId,
      unit: {
        kind: journal.classId === null ? 'group' : 'class',
        id: journal.classId ?? journal.groupId ?? '',
        name: journal.unitName,
      },
      subject: {
        id: journal.subjectId,
        names: journal.subject.names,
        colour: subjectColourSchema.parse(journal.subject.colour),
      },
      grades,
      results,
    });
  }
  journals.sort(
    (a, b) =>
      a.subject.names.en.localeCompare(b.subject.names.en, 'en') ||
      a.unit.name.localeCompare(b.unit.name, 'en'),
  );
  return { quarterId: after.quarter.id, number: after.quarter.number, journals };
}

/** The quarter's row as `quarterGrades` takes it; `undefined` while its dates are not set. */
export async function quarterRefOf(
  transaction: Transaction,
  quarterId: string,
): Promise<QuarterRef | undefined> {
  const row = await transaction
    .selectFrom('quarters')
    .select([
      'id',
      'number',
      'academic_year_id',
      sql<string | null>`start_date::text`.as('start_date'),
      sql<string | null>`end_date::text`.as('end_date'),
    ])
    .where('id', '=', quarterId)
    .executeTakeFirst();
  if (row === undefined || row.start_date === null || row.end_date === null) return undefined;
  return {
    id: row.id,
    number: row.number,
    academicYearId: row.academic_year_id,
    startDate: row.start_date,
    endDate: row.end_date,
  };
}
