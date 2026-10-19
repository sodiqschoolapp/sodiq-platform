import { createHash } from 'node:crypto';
import { patternIdOf, type DatedLesson } from '@sodiq/timetable-rules';
import { dayDecisionKeyOf, type BulkItemAnswer, type DayChangeChoice } from '@sodiq/shared';
import { sql } from 'kysely';
import type { Transaction } from '../../database/transactions.js';
import { patternDateOf, placeKeyOf } from './dated-lessons.js';

/**
 * The stored bulk cancels of the dates a publish writes, applied again (task
 * 5.6a-5b-1, pull request #165; `edge/timetable`, Versions and drafts: "One-day
 * changes, absences, room closures and exams are stored on their own and
 * applied again after a publish. The preview sorts them into kept, needs a
 * decision and dropped. Publish waits until every 'needs a decision' item is
 * settled."; After publishing, the 7 Oxford row: "For each, the Academic Vice
 * Principal chooses: cancel the whole block, or keep it and exempt the
 * students of the chosen classes for those slots in the same action.").
 *
 * Read on the lessons of the new version with 5.6a-5a's kept changes applied
 * (`DaySorting.findings`). A lesson is in scope when it belongs to a chosen
 * class, or to a group fed by one, and overlaps by clock time a stored span
 * of that class (decision 6), unless a kept move recorded after the bulk
 * cancel put it there (decision 9). A block in scope brings in the other half
 * of its double (decision 7). A block is shared when one of its lessons is fed
 * by a class not chosen:
 * - not shared: every lesson of it the write creates is cancelled with the
 *   bulk cancel's reason; one it keeps keeps its stored state (decision 4);
 * - shared, with the same lessons as a stored block that has a choice: the
 *   choice carries, on the lessons the write creates (decision 5);
 * - shared otherwise: "needs a decision", `cancel` or `keep`, written on every
 *   lesson of the block, kept or created (decision 4's exception): `keep`
 *   holds a part of the other classes the bulk cancel's own cancel had
 *   cancelled (`BulkHold`; review of the code, round 1).
 * A bulk cancel is never dropped or ended (decision 3): with nothing in scope
 * it is kept and cancels nothing.
 */

const MINUTE = 60_000;

/** A stored bulk cancel with what it chose. */
export interface BulkRecord {
  readonly id: string;
  readonly date: string;
  readonly reason: string;
  readonly changedAt: Date;
  readonly classIds: readonly string[];
  readonly spans: readonly { classId: string; startsAt: Date; endsAt: Date }[];
  /** The stored choices whose block is still there, with that block's lessons. */
  readonly stored: readonly {
    readonly blockId: string;
    readonly choice: 'keep' | 'cancel';
    readonly lessons: readonly {
      readonly unitId: string;
      readonly subjectId: string;
      readonly startsAt: Date;
      readonly endsAt: Date;
    }[];
  }[];
}

/** A block of the new version shared with classes not chosen, and its outcome. */
export interface SortedBulkBlock {
  /** The key of its decision (`dayDecisionKeyOf`). */
  readonly decisionKey: string;
  readonly patternBlockId: string;
  readonly blockDate: string;
  /** Its pattern blocks with their minutes: the block, and the other half of its double. */
  readonly members: readonly { patternBlockId: string; start: number; end: number }[];
  readonly lessons: readonly DatedLesson[];
  /** The lessons fed by chosen classes alone. */
  readonly chosenOnly: readonly DatedLesson[];
  /** The choice of the stored block it matches, `null`: it needs a decision. */
  readonly carried: 'keep' | 'cancel' | null;
}

/** A choice recorded on a block by a write, and the stored one it replaced (0088). */
export type BulkChoiceEntry = {
  key: string;
  blockId: string;
  blockDate: string;
  choice: 'keep' | 'cancel';
  before?: 'keep' | 'cancel';
};

/**
 * A part of a block decided `keep` that the write holds: a stored lesson at
 * its place is held when its cancel is the bulk cancel's own, read as cause
 * `reason` with the bulk cancel's reason and no `lesson.cancel` of it
 * recorded after `since` (review of the code, round 1; decided without the
 * owner).
 */
export interface BulkHold {
  readonly reason: string;
  readonly since: Date;
}

