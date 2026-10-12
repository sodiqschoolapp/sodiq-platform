import { CALENDAR_ENTRY_KINDS, CALENDAR_ENTRY_NAME_MAX_LENGTH, EXAM_WEEKS } from '@sodiq/shared';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';
import { SystemClock } from '../../clock/system-clock.js';

const INSUFFICIENT_PRIVILEGE = '42501';
const CHECK_VIOLATION = '23514';
const EXCLUSION_VIOLATION = '23P01';
const FOREIGN_KEY_VIOLATION = '23503';

/** The SQLSTATE and the constraint of a refusal; what a promise that was not refused gives. */
async function refusal(work: Promise<unknown>): Promise<{ code: unknown; constraint: unknown }> {
  try {
    await work;
  } catch (error) {
    const failure = error as { code?: unknown; constraint?: unknown };
    return { code: failure.code, constraint: failure.constraint };
  }
  return { code: 'none', constraint: 'none' };
}

const ACCEPTED = { code: 'none', constraint: 'none' };
const check = (constraint: string) => ({ code: CHECK_VIOLATION, constraint });
const OVERLAP = { code: EXCLUSION_VIOLATION, constraint: 'calendar_entries_no_overlap' };

interface EntryFields {
  kind?: string;
  name?: string;
  first?: string;
  last?: string;
  gradeFrom?: number | null;
  gradeTo?: number | null;
  template?: string | null;
  follows?: number | null;
  examWeek?: string | null;
}

