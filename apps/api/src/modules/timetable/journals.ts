import { sql } from 'kysely';
import type { Transaction } from '../../database/transactions.js';
import type { Audit } from '../audit/audit.service.js';
import { laterVersionsOf, type LaterVersion } from './chain.js';
import type { VersionRow } from './timetable.service.js';

/** A run of the chain: from its start, until the next start (exclusive), `null` with no end. */
interface Run {
  readonly from: string;
  readonly until: string | null;
}

/** Who published, for the audit entries of the journals. */
export interface JournalActor {
  readonly actorId: string;
  readonly assignmentId?: string;
  readonly requestId?: string;
}

/** What a sync did, as the publish's audit entry counts it (decision 7). */
export interface JournalSync {
  readonly opened: number;
  readonly changed: number;
}

/**
 * The runs of the published versions of the year, in start order: a tie on
 * a start goes to the higher number (review of #155, correction 1; as 0075's
 * `distinct on (starts_on) … number desc`), each run ends on the next start,
 * the last has no end (decision 10). Archived versions never run.
 */
export function runsOf(published: readonly LaterVersion[]): { id: string; run: Run }[] {
  const byStart = new Map<string, LaterVersion>();
  for (const one of published) {
    const held = byStart.get(one.starts_on);
    if (held === undefined || one.number > held.number) byStart.set(one.starts_on, one);
  }
  const ordered = [...byStart.values()].sort((a, b) => a.starts_on.localeCompare(b.starts_on));
  return ordered.map((one, index) => ({
    id: one.id,
    run: { from: one.starts_on, until: ordered[index + 1]?.starts_on ?? null },
  }));
}

/** The runs as PostgreSQL writes a `datemultirange`, adjacent runs joined. */
export function multirangeOf(runs: readonly Run[]): string {
  const sorted = [...runs].sort((a, b) => a.from.localeCompare(b.from));
  const joined: { from: string; until: string | null }[] = [];
  for (const run of sorted) {
    const last = joined[joined.length - 1];
    if (last !== undefined && last.until !== null && last.until >= run.from) {
      last.until = run.until === null ? null : run.until > last.until ? run.until : last.until;
    } else if (last === undefined || last.until !== null) {
      joined.push({ ...run });
    }
  }
  return `{${joined.map((one) => `[${one.from},${one.until ?? ''})`).join(',')}}`;
}

/**
 * The journals of a branch and year brought in line with the chain of
 * published versions (task 5.5c-1, pull request #155; `edge/timetable`,
 * Versions and drafts: "Journals are created and closed at publish. There is
 * one journal per class or group and subject in a year; adding a removed
 * subject again reopens its journal"). A journal's runs are the days on which
 * the published load has its class or group and subject (decision 3); a
 * journal no run has any more keeps its row with empty runs (decision 8).
 * The whole chain is read each time (decision 9). Runs under the publish lock
 * and the year's versions held FOR NO KEY UPDATE; the unique keys of 0081
 * guard it all the same.
 */
export async function syncJournals(
  transaction: Transaction,
  audit: Audit,
  version: VersionRow,
  actor: JournalActor,
): Promise<JournalSync> {
  const runs = runsOf(await laterVersionsOf(transaction, version, version.start_date));
  const rows =
    runs.length === 0
      ? []
      : await transaction
          .selectFrom('teaching_load_rows')
          .select(['version_id', 'class_id', 'group_id', 'subject_id'])
          .where(
            'version_id',
            'in',
            runs.map((one) => one.id),
          )
          .orderBy('class_id')
          .orderBy('group_id')
          .orderBy('subject_id')
          .execute();
  const runOf = new Map(runs.map((one) => [one.id, one.run]));
  const keyOf = (one: { class_id: string | null; group_id: string | null; subject_id: string }) =>
    `${one.class_id ?? ''}|${one.group_id ?? ''}|${one.subject_id}`;
  const wanted = new Map<
    string,
    { class_id: string | null; group_id: string | null; subject_id: string; runs: Run[] }
  >();
  for (const row of rows) {
    const run = runOf.get(row.version_id);
    if (run === undefined) continue;
    const key = keyOf(row);
    const held = wanted.get(key);
    if (held === undefined) {
      wanted.set(key, { ...row, runs: [run] });
    } else if (!held.runs.includes(run)) {
      held.runs.push(run);
    }
  }
  const stored = await transaction
    .selectFrom('journals')
    .select(['id', 'class_id', 'group_id', 'subject_id', sql<string>`runs::text`.as('runs')])
    .where('branch_id', '=', version.branch_id)
    .where('academic_year_id', '=', version.academic_year_id)
    .execute();
  const storedOf = new Map(stored.map((one) => [keyOf(one), one]));
  // Written and audited in the order class id, group id, subject id: class journals first.
  const keys = [...new Set([...wanted.keys(), ...storedOf.keys()])].sort((a, b) => {
    const [classA = '', groupA = '', subjectA = ''] = a.split('|');
    const [classB = '', groupB = '', subjectB = ''] = b.split('|');
    return (
      Number(classA === '') - Number(classB === '') ||
      classA.localeCompare(classB) ||
      groupA.localeCompare(groupB) ||
      subjectA.localeCompare(subjectB)
    );
  });
  let opened = 0;
  let changed = 0;
  for (const key of keys) {
    const want = wanted.get(key);
    const held = storedOf.get(key);
    const next = multirangeOf(want?.runs ?? []);
    const unit = want ?? held;
    if (unit === undefined) continue;
    const named = {
      classId: unit.class_id,
      groupId: unit.group_id,
      subjectId: unit.subject_id,
      versionId: version.id,
      versionNumber: version.number,
    };
    if (held === undefined) {
      const inserted = await transaction
        .insertInto('journals')
        .values({
          branch_id: version.branch_id,
          academic_year_id: version.academic_year_id,
          class_id: unit.class_id,
          group_id: unit.group_id,
          subject_id: unit.subject_id,
          runs: next,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      opened += 1;
      await audit.record(transaction, {
        branchId: version.branch_id,
        ...actorOf(actor),
        action: 'journal.open',
        record: { type: 'journal', id: inserted.id },
        oldValue: null,
        newValue: { ...named, runs: next },
      });
    } else if (held.runs !== next) {
      await transaction
        .updateTable('journals')
        .set({ runs: next })
        .where('id', '=', held.id)
        .execute();
      changed += 1;
      await audit.record(transaction, {
        branchId: version.branch_id,
        ...actorOf(actor),
        action: 'journal.runs',
        record: { type: 'journal', id: held.id },
        oldValue: { runs: held.runs },
        newValue: { ...named, runs: next },
      });
    }
  }
  return { opened, changed };
}

const actorOf = (actor: JournalActor) => ({
  actorId: actor.actorId,
  ...(actor.assignmentId === undefined ? {} : { assignmentId: actor.assignmentId }),
  ...(actor.requestId === undefined ? {} : { requestId: actor.requestId }),
});
