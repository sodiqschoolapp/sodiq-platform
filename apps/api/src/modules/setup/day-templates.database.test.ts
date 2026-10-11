import {
  DAY_TEMPLATE_NAME_MAX_LENGTH,
  DAY_TEMPLATE_SLOTS_MAX,
  SLOT_KINDS,
  SLOT_LENGTH_MAX_MINUTES,
  SLOT_LENGTH_MIN_MINUTES,
  SLOT_TYPE_NAME_MAX_LENGTH,
  TEMPLATE_LEVELS,
} from '@sodiq/shared';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../../database/database.js';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';
import { ApiException } from '../../http/api-exception.js';
import { assignmentRefusals, refusingConstraints } from './setup-refusals.js';

const INSUFFICIENT_PRIVILEGE = '42501';
const CHECK_VIOLATION = '23514';
const EXCLUSION_VIOLATION = '23P01';
const FOREIGN_KEY_VIOLATION = '23503';
const UNIQUE_VIOLATION = '23505';

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
const exclusion = (constraint: string) => ({ code: EXCLUSION_VIOLATION, constraint });

type Connection = Database | Transaction;

interface Dated {
  from: string;
  until?: string | null;
}

// The rules of slot types and day templates that the database itself keeps
// (db/migrations/0017), also when the application has a fault: the branch
// filter and keys of one branch; the bounds of answers 9 and 10; unique active
// names; no two dated rows of one key on one date, and grade ranges at one
// level apart (`03`: "Grade ranges set at one level may not overlap"; answer
// 11: "(database)"); 1 to 20 slots with a lesson slot; a saved version never
// gains a slot; a dated row only shrinks and its history never changes; the
// application writes only the columns it may and deletes nothing.
describe('slot types and day templates in the database', () => {
  let database: TestDatabase;
  let transactions: Transactions;

  const inBranch = <T>(branch: string, work: (transaction: Transaction) => Promise<T>) =>
    transactions.run([branch], work);

  let branchCount = 0;
  const newBranch = () => {
    branchCount += 1;
    return insertBranch(database.migrator, `Branch ${String(branchCount)}`);
  };

  async function addSlotTypeWith(
    connection: Connection,
    branch: string,
    name: string,
    kind = 'lesson',
    length = 45,
  ): Promise<string> {
    const row = await connection
      .insertInto('slot_types')
      .values({ branch_id: branch, name, kind })
      .returning('id')
      .executeTakeFirstOrThrow();
    await connection
      .insertInto('slot_type_lengths')
      .values({
        branch_id: branch,
        slot_type_id: row.id,
        length_minutes: length,
        valid_from: '2026-09-01',
      })
      .execute();
    return row.id;
  }

  const addSlotType = (branch: string, name: string, kind = 'lesson', length = 45) =>
    inBranch(branch, (transaction) => addSlotTypeWith(transaction, branch, name, kind, length));

  async function addVersionWith(
    connection: Connection,
    branch: string,
    template: string,
    slotTypes: readonly string[],
    { from, until = null }: Dated = { from: '2026-09-01' },
  ): Promise<string> {
    const version = await connection
      .insertInto('day_template_versions')
      .values({
        branch_id: branch,
        day_template_id: template,
        start_minutes: 480,
        valid_from: from,
        valid_until: until,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    if (slotTypes.length > 0) {
      await connection
        .insertInto('day_template_slots')
        .values(
          slotTypes.map((slotType, index) => ({
            version_id: version.id,
            branch_id: branch,
            position: index + 1,
            slot_type_id: slotType,
          })),
        )
        .execute();
    }
    return version.id;
  }

  /** A template with one version of the given slots, in one transaction so that the check at commit passes. */
  const addTemplate = (branch: string, name: string, slotTypes: readonly string[]) =>
    inBranch(branch, async (transaction) => {
      const template = await transaction
        .insertInto('day_templates')
        .values({ branch_id: branch, name })
        .returning('id')
        .executeTakeFirstOrThrow();
      // Closed before 2030, so that a test can add a version from then on.
      await addVersionWith(transaction, branch, template.id, slotTypes, {
        from: '2026-09-01',
        until: '2030-01-01',
      });
      return template.id;
    });

  /** A branch with one lesson slot type and one template using it. */
  async function setUp(): Promise<{ branch: string; lesson: string; template: string }> {
    const branch = await newBranch();
    const lesson = await addSlotType(branch, 'Lesson 45');
    const template = await addTemplate(branch, 'Main', [lesson]);
    return { branch, lesson, template };
  }

  const assign = (
    branch: string,
    template: string,
    key: {
      level: string;
      weekday?: number | null;
      gradeFrom?: number | null;
      gradeTo?: number | null;
    },
    { from, until = null }: Dated,
  ) =>
    inBranch(branch, (transaction) =>
      transaction
        .insertInto('day_template_assignments')
        .values({
          branch_id: branch,
          level: key.level,
          weekday: key.weekday ?? null,
          grade_from: key.gradeFrom ?? null,
          grade_to: key.gradeTo ?? null,
          day_template_id: template,
          valid_from: from,
          valid_until: until,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
        .then((row) => row.id),
    );

  beforeAll(async () => {
    database = await createTestDatabase();
    transactions = new Transactions(database.app);
  });

  afterAll(async () => {
    await database.destroy();
  });

  // docs/spec/edge-cases/developer-rules.md, Branch filter.
  it('keep every table behind the branch filter', async () => {
    const north = await setUp();
    await assign(north.branch, north.template, { level: 'default' }, { from: '2026-10-12' });
    const south = await newBranch();

    const seen = await inBranch(south, async (transaction) => ({
      slotTypes: await transaction.selectFrom('slot_types').select('id').execute(),
      lengths: await transaction.selectFrom('slot_type_lengths').select('id').execute(),
      templates: await transaction.selectFrom('day_templates').select('id').execute(),
      versions: await transaction.selectFrom('day_template_versions').select('id').execute(),
      slots: await transaction.selectFrom('day_template_slots').select('version_id').execute(),
      assignments: await transaction.selectFrom('day_template_assignments').select('id').execute(),
    }));

    expect(seen).toEqual({
      slotTypes: [],
      lengths: [],
      templates: [],
      versions: [],
      slots: [],
      assignments: [],
    });
  });

  it('keep every row to its own branch: a template of one branch cannot use a slot type of another', async () => {
    const north = await setUp();
    const south = await setUp();

    // Written by the migrator, which passes the branch filter: only the keys refuse.
    const refused = await refusal(
      database.migrator.transaction().execute(async (transaction) => {
        const template = await transaction
          .insertInto('day_templates')
          .values({ branch_id: south.branch, name: 'Borrowed' })
          .returning('id')
          .executeTakeFirstOrThrow();
        await addVersionWith(transaction, south.branch, template.id, [north.lesson]);
      }),
    );
    expect(refused).toEqual({
      code: FOREIGN_KEY_VIOLATION,
      constraint: 'day_template_slots_slot_type_fkey',
    });
    expect(
      await refusal(
        assign(south.branch, north.template, { level: 'default' }, { from: '2026-10-12' }),
      ),
    ).toMatchObject({ code: FOREIGN_KEY_VIOLATION });
  });

  describe('keep the bounds of packages/shared', () => {
    it('for the names of slot types and templates', async () => {
      const branch = await newBranch();
      expect(await refusal(addSlotType(branch, 'x'.repeat(SLOT_TYPE_NAME_MAX_LENGTH)))).toEqual(
        ACCEPTED,
      );
      expect(await refusal(addSlotType(branch, 'y'.repeat(SLOT_TYPE_NAME_MAX_LENGTH + 1)))).toEqual(
        check('slot_types_name_check'),
      );
      expect(await refusal(addSlotType(branch, '   '))).toEqual(check('slot_types_name_check'));
      const lesson = await addSlotType(branch, 'Lesson');
      expect(
        await refusal(addTemplate(branch, 'x'.repeat(DAY_TEMPLATE_NAME_MAX_LENGTH), [lesson])),
      ).toEqual(ACCEPTED);
      expect(
        await refusal(addTemplate(branch, 'y'.repeat(DAY_TEMPLATE_NAME_MAX_LENGTH + 1), [lesson])),
      ).toEqual(check('day_templates_name_check'));
    });

    it('for the kinds of slot type and the levels', async () => {
      const kinds = await sql<{ definition: string }>`
        select pg_get_constraintdef(oid) as definition from pg_constraint
        where conname in ('slot_types_kind_check', 'day_template_assignments_level_check')
        order by conname desc
      `.execute(database.migrator);
      const [kindCheck, levelCheck] = kinds.rows.map((row) => row.definition);
      for (const kind of SLOT_KINDS) {
        expect(kindCheck).toContain(`'${kind}'`);
      }
      for (const level of TEMPLATE_LEVELS) {
        expect(levelCheck).toContain(`'${level}'`);
      }
      const branch = await newBranch();
      expect(await refusal(addSlotType(branch, 'Lunch', 'lunch'))).toEqual(
        check('slot_types_kind_check'),
      );
    });

    it('for the length of a slot type: 5 to 180 minutes', async () => {
      const branch = await newBranch();
      expect(await refusal(addSlotType(branch, 'Short', 'break', SLOT_LENGTH_MIN_MINUTES))).toEqual(
        ACCEPTED,
      );
      expect(await refusal(addSlotType(branch, 'Long', 'lesson', SLOT_LENGTH_MAX_MINUTES))).toEqual(
        ACCEPTED,
      );
      expect(
        await refusal(addSlotType(branch, 'Too short', 'break', SLOT_LENGTH_MIN_MINUTES - 1)),
      ).toEqual(check('slot_type_lengths_length_check'));
      expect(
        await refusal(addSlotType(branch, 'Too long', 'lesson', SLOT_LENGTH_MAX_MINUTES + 1)),
      ).toEqual(check('slot_type_lengths_length_check'));
    });

    it('for the start time: 00:00 to 23:59', async () => {
      const { branch, template, lesson } = await setUp();
      const version = (start: number) =>
        inBranch(branch, async (transaction) => {
          const id = await transaction
            .insertInto('day_template_versions')
            .values({
              branch_id: branch,
              day_template_id: template,
              start_minutes: start,
              valid_from: '2030-01-01',
            })
            .returning('id')
            .executeTakeFirstOrThrow();
          await transaction
            .insertInto('day_template_slots')
            .values({ version_id: id.id, branch_id: branch, position: 1, slot_type_id: lesson })
            .execute();
        });
      expect(await refusal(version(1440))).toEqual(check('day_template_versions_start_check'));
      expect(await refusal(version(-1))).toEqual(check('day_template_versions_start_check'));
      expect(await refusal(version(1439))).toEqual(ACCEPTED);
    });
  });

  // Answer 9 and decision 16: unique per branch among active rows, case and
  // outer spaces ignored.
  describe('keep active names unique in a branch', () => {
    it('for slot types, a Cyrillic name differing in case only included', async () => {
      const branch = await newBranch();
      await addSlotType(branch, 'Обед', 'break', 40);
      expect(await refusal(addSlotType(branch, ' ОБЕД ', 'break', 40))).toEqual({
        code: UNIQUE_VIOLATION,
        constraint: 'slot_types_active_name_idx',
      });
      // Another branch has names of its own.
      expect(await refusal(addSlotType(await newBranch(), 'Обед', 'break', 40))).toEqual(ACCEPTED);
    });

    it('for templates, while an archived one frees its name', async () => {
      const { branch, lesson, template } = await setUp();
      expect(await refusal(addTemplate(branch, 'MAIN', [lesson]))).toEqual({
        code: UNIQUE_VIOLATION,
        constraint: 'day_templates_active_name_idx',
      });
      await inBranch(branch, (transaction) =>
        transaction
          .updateTable('day_templates')
          .set({ archived_at: '2026-10-11T10:00:00Z' })
          .where('id', '=', template)
          .execute(),
      );
      expect(await refusal(addTemplate(branch, 'Main', [lesson]))).toEqual(ACCEPTED);
    });
  });

  // Dated rows: no two rows of one key on one date (decision 1).
  describe('keep dated rows of one key apart', () => {
    it('for the lengths of a slot type, touching half-open ranges allowed', async () => {
      const { branch, lesson } = await setUp();
      const length = (from: string, until: string | null) =>
        inBranch(branch, (transaction) =>
          transaction
            .insertInto('slot_type_lengths')
            .values({
              branch_id: branch,
              slot_type_id: lesson,
              length_minutes: 40,
              valid_from: from,
              valid_until: until,
            })
            .execute(),
        );
      // The first length is open from 2026-09-01.
      expect(await refusal(length('2026-12-01', null))).toEqual(
        exclusion('slot_type_lengths_no_overlap'),
      );
      await inBranch(branch, (transaction) =>
        transaction
          .updateTable('slot_type_lengths')
          .set({ valid_until: '2026-12-01' })
          .where('slot_type_id', '=', lesson)
          .execute(),
      );
      expect(await refusal(length('2026-12-01', null))).toEqual(ACCEPTED);
      // A withdrawn row (an empty range) never blocks.
      expect(await refusal(length('2026-11-01', '2026-11-01'))).toEqual(ACCEPTED);
    });

    it('for the versions of a template', async () => {
      const { branch, lesson, template } = await setUp();
      expect(
        await refusal(
          inBranch(branch, (transaction) =>
            addVersionWith(transaction, branch, template, [lesson], { from: '2026-12-01' }),
          ),
        ),
      ).toEqual(exclusion('day_template_versions_no_overlap'));
    });

    it('for the settings: one default and one template per weekday on a date', async () => {
      const { branch, template } = await setUp();
      await assign(
        branch,
        template,
        { level: 'default' },
        { from: '2026-10-12', until: '2026-11-01' },
      );
      expect(
        await refusal(assign(branch, template, { level: 'default' }, { from: '2026-10-31' })),
      ).toEqual(exclusion('day_template_assignments_no_overlap'));
      expect(
        await refusal(assign(branch, template, { level: 'default' }, { from: '2026-11-01' })),
      ).toEqual(ACCEPTED);
      await assign(branch, template, { level: 'weekday', weekday: 5 }, { from: '2026-10-12' });
      expect(
        await refusal(
          assign(branch, template, { level: 'weekday', weekday: 5 }, { from: '2027-01-01' }),
        ),
      ).toEqual(exclusion('day_template_assignments_no_overlap'));
      expect(
        await refusal(
          assign(branch, template, { level: 'weekday', weekday: 4 }, { from: '2026-10-12' }),
        ),
      ).toEqual(ACCEPTED);
    });

    it('for grade ranges at one level, while ranges at other levels and on other weekdays may overlap', async () => {
      const { branch, template } = await setUp();
      const from = { from: '2026-10-12' };
      await assign(branch, template, { level: 'grades', gradeFrom: 9, gradeTo: 11 }, from);
      expect(
        await refusal(
          assign(branch, template, { level: 'grades', gradeFrom: 10, gradeTo: 11 }, from),
        ),
      ).toEqual(exclusion('day_template_assignments_no_overlap'));
      expect(
        await refusal(
          assign(branch, template, { level: 'grades', gradeFrom: 1, gradeTo: 9 }, from),
        ),
      ).toEqual(exclusion('day_template_assignments_no_overlap'));
      expect(
        await refusal(
          assign(branch, template, { level: 'grades', gradeFrom: 1, gradeTo: 8 }, from),
        ),
      ).toEqual(ACCEPTED);
      await assign(
        branch,
        template,
        { level: 'weekday_grades', weekday: 1, gradeFrom: 9, gradeTo: 11 },
        from,
      );
      expect(
        await refusal(
          assign(
            branch,
            template,
            { level: 'weekday_grades', weekday: 1, gradeFrom: 11, gradeTo: 11 },
            from,
          ),
        ),
      ).toEqual(exclusion('day_template_assignments_no_overlap'));
      expect(
        await refusal(
          assign(
            branch,
            template,
            { level: 'weekday_grades', weekday: 2, gradeFrom: 9, gradeTo: 11 },
            from,
          ),
        ),
      ).toEqual(ACCEPTED);
    });

    it('in every branch on its own', async () => {
      const north = await setUp();
      const south = await setUp();
      await assign(north.branch, north.template, { level: 'default' }, { from: '2026-10-12' });
      expect(
        await refusal(
          assign(south.branch, south.template, { level: 'default' }, { from: '2026-10-12' }),
        ),
      ).toEqual(ACCEPTED);
    });
  });

  // `.claude/rules/web.md`: the text of an error code is true on every path
  // that sends it. Two settings that overlap are two grade ranges only at the
  // two grade levels.
  it('answer the overlap of two settings as overlapping grades at the grade levels only', async () => {
    const { branch, template } = await setUp();
    const from = { from: '2026-10-12' };
    const keys = [
      { level: 'default' },
      { level: 'weekday', weekday: 2 },
      { level: 'grades', gradeFrom: 5, gradeTo: 11 },
      { level: 'weekday_grades', weekday: 2, gradeFrom: 5, gradeTo: 11 },
    ] as const;
    for (const key of keys) {
      await assign(branch, template, key, from);
    }
    const answers: Record<string, unknown> = {};
    for (const key of keys) {
      try {
        await refusingConstraints(
          () => assign(branch, template, key, from),
          assignmentRefusals(key.level),
        );
        answers[key.level] = 'accepted';
      } catch (error) {
        answers[key.level] = error instanceof ApiException ? error.code : error;
      }
    }
    expect(answers).toEqual({
      default: 'request_refused',
      weekday: 'request_refused',
      grades: 'grade_ranges_overlap',
      weekday_grades: 'grade_ranges_overlap',
    });
  });

  it('tie the weekday and the grades to the level', async () => {
    const { branch, template } = await setUp();
    const from = { from: '2026-10-12' };
    const keyCheck = check('day_template_assignments_key_check');
    expect(await refusal(assign(branch, template, { level: 'default', weekday: 1 }, from))).toEqual(
      keyCheck,
    );
    expect(
      await refusal(assign(branch, template, { level: 'grades', gradeFrom: 9 }, from)),
    ).toEqual(keyCheck);
    expect(await refusal(assign(branch, template, { level: 'weekday' }, from))).toEqual(keyCheck);
    expect(
      await refusal(
        assign(branch, template, { level: 'weekday', weekday: 1, gradeFrom: 1, gradeTo: 4 }, from),
      ),
    ).toEqual(keyCheck);
    expect(
      await refusal(
        assign(
          branch,
          template,
          { level: 'weekday_grades', weekday: 1, gradeFrom: 5, gradeTo: 4 },
          from,
        ),
      ),
    ).toEqual(keyCheck);
    expect(
      await refusal(assign(branch, template, { level: 'grades', gradeFrom: 0, gradeTo: 4 }, from)),
    ).toEqual(check('day_template_assignments_grade_from_check'));
    expect(await refusal(assign(branch, template, { level: 'weekday', weekday: 8 }, from))).toEqual(
      check('day_template_assignments_weekday_check'),
    );
    expect(
      await refusal(
        assign(branch, template, { level: 'default' }, { from: '2026-10-12', until: '2026-10-11' }),
      ),
    ).toEqual(check('day_template_assignments_range_check'));
  });

  // Answer 10: "1 to 20 ordered slots with at least one lesson slot".
  describe('keep the slots of a version', () => {
    it('refusing a version without slots, with a gap, or with only breaks, at the commit', async () => {
      const { branch, template, lesson } = await setUp();
      const lunch = await addSlotType(branch, 'Lunch', 'break', 40);
      const later = { from: '2030-01-01' };
      const count = check('day_template_version_slots_count');

      expect(
        await refusal(
          inBranch(branch, (transaction) =>
            addVersionWith(transaction, branch, template, [], later),
          ),
        ),
      ).toEqual(count);
      expect(
        await refusal(
          inBranch(branch, async (transaction) => {
            const version = await addVersionWith(transaction, branch, template, [lesson], later);
            await transaction
              .insertInto('day_template_slots')
              .values({ version_id: version, branch_id: branch, position: 3, slot_type_id: lesson })
              .execute();
          }),
        ),
      ).toEqual(count);
      expect(
        await refusal(
          inBranch(branch, (transaction) =>
            addVersionWith(transaction, branch, template, [lunch, lunch], later),
          ),
        ),
      ).toEqual(check('day_template_version_lesson_slot'));
      expect(
        await refusal(
          inBranch(branch, (transaction) =>
            addVersionWith(transaction, branch, template, [lunch, lesson], later),
          ),
        ),
      ).toEqual(ACCEPTED);
    });

    it('refusing a 21st slot', async () => {
      const { branch, template, lesson } = await setUp();
      const many = Array.from({ length: DAY_TEMPLATE_SLOTS_MAX + 1 }, () => lesson);
      expect(
        await refusal(
          inBranch(branch, (transaction) =>
            addVersionWith(transaction, branch, template, many, { from: '2030-01-01' }),
          ),
        ),
      ).toEqual(check('day_template_slots_position_check'));
      expect(
        await refusal(
          inBranch(branch, (transaction) =>
            addVersionWith(transaction, branch, template, many.slice(1), { from: '2030-01-01' }),
          ),
        ),
      ).toEqual(ACCEPTED);
    });

    // The review's correction 1: a saved version never gains a slot.
    it('refusing a slot added to a version saved before, also right after it was cut', async () => {
      const { branch, template, lesson } = await setUp();
      const [version] = await inBranch(branch, (transaction) =>
        transaction
          .selectFrom('day_template_versions')
          .select('id')
          .where('day_template_id', '=', template)
          .execute(),
      );
      if (version === undefined) throw new Error('The template has a version.');
      const addSlot = (connection: Connection) =>
        connection
          .insertInto('day_template_slots')
          .values({ version_id: version.id, branch_id: branch, position: 2, slot_type_id: lesson })
          .execute();
      const sameTransaction = check('day_template_slots_same_transaction');

      expect(await refusal(inBranch(branch, addSlot))).toEqual(sameTransaction);
      expect(
        await refusal(
          inBranch(branch, async (transaction) => {
            await transaction
              .updateTable('day_template_versions')
              .set({ valid_until: '2029-01-01' })
              .where('id', '=', version.id)
              .execute();
            await addSlot(transaction);
          }),
        ),
      ).toEqual(sameTransaction);
      expect(await refusal(database.migrator.transaction().execute(addSlot))).toEqual(
        sameTransaction,
      );
    });
  });

  // Decision 1: a dated row only shrinks; its history never changes.
  describe('let a dated row only shrink', () => {
    const setUntil = (
      connection: Connection,
      table: 'slot_type_lengths' | 'day_template_assignments',
      id: string,
      until: string | null,
    ) => connection.updateTable(table).set({ valid_until: until }).where('id', '=', id).execute();

    it('from open to a date and to an earlier date, never later and never open again', async () => {
      const { branch, template } = await setUp();
      const id = await assign(branch, template, { level: 'default' }, { from: '2026-10-12' });
      const shrink = check('dated_rows_only_shrink');
      const asApp = (until: string | null) =>
        inBranch(branch, (transaction) =>
          setUntil(transaction, 'day_template_assignments', id, until),
        );

      expect(await refusal(asApp('2027-01-01'))).toEqual(ACCEPTED);
      expect(await refusal(asApp('2026-12-01'))).toEqual(ACCEPTED);
      expect(await refusal(asApp('2026-12-02'))).toEqual(shrink);
      expect(await refusal(asApp(null))).toEqual(shrink);
      // Withdrawn: an empty range, kept as history.
      expect(await refusal(asApp('2026-10-12'))).toEqual(ACCEPTED);
      expect(await refusal(asApp('2026-10-11'))).toEqual(
        check('day_template_assignments_range_check'),
      );
      // The migrator too.
      expect(
        await refusal(setUntil(database.migrator, 'day_template_assignments', id, null)),
      ).toEqual(shrink);
    });

    it('keeping every other column as written, for the migrator too', async () => {
      const { branch, lesson, template } = await setUp();
      const shrink = check('dated_rows_only_shrink');
      expect(
        await refusal(
          database.migrator
            .updateTable('slot_type_lengths')
            .set({ length_minutes: 40 })
            .where('slot_type_id', '=', lesson)
            .execute(),
        ),
      ).toEqual(shrink);
      expect(
        await refusal(
          database.migrator
            .updateTable('day_template_versions')
            .set({ start_minutes: 500 })
            .where('day_template_id', '=', template)
            .execute(),
        ),
      ).toEqual(shrink);
      const id = await assign(
        branch,
        template,
        { level: 'grades', gradeFrom: 1, gradeTo: 4 },
        { from: '2026-10-12' },
      );
      expect(
        await refusal(
          database.migrator
            .updateTable('day_template_assignments')
            .set({ grade_to: 5 })
            .where('id', '=', id)
            .execute(),
        ),
      ).toEqual(shrink);
    });
  });

  describe('let the application write only what it may', () => {
    it('never delete a row', async () => {
      const { branch } = await setUp();
      for (const table of [
        'slot_types',
        'slot_type_lengths',
        'day_templates',
        'day_template_versions',
        'day_template_slots',
        'day_template_assignments',
      ] as const) {
        expect(
          await refusal(inBranch(branch, (transaction) => transaction.deleteFrom(table).execute())),
          table,
        ).toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
      }
    });

    it('never change a kind, a length, a start, a slot, a key or a valid_from', async () => {
      const { branch, lesson, template } = await setUp();
      const id = await assign(branch, template, { level: 'default' }, { from: '2026-10-12' });
      const attempts: (() => Promise<unknown>)[] = [
        () => inBranch(branch, (t) => t.updateTable('slot_types').set({ kind: 'break' }).execute()),
        () =>
          inBranch(branch, (t) =>
            t.updateTable('slot_type_lengths').set({ length_minutes: 40 }).execute(),
          ),
        () =>
          inBranch(branch, (t) =>
            t.updateTable('slot_type_lengths').set({ valid_from: '2026-09-02' }).execute(),
          ),
        () =>
          inBranch(branch, (t) =>
            t.updateTable('day_template_versions').set({ start_minutes: 500 }).execute(),
          ),
        () =>
          inBranch(branch, (t) =>
            t.updateTable('day_template_versions').set({ valid_from: '2026-09-02' }).execute(),
          ),
        () =>
          inBranch(branch, (t) =>
            t.updateTable('day_template_slots').set({ slot_type_id: lesson }).execute(),
          ),
        () =>
          inBranch(branch, (t) =>
            t
              .updateTable('day_template_assignments')
              .set({ day_template_id: template })
              .where('id', '=', id)
              .execute(),
          ),
        () =>
          inBranch(branch, (t) =>
            t
              .updateTable('day_template_assignments')
              .set({ valid_from: '2026-10-13' })
              .where('id', '=', id)
              .execute(),
          ),
      ];
      for (const [index, attempt] of attempts.entries()) {
        expect(await refusal(attempt()), String(index)).toMatchObject({
          code: INSUFFICIENT_PRIVILEGE,
        });
      }
    });

    it('never write the transaction of a version or an archived row at insert', async () => {
      const { branch, template } = await setUp();
      expect(
        await refusal(
          inBranch(branch, (transaction) =>
            sql`insert into day_template_versions (branch_id, day_template_id, start_minutes, valid_from, created_xact)
                values (${branch}, ${template}, 480, '2031-01-01', '1')`.execute(transaction),
          ),
        ),
      ).toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
      expect(
        await refusal(
          inBranch(branch, (transaction) =>
            sql`insert into slot_types (branch_id, name, kind, archived_at)
                values (${branch}, 'Archived', 'lesson', now())`.execute(transaction),
          ),
        ),
      ).toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
    });
  });
});
