import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions } from '../../database/transactions.js';
import { ClassesKit } from '../../testing/classes-kit.js';
import { dayTemplatesKit, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { MemoryPhotoStore } from '../people/photo-store.js';
import { JournalExports } from './journal-exports.service.js';

const store = new MemoryPhotoStore();

/** Wednesday 28 October 2026, 03:00 in Tashkent: the hour of the daily cleanup. */
const CLEANUP = '2026-10-28T03:00:00+05:00';

// Task 10.2a, pull request #256 (From 8.9 on 10.2, decision 4: "a cleanup removes the files of
// expired and failed exports"; `edge/system-behaviour`: "The link works for 24 hours"). The rows
// are written as the application writes them, in a transaction with the moment; names invented.
describe('the cleanup of branch export files', () => {
  let t: DayTemplatesKit;
  let transactions: Transactions;
  const quarterOf = new Map<string, string>();
  /** The account and assignment of each branch's requester: the Vice Principal, the Super Admin. */
  const requesterOf = new Map<string, { accountId: string; assignmentId: string }>();

  beforeAll(async () => {
    t = await dayTemplatesKit({ photoStore: store });
    transactions = t.app.get(Transactions);
    for (const [branch, assignmentId] of [
      [t.north, t.viceAssignment],
      [t.south, t.adminAssignment],
    ] as const) {
      const { account_id: accountId } = await t.database.migrator
        .selectFrom('assignments')
        .select('account_id')
        .where('id', '=', assignmentId)
        .executeTakeFirstOrThrow();
      requesterOf.set(branch, { accountId, assignmentId });
    }
    const classes = new ClassesKit(t.database.migrator);
    for (const branch of [t.north, t.south]) {
      const year = await classes.year(branch);
      const quarter = await t.database.migrator
        .selectFrom('quarters')
        .select('id')
        .where('academic_year_id', '=', year)
        .where('number', '=', 1)
        .executeTakeFirstOrThrow();
      quarterOf.set(branch, quarter.id);
    }
  });

  afterAll(async () => {
    await t.close();
  });

  /** An export asked for at `asked`, then ready or failed at `ended`, with a file under its prefix. */
  async function exportOf(
    branch: string,
    end: 'ready' | 'failed',
    asked: string,
    ended: string,
  ): Promise<string> {
    const { accountId, assignmentId } = requesterOf.get(branch) ?? {
      accountId: '',
      assignmentId: '',
    };
    t.clock.set(asked);
    const id = await transactions.run([branch], async (transaction) => {
      const row = await transaction
        .insertInto('journal_exports')
        .values({
          branch_id: branch,
          account_id: accountId,
          assignment_id: assignmentId,
          quarter_id: quarterOf.get(branch) ?? '',
          format: 'xlsx',
          language: 'en',
          // Written again by the trigger from the transaction's moment.
          requested_at: new Date(asked),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return row.id;
    });
    // A failed run leaves its file under a key it never stored.
    const key = `exports/${id}/file-${end}`;
    await store.put(key, Buffer.from('xlsx'), 'image/png');
    t.clock.set(ended);
    await transactions.run([branch], (transaction) =>
      transaction
        .updateTable('journal_exports')
        .set(
          end === 'ready'
            ? { status: 'ready', as_of: new Date(asked), file_key: key, journals: 1, rows: 1 }
            : { status: 'failed', failure: 'journal_export_failed' },
        )
        .where('id', '=', id)
        .execute(),
    );
    return id;
  }

  const filesOf = (id: string) => store.keys().filter((key) => key.startsWith(`exports/${id}/`));

  const removedAt = async (id: string) =>
    (
      await t.database.migrator
        .selectFrom('journal_exports')
        .select('file_removed_at')
        .where('id', '=', id)
        .executeTakeFirstOrThrow()
    ).file_removed_at;

  it('removes the files of expired and failed exports once, with an audit entry, and keeps a live link', async () => {
    // Ready at 10:00 on the 27th: its link works until 10:00 on the 28th, after the cleanup.
    const live = await exportOf(
      t.north,
      'ready',
      '2026-10-27T09:55:00+05:00',
      '2026-10-27T10:00:00+05:00',
    );
    // Ready at 02:00 on the 27th: expired at 02:00 on the 28th, before the cleanup.
    const expired = await exportOf(
      t.north,
      'ready',
      '2026-10-27T01:55:00+05:00',
      '2026-10-27T02:00:00+05:00',
    );
    // Failed an hour ago: its file goes at once.
    const failed = await exportOf(
      t.north,
      'failed',
      '2026-10-28T01:55:00+05:00',
      '2026-10-28T02:00:00+05:00',
    );
    // Another branch's failed export: not this branch's run.
    const southFailed = await exportOf(
      t.south,
      'failed',
      '2026-10-27T01:55:00+05:00',
      '2026-10-27T02:00:00+05:00',
    );

    t.clock.set(CLEANUP);
    await t.app.get(JournalExports).cleanupFiles({ branchIds: [t.north] });

    expect(filesOf(expired)).toEqual([]);
    expect(filesOf(failed)).toEqual([]);
    expect(filesOf(live)).toHaveLength(1);
    expect(filesOf(southFailed)).toHaveLength(1);
    expect(await removedAt(expired)).toEqual(new Date(CLEANUP));
    expect(await removedAt(failed)).toEqual(new Date(CLEANUP));
    expect(await removedAt(live)).toBeNull();
    expect(await removedAt(southFailed)).toBeNull();
    for (const [id, status] of [
      [expired, 'ready'],
      [failed, 'failed'],
    ] as const) {
      const entries = await t.entries('journal.export_file_removed', id);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ branch_id: t.north, actor_id: null });
      expect(entries[0]?.details).toEqual({ status });
    }
    expect(await t.entries('journal.export_file_removed', live)).toEqual([]);

    // A second run, later the same day, changes nothing.
    t.clock.set('2026-10-28T04:00:00+05:00');
    await t.app.get(JournalExports).cleanupFiles({ branchIds: [t.north] });
    expect(await removedAt(expired)).toEqual(new Date(CLEANUP));
    expect(await t.entries('journal.export_file_removed', expired)).toHaveLength(1);
    expect(await t.entries('journal.export_file_removed', failed)).toHaveLength(1);
  });

  it('removes a file left after its key was gone, and a prefix with nothing left counts as removed', async () => {
    const failed = await exportOf(
      t.south,
      'failed',
      '2026-10-28T01:00:00+05:00',
      '2026-10-28T01:10:00+05:00',
    );
    await store.put(`exports/${failed}/second`, Buffer.from('xlsx'), 'image/png');
    await store.deletePrefix(`exports/${failed}/file-failed`);
    t.clock.set(CLEANUP);
    await t.app.get(JournalExports).cleanupFiles({ branchIds: [t.south] });
    expect(filesOf(failed)).toEqual([]);
    expect(await removedAt(failed)).toEqual(new Date(CLEANUP));

    const empty = await exportOf(
      t.south,
      'failed',
      '2026-10-28T01:20:00+05:00',
      '2026-10-28T01:30:00+05:00',
    );
    await store.deletePrefix(`exports/${empty}/`);
    t.clock.set(CLEANUP);
    await t.app.get(JournalExports).cleanupFiles({ branchIds: [t.south] });
    expect(await removedAt(empty)).toEqual(new Date(CLEANUP));
  });

  describe('the trigger lets through only the moment of the removal', () => {
    /** Writes as the application at `moment`; answers the code of a refusal or `done`. */
    const write = async (
      moment: string,
      id: string,
      values: { file_removed_at: Date; rows?: number },
    ): Promise<string> => {
      t.clock.set(moment);
      try {
        await transactions.run([t.north], (transaction) =>
          transaction.updateTable('journal_exports').set(values).where('id', '=', id).execute(),
        );
        return 'done';
      } catch (error) {
        return (error as { constraint?: string }).constraint ?? 'unknown';
      }
    };

    it('refuses a live link, a second removal, another column changed with it and a queued row', async () => {
      const live = await exportOf(
        t.north,
        'ready',
        '2026-10-29T09:00:00+05:00',
        '2026-10-29T09:05:00+05:00',
      );
      // 24 hours after ready: still refused one second before, allowed at the moment.
      expect(await write('2026-10-30T09:04:59+05:00', live, { file_removed_at: new Date(0) })).toBe(
        'journal_export_file_removed',
      );
      expect(
        await write('2026-10-30T09:05:00+05:00', live, {
          file_removed_at: new Date(0),
          rows: 7,
        }),
      ).toBe('journal_export_file_removed');
      // The moment is the transaction's, whatever the application sends.
      expect(await write('2026-10-30T09:05:00+05:00', live, { file_removed_at: new Date(0) })).toBe(
        'done',
      );
      expect(await removedAt(live)).toEqual(new Date('2026-10-30T09:05:00+05:00'));
      expect(await write('2026-10-30T10:00:00+05:00', live, { file_removed_at: new Date(0) })).toBe(
        'journal_export_file_removed',
      );

      t.clock.set('2026-10-30T11:00:00+05:00');
      const queued = await transactions.run(
        [t.north],
        async (transaction) =>
          (
            await transaction
              .insertInto('journal_exports')
              .values({
                branch_id: t.north,
                account_id: requesterOf.get(t.north)?.accountId ?? '',
                assignment_id: t.viceAssignment,
                quarter_id: quarterOf.get(t.north) ?? '',
                format: 'pdf',
                language: 'uz',
                requested_at: new Date(0),
              })
              .returning(['id', 'file_removed_at'])
              .executeTakeFirstOrThrow()
          ).id,
      );
      expect(await removedAt(queued)).toBeNull();
      expect(
        await write('2026-10-30T11:01:00+05:00', queued, { file_removed_at: new Date(0) }),
      ).toBe('journal_export_file_removed');
    });
  });
});