// The rules of the calendar that the database itself keeps (db/migrations/0018),
// also when the application has a fault: the branch filter and the keys of one
// branch; the shape of an entry (answer 15); no two active entries of one kind
// on a date for overlapping grades, a whole-branch entry holding every grade
// (answer 17, "(database constraint)"; decision 2 of pull request #47); the
// application writes only the columns it may and deletes nothing.
describe('the calendar in the database', () => {
  let database: TestDatabase;
  let transactions: Transactions;

  const inBranch = <T>(branch: string, work: (transaction: Transaction) => Promise<T>) =>
    transactions.run([branch], work);

  let branchCount = 0;
  const newBranch = () => {
    branchCount += 1;
    return insertBranch(database.migrator, `Branch ${String(branchCount)}`);
  };

  /** A template of the branch, written by the migrator (its slots are not what this file tests). */
  async function addTemplate(branch: string, name = 'Short day'): Promise<string> {
    return database.migrator.transaction().execute(async (transaction) => {
      const slotType = await transaction
        .insertInto('slot_types')
        .values({ branch_id: branch, name: `Lesson of ${name}`, kind: 'lesson' })
        .returning('id')
        .executeTakeFirstOrThrow();
      const template = await transaction
        .insertInto('day_templates')
        .values({ branch_id: branch, name })
        .returning('id')
        .executeTakeFirstOrThrow();
      const version = await transaction
        .insertInto('day_template_versions')
        .values({
          branch_id: branch,
          day_template_id: template.id,
          start_minutes: 480,
          valid_from: '2026-09-01',
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto('day_template_slots')
        .values({
          version_id: version.id,
          branch_id: branch,
          position: 1,
          slot_type_id: slotType.id,
        })
        .execute();
      return template.id;
    });
  }

  const values = (branch: string, fields: EntryFields) => ({
    branch_id: branch,
    kind: fields.kind ?? 'day_off',
    name: fields.name ?? 'Navruz',
    first_date: fields.first ?? '2027-03-21',
    last_date: fields.last ?? fields.first ?? '2027-03-21',
    grade_from: fields.gradeFrom ?? null,
    grade_to: fields.gradeTo ?? null,
    day_template_id: fields.template ?? null,
    follows_weekday: fields.follows ?? null,
    exam_week: fields.examWeek ?? null,
  });

  const addEntry = (branch: string, fields: EntryFields = {}) =>
    inBranch(branch, (transaction) =>
      transaction
        .insertInto('calendar_entries')
        .values(values(branch, fields))
        .returning('id')
        .executeTakeFirstOrThrow()
        .then((row) => row.id),
    );

  const special = (template: string, fields: EntryFields = {}): EntryFields => ({
    kind: 'special_day',
    name: 'Short day',
    template,
    ...fields,
  });

  beforeAll(async () => {
    database = await createTestDatabase();
    transactions = new Transactions(database.app, new SystemClock());
  });

  afterAll(async () => {
    await database.destroy();
  });

  // docs/spec/edge-cases/developer-rules.md, Branch filter.
  it('keeps the entries behind the branch filter', async () => {
    const north = await newBranch();
    await addEntry(north);
    const south = await newBranch();
    expect(
      await inBranch(south, (transaction) =>
        transaction.selectFrom('calendar_entries').select('id').execute(),
      ),
    ).toEqual([]);
    expect(
      await refusal(
        inBranch(south, (transaction) =>
          transaction.insertInto('calendar_entries').values(values(north, {})).execute(),
        ),
      ),
    ).toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
  });

  it('refuses a special day naming a template of another branch', async () => {
    const north = await newBranch();
    const south = await newBranch();
    const template = await addTemplate(north);
    expect(await refusal(addEntry(south, special(template)))).toEqual({
      code: FOREIGN_KEY_VIOLATION,
      constraint: 'calendar_entries_template_fkey',
    });
  });

  describe('keeps the shape of an entry', () => {
    it('with the name bound of packages/shared', async () => {
      const branch = await newBranch();
      expect(
        await refusal(addEntry(branch, { name: 'x'.repeat(CALENDAR_ENTRY_NAME_MAX_LENGTH) })),
      ).toEqual(ACCEPTED);
      expect(
        await refusal(
          addEntry(branch, {
            name: 'y'.repeat(CALENDAR_ENTRY_NAME_MAX_LENGTH + 1),
            first: '2027-03-22',
          }),
        ),
      ).toEqual(check('calendar_entries_name_check'));
      expect(await refusal(addEntry(branch, { name: '  ', first: '2027-03-23' }))).toEqual(
        check('calendar_entries_name_check'),
      );
    });

    it('with the kinds and exam weeks of packages/shared', async () => {
      const branch = await newBranch();
      const template = await addTemplate(branch);
      for (const [index, kind] of CALENDAR_ENTRY_KINDS.entries()) {
        const date = `2027-04-0${String(index + 1)}`;
        const fields = kind === 'special_day' ? special(template) : {};
        expect(await refusal(addEntry(branch, { ...fields, first: date })), kind).toEqual(ACCEPTED);
      }
      for (const [index, examWeek] of EXAM_WEEKS.entries()) {
        const date = `2027-05-0${String(index + 1)}`;
        expect(
          await refusal(addEntry(branch, special(template, { first: date, examWeek }))),
          examWeek,
        ).toEqual(ACCEPTED);
      }
      expect(await refusal(addEntry(branch, { kind: 'holiday', first: '2027-06-01' }))).toEqual(
        check('calendar_entries_kind_check'),
      );
      expect(
        await refusal(
          addEntry(branch, special(template, { first: '2027-06-02', examWeek: 'exams' })),
        ),
      ).toEqual(check('calendar_entries_kind_check'));
    });

    it('with both dates counting and the last never before the first', async () => {
      const branch = await newBranch();
      expect(await refusal(addEntry(branch, { first: '2027-03-21', last: '2027-03-21' }))).toEqual(
        ACCEPTED,
      );
      expect(await refusal(addEntry(branch, { first: '2027-03-25', last: '2027-03-24' }))).toEqual(
        check('calendar_entries_dates_check'),
      );
    });

    it('with both grades or neither, 1 to 11, upwards', async () => {
      const branch = await newBranch();
      const refused = check('calendar_entries_grades_check');
      expect(await refusal(addEntry(branch, { gradeFrom: 9, gradeTo: 9 }))).toEqual(ACCEPTED);
      expect(await refusal(addEntry(branch, { first: '2027-04-01', gradeFrom: 9 }))).toEqual(
        refused,
      );
      expect(
        await refusal(addEntry(branch, { first: '2027-04-01', gradeFrom: 9, gradeTo: 8 })),
      ).toEqual(refused);
      expect(
        await refusal(addEntry(branch, { first: '2027-04-01', gradeFrom: 0, gradeTo: 3 })),
      ).toEqual(refused);
      expect(
        await refusal(addEntry(branch, { first: '2027-04-01', gradeFrom: 10, gradeTo: 12 })),
      ).toEqual(refused);
    });

    it('with a template for a special day and nothing of one for a day off', async () => {
      const branch = await newBranch();
      const template = await addTemplate(branch);
      const refused = check('calendar_entries_kind_check');
      expect(await refusal(addEntry(branch, { kind: 'special_day' }))).toEqual(refused);
      expect(await refusal(addEntry(branch, { template }))).toEqual(refused);
      expect(await refusal(addEntry(branch, { follows: 1 }))).toEqual(refused);
      expect(await refusal(addEntry(branch, { examWeek: 'regular_lessons' }))).toEqual(refused);
      expect(await refusal(addEntry(branch, special(template, { follows: 0 })))).toEqual(refused);
      expect(await refusal(addEntry(branch, special(template, { follows: 8 })))).toEqual(refused);
      expect(await refusal(addEntry(branch, special(template, { follows: 7 })))).toEqual(ACCEPTED);
    });
  });

  // Answer 17: "two entries of the same kind are refused (database constraint)".
  describe('keeps two active entries of one kind off the same date for overlapping grades', () => {
    it('for days off, whole branch or grades, the first and last dates counting', async () => {
      const branch = await newBranch();
      await addEntry(branch, { first: '2027-03-20', last: '2027-03-22' });
      expect(await refusal(addEntry(branch, { first: '2027-03-22', last: '2027-03-23' }))).toEqual(
        OVERLAP,
      );
      expect(await refusal(addEntry(branch, { first: '2027-03-18', last: '2027-03-20' }))).toEqual(
        OVERLAP,
      );
      expect(
        await refusal(addEntry(branch, { first: '2027-03-21', gradeFrom: 9, gradeTo: 11 })),
      ).toEqual(OVERLAP);
      expect(await refusal(addEntry(branch, { first: '2027-03-23', last: '2027-03-24' }))).toEqual(
        ACCEPTED,
      );
      await addEntry(branch, { first: '2027-04-01', gradeFrom: 1, gradeTo: 4 });
      expect(
        await refusal(addEntry(branch, { first: '2027-04-01', gradeFrom: 4, gradeTo: 6 })),
      ).toEqual(OVERLAP);
      expect(
        await refusal(addEntry(branch, { first: '2027-04-01', gradeFrom: 5, gradeTo: 11 })),
      ).toEqual(ACCEPTED);
    });

    it('for special days: a grade-range one on a whole-branch one is refused (decision 2)', async () => {
      const branch = await newBranch();
      const template = await addTemplate(branch);
      await addEntry(branch, special(template, { first: '2027-03-27' }));
      expect(await refusal(addEntry(branch, special(template, { first: '2027-03-27' })))).toEqual(
        OVERLAP,
      );
      expect(
        await refusal(
          addEntry(branch, special(template, { first: '2027-03-27', gradeFrom: 1, gradeTo: 4 })),
        ),
      ).toEqual(OVERLAP);
    });

    it('while a day off and a special day may share a date (a day off beats it)', async () => {
      const branch = await newBranch();
      const template = await addTemplate(branch);
      await addEntry(branch, special(template, { first: '2027-03-27' }));
      expect(await refusal(addEntry(branch, { first: '2027-03-27' }))).toEqual(ACCEPTED);
    });

    it('leaving archived entries out, and every branch on its own', async () => {
      const branch = await newBranch();
      const archived = await addEntry(branch, { first: '2027-03-21' });
      await inBranch(branch, (transaction) =>
        transaction
          .updateTable('calendar_entries')
          .set({ archived_at: new Date('2026-10-11T10:00:00Z') })
          .where('id', '=', archived)
          .execute(),
      );
      expect(await refusal(addEntry(branch, { first: '2027-03-21' }))).toEqual(ACCEPTED);
      // Restoring the archived one now overlaps the new one.
      expect(
        await refusal(
          inBranch(branch, (transaction) =>
            transaction
              .updateTable('calendar_entries')
              .set({ archived_at: null })
              .where('id', '=', archived)
              .execute(),
          ),
        ),
      ).toEqual(OVERLAP);
      const other = await newBranch();
      expect(await refusal(addEntry(other, { first: '2027-03-21' }))).toEqual(ACCEPTED);
    });

    it('also when an edit moves an entry onto another', async () => {
      const branch = await newBranch();
      await addEntry(branch, { first: '2027-03-21' });
      const moved = await addEntry(branch, { first: '2027-03-25' });
      expect(
        await refusal(
          inBranch(branch, (transaction) =>
            transaction
              .updateTable('calendar_entries')
              .set({ first_date: '2027-03-21' })
              .where('id', '=', moved)
              .execute(),
          ),
        ),
      ).toEqual(OVERLAP);
    });
  });

  describe('lets the application write only what it may', () => {
    it('never delete an entry', async () => {
      const branch = await newBranch();
      await addEntry(branch);
      expect(
        await refusal(
          inBranch(branch, (transaction) => transaction.deleteFrom('calendar_entries').execute()),
        ),
      ).toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
    });

    it('never change the kind or the branch, nor write an archived entry at insert', async () => {
      const branch = await newBranch();
      await addEntry(branch);
      for (const change of [{ kind: 'special_day' }, { branch_id: branch }] as const) {
        expect(
          await refusal(
            inBranch(branch, (transaction) =>
              transaction.updateTable('calendar_entries').set(change).execute(),
            ),
          ),
          Object.keys(change).join(),
        ).toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
      }
      expect(
        await refusal(
          inBranch(branch, (transaction) =>
            sql`insert into calendar_entries (branch_id, kind, name, first_date, last_date, archived_at)
                values (${branch}, 'day_off', 'Archived', '2027-05-01', '2027-05-01', now())`.execute(
              transaction,
            ),
          ),
        ),
      ).toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
    });
  });
});
