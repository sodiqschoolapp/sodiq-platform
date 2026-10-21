import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions } from '../../database/transactions.js';
import { ActingKit, type ActingScene } from '../../testing/acting-kit.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';
import { endsOnOf, journalOwnerOn, journalsWithoutTeacher } from './journal-owners.js';

/** Thursday 15 October 2026, 10:00 in Tashkent. */
const NOW = '2026-10-15T10:00:00+05:00';
const TODAY = '2026-10-15';
/** The fill's date, a Monday. */
const FILL = '2026-11-02';
const DECEMBER = '2026-12-01';

// Task 5.7a-3c, pull request #190: who owns a journal on a day
// (edge/timetable, After publishing, "A vacancy lasts a quarter: who writes
// the plan and grades?" and "The plan, the journal and the reports of a
// vacancy's subject"). Decisions 2 and 3, review correction 2, spec review of
// the plan must-fix 4 and should-fix 2. All names are invented.
describe('the owner of a journal', () => {
  let database: TestDatabase;
  let kit: ActingKit;
  let branchCount = 0;

  const transactions = () => new Transactions(database.app, new FixedClock(NOW));

  const ownerOn = (scene: ActingScene, day: string) =>
    transactions().run([scene.branch], (transaction) =>
      journalOwnerOn(transaction, scene.branch, scene.journal, day),
    );

  const without = (scene: ActingScene, from: string, until: string) =>
    transactions().run([scene.branch], (transaction) =>
      journalsWithoutTeacher(transaction, scene.branch, from, until),
    );

  async function fresh(): Promise<ActingScene> {
    branchCount += 1;
    const branch = await insertBranch(database.migrator, `Branch ${String(branchCount)}`);
    return kit.scene(branch);
  }

  /** What a fill from FILL leaves in the chain: a published version from then whose row names the person. */
  const filled = (scene: ActingScene) => kit.published(scene, FILL, scene.person);

  beforeAll(async () => {
    database = await createTestDatabase();
    kit = new ActingKit(database.migrator);
  });

  afterAll(async () => {
    await database.destroy();
  });

  it('is the teacher of the row for a teacher’s journal', async () => {
    const scene = await fresh();
    await kit.published(scene, FILL, scene.person);
    expect(await ownerOn(scene, DECEMBER)).toEqual({ kind: 'teacher', staffId: scene.person });
  });

  it('is nobody under a vacancy without an acting teacher ("no teacher", decision 3)', async () => {
    const scene = await fresh();
    expect(await ownerOn(scene, TODAY)).toEqual({ kind: 'none', vacancyId: scene.vacancy });
  });

  it('is the acting teacher in force under the vacancy', async () => {
    const scene = await fresh();
    await kit.period(scene, TODAY);
    expect(await ownerOn(scene, TODAY)).toEqual({
      kind: 'acting',
      staffId: scene.person,
      vacancyId: scene.vacancy,
    });
  });

  it('gives nothing before a planned period starts, and leaves its end day to nobody (review correction 2)', async () => {
    const scene = await fresh();
    await kit.period(scene, '2026-10-20', '2026-10-27');
    expect((await ownerOn(scene, '2026-10-19'))?.kind).toBe('none');
    expect((await ownerOn(scene, '2026-10-20'))?.kind).toBe('acting');
    expect((await ownerOn(scene, '2026-10-26'))?.kind).toBe('acting');
    expect((await ownerOn(scene, '2026-10-27'))?.kind).toBe('none');
  });

  it('passes to the hired teacher from the fill date, and back to the acting teacher when the fill’s version is withdrawn (decision 2)', async () => {
    const scene = await fresh();
    await kit.period(scene, TODAY);
    const version = await filled(scene);
    expect((await ownerOn(scene, '2026-10-30'))?.kind).toBe('acting');
    expect(await ownerOn(scene, FILL)).toEqual({ kind: 'teacher', staffId: scene.person });
    await kit.load.setVersion(version, 'archived');
    expect((await ownerOn(scene, FILL))?.kind).toBe('acting');
  });

  it('never counts a draft that names the vacancy', async () => {
    const scene = await fresh();
    const other = await kit.load.teacher(scene.branch, {
      subjects: [{ subject: scene.subject, grades: [7] }],
    });
    // The published chain gives the row to another teacher from FILL; a
    // later draft (dated before it would run) names the vacancy again.
    await kit.published(scene, FILL, other.staffId);
    await kit.published(scene, '2026-11-09', scene.vacancy, 'draft');
    await kit.period(scene, TODAY);
    expect(await ownerOn(scene, DECEMBER)).toEqual({ kind: 'teacher', staffId: other.staffId });
  });

  it('is nobody on the days the acting person has left or is inactive (should-fix 2)', async () => {
    const scene = await fresh();
    await kit.period(scene, TODAY);
    await kit.load.status(scene.person, 'inactive', '2026-10-20');
    await kit.load.status(scene.person, 'active', '2026-10-27');
    await kit.load.status(scene.person, 'left', DECEMBER);
    expect((await ownerOn(scene, '2026-10-19'))?.kind).toBe('acting');
    expect((await ownerOn(scene, '2026-10-20'))?.kind).toBe('none');
    expect((await ownerOn(scene, '2026-10-27'))?.kind).toBe('acting');
    expect((await ownerOn(scene, DECEMBER))?.kind).toBe('none');
  });

  it('is null with no published run on the day', async () => {
    const scene = await fresh();
    expect(await ownerOn(scene, '2026-09-01')).toBeNull();
  });

  describe('journalsWithoutTeacher (decision 3, must-fix 4)', () => {
    it('lists the vacancy days with no acting teacher, not the days an acting period or a fill covers', async () => {
      const scene = await fresh();
      await kit.period(scene, '2026-10-20', '2026-10-27');
      await filled(scene);
      expect(await without(scene, TODAY, '2026-11-09')).toEqual([
        {
          journalId: scene.journal,
          days: [
            { from: TODAY, until: '2026-10-20', vacancyId: scene.vacancy },
            { from: '2026-10-27', until: FILL, vacancyId: scene.vacancy },
          ],
        },
      ]);
    });

    it('lists nothing when an acting teacher covers every day', async () => {
      const scene = await fresh();
      await kit.period(scene, TODAY);
      expect(await without(scene, TODAY, '2026-11-09')).toEqual([]);
    });
  });

  describe('endsOnOf (decision 2)', () => {
    const period = {
      id: 'p',
      journalId: 'j',
      vacancyId: 'v',
      personId: 'a',
      from: '2026-10-01',
      until: null,
    };

    it('is the fill date when the run passes to the hired teacher', () => {
      const runs = [
        { from: '2026-09-07', until: '2026-10-19', teacherId: 'v', vacancy: true },
        { from: '2026-10-19', until: FILL, teacherId: 'v', vacancy: true },
        { from: FILL, until: null, teacherId: 'a', vacancy: false },
      ];
      expect(endsOnOf(runs, period)).toBe(FILL);
      expect(endsOnOf(runs, { ...period, until: '2026-10-25' })).toBeNull();
    });

    it('is null while the vacancy holds every day', () => {
      expect(
        endsOnOf([{ from: '2026-09-07', until: null, teacherId: 'v', vacancy: true }], period),
      ).toBeNull();
    });
  });
});
