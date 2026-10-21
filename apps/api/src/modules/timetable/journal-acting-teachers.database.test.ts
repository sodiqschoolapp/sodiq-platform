import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions } from '../../database/transactions.js';
import { ActingKit, type ActingScene } from '../../testing/acting-kit.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

/** Thursday 15 October 2026, 10:00 in Tashkent. */
const NOW = '2026-10-15T10:00:00+05:00';
const TODAY = '2026-10-15';
const YESTERDAY = '2026-10-14';
const LATER = '2026-11-02';
const LATEST = '2026-11-16';

/** What a promise came to: `written`, or the constraint that refused it. */
const outcome = (work: Promise<unknown>): Promise<string | undefined> =>
  work.then(
    () => 'written',
    (error: unknown) => {
      const failure = error as { constraint?: string; code?: string };
      return failure.constraint ?? failure.code ?? String(error);
    },
  );

// Task 5.7a-3c, pull request #190 (db/migrations/0100): the periods of the
// acting teacher of a vacancy's journal (edge/timetable, After publishing, "A
// vacancy lasts a quarter": "names an acting teacher for the journal for a
// period"). Decisions 4 and 6, review correction 1, spec review of the plan
// must-fix 3 and should-fix 1. Each test has a branch of its own. All names
// are invented.
describe('the acting teacher of a journal in the database', () => {
  let database: TestDatabase;
  let kit: ActingKit;
  let branchCount = 0;
  let accountId: string;

  const app = () => new Transactions(database.app, new FixedClock(NOW));

  async function fresh(): Promise<ActingScene> {
    branchCount += 1;
    const branch = await insertBranch(database.migrator, `Branch ${String(branchCount)}`);
    const scene = await kit.scene(branch);
    accountId = scene.personAccount;
    return scene;
  }

  /** A period inserted as the application, at NOW. */
  const insert = (
    scene: ActingScene,
    from: string,
    until: string | null = null,
    extra: { end_cause?: 'ended' | 'withdrawn'; ended_by?: string } = {},
  ) =>
    outcome(
      app().run([scene.branch], (transaction) =>
        transaction
          .insertInto('journal_acting_teachers')
          .values({
            branch_id: scene.branch,
            journal_id: scene.journal,
            vacancy_id: scene.vacancy,
            person_id: scene.person,
            valid_from: from,
            valid_until: until,
            given_by: accountId,
            ...extra,
          })
          .execute(),
      ),
    );

  /** An update of a period as the application, at NOW. */
  const update = (
    scene: ActingScene,
    id: string,
    values: { valid_until?: string | null; end_cause?: 'ended' | 'withdrawn' | null },
  ) =>
    outcome(
      app().run([scene.branch], (transaction) =>
        transaction
          .updateTable('journal_acting_teachers')
          .set({ ended_by: accountId, end_cause: 'ended', ...values })
          .where('id', '=', id)
          .execute(),
      ),
    );

  beforeAll(async () => {
    database = await createTestDatabase();
    kit = new ActingKit(database.migrator);
  });

  afterAll(async () => {
    await database.destroy();
  });

  it('keeps one acting teacher of a journal on a day (journal_acting_one, decision 6)', async () => {
    const scene = await fresh();
    expect(await insert(scene, TODAY, LATER)).toBe('written');
    expect(await insert(scene, LATER, LATEST)).toBe('written');
    expect(await insert(scene, LATEST)).toBe('written');
    // Overlapping the first, and an open-ended one over the last.
    expect(await insert(scene, '2026-10-20', '2026-10-22')).toBe('journal_acting_one');
    expect(await insert(scene, '2026-12-01')).toBe('journal_acting_one');
  });

  it('lets a period meet a withdrawn (empty) one on its days', async () => {
    const scene = await fresh();
    const id = await kit.period(scene, LATER, LATEST);
    expect(await update(scene, id, { valid_until: LATER, end_cause: 'withdrawn' })).toBe('written');
    expect(await insert(scene, LATER, LATEST)).toBe('written');
  });

  it('refuses a start before today, from the moment of the transaction (decision 4)', async () => {
    const scene = await fresh();
    expect(await insert(scene, YESTERDAY)).toBe('journal_acting_start_past');
    expect(await insert(scene, TODAY)).toBe('written');
  });

  it('refuses an empty or reversed period at naming (review correction 1)', async () => {
    const scene = await fresh();
    expect(await insert(scene, LATER, LATER)).toBe('journal_acting_empty');
    expect(await insert(scene, LATER, TODAY)).toBe('journal_acting_empty');
    // Past the trigger (as the owner), the check of the table still refuses it.
    expect(
      await outcome(
        database.migrator
          .insertInto('journal_acting_teachers')
          .values({
            branch_id: scene.branch,
            journal_id: scene.journal,
            vacancy_id: scene.vacancy,
            person_id: scene.person,
            valid_from: LATER,
            valid_until: TODAY,
            given_by: accountId,
          })
          .execute(),
      ),
    ).toBe('journal_acting_teachers_range_check');
  });

  it('keeps the end cause to the end route: none with a typed end, none without an end (should-fix 1)', async () => {
    const scene = await fresh();
    expect(await insert(scene, TODAY, LATER)).toBe('written');
    // The application cannot write a cause at naming: the columns are outside the insert grant.
    expect(await insert(scene, LATER, null, { end_cause: 'ended', ended_by: accountId })).toBe(
      '42501',
    );
    const id = await kit.period(scene, LATEST);
    // Past the trigger (as the owner): a cause with no end.
    expect(
      await outcome(
        database.migrator
          .updateTable('journal_acting_teachers')
          .set({ end_cause: 'ended', ended_by: accountId })
          .where('id', '=', id)
          .execute(),
      ),
    ).toBe('journal_acting_teachers_end_cause_needed');
  });

  it('keeps who ended a period with its cause, and a vacancy apart from the person (code review, must-fix 2)', async () => {
    const scene = await fresh();
    const id = await kit.period(scene, LATER, LATEST);
    expect(
      await outcome(
        database.migrator
          .updateTable('journal_acting_teachers')
          .set({ end_cause: 'ended', ended_by: null })
          .where('id', '=', id)
          .execute(),
      ),
    ).toBe('journal_acting_teachers_ended_by_check');
    expect(
      await outcome(
        database.migrator
          .insertInto('journal_acting_teachers')
          .values({
            branch_id: scene.branch,
            journal_id: scene.journal,
            vacancy_id: scene.vacancy,
            person_id: scene.vacancy,
            valid_from: LATEST,
            given_by: accountId,
          })
          .execute(),
      ),
    ).toBe('journal_acting_teachers_people_check');
  });

  it('refuses a write of the application with no moment of the transaction', async () => {
    const scene = await fresh();
    const id = await kit.period(scene, LATER);
    const withoutMoment = (work: Parameters<Transactions['run']>[1]) =>
      outcome(
        app().run([scene.branch], async (transaction) => {
          await sql`select set_config('app.now', '', true)`.execute(transaction);
          return work(transaction);
        }),
      );
    expect(
      await withoutMoment((transaction) =>
        transaction
          .insertInto('journal_acting_teachers')
          .values({
            branch_id: scene.branch,
            journal_id: scene.journal,
            vacancy_id: scene.vacancy,
            person_id: scene.person,
            valid_from: LATEST,
            given_by: accountId,
          })
          .execute(),
      ),
    ).toBe('journal_acting_needs_moment');
    expect(
      await withoutMoment((transaction) =>
        transaction
          .updateTable('journal_acting_teachers')
          .set({ valid_until: LATEST, end_cause: 'ended', ended_by: accountId })
          .where('id', '=', id)
          .execute(),
      ),
    ).toBe('journal_acting_needs_moment');
  });

  it('ends a period only earlier, on today or later; an end passed is final', async () => {
    const scene = await fresh();
    const open = await kit.period(scene, '2026-10-01');
    expect(await update(scene, open, { valid_until: YESTERDAY })).toBe('journal_acting_end_past');
    expect(await update(scene, open, { valid_until: LATEST })).toBe('written');
    expect(await update(scene, open, { valid_until: '2026-12-01' })).toBe(
      'journal_acting_end_later',
    );
    expect(await update(scene, open, { valid_until: LATER })).toBe('written');
    // An end is never taken back to open-ended.
    expect(await update(scene, open, { valid_until: null })).toBe('journal_acting_end_later');
    const ended = await kit.period(scene, '2026-09-10', '2026-09-20');
    expect(await update(scene, ended, { valid_until: '2026-09-15' })).toBe(
      'journal_acting_end_final',
    );
  });

  it('refuses a change of a column outside the grant', async () => {
    const scene = await fresh();
    const id = await kit.period(scene, LATER);
    const refused = await outcome(
      app().run([scene.branch], (transaction) =>
        transaction
          .updateTable('journal_acting_teachers')
          .set({ valid_from: LATEST })
          .where('id', '=', id)
          .execute(),
      ),
    );
    expect(refused).toBe('42501');
    const deleted = await outcome(
      app().run([scene.branch], (transaction) =>
        transaction.deleteFrom('journal_acting_teachers').where('id', '=', id).execute(),
      ),
    );
    expect(deleted).toBe('42501');
  });

  it('refuses a naming and an end in a closed year', async () => {
    const scene = await fresh();
    const id = await kit.period(scene, LATER);
    await database.migrator
      .updateTable('academic_years')
      .set({ status: 'closed' })
      .where('id', '=', scene.year)
      .execute();
    expect(await insert(scene, LATEST)).toBe('class_year_closed');
    expect(await update(scene, id, { valid_until: LATEST })).toBe('class_year_closed');
  });

  it('hides another branch’s periods', async () => {
    const scene = await fresh();
    const other = await fresh();
    await kit.period(scene, LATER);
    const seen = await app().run([other.branch], (transaction) =>
      transaction.selectFrom('journal_acting_teachers').select('id').execute(),
    );
    expect(seen).toEqual([]);
  });
});
