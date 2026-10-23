import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../../database/migrate.js';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { ClassesKit } from '../../testing/classes-kit.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

const CHECK_VIOLATION = '23514';
const UNIQUE_VIOLATION = '23505';
const INSUFFICIENT_PRIVILEGE = '42501';

const NOW = '2026-10-15T10:00:00+05:00';

async function refusal(
  work: Promise<unknown>,
): Promise<{ code?: string; constraint?: string; message?: string }> {
  try {
    await work;
  } catch (error) {
    return error as { code?: string; constraint?: string; message?: string };
  }
  throw new Error('The database did not refuse it.');
}

const MIGRATIONS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../../db/migrations',
);
const PLAN_WINDOW = '0117_plan_window.sql';

// The plan window and requests in the database (task 7.2, pull request #215;
// db/migrations/0117): one window per quarter and branch inside its quarter, the
// states of a request, the grants, and a plan record for every journal of a
// graded subject and quarter. Invented names.
describe('the plan window and requests in the database', () => {
  let database: TestDatabase;
  let transactions: Transactions;
  let classes: ClassesKit;
  let north: string;
  let year: string;
  let quarter: string;
  let account: string;

  const inBranch = <T>(work: (transaction: Transaction) => Promise<T>) =>
    transactions.run([north], work);

  const window = (change: object = {}) =>
    inBranch((transaction) =>
      transaction
        .insertInto('lesson_plan_windows')
        .values({
          branch_id: north,
          quarter_id: quarter,
          start_date: '2026-09-01',
          end_date: '2026-09-20',
          starts_at: new Date('2026-09-01T00:00:00+05:00'),
          ends_at: new Date('2026-09-20T23:59:59.999+05:00'),
          opened_at: new Date(NOW),
          opened_by: account,
          ...change,
        })
        .returning('id')
        .executeTakeFirstOrThrow(),
    );

  /** A graded journal of a new class, with its plan records (0117), and the plan of quarter 1. */
  const journal = async (journalType: 'graded' | 'attendance_only' = 'graded') => {
    const subject = await classes.subject({ grades: [7], journalType });
    const classId = await classes.schoolClass(north, year, { grade: 7 });
    const row = await inBranch((transaction) =>
      transaction
        .insertInto('journals')
        .values({
          branch_id: north,
          academic_year_id: year,
          class_id: classId,
          group_id: null,
          subject_id: subject,
          runs: '{[2026-09-07,)}',
        })
        .returning('id')
        .executeTakeFirstOrThrow(),
    );
    return row.id;
  };

  const linksOf = (journalId: string) =>
    database.migrator
      .selectFrom('lesson_plan_journals')
      .innerJoin('quarters', 'quarters.id', 'lesson_plan_journals.quarter_id')
      .select(['lesson_plan_journals.plan_id', 'quarters.number'])
      .where('lesson_plan_journals.journal_id', '=', journalId)
      .orderBy('quarters.number')
      .execute();

  const request = async (change: object) => {
    const journalId = await journal();
    const [link] = await linksOf(journalId);
    return inBranch((transaction) =>
      transaction
        .insertInto('lesson_plan_requests')
        .values({
          branch_id: north,
          plan_id: link?.plan_id ?? '',
          journal_id: journalId,
          quarter_id: quarter,
          kind: 'replan',
          status: 'prepared',
          from_date: '2026-09-14',
          prepared_at: new Date(NOW),
          updated_at: new Date(NOW),
          ...change,
        })
        .returning('id')
        .executeTakeFirstOrThrow(),
    );
  };

  beforeAll(async () => {
    database = await createTestDatabase();
    transactions = new Transactions(database.app, new FixedClock(NOW));
    classes = new ClassesKit(database.migrator);
    north = await insertBranch(database.migrator, 'North');
    year = await classes.year(north);
    await database.migrator
      .updateTable('quarters')
      .set({ start_date: '2026-09-01', end_date: '2026-10-31' })
      .where('academic_year_id', '=', year)
      .where('number', '=', 1)
      .execute();
    quarter = (
      await database.migrator
        .selectFrom('quarters')
        .select('id')
        .where('academic_year_id', '=', year)
        .where('number', '=', 1)
        .executeTakeFirstOrThrow()
    ).id;
    account = (
      await database.migrator
        .insertInto('accounts')
        .values({
          login: 'vice.window',
          password_hash: '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0c2FsdA$aGFzaA',
          must_change_password: false,
          created_at: new Date(NOW),
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
  });

  afterAll(async () => {
    await database.destroy();
  });

  it('keeps one window per quarter and branch, its start on or before its end, inside its quarter', async () => {
    const dates = await refusal(window({ start_date: '2026-09-21', end_date: '2026-09-20' }));
    expect(dates.code).toBe(CHECK_VIOLATION);
    expect(dates.constraint).toBe('lesson_plan_windows_dates_check');
    const moments = await refusal(
      window({
        starts_at: new Date('2026-09-21T00:00:00+05:00'),
        ends_at: new Date('2026-09-20T00:00:00+05:00'),
      }),
    );
    expect(moments.constraint).toBe('lesson_plan_windows_moments_check');
    // `edge`: "It ends no later than the quarter's last day."
    const after = await refusal(window({ end_date: '2026-11-01' }));
    expect(after.code).toBe(CHECK_VIOLATION);
    expect(after.constraint).toBe('lesson_plan_window_quarter');
    // A start before the quarter is allowed (`edge`: published two days before lessons start).
    const opened = await window({ start_date: '2026-08-28' });
    const second = await refusal(window());
    expect(second.code).toBe(UNIQUE_VIOLATION);
    expect(second.constraint).toBe('lesson_plan_windows_quarter_key');
    // The end moved past the quarter on update is refused too.
    const moved = await refusal(
      inBranch((transaction) =>
        transaction
          .updateTable('lesson_plan_windows')
          .set({ end_date: '2026-11-02' })
          .where('id', '=', opened.id)
          .execute(),
      ),
    );
    expect(moved.constraint).toBe('lesson_plan_window_quarter');
    // Never deleted; the opener never changes.
    const deleted = await refusal(
      inBranch((transaction) =>
        transaction.deleteFrom('lesson_plan_windows').where('id', '=', opened.id).execute(),
      ),
    );
    expect(deleted.code).toBe(INSUFFICIENT_PRIVILEGE);
    const opener = await refusal(
      inBranch((transaction) =>
        transaction
          .updateTable('lesson_plan_windows')
          .set({ opened_by: account })
          .where('id', '=', opened.id)
          .execute(),
      ),
    );
    expect(opener.code).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it('holds each status of a request to its columns, and the Re-plan part to its kind', async () => {
    const at = new Date(NOW);
    // A prepared request has no sender and no decision.
    expect((await refusal(request({ requested_by: account }))).constraint).toBe(
      'lesson_plan_requests_state_check',
    );
    // A sent one has its moment.
    expect((await refusal(request({ status: 'sent', requested_by: account }))).constraint).toBe(
      'lesson_plan_requests_state_check',
    );
    await request({ status: 'sent', requested_by: account, sent_at: at });
    // An approved one has its decider, moment, days and end.
    expect(
      (
        await refusal(
          request({
            status: 'approved',
            sent_at: at,
            decided_by: account,
            decided_at: at,
            days: 2,
          }),
        )
      ).constraint,
    ).toBe('lesson_plan_requests_state_check');
    await request({
      status: 'approved',
      sent_at: at,
      decided_by: account,
      decided_at: at,
      days: 2,
      open_until: at,
    });
    // An extension names its end, with no days.
    await request({
      kind: 'extension',
      from_date: null,
      status: 'approved',
      decided_by: account,
      decided_at: at,
      open_until: at,
    });
    // A refused one has no period.
    expect(
      (
        await refusal(
          request({
            status: 'refused',
            sent_at: at,
            decided_by: account,
            decided_at: at,
            open_until: at,
          }),
        )
      ).constraint,
    ).toBe('lesson_plan_requests_state_check');
    // `edge`: "The days are school days, from 1 to 10."
    expect(
      (
        await refusal(
          request({
            status: 'approved',
            sent_at: at,
            decided_by: account,
            decided_at: at,
            days: 11,
            open_until: at,
          }),
        )
      ).constraint,
    ).toBe('lesson_plan_requests_days_check');
    // The Re-plan part is the Re-plan's only.
    expect((await refusal(request({ from_date: null }))).constraint).toBe(
      'lesson_plan_requests_kind_from_check',
    );
    expect(
      (
        await refusal(
          request({ kind: 'text', status: 'sent', sent_at: at, from_date: '2026-09-14' }),
        )
      ).constraint,
    ).toBe('lesson_plan_requests_kind_from_check');
  });

  it('lets the application change no kind of a request and delete none', async () => {
    const made = await request({});
    const kind = await refusal(
      inBranch((transaction) =>
        transaction
          .updateTable('lesson_plan_requests')
          .set({ kind: 'text' })
          .where('id', '=', made.id)
          .execute(),
      ),
    );
    expect(kind.code).toBe(INSUFFICIENT_PRIVILEGE);
    const deleted = await refusal(
      inBranch((transaction) =>
        transaction.deleteFrom('lesson_plan_requests').where('id', '=', made.id).execute(),
      ),
    );
    expect(deleted.code).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it('makes a plan record for every quarter of a graded journal from its insert, none for an attendance-only one', async () => {
    const graded = await journal();
    const links = await linksOf(graded);
    expect(links.map((one) => one.number)).toEqual([1, 2, 3, 4]);
    expect(new Set(links.map((one) => one.plan_id)).size).toBe(4);
    // The insert marks the journal, so the follow lays the new plans before the commit.
    const marked = await database.migrator
      .selectFrom('lesson_plan_follow_marks')
      .select('journal_id')
      .where('journal_id', '=', graded)
      .execute();
    expect(marked.length).toBeGreaterThan(0);
    expect(await linksOf(await journal('attendance_only'))).toEqual([]);
  });
});

// Task 7.2 (review decision 21): 0117 makes the plan records of every journal of
// a graded subject in a year not closed, keeping the records that exist.
describe('migration 0117 makes the plan records of the journals that exist', () => {
  let database: TestDatabase;
  let directory: string;

  beforeAll(async () => {
    database = await createTestDatabase({ empty: true });
    directory = await mkdtemp(path.join(tmpdir(), 'sodiq-plan-window-'));
    for (const name of (await readdir(MIGRATIONS)).filter((one) => one.endsWith('.sql'))) {
      if (name < PLAN_WINDOW) {
        await copyFile(path.join(MIGRATIONS, name), path.join(directory, name));
      }
    }
    await migrate({ connectionString: database.migrationUrl, directory });
  });

  afterAll(async () => {
    await database.destroy();
    await rm(directory, { recursive: true, force: true });
  });

  it('keeps an existing record, adds the missing quarters, and skips attendance-only subjects and closed years', async () => {
    const m = database.migrator;
    const classes = new ClassesKit(m);
    const north = await insertBranch(m, 'North');
    const journalIn = async (year: string, journalType: 'graded' | 'attendance_only') => {
      const subject = await classes.subject({ grades: [7], journalType });
      const classId = await classes.schoolClass(north, year, { grade: 7 });
      return await m
        .insertInto('journals')
        .values({
          branch_id: north,
          academic_year_id: year,
          class_id: classId,
          group_id: null,
          subject_id: subject,
          runs: '{}',
        })
        .returning(['id', 'subject_id'])
        .executeTakeFirstOrThrow();
    };
    // Last year gets its journal while current, then closes.
    const closed = await classes.year(north, 'current', '2025-09-01', '2026-05-31');
    const old = await journalIn(closed, 'graded');
    await m
      .updateTable('academic_years')
      .set({ status: 'closed' })
      .where('id', '=', closed)
      .execute();
    const open = await classes.year(north);
    const graded = await journalIn(open, 'graded');
    const attendance = await journalIn(open, 'attendance_only');
    // A record written as 7.1a wrote it, on the first write, for quarter 1.
    const q1 = (
      await m
        .selectFrom('quarters')
        .select('id')
        .where('academic_year_id', '=', open)
        .where('number', '=', 1)
        .executeTakeFirstOrThrow()
    ).id;
    const kept = await m
      .insertInto('lesson_plans')
      .values({ branch_id: north, quarter_id: q1, subject_id: graded.subject_id })
      .returning('id')
      .executeTakeFirstOrThrow();
    await m
      .insertInto('lesson_plan_journals')
      .values({ branch_id: north, plan_id: kept.id, journal_id: graded.id, quarter_id: q1 })
      .execute();
    await copyFile(path.join(MIGRATIONS, PLAN_WINDOW), path.join(directory, PLAN_WINDOW));
    await migrate({ connectionString: database.migrationUrl, directory });
    const linksOf = (journalId: string) =>
      m
        .selectFrom('lesson_plan_journals')
        .innerJoin('quarters', 'quarters.id', 'lesson_plan_journals.quarter_id')
        .select(['lesson_plan_journals.plan_id', 'quarters.number'])
        .where('lesson_plan_journals.journal_id', '=', journalId)
        .orderBy('quarters.number')
        .execute();
    const links = await linksOf(graded.id);
    expect(links.map((one) => one.number)).toEqual([1, 2, 3, 4]);
    expect(links[0]?.plan_id).toBe(kept.id);
    expect(await linksOf(attendance.id)).toEqual([]);
    expect(await linksOf(old.id)).toEqual([]);
  });
});