/** A stored bulk cancel as sorted, with what the write needs. */
export interface SortedBulk {
  readonly answer: BulkItemAnswer;
  readonly date: string;
  /** The moment the bulk cancel was saved. */
  readonly changedAt: Date;
  /** The lessons of blocks not shared. */
  readonly plain: readonly DatedLesson[];
  readonly blocks: readonly SortedBulkBlock[];
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const unitOf = (lesson: DatedLesson) => lesson.placement.classId ?? lesson.placement.groupId ?? '';
const blockKeyOf = (lesson: DatedLesson) =>
  `${lesson.placement.blockId ?? lesson.placement.id}|${lesson.date}`;
const byStart = (a: DatedLesson, b: DatedLesson) =>
  a.placement.start - b.placement.start ||
  compare(a.placement.blockId ?? '', b.placement.blockId ?? '') ||
  compare(a.entryId, b.entryId);
const signatureOf = (unitId: string, subjectId: string, start: number, end: number) =>
  `${unitId}|${subjectId}|${String(start)}|${String(end)}`;

/**
 * Sorts `records` against `lessons`, the new version's lessons of the run
 * with the kept changes applied (see the file's comment); pure.
 */
export function sortBulkOf(input: {
  readonly lessons: readonly DatedLesson[];
  readonly movedAt: ReadonlyMap<DatedLesson, Date>;
  readonly begins: (date: string) => Date;
  readonly records: readonly BulkRecord[];
  readonly carriedVersionId: string | null;
}): SortedBulk[] {
  const sorted: SortedBulk[] = [];
  const records = [...input.records].sort(
    (a, b) => a.changedAt.getTime() - b.changedAt.getTime() || compare(a.id, b.id),
  );
  for (const record of records) {
    const dayStart = input.begins(record.date).getTime();
    const minutes = (moment: Date) => Math.round((moment.getTime() - dayStart) / MINUTE);
    const chosen = new Set(record.classIds);
    const spansOf = new Map<string, { start: number; end: number }[]>();
    for (const span of record.spans) {
      spansOf.set(span.classId, [
        ...(spansOf.get(span.classId) ?? []),
        { start: minutes(span.startsAt), end: minutes(span.endsAt) },
      ]);
    }
    const dayLessons = input.lessons.filter((one) => one.date === record.date);
    const inScope = (lesson: DatedLesson) => {
      const moved = input.movedAt.get(lesson);
      // A move recorded after the bulk cancel is a deliberate later change.
      if (moved !== undefined && moved.getTime() > record.changedAt.getTime()) return false;
      return lesson.placement.classIds.some(
        (classId) =>
          chosen.has(classId) &&
          (spansOf.get(classId) ?? []).some(
            (span) => span.start < lesson.placement.end && lesson.placement.start < span.end,
          ),
      );
    };
    const blockLessons = new Map<string, DatedLesson[]>();
    for (const lesson of dayLessons) {
      const key = blockKeyOf(lesson);
      blockLessons.set(key, [...(blockLessons.get(key) ?? []), lesson]);
    }
    const startOf = (key: string) =>
      Math.min(...(blockLessons.get(key) ?? []).map((one) => one.placement.start));
    const inBlocks = [...new Set(dayLessons.filter(inScope).map(blockKeyOf))].sort(
      (a, b) => startOf(a) - startOf(b) || compare(a, b),
    );
    const taken = new Set<string>();
    const plain: DatedLesson[] = [];
    const blocks: SortedBulkBlock[] = [];
    const stored = record.stored.map((one) => ({
      ...one,
      signatures: new Set(
        one.lessons.map((lesson) =>
          signatureOf(
            lesson.unitId,
            lesson.subjectId,
            minutes(lesson.startsAt),
            minutes(lesson.endsAt),
          ),
        ),
      ),
    }));
    for (const key of inBlocks) {
      if (taken.has(key)) continue;
      const own = blockLessons.get(key) ?? [];
      const pair = own[0]?.placement.doublePairId ?? null;
      const members = [key];
      if (pair !== null) {
        for (const [other, lessons] of blockLessons) {
          if (other !== key && lessons.some((one) => one.placement.doublePairId === pair)) {
            members.push(other);
          }
        }
      }
      for (const member of members) taken.add(member);
      members.sort((a, b) => startOf(a) - startOf(b) || compare(a, b));
      const lessons = members.flatMap((member) => blockLessons.get(member) ?? []).sort(byStart);
      const shared = lessons.some((one) =>
        one.placement.classIds.some((classId) => !chosen.has(classId)),
      );
      if (!shared) {
        plain.push(...lessons);
        continue;
      }
      const chosenOnly = lessons.filter(
        (one) =>
          one.placement.classIds.length > 0 &&
          one.placement.classIds.every((classId) => chosen.has(classId)),
      );
      // The stored choice carries when every member has the lessons of a stored block (decision 5).
      const choices = members.map((member) => {
        const mine = new Set(
          (blockLessons.get(member) ?? []).map((one) =>
            signatureOf(
              unitOf(one),
              one.placement.subjectId ?? '',
              one.placement.start,
              one.placement.end,
            ),
          ),
        );
        return stored.find(
          (one) =>
            one.signatures.size === mine.size &&
            [...mine].every((sign) => one.signatures.has(sign)),
        )?.choice;
      });
      const [first] = choices;
      const carried = first !== undefined && choices.every((one) => one === first) ? first : null;
      const head = (blockLessons.get(members[0] ?? key) ?? [])[0];
      if (head === undefined) continue;
      const dated = patternIdOf(head.placement.blockId ?? '');
      const patternBlockId = dated?.id ?? '';
      const blockDate = patternDateOf(head);
      blocks.push({
        decisionKey: dayDecisionKeyOf({ key: record.id, blockId: patternBlockId, blockDate }),
        patternBlockId,
        blockDate,
        members: members.map((member) => {
          const one = (blockLessons.get(member) ?? [])[0];
          return {
            patternBlockId: patternIdOf(one?.placement.blockId ?? '')?.id ?? '',
            start: one?.placement.start ?? 0,
            end: one?.placement.end ?? 0,
          };
        }),
        lessons,
        chosenOnly,
        carried,
      });
    }
    const cancelled =
      plain.length +
      blocks.reduce(
        (sum, block) =>
          sum +
          (block.carried === 'cancel'
            ? block.lessons.length
            : block.carried === 'keep'
              ? block.chosenOnly.length
              : 0),
        0,
      );
    sorted.push({
      date: record.date,
      changedAt: record.changedAt,
      plain,
      blocks,
      answer: {
        key: record.id,
        category: blocks.some((one) => one.carried === null) ? 'decide' : 'kept',
        date: record.date,
        reason: record.reason,
        classIds: [...record.classIds].sort(),
        carriedVersionId: input.carriedVersionId,
        cancelled,
        blocks: blocks.map((block) => {
          const classes = new Set(block.lessons.flatMap((one) => one.placement.classIds));
          return {
            blockId: block.patternBlockId,
            blockDate: block.blockDate,
            pairBlockId: block.members[1]?.patternBlockId ?? null,
            start: block.members[0]?.start ?? 0,
            end: block.members[block.members.length - 1]?.end ?? 0,
            lessons: block.lessons.map((one) => ({
              unitId: unitOf(one),
              subjectId: one.placement.subjectId ?? '',
            })),
            chosenClassIds: [...classes].filter((id) => chosen.has(id)).sort(),
            otherClassIds: [...classes].filter((id) => !chosen.has(id)).sort(),
            choice: block.carried,
          };
        }),
      },
    });
  }
  return sorted;
}

/** The bulk cancels of the branch dated `firstDate` to `lastDate`, with their stored choices. */
export async function bulkRecordsOf(
  transaction: Transaction,
  branchId: string,
  firstDate: string,
  lastDate: string,
): Promise<BulkRecord[]> {
  const records = await transaction
    .selectFrom('bulk_cancels')
    .select(['id', sql<string>`cancel_date::text`.as('cancel_date'), 'reason', 'changed_at'])
    .where('branch_id', '=', branchId)
    .where('cancel_date', '>=', firstDate)
    .where('cancel_date', '<=', lastDate)
    .orderBy('id')
    .execute();
  if (records.length === 0) return [];
  const ids = records.map((one) => one.id);
  const [classes, spans, blocks] = await Promise.all([
    transaction
      .selectFrom('bulk_cancel_classes')
      .select(['bulk_cancel_id', 'class_id'])
      .where('branch_id', '=', branchId)
      .where('bulk_cancel_id', 'in', ids)
      .orderBy('class_id')
      .execute(),
    transaction
      .selectFrom('bulk_cancel_spans')
      .select(['bulk_cancel_id', 'class_id', 'starts_at', 'ends_at'])
      .where('branch_id', '=', branchId)
      .where('bulk_cancel_id', 'in', ids)
      .orderBy('class_id')
      .orderBy('lesson_number')
      .execute(),
    transaction
      .selectFrom('bulk_cancel_blocks')
      .innerJoin('lessons', 'lessons.block_id', 'bulk_cancel_blocks.block_id')
      .select([
        'bulk_cancel_blocks.bulk_cancel_id',
        'bulk_cancel_blocks.block_id',
        'bulk_cancel_blocks.choice',
        'lessons.class_id',
        'lessons.group_id',
        'lessons.subject_id',
        'lessons.starts_at',
        'lessons.ends_at',
      ])
      .where('bulk_cancel_blocks.branch_id', '=', branchId)
      .where('lessons.branch_id', '=', branchId)
      .where('bulk_cancel_blocks.bulk_cancel_id', 'in', ids)
      .orderBy('lessons.id')
      .execute(),
  ]);
  return records.map((record) => {
    const storedBy = new Map<string, BulkRecord['stored'][number]>();
    for (const row of blocks) {
      if (row.bulk_cancel_id !== record.id || row.block_id === null) continue;
      const known = storedBy.get(row.block_id);
      const lesson = {
        unitId: row.class_id ?? row.group_id ?? '',
        subjectId: row.subject_id,
        startsAt: row.starts_at,
        endsAt: row.ends_at,
      };
      storedBy.set(row.block_id, {
        blockId: row.block_id,
        choice: row.choice === 'keep' ? 'keep' : 'cancel',
        lessons: [...(known?.lessons ?? []), lesson],
      });
    }
    return {
      id: record.id,
      date: record.cancel_date,
      reason: record.reason,
      changedAt: record.changed_at,
      classIds: classes
        .filter((one) => one.bulk_cancel_id === record.id)
        .map((one) => one.class_id),
      spans: spans
        .filter((one) => one.bulk_cancel_id === record.id)
        .map((one) => ({ classId: one.class_id, startsAt: one.starts_at, endsAt: one.ends_at })),
      stored: [...storedBy.values()].sort((a, b) => compare(a.blockId, b.blockId)),
    };
  });
}

/** The keys of the "needs a decision" blocks of `items`, each with the choices it offers. */
export function openBulkBlocks(items: readonly SortedBulk[]): Set<string> {
  return new Set(
    items.flatMap((item) =>
      item.blocks.filter((block) => block.carried === null).map((block) => block.decisionKey),
    ),
  );
}

/**
 * What the write does with the sorted bulk cancels and the choices of their
 * blocks (decisions 4 and 13): `cancels` for a decided block, on every lesson
 * of it; `bulkCancels` for the rest, on the lessons the write creates. A
 * cancel from any item wins; a decided `keep` puts the parts it holds in
 * `holds`, unless an item cancels them.
 */
export function bulkWritePlanOf(
  items: readonly SortedBulk[],
  decisions: ReadonlyMap<string, DayChangeChoice>,
): {
  cancels: Map<string, string>;
  bulkCancels: Map<string, string>;
  holds: Map<string, BulkHold>;
} {
  const cancels = new Map<string, string>();
  const bulkCancels = new Map<string, string>();
  const holds = new Map<string, BulkHold>();
  const keyOf = (lesson: DatedLesson) =>
    placeKeyOf(lesson.entryId, patternDateOf(lesson), lesson.date);
  const add = (map: Map<string, string>, lessons: readonly DatedLesson[], reason: string) => {
    for (const lesson of lessons) {
      const key = keyOf(lesson);
      if (!map.has(key)) map.set(key, reason);
    }
  };
  for (const item of items) {
    const { reason } = item.answer;
    add(bulkCancels, item.plain, reason);
    for (const block of item.blocks) {
      if (block.carried !== null) {
        add(bulkCancels, block.carried === 'cancel' ? block.lessons : block.chosenOnly, reason);
        continue;
      }
      const choice = decisions.get(block.decisionKey);
      if (choice === 'cancel') add(cancels, block.lessons, reason);
      else if (choice === 'keep') {
        add(cancels, block.chosenOnly, reason);
        const chosenOnly = new Set(block.chosenOnly);
        for (const lesson of block.lessons) {
          const key = keyOf(lesson);
          if (!chosenOnly.has(lesson) && !holds.has(key)) {
            holds.set(key, { reason, since: item.changedAt });
          }
        }
      }
    }
  }
  for (const key of holds.keys()) {
    if (cancels.has(key) || bulkCancels.has(key)) holds.delete(key);
  }
  return { cancels, bulkCancels, holds };
}

/** The key of the bulk sorting, joined with 5.6a-5a's (`dayChangesKeyOf`). */
export function bulkKeyPartOf(items: readonly SortedBulk[]): string {
  const shown = items
    .map((one) =>
      JSON.stringify([
        one.answer.carriedVersionId ?? '',
        one.answer.key,
        one.answer.category,
        one.answer.cancelled,
        one.answer.blocks,
      ]),
    )
    .sort(compare);
  return createHash('sha256').update(JSON.stringify(shown)).digest('hex');
}

/**
 * After the write: each shared block that took a choice in this write (a
 * decision, or a stored choice carried) gets a `bulk_cancel_blocks` row for
 * its dated block; a row already there takes the choice made now (0088); a row whose block the write removed
 * was set null by 0086 (review note 1: the partial key is read before the
 * insert). Returns the rows written for the audit entry.
 */
export async function recordBulkBlocks(
  transaction: Transaction,
  input: {
    readonly branchId: string;
    readonly versionId: string;
    readonly begins: (date: string) => Date;
    readonly items: readonly SortedBulk[];
    readonly decisions: ReadonlyMap<string, DayChangeChoice>;
  },
): Promise<{
  decided: BulkChoiceEntry[];
  carried: BulkChoiceEntry[];
}> {
  const decided: BulkChoiceEntry[] = [];
  const carried: typeof decided = [];
  const rows: {
    branch_id: string;
    bulk_cancel_id: string;
    block_id: string;
    choice: 'keep' | 'cancel';
    lesson_date: string;
    starts_at: Date;
    ends_at: Date;
  }[] = [];
  for (const item of input.items) {
    for (const block of item.blocks) {
      const chosen = block.carried ?? input.decisions.get(block.decisionKey);
      if (chosen !== 'keep' && chosen !== 'cancel') continue;
      const entry: BulkChoiceEntry = {
        key: item.answer.key,
        blockId: block.patternBlockId,
        blockDate: block.blockDate,
        choice: chosen,
      };
      (block.carried === null ? decided : carried).push(entry);
      const dayStart = input.begins(item.date).getTime();
      for (const member of block.members) {
        const startsAt = new Date(dayStart + member.start * 60_000);
        const found = await transaction
          .selectFrom('lesson_blocks')
          .select('id')
          .where('branch_id', '=', input.branchId)
          .where('version_id', '=', input.versionId)
          .where('pattern_block_id', '=', member.patternBlockId)
          .where('lesson_date', '=', item.date)
          .where('starts_at', '=', startsAt)
          .orderBy('id')
          .executeTakeFirst();
        if (found === undefined) continue;
        const there = await transaction
          .selectFrom('bulk_cancel_blocks')
          .select('choice')
          .where('branch_id', '=', input.branchId)
          .where('bulk_cancel_id', '=', item.answer.key)
          .where('block_id', '=', found.id)
          .executeTakeFirst();
        if (there !== undefined) {
          // A block the write reused keeps its row; a choice made now replaces
          // the stored one (0088; spec review of the code, must-fix 1).
          if (there.choice !== chosen) {
            entry.before = there.choice === 'keep' ? 'keep' : 'cancel';
            await transaction
              .updateTable('bulk_cancel_blocks')
              .set({ choice: chosen })
              .where('branch_id', '=', input.branchId)
              .where('bulk_cancel_id', '=', item.answer.key)
              .where('block_id', '=', found.id)
              .execute();
          }
          continue;
        }
        if (
          rows.some((one) => one.block_id === found.id && one.bulk_cancel_id === item.answer.key)
        ) {
          continue;
        }
        rows.push({
          branch_id: input.branchId,
          bulk_cancel_id: item.answer.key,
          block_id: found.id,
          choice: chosen,
          lesson_date: item.date,
          starts_at: startsAt,
          ends_at: new Date(dayStart + member.end * 60_000),
        });
      }
    }
  }
  if (rows.length > 0) await transaction.insertInto('bulk_cancel_blocks').values(rows).execute();
  const order = (a: { key: string; blockId: string }, b: { key: string; blockId: string }) =>
    compare(`${a.key}|${a.blockId}`, `${b.key}|${b.blockId}`);
  return { decided: decided.sort(order), carried: carried.sort(order) };
}
