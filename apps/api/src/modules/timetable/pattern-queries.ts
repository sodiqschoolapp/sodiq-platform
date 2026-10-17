import { sql } from 'kysely';
import type { PatternBlock } from '@sodiq/timetable-rules';
import type { Transaction } from '../../database/transactions.js';

/**
 * A swap of two blocks (task 5.4a): the clash constraints of the weekly pattern
 * (db/migrations/0058, deferrable initially immediate, "deferrable for a
 * swap") are checked at the commit, so the two blocks may pass through each
 * other's slot inside the transaction; a clash left at the commit is still
 * refused.
 */
export async function deferPatternClashes(transaction: Transaction): Promise<void> {
  await sql`set constraints pattern_entries_teacher_excl, pattern_entries_room_excl, pattern_block_classes_excl deferred`.execute(
    transaction,
  );
}

/** The placed blocks of a version, each with its lessons (one per load row). */
export async function readBlocks(
  transaction: Transaction,
  versionId: string,
): Promise<PatternBlock[]> {
  const [blocks, entries] = await Promise.all([
    transaction
      .selectFrom('pattern_blocks')
      .select(['id', 'weekday', 'slot_position', 'start_minutes', 'end_minutes'])
      .where('version_id', '=', versionId)
      .orderBy('weekday')
      .orderBy('start_minutes')
      .orderBy('id')
      .execute(),
    transaction
      .selectFrom('pattern_entries')
      .select(['id', 'block_id', 'load_row_id', 'room_id'])
      .where('version_id', '=', versionId)
      .orderBy('load_row_id')
      .orderBy('id')
      .execute(),
  ]);
  return blocks.map((block) => ({
    id: block.id,
    weekday: block.weekday,
    slotPosition: block.slot_position,
    start: block.start_minutes,
    end: block.end_minutes,
    lessons: entries
      .filter((entry) => entry.block_id === block.id)
      .map((entry) => ({ id: entry.id, loadRowId: entry.load_row_id, roomId: entry.room_id })),
  }));
}
