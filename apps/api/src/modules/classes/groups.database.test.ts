import { GROUP_MAX_SIZE, GROUP_NAME_MAX_LENGTH, groupNameSchema } from '@sodiq/shared';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { ClassesKit } from '../../testing/classes-kit.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

const INSUFFICIENT_PRIVILEGE = '42501';
const CHECK_VIOLATION = '23514';
const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';
const GENERATED_ALWAYS = '428C9';

/** Wednesday 14 October 2026, 10:00 in Tashkent. */
const NOW = '2026-10-14T10:00:00+05:00';
const ARCHIVED_AT = new Date(NOW);

/** The error a promise was refused with, or a failure when it was not refused. */
async function refusal(work: Promise<unknown>): Promise<{ code?: string; constraint?: string }> {
  try {
    await work;
  } catch (error) {
    return error as { code?: string; constraint?: string };
  }
  throw new Error('The database did not refuse it.');
}

// The rules of groups that the database itself keeps (db/migrations/0046),
// also when the application has a fault: the branch filter and the keys of
// the branch; the bounds of the shared constants; the unique folded name per
// branch and year (decision 6); a closed year as history; the classes of one
// year, active, of one grade or two; a subject taught in every grade of the
// group and not archived (decision 16); the language of one-language classes
// (decision 8); the class's and the subject's side (decision 16), the
// subject's across branches (decision 12); the restore checked again
// (decision 10); the grants. All names are invented.
describe('groups in the database', () => {
  let database: TestDatabase;
  let transactions: Transactions;
  let kit: ClassesKit;
  let north: string;
  let south: string;
  let northYear: string;
  let southYear: string;
  let subject: string;
  let nameYear: string;

  const inBranch = <T>(branch: string | string[], work: (transaction: Transaction) => Promise<T>) =>
    transactions.run(Array.isArray(branch) ? branch : [branch], work);

  /** A group with its classes, inserted as the application inserts it, in one transaction. */
  const insertGroup = (
    branch: string,
    input: {
      year?: string;
      subject?: string;
      classIds: readonly string[];
      name?: string;
      language?: string;
      size?: number;
    },
  ) =>
    inBranch(branch, async (transaction) => {
      const row = await transaction
        .insertInto('groups')
        .values({
          branch_id: branch,
          academic_year_id: input.year ?? (branch === north ? northYear : southYear),
          subject_id: input.subject ?? subject,
          name: input.name ?? `G ${String(Math.random()).slice(2, 8)}`,
          language: input.language ?? 'uz',
          max_size: input.size ?? 20,
        })
        .returning(['id', 'name_key', 'version'])
        .executeTakeFirstOrThrow();
      for (const classId of input.classIds) {
        await transaction
          .insertInto('group_classes')
          .values({ group_id: row.id, class_id: classId, branch_id: branch })
          .execute();
      }
      return row;
    });

  const updateGroup = (
    id: string,
    values: { name?: string; language?: string; max_size?: number; archived_at?: Date | null },
    branch = north,
  ) =>
    inBranch(branch, (transaction) =>
      transaction.updateTable('groups').set(values).where('id', '=', id).execute(),
    );

  const updateClass = (
    id: string,
    values: { grade?: number; language?: string; archived_at?: Date | null },
  ) =>
    inBranch(north, (transaction) =>
      transaction.updateTable('classes').set(values).where('id', '=', id).execute(),
    );

  const updateSubject = (id: string, values: { grades?: number[]; archived_at?: Date | null }) =>
    inBranch(north, (transaction) =>
      transaction.updateTable('subjects').set(values).where('id', '=', id).execute(),
    );

  beforeAll(async () => {
    database = await createTestDatabase();
    transactions = new Transactions(database.app, new FixedClock(NOW));
    kit = new ClassesKit(database.migrator);
    north = await insertBranch(database.migrator, 'North');
    south = await insertBranch(database.migrator, 'South');
    northYear = await kit.year(north);
    southYear = await kit.year(south);
    subject = await kit.subject({ grades: [7, 8, 9, 10] });
    nameYear = await kit.year(north, 'planned', '2027-09-01', '2028-05-31');
  });

  afterAll(async () => {
    await database.destroy();
  });

  describe('a group', () => {
    it('is invisible from another branch', async () => {
      const classId = await kit.schoolClass(south, southYear);
      const id = await kit.group(south, southYear, subject, [classId]);
      const seen = await inBranch(north, (transaction) =>
        transaction.selectFrom('groups').select('id').where('id', '=', id).execute(),
      );
      const links = await inBranch(north, (transaction) =>
        transaction
          .selectFrom('group_classes')
          .select('class_id')
          .where('group_id', '=', id)
          .execute(),
      );
      expect(seen).toEqual([]);
      expect(links).toEqual([]);
    });

    it('keeps its year and its classes in its branch (composite keys)', async () => {
      const northClass = await kit.schoolClass(north, northYear);
      const southClass = await kit.schoolClass(south, southYear);
      expect(
        (await refusal(insertGroup(north, { year: southYear, classIds: [northClass] }))).code,
      ).toBe(FOREIGN_KEY_VIOLATION);
      // The migrator sees both branches; the key still refuses a class of the other one.
      const group = await kit.group(north, northYear, subject, [northClass]);
      expect(
        (
          await refusal(
            database.migrator
              .insertInto('group_classes')
              .values({ group_id: group, class_id: southClass, branch_id: north })
              .execute(),
          )
        ).code,
      ).toBe(FOREIGN_KEY_VIOLATION);
    });

    it('holds the bounds of the shared constants', async () => {
      const classId = await kit.schoolClass(north, northYear);
      expect(GROUP_NAME_MAX_LENGTH).toBe(40);
      expect(GROUP_MAX_SIZE).toBe(60);
      await insertGroup(north, { classIds: [classId], name: 'A'.repeat(GROUP_NAME_MAX_LENGTH) });
      await insertGroup(north, { classIds: [classId], size: GROUP_MAX_SIZE });
      for (const input of [
        { name: 'A'.repeat(GROUP_NAME_MAX_LENGTH + 1) },
        { size: 0 },
        { size: GROUP_MAX_SIZE + 1 },
        { language: 'en' },
      ]) {
        expect((await refusal(insertGroup(north, { classIds: [classId], ...input }))).code).toBe(
          CHECK_VIOLATION,
        );
      }
    });

    // Correction 3 of the review of pull request #91: the schema is no wider
    // than the check; values between them are refused by both.
    it.each(['7-M-1²', '-7', '7/M'])('refuses the name %s, as the schema does', async (name) => {
      const classId = await kit.schoolClass(north, northYear);
      expect(groupNameSchema.safeParse(name).success).toBe(false);
      const error = await refusal(insertGroup(north, { classIds: [classId], name }));
      expect(error.constraint).toBe('groups_name_check');
    });

    it.each(['7-M-1', 'Gʻalaba-1', 'Группа 2'])(
      'takes the name %s, as the schema does',
      async (name) => {
        const year = nameYear;
        const classId = await kit.schoolClass(north, year);
        expect(groupNameSchema.safeParse(name).success).toBe(true);
        await insertGroup(north, { year, classIds: [classId], name });
      },
    );

    it('is unique per branch and year by its folded name, archived groups included (decision 6)', async () => {
      const year = await kit.year(north, 'planned', '2028-09-01', '2029-05-31');
      const otherYear = await kit.year(north, 'planned', '2029-09-01', '2030-05-31');
      const classId = await kit.schoolClass(north, year);
      const otherClass = await kit.schoolClass(north, otherYear);
      const first = await insertGroup(north, { year, classIds: [classId], name: 'Ma-1' });
      expect(first.name_key).toBe('ma-1');
      await updateGroup(first.id, { archived_at: ARCHIVED_AT });
      // A Cyrillic М and а, in another case.
      for (const name of ['MA-1', 'Ма-1', ' ma-1 ']) {
        const error = await refusal(insertGroup(north, { year, classIds: [classId], name }));
        expect([error.code, error.constraint]).toEqual([UNIQUE_VIOLATION, 'groups_name_key']);
      }
      await insertGroup(north, { year: otherYear, classIds: [otherClass], name: 'Ma-1' });
    });

    it('cannot be written in a closed year', async () => {
      const branch = await insertBranch(database.migrator, 'Closed');
      const year = await kit.year(branch, 'current', '2025-09-01', '2026-05-31');
      const classId = await kit.schoolClass(branch, year);
      const group = await kit.group(branch, year, subject, [classId]);
      await kit.setYear(year, 'closed');
      expect((await refusal(insertGroup(branch, { year, classIds: [classId] }))).constraint).toBe(
        'group_year_closed',
      );
      expect((await refusal(updateGroup(group, { max_size: 21 }, branch))).constraint).toBe(
        'group_year_closed',
      );
      expect(
        (await refusal(updateGroup(group, { archived_at: ARCHIVED_AT }, branch))).constraint,
      ).toBe('group_year_closed');
    });

    it('needs a class: none at the create, and the last one removed', async () => {
      expect((await refusal(insertGroup(north, { classIds: [] }))).constraint).toBe(
        'group_needs_class',
      );
      const classId = await kit.schoolClass(north, northYear);
      const group = await kit.group(north, northYear, subject, [classId]);
      const error = await refusal(
        inBranch(north, (transaction) =>
          transaction.deleteFrom('group_classes').where('group_id', '=', group).execute(),
        ),
      );
      expect(error.constraint).toBe('group_needs_class');
    });

    it('draws from active classes of its own year only, through a create and through an added class', async () => {
      const otherYear = await kit.year(north, 'planned', '2030-09-01', '2031-05-31');
      const classId = await kit.schoolClass(north, northYear);
      const ofOtherYear = await kit.schoolClass(north, otherYear);
      const archived = await kit.schoolClass(north, northYear);
      await updateClass(archived, { archived_at: ARCHIVED_AT });
      for (const other of [ofOtherYear, archived]) {
        expect((await refusal(insertGroup(north, { classIds: [classId, other] }))).constraint).toBe(
          'group_class_year',
        );
      }
      const group = await kit.group(north, northYear, subject, [classId]);
      const error = await refusal(
        inBranch(north, (transaction) =>
          transaction
            .insertInto('group_classes')
            .values({ group_id: group, class_id: archived, branch_id: north })
            .execute(),
        ),
      );
      expect(error.constraint).toBe('group_class_year');
    });

    it('draws from one grade or two (05), through a create and through an added class', async () => {
      const seven = await kit.schoolClass(north, northYear, { grade: 7 });
      const eight = await kit.schoolClass(north, northYear, { grade: 8 });
      const nine = await kit.schoolClass(north, northYear, { grade: 9 });
      await insertGroup(north, { classIds: [seven, eight] });
      expect(
        (await refusal(insertGroup(north, { classIds: [seven, eight, nine] }))).constraint,
      ).toBe('group_grades');
      const group = await kit.group(north, northYear, subject, [seven, eight]);
      const error = await refusal(
        inBranch(north, (transaction) =>
          transaction
            .insertInto('group_classes')
            .values({ group_id: group, class_id: nine, branch_id: north })
            .execute(),
        ),
      );
      expect(error.constraint).toBe('group_grades');
    });

    it('has a subject taught in every grade of the group and not archived (decision 16)', async () => {
      const onlySeven = await kit.subject({ grades: [7] });
      const seven = await kit.schoolClass(north, northYear, { grade: 7 });
      const eight = await kit.schoolClass(north, northYear, { grade: 8 });
      await insertGroup(north, { subject: onlySeven, classIds: [seven] });
      expect(
        (await refusal(insertGroup(north, { subject: onlySeven, classIds: [seven, eight] })))
          .constraint,
      ).toBe('group_subject_grade');
      const archived = await kit.subject({ grades: [7] });
      await database.migrator
        .updateTable('subjects')
        .set({ archived_at: ARCHIVED_AT })
        .where('id', '=', archived)
        .execute();
      expect(
        (await refusal(insertGroup(north, { subject: archived, classIds: [seven] }))).constraint,
      ).toBe('group_subject_archived');
    });

    it('takes the language of one-language classes, through a create and through an update (decision 8)', async () => {
      const uzbek = await kit.schoolClass(north, northYear, { language: 'uz' });
      const russian = await kit.schoolClass(north, northYear, { language: 'ru' });
      expect(
        (await refusal(insertGroup(north, { classIds: [uzbek], language: 'ru' }))).constraint,
      ).toBe('group_language');
      const group = await kit.group(north, northYear, subject, [uzbek]);
      expect((await refusal(updateGroup(group, { language: 'ru' }))).constraint).toBe(
        'group_language',
      );
      // A mixed group has the language chosen for it, either one.
      const mixed = await insertGroup(north, { classIds: [uzbek, russian], language: 'ru' });
      await updateGroup(mixed.id, { language: 'uz' });
      // Removing the Russian class leaves one language, which the group then has.
      await inBranch(north, (transaction) =>
        transaction
          .deleteFrom('group_classes')
          .where('group_id', '=', mixed.id)
          .where('class_id', '=', russian)
          .execute(),
      );
    });

    it('raises its version on every update', async () => {
      const classId = await kit.schoolClass(north, northYear);
      const group = await insertGroup(north, { classIds: [classId] });
      await updateGroup(group.id, { max_size: 22 });
      const row = await database.migrator
        .selectFrom('groups')
        .select('version')
        .where('id', '=', group.id)
        .executeTakeFirstOrThrow();
      expect(row.version).toBe(group.version + 1);
    });

    it('runs every rule again at a restore (decision 10)', async () => {
      const subjectOfRestore = await kit.subject({ grades: [7] });
      const archivedClass = await kit.schoolClass(north, northYear);
      const first = await kit.group(north, northYear, subjectOfRestore, [archivedClass]);
      await updateGroup(first, { archived_at: ARCHIVED_AT });
      // An archived group lets its class be archived, and is not checked again.
      await updateClass(archivedClass, { archived_at: ARCHIVED_AT });
      expect((await refusal(updateGroup(first, { archived_at: null }))).constraint).toBe(
        'group_class_year',
      );

      const classId = await kit.schoolClass(north, northYear);
      const second = await kit.group(north, northYear, subjectOfRestore, [classId]);
      await updateGroup(second, { archived_at: ARCHIVED_AT });
      await updateSubject(subjectOfRestore, { archived_at: ARCHIVED_AT });
      expect((await refusal(updateGroup(second, { archived_at: null }))).constraint).toBe(
        'group_subject_archived',
      );

      const branch = await insertBranch(database.migrator, 'Restored');
      const year = await kit.year(branch, 'current', '2025-09-01', '2026-05-31');
      const ofClosedYear = await kit.schoolClass(branch, year);
      const third = await kit.group(branch, year, subject, [ofClosedYear]);
      await updateGroup(third, { archived_at: ARCHIVED_AT }, branch);
      await kit.setYear(year, 'closed');
      expect((await refusal(updateGroup(third, { archived_at: null }, branch))).constraint).toBe(
        'group_year_closed',
      );
    });
  });

  describe("the class's side (decision 16)", () => {
    it('refuses a grade change and an archive of a class that feeds an active group', async () => {
      const classId = await kit.schoolClass(north, northYear, { grade: 7 });
      const group = await kit.group(north, northYear, subject, [classId]);
      expect((await refusal(updateClass(classId, { grade: 8 }))).constraint).toBe(
        'class_grade_groups',
      );
      expect((await refusal(updateClass(classId, { archived_at: ARCHIVED_AT }))).constraint).toBe(
        'class_in_groups',
      );
      await updateGroup(group, { archived_at: ARCHIVED_AT });
      await updateClass(classId, { grade: 8 });
      await updateClass(classId, { archived_at: ARCHIVED_AT });
    });

    it('runs the group language rule again at a language change (decision 8)', async () => {
      const uzbek = await kit.schoolClass(north, northYear, { language: 'uz' });
      const group = await kit.group(north, northYear, subject, [uzbek]);
      expect((await refusal(updateClass(uzbek, { language: 'ru' }))).constraint).toBe(
        'group_language',
      );
      // The class edit moves the group along in the same transaction.
      await inBranch(north, async (transaction) => {
        await transaction
          .updateTable('classes')
          .set({ language: 'ru' })
          .where('id', '=', uzbek)
          .execute();
        await transaction
          .updateTable('groups')
          .set({ language: 'ru' })
          .where('id', '=', group)
          .execute();
      });
      // A change that makes a mixed group one-language needs the group to follow too.
      const russian = await kit.schoolClass(north, northYear, { language: 'ru' });
      const other = await kit.schoolClass(north, northYear, { language: 'uz' });
      const mixed = await kit.group(north, northYear, subject, [russian, other], {
        language: 'uz',
      });
      expect((await refusal(updateClass(other, { language: 'ru' }))).constraint).toBe(
        'group_language',
      );
      await updateClass(russian, { language: 'uz' });
      expect(
        (
          await database.migrator
            .selectFrom('groups')
            .select('language')
            .where('id', '=', mixed)
            .executeTakeFirstOrThrow()
        ).language,
      ).toBe('uz');
    });
  });

  describe("the subject's side (decisions 12 and 16)", () => {
    it('refuses a grade removal and an archive while an active group needs it, also from another branch', async () => {
      const own = await kit.subject({ grades: [7, 8, 9] });
      const classId = await kit.schoolClass(south, southYear, { grade: 9 });
      const group = await kit.group(south, southYear, own, [classId]);
      // The edit runs with the branch filter of North, which cannot see South's group.
      expect((await refusal(updateSubject(own, { grades: [7, 8] }))).constraint).toBe(
        'subject_grade_groups',
      );
      expect((await refusal(updateSubject(own, { archived_at: ARCHIVED_AT }))).constraint).toBe(
        'subject_has_groups',
      );
      await updateSubject(own, { grades: [8, 9] });
      await database.migrator
        .updateTable('groups')
        .set({ archived_at: ARCHIVED_AT })
        .where('id', '=', group)
        .execute();
      await updateSubject(own, { grades: [7] });
      await updateSubject(own, { archived_at: ARCHIVED_AT });
    });

    it('answers grades and the count of groups outside the transaction, never ids (subject_group_grades)', async () => {
      const own = await kit.subject({ grades: [7, 8] });
      const southClass = await kit.schoolClass(south, southYear, { grade: 8 });
      const northClass = await kit.schoolClass(north, northYear, { grade: 7 });
      await kit.group(south, southYear, own, [southClass]);
      await kit.group(north, northYear, own, [northClass]);
      const rows = await inBranch(north, (transaction) =>
        sql<{
          grade: number;
          groups_elsewhere: number;
        }>`select * from subject_group_grades(${own}) order by grade`.execute(transaction),
      );
      expect(rows.rows).toEqual([
        { grade: 7, groups_elsewhere: 0 },
        { grade: 8, groups_elsewhere: 1 },
      ]);
    });
  });

  describe('the grants', () => {
    it('refuse a delete of a group and a write of its year, subject or folded name', async () => {
      const classId = await kit.schoolClass(north, northYear);
      const group = await kit.group(north, northYear, subject, [classId]);
      expect(
        (
          await refusal(
            inBranch(north, (transaction) =>
              transaction.deleteFrom('groups').where('id', '=', group).execute(),
            ),
          )
        ).code,
      ).toBe(INSUFFICIENT_PRIVILEGE);
      for (const column of ['academic_year_id', 'subject_id']) {
        const error = await refusal(
          inBranch(north, (transaction) =>
            sql`update groups set ${sql.ref(column)} = ${sql.ref(column)} where id = ${group}`.execute(
              transaction,
            ),
          ),
        );
        expect(error.code).toBe(INSUFFICIENT_PRIVILEGE);
      }
      const error = await refusal(
        database.migrator
          .updateTable('groups')
          .set({ name_key: 'x' } as never)
          .where('id', '=', group)
          .execute(),
      );
      expect(error.code).toBe(GENERATED_ALWAYS);
    });

    it('keep the year and the subject of a group fixed, for the migrator too (groups_fixed)', async () => {
      const classId = await kit.schoolClass(north, northYear);
      const group = await kit.group(north, northYear, subject, [classId]);
      const other = await kit.subject();
      const error = await refusal(
        database.migrator
          .updateTable('groups')
          .set({ subject_id: other })
          .where('id', '=', group)
          .execute(),
      );
      expect(error.constraint).toBe('groups_fixed');
    });
  });
});
