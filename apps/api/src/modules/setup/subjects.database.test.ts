import { JOURNAL_TYPES, SUBJECT_COLOURS, SUBJECT_NAME_MAX_LENGTH, WEIGHT_MIN } from '@sodiq/shared';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../../database/database.js';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';
import { SystemClock } from '../../clock/system-clock.js';

const INSUFFICIENT_PRIVILEGE = '42501';
const CHECK_VIOLATION = '23514';
const FOREIGN_KEY_VIOLATION = '23503';
const UNIQUE_VIOLATION = '23505';

const MOMENT = new Date('2026-10-10T09:00:00+05:00');

// The rules of subjects and their weights that the database itself keeps
// (db/migrations/0020 and 0021), also when the application has a fault: every
// distribution totals 100 with parts of at least 1 (`05`; the build plan's
// "done when"; decision 8); an attendance-only subject has no rating exam; the
// grades are 1 to 11, each once, ascending; a name is unique among active
// subjects; an active subject is in an active department of Academic
// (decisions 6 and 9); the weights are per branch behind the branch filter and
// a quarter's distribution names a quarter of its own branch; a closed year's
// distributions are frozen (decision 12); the application removes nothing.
describe('subjects in the database', () => {
  let database: TestDatabase;
  let transactions: Transactions;
  let north: string;
  let south: string;
  let steam: string;
  let medical: string;
  let count = 0;

  const inBranch = <T>(branch: string, work: (transaction: Transaction) => Promise<T>) =>
    transactions.run([branch], work);

  const asApp = <T>(work: (transaction: Transaction) => Promise<T>) => transactions.run([], work);

  /** A subject with a name of its own, by the application unless a writer is named. */
  function insertSubject(
    fields: Record<string, unknown> = {},
    writer: 'app' | 'migrator' = 'app',
  ): Promise<string> {
    count += 1;
    const values = {
      name_uz: `Fan ${String(count)}`,
      name_ru: `Предмет ${String(count)}`,
      name_en: `Subject ${String(count)}`,
      department_id: steam,
      grades: [5, 6],
      colour: 'blue',
      journal_type: 'graded',
      ...fields,
    };
    const insert = (db: Database | Transaction) =>
      db
        .insertInto('subjects')
        .values(values as never)
        .returning('id')
        .executeTakeFirstOrThrow()
        .then((row) => row.id);
    return writer === 'app' ? asApp(insert) : insert(database.migrator);
  }

  const insertDaily = (
    branch: string,
    subject: string,
    weights: { attendance: number; classwork: number; homework: number },
    writer: 'app' | 'migrator' = 'app',
  ) => {
    const insert = (db: Database | Transaction) =>
      db
        .insertInto('subject_daily_weights')
        .values({ branch_id: branch, subject_id: subject, ...weights })
        .execute();
    return writer === 'app' ? inBranch(branch, insert) : insert(database.migrator);
  };

  const insertQuarterWeights = (
    branch: string,
    subject: string,
    quarter: string,
    weights: {
      attendance: number;
      classwork: number;
      homework: number;
      rating_exam: number | null;
    },
    writer: 'app' | 'migrator' = 'app',
  ) => {
    const insert = (db: Database | Transaction) =>
      db
        .insertInto('subject_quarter_weights')
        .values({ branch_id: branch, subject_id: subject, quarter_id: quarter, ...weights })
        .execute();
    return writer === 'app' ? inBranch(branch, insert) : insert(database.migrator);
  };

  /** A year of four undated quarters by the migrator; closed when asked (a closed year first). */
  async function insertYear(branch: string, startDate: string, closed = false): Promise<string[]> {
    return database.migrator.transaction().execute(async (transaction) => {
      const year = await transaction
        .insertInto('academic_years')
        .values({
          branch_id: branch,
          start_date: startDate,
          end_date: `${String(Number(startDate.slice(0, 4)) + 1)}-06-30`,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const ids: string[] = [];
      for (const number of [1, 2, 3, 4]) {
        const quarter = await transaction
          .insertInto('quarters')
          .values({ branch_id: branch, academic_year_id: year.id, number })
          .returning('id')
          .executeTakeFirstOrThrow();
        ids.push(quarter.id);
      }
      if (closed) {
        for (const status of ['current', 'closed'] as const) {
          await transaction
            .updateTable('academic_years')
            .set({ status })
            .where('id', '=', year.id)
            .execute();
        }
      }
      return ids;
    });
  }

  /** The values a check constraint names, in order, as the database writes the constraint back. */
  async function valuesOfCheck(name: string): Promise<string[]> {
    const found = await sql<{ definition: string }>`
      select pg_get_constraintdef(oid) as definition from pg_constraint where conname = ${name}
    `.execute(database.migrator);
    const definition = found.rows[0]?.definition ?? '';
    return [...definition.matchAll(/'([a-z_]+)'/g)].map((match) => match[1] ?? '');
  }

  beforeAll(async () => {
    database = await createTestDatabase();
    transactions = new Transactions(database.app, new SystemClock());
    north = await insertBranch(database.migrator, 'North');
    south = await insertBranch(database.migrator, 'South');
    const departmentId = async (en: string) =>
      (
        await database.migrator
          .selectFrom('departments')
          .select('id')
          .where('name_en', '=', en)
          .executeTakeFirstOrThrow()
      ).id;
    steam = await departmentId('STEAM');
    medical = await departmentId('Medical');
  });

  afterAll(async () => {
    await database.destroy();
  });

  describe('check what is typed', () => {
    it('bound each name as packages/shared does', async () => {
      expect(SUBJECT_NAME_MAX_LENGTH).toBe(100);
      await expect(insertSubject({ name_en: 'N'.repeat(100) })).resolves.toEqual(
        expect.any(String),
      );
      for (const name of ['', ' ', 'N'.repeat(101)]) {
        await expect(insertSubject({ name_ru: name })).rejects.toMatchObject({
          code: CHECK_VIOLATION,
        });
      }
    });

    it('keep the colours and journal types equal to those of packages/shared', async () => {
      expect(await valuesOfCheck('subjects_colour_check')).toEqual([...SUBJECT_COLOURS]);
      expect(await valuesOfCheck('subjects_journal_type_check')).toEqual([...JOURNAL_TYPES]);
      await expect(insertSubject({ colour: 'black' })).rejects.toMatchObject({
        code: CHECK_VIOLATION,
      });
    });

    // Answer 8: "any of 1 to 11, ticked".
    it.each([
      ['no grade', []],
      ['grade 0', [0]],
      ['grade 12', [12]],
      ['a grade twice', [5, 5]],
      ['grades out of order', [7, 5]],
      ['a null grade', [5, null]],
    ])('refuse %s', async (_, grades) => {
      await expect(insertSubject({ grades })).rejects.toMatchObject({ code: CHECK_VIOLATION });
    });

    it('refuse grades of two dimensions and take 1 to 11 in order', async () => {
      await expect(
        asApp((transaction) =>
          sql`insert into subjects (name_uz, name_ru, name_en, department_id, grades, colour, journal_type)
              values ('Ikki', 'Два', 'Two', ${steam}, '{{1,2},{3,4}}'::smallint[], 'red', 'graded')`.execute(
            transaction,
          ),
        ),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION });
      await expect(insertSubject({ grades: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] })).resolves.toEqual(
        expect.any(String),
      );
    });

    // `edge/calculation`: attendance-only subjects have no weights and no result.
    it('refuse a rating exam on an attendance-only subject', async () => {
      await expect(
        insertSubject({ journal_type: 'attendance_only', rating_exam: true }),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION });
    });
  });

  // `05`: "Each distribution must total 100." The build plan's "done when",
  // kept by the database for every writer.
  describe('keep every distribution at 100', () => {
    it.each(['app', 'migrator'] as const)(
      'for the daily distribution, as the %s: 99 and 101 refused, 100 taken',
      async (writer) => {
        const subject = await insertSubject();
        for (const homework of [39, 41]) {
          await expect(
            insertDaily(north, subject, { attendance: 10, classwork: 50, homework }, writer),
          ).rejects.toMatchObject({ code: CHECK_VIOLATION });
        }
        await expect(
          insertDaily(north, subject, { attendance: 10, classwork: 50, homework: 40 }, writer),
        ).resolves.toBeDefined();
      },
    );

    it.each(['app', 'migrator'] as const)(
      'for a quarterly distribution of three and of four parts, as the %s',
      async (writer) => {
        const [first, second] = await insertYear(
          north,
          writer === 'app' ? '2027-09-01' : '2028-09-01',
        );
        const subject = await insertSubject();
        const three = { attendance: 10, classwork: 50, homework: 40, rating_exam: null };
        const four = { attendance: 10, classwork: 30, homework: 20, rating_exam: 40 };
        for (const wrong of [
          { ...three, homework: 39 },
          { ...three, homework: 41 },
          { ...four, rating_exam: 39 },
          { ...four, rating_exam: 41 },
        ]) {
          await expect(
            insertQuarterWeights(north, subject, first ?? '', wrong, writer),
          ).rejects.toMatchObject({ code: CHECK_VIOLATION });
        }
        await expect(
          insertQuarterWeights(north, subject, first ?? '', three, writer),
        ).resolves.toBeDefined();
        await expect(
          insertQuarterWeights(north, subject, second ?? '', four, writer),
        ).resolves.toBeDefined();
      },
    );

    // Decision 8.
    it('refuse a part of 0, in either distribution', async () => {
      expect(WEIGHT_MIN).toBe(1);
      const subject = await insertSubject();
      const [first] = await insertYear(south, '2027-09-01');
      await expect(
        insertDaily(south, subject, { attendance: 0, classwork: 60, homework: 40 }),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION });
      await expect(
        insertQuarterWeights(south, subject, first ?? '', {
          attendance: 10,
          classwork: 50,
          homework: 40,
          rating_exam: 0,
        }),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION });
    });

    it('refuse an update that leaves the total off 100', async () => {
      const subject = await insertSubject();
      await insertDaily(north, subject, { attendance: 10, classwork: 50, homework: 40 });
      await expect(
        inBranch(north, (transaction) =>
          transaction
            .updateTable('subject_daily_weights')
            .set({ homework: 45 })
            .where('subject_id', '=', subject)
            .execute(),
        ),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION });
    });
  });

  // Decision 11: two active subjects of one name would be indistinguishable.
  describe('keep names unique among active subjects', () => {
    it('in each language, whatever the case (Cyrillic too); an archived subject frees its name', async () => {
      const first = await insertSubject({ name_ru: 'Физика' });
      await expect(insertSubject({ name_ru: 'ФИЗИКА' })).rejects.toMatchObject({
        code: UNIQUE_VIOLATION,
        constraint: 'subjects_active_name_ru_idx',
      });
      await asApp((transaction) =>
        transaction
          .updateTable('subjects')
          .set({ archived_at: MOMENT })
          .where('id', '=', first)
          .execute(),
      );
      await expect(insertSubject({ name_ru: 'физика' })).resolves.toEqual(expect.any(String));
    });
  });

  // `03`, Department; decisions 6 and 9.
  describe('keep an active subject in an active department of Academic', () => {
    async function archivedDepartment(): Promise<string> {
      count += 1;
      const academic = await database.migrator
        .selectFrom('divisions')
        .select('id')
        .where('built_in', '=', true)
        .executeTakeFirstOrThrow();
      const row = await database.migrator
        .insertInto('departments')
        .values({
          division_id: academic.id,
          name_uz: `Eski ${String(count)}`,
          name_ru: `Старый ${String(count)}`,
          name_en: `Old ${String(count)}`,
          position: 50 + count,
          archived_at: MOMENT,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return row.id;
    }

    it.each(['app', 'migrator'] as const)(
      'refuse a department of another division, and an archived one, as the %s',
      async (writer) => {
        await expect(insertSubject({ department_id: medical }, writer)).rejects.toMatchObject({
          code: CHECK_VIOLATION,
          constraint: 'subjects_department_academic',
        });
        await expect(
          insertSubject({ department_id: await archivedDepartment() }, writer),
        ).rejects.toMatchObject({
          code: CHECK_VIOLATION,
          constraint: 'subjects_department_archived',
        });
      },
    );

    it('refuse a move into such a department, and a restore while the department is archived (as the migrator)', async () => {
      const subject = await insertSubject();
      await expect(
        asApp((transaction) =>
          transaction
            .updateTable('subjects')
            .set({ department_id: medical })
            .where('id', '=', subject)
            .execute(),
        ),
      ).rejects.toMatchObject({ constraint: 'subjects_department_academic' });

      const department = await archivedDepartment();
      const archived = await insertSubject(
        { department_id: department, archived_at: MOMENT },
        'migrator',
      );
      await expect(
        database.migrator
          .updateTable('subjects')
          .set({ archived_at: null })
          .where('id', '=', archived)
          .execute(),
      ).rejects.toMatchObject({ constraint: 'subjects_department_archived' });
    });

    // The review's correction 2: archiving a subject is never refused because
    // of its department's state.
    it('take the archive of a subject whose department was archived', async () => {
      count += 1;
      const academic = await database.migrator
        .selectFrom('divisions')
        .select('id')
        .where('built_in', '=', true)
        .executeTakeFirstOrThrow();
      const department = await database.migrator
        .insertInto('departments')
        .values({
          division_id: academic.id,
          name_uz: `Yopiladi ${String(count)}`,
          name_ru: `Закроется ${String(count)}`,
          name_en: `Closing ${String(count)}`,
          position: 80 + count,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const subject = await insertSubject({ department_id: department.id });
      await database.migrator
        .updateTable('departments')
        .set({ archived_at: MOMENT })
        .where('id', '=', department.id)
        .execute();

      await expect(
        asApp((transaction) =>
          transaction
            .updateTable('subjects')
            .set({ archived_at: MOMENT })
            .where('id', '=', subject)
            .execute(),
        ),
      ).resolves.toBeDefined();
    });
  });

  // docs/spec/edge-cases/developer-rules.md, Branch filter; answer 3.
  describe('keep the weights behind the branch filter', () => {
    it('so that a transaction of another branch sees none of them and writes none', async () => {
      const subject = await insertSubject();
      const [quarter] = await insertYear(north, '2029-09-01');
      await insertDaily(north, subject, { attendance: 10, classwork: 50, homework: 40 });
      await insertQuarterWeights(north, subject, quarter ?? '', {
        attendance: 10,
        classwork: 50,
        homework: 40,
        rating_exam: null,
      });

      const seen = await inBranch(south, async (transaction) => ({
        daily: await transaction
          .selectFrom('subject_daily_weights')
          .select('subject_id')
          .where('subject_id', '=', subject)
          .execute(),
        quarters: await transaction
          .selectFrom('subject_quarter_weights')
          .select('subject_id')
          .where('subject_id', '=', subject)
          .execute(),
      }));
      expect(seen).toEqual({ daily: [], quarters: [] });

      const other = await insertSubject();
      await expect(
        inBranch(south, (transaction) =>
          transaction
            .insertInto('subject_daily_weights')
            .values({
              branch_id: north,
              subject_id: other,
              attendance: 10,
              classwork: 50,
              homework: 40,
            })
            .execute(),
        ),
      ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
    });

    it("refuse a quarterly distribution that names another branch's quarter", async () => {
      const subject = await insertSubject();
      const [southQuarter] = await insertYear(south, '2029-09-01');
      await expect(
        insertQuarterWeights(
          north,
          subject,
          southQuarter ?? '',
          { attendance: 10, classwork: 50, homework: 40, rating_exam: null },
          'migrator',
        ),
      ).rejects.toMatchObject({ code: FOREIGN_KEY_VIOLATION });
    });
  });

  // Decision 12: a quarter of a closed year is closed.
  describe('freeze the distributions of a closed year', () => {
    it.each(['app', 'migrator'] as const)('for every writer: the %s', async (writer) => {
      const branch = await insertBranch(database.migrator, `Closed ${writer}`);
      const [quarter] = await insertYear(branch, '2025-09-01', true);
      const subject = await insertSubject();
      await expect(
        insertQuarterWeights(
          branch,
          subject,
          quarter ?? '',
          { attendance: 10, classwork: 50, homework: 40, rating_exam: null },
          writer,
        ),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: 'academic_years_closed' });
    });
  });

  // Migrations 0021 and 0022 (decision 14; the spec review): the round of a
  // subject only grows, and a weight row is written in the current round.
  describe('keep the weights round', () => {
    const setRound = (subject: string, round: number, writer: 'app' | 'migrator' = 'app') => {
      const update = (db: Database | Transaction) =>
        db
          .updateTable('subjects')
          .set({ weights_round: round })
          .where('id', '=', subject)
          .execute();
      return writer === 'app' ? asApp(update) : update(database.migrator);
    };

    it.each(['app', 'migrator'] as const)(
      'growing only, as the %s; never below 1',
      async (writer) => {
        const subject = await insertSubject();
        await expect(setRound(subject, 2, writer)).resolves.toBeDefined();
        await expect(setRound(subject, 1, writer)).rejects.toMatchObject({
          code: CHECK_VIOLATION,
          constraint: 'subjects_weights_round_down',
        });
        await expect(insertSubject({ weights_round: 0 }, 'migrator')).rejects.toMatchObject({
          code: CHECK_VIOLATION,
        });
      },
    );

    it.each(['app', 'migrator'] as const)(
      'with every weight row in the current round of its subject, as the %s',
      async (writer) => {
        const subject = await insertSubject();
        const [quarter] = await insertYear(north, writer === 'app' ? '2030-09-01' : '2031-09-01');
        await insertDaily(north, subject, { attendance: 10, classwork: 50, homework: 40 }, writer);
        await setRound(subject, 2);

        // A row of round 1 is not brought into round 2 without new values, nor kept in round 1.
        const updateDaily = (round: number) => {
          const update = (db: Database | Transaction) =>
            db
              .updateTable('subject_daily_weights')
              .set({ weights_round: round })
              .where('subject_id', '=', subject)
              .execute();
          return writer === 'app' ? inBranch(north, update) : update(database.migrator);
        };
        await expect(updateDaily(1)).rejects.toMatchObject({
          constraint: 'subject_weights_current_round',
        });
        await expect(updateDaily(2)).resolves.toBeDefined();
        await expect(
          insertQuarterWeights(
            north,
            subject,
            quarter ?? '',
            { attendance: 10, classwork: 50, homework: 40, rating_exam: null },
            writer,
          ),
        ).rejects.toMatchObject({ constraint: 'subject_weights_current_round' });
      },
    );

    // 0022: the closed-year guard locks the year row whatever its status, so a
    // close of the year waits for a weights write of that moment. The test
    // holds the write open, sends the close, sees it wait, then lets go.
    it('makes a close of the year wait for a quarterly distribution being written', async () => {
      const branch = await insertBranch(database.migrator, 'Lock branch');
      const [quarter] = await insertYear(branch, '2026-09-01');
      const year = await database.migrator
        .selectFrom('quarters')
        .select('academic_year_id')
        .where('id', '=', quarter ?? '')
        .executeTakeFirstOrThrow();
      const subject = await insertSubject();
      let open = (): void => undefined;
      const release = new Promise<void>((resolve) => {
        open = resolve;
      });
      let heldNow = (): void => undefined;
      const held = new Promise<void>((resolve) => {
        heldNow = resolve;
      });
      const write = inBranch(branch, async (transaction) => {
        await transaction
          .insertInto('subject_quarter_weights')
          .values({
            branch_id: branch,
            subject_id: subject,
            quarter_id: quarter ?? '',
            attendance: 10,
            classwork: 50,
            homework: 40,
          })
          .execute();
        heldNow();
        await release;
      });
      await held;
      try {
        const close = database.migrator
          .updateTable('academic_years')
          .set({ status: 'current' })
          .where('id', '=', year.academic_year_id)
          .execute();
        for (let tries = 0; ; tries += 1) {
          const waiting = await sql<{ n: string }>`
            select count(*) as n from pg_stat_activity
            where datname = current_database() and wait_event_type = 'Lock'
          `.execute(database.migrator);
          if (Number(waiting.rows[0]?.n) > 0) {
            break;
          }
          if (tries > 100) {
            throw new Error('The change of the year did not wait for the weights.');
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        open();
        await write;
        await close;
      } finally {
        open();
        await write.catch(() => undefined);
      }
    });
  });

  // Migration 0023 (decision 19; the review of #52): the rating round of a
  // subject only grows, and a quarterly row is written in the current rating
  // round, so a change of the rating switch brings no old row back into force.
  describe('keep the rating round', () => {
    const setRatingRound = (subject: string, round: number, writer: 'app' | 'migrator') => {
      const update = (db: Database | Transaction) =>
        db.updateTable('subjects').set({ rating_round: round }).where('id', '=', subject).execute();
      return writer === 'app' ? asApp(update) : update(database.migrator);
    };

    it.each(['app', 'migrator'] as const)(
      'growing only, as the %s; never below 1',
      async (writer) => {
        const subject = await insertSubject();
        await expect(setRatingRound(subject, 2, writer)).resolves.toBeDefined();
        await expect(setRatingRound(subject, 1, writer)).rejects.toMatchObject({
          code: CHECK_VIOLATION,
          constraint: 'subjects_rating_round_down',
        });
        await expect(insertSubject({ rating_round: 0 }, 'migrator')).rejects.toMatchObject({
          code: CHECK_VIOLATION,
        });
      },
    );

    it.each(['app', 'migrator'] as const)(
      'with every quarterly row in the current rating round of its subject, as the %s',
      async (writer) => {
        const subject = await insertSubject();
        const [first, second] = await insertYear(
          north,
          writer === 'app' ? '2032-09-01' : '2033-09-01',
        );
        const weights = { attendance: 10, classwork: 50, homework: 40, rating_exam: null };
        await insertQuarterWeights(north, subject, first ?? '', weights, writer);
        await setRatingRound(subject, 2, 'app');

        // A row of rating round 1 is not brought into round 2 without new values, nor kept in round 1.
        const updateRow = (round: number) => {
          const update = (db: Database | Transaction) =>
            db
              .updateTable('subject_quarter_weights')
              .set({ rating_round: round })
              .where('subject_id', '=', subject)
              .execute();
          return writer === 'app' ? inBranch(north, update) : update(database.migrator);
        };
        await expect(updateRow(1)).rejects.toMatchObject({
          constraint: 'subject_quarter_weights_current_rating_round',
        });
        await expect(updateRow(2)).resolves.toBeDefined();
        await expect(
          insertQuarterWeights(north, subject, second ?? '', weights, writer),
        ).rejects.toMatchObject({ constraint: 'subject_quarter_weights_current_rating_round' });
      },
    );
  });

  // CLAUDE.md, "Archive, do not delete"; the grants of 0020 and 0021.
  describe('give the application no removal and no write of protected columns', () => {
    it('refuse a delete from the three tables', async () => {
      for (const table of [
        'subjects',
        'subject_daily_weights',
        'subject_quarter_weights',
      ] as const) {
        await expect(
          inBranch(north, (transaction) =>
            sql`delete from ${sql.table(table)} where false`.execute(transaction),
          ),
        ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
      }
    });

    it('refuse a write of the id or the creation moment of a subject, and of the keys of a weight row', async () => {
      await expect(
        insertSubject({ id: '0199a000-0000-7000-8000-0000000000aa' }),
      ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
      await expect(insertSubject({ created_at: MOMENT })).rejects.toMatchObject({
        code: INSUFFICIENT_PRIVILEGE,
      });
      const subject = await insertSubject();
      await insertDaily(south, subject, { attendance: 10, classwork: 50, homework: 40 });
      await expect(
        inBranch(south, (transaction) =>
          transaction
            .updateTable('subject_daily_weights')
            .set({ subject_id: subject })
            .where('subject_id', '=', subject)
            .execute(),
        ),
      ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
    });
  });
});
