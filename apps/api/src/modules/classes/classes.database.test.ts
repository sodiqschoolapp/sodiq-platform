import { CLASS_MAX_SIZE, CLASS_NAME_MAX_LENGTH, classNameKey } from '@sodiq/shared';
import fc from 'fast-check';
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
const EXCLUSION_VIOLATION = '23P01';
const FOREIGN_KEY_VIOLATION = '23503';
const GENERATED_ALWAYS = '428C9';

/** Wednesday 14 October 2026, 10:00 in Tashkent. */
const NOW = '2026-10-14T10:00:00+05:00';
const TODAY_START = new Date('2026-10-14T00:00:00+05:00');
const SEPTEMBER = new Date('2026-09-01T00:00:00+05:00');
const at = (moment: string): Date => new Date(moment);

/** The error a promise was refused with, or a failure when it was not refused. */
async function refusal(work: Promise<unknown>): Promise<{ code?: string; constraint?: string }> {
  try {
    await work;
  } catch (error) {
    return error as { code?: string; constraint?: string };
  }
  throw new Error('The database did not refuse it.');
}

// The rules of classes and their Tutors that the database itself keeps
// (db/migrations/0042), also when the application has a fault: the branch
// filter and the keys of the branch; the bounds of the shared constants; the
// unique folded name per branch, year and grade (decisions 3 and 4); a class
// of a closed year as history (decision 18); a main classroom that is not
// closed (decision 7); one Tutor and one acting Tutor at a moment
// (decision 15); the Tutor language rule from the Tutor's, the class's and
// the staff record's side, across branches (05; decisions 16 and 19); a
// Tutor row within its role, never in the past (decision 9); the mirror of a
// role end (decision 2, corrections 2 and 3); the grants.
describe('classes and their Tutors in the database', () => {
  let database: TestDatabase;
  let transactions: Transactions;
  let clock: FixedClock;
  let kit: ClassesKit;
  let north: string;
  let south: string;
  let northYear: string;
  let southYear: string;
  let editor: string;

  const inBranch = <T>(branch: string | string[], work: (transaction: Transaction) => Promise<T>) =>
    transactions.run(Array.isArray(branch) ? branch : [branch], work);

  /** A class inserted as the application inserts it. */
  const insertClass = (
    branch: string,
    year: string,
    input: { grade?: number; name: string; language?: string; room?: string | null; size?: number },
  ) =>
    inBranch(branch, (transaction) =>
      transaction
        .insertInto('classes')
        .values({
          branch_id: branch,
          academic_year_id: year,
          grade: input.grade ?? 7,
          name: input.name,
          language: input.language ?? 'uz',
          main_room_id: input.room ?? null,
          max_size: input.size ?? 25,
        })
        .returning(['id', 'name_key', 'version'])
        .executeTakeFirstOrThrow(),
    );

  /** A Tutor row inserted as the application inserts it. */
  const giveTutor = (
    branch: string,
    classId: string,
    assignmentId: string,
    input: { kind?: 'tutor' | 'acting'; from?: Date; until?: Date | null } = {},
  ) =>
    inBranch(branch, (transaction) =>
      transaction
        .insertInto('class_tutors')
        .values({
          branch_id: branch,
          class_id: classId,
          assignment_id: assignmentId,
          kind: input.kind ?? 'tutor',
          valid_from: input.from ?? clock.now(),
          own_until: input.until ?? null,
          given_by: editor,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
        .then((row) => row.id),
    );

  /** A Tutor of the branch: a person who teaches in `languages` with a Tutor role there. */
  async function tutor(
    branch: string,
    languages: readonly ('uz' | 'ru')[] = ['uz'],
    further: readonly string[] = [],
  ): Promise<{ staffId: string; accountId: string; assignmentId: string }> {
    const person = await kit.person(branch, languages, { further });
    return { ...person, assignmentId: await kit.role(person.accountId, branch) };
  }

  const endRole = (assignmentId: string, until: Date | null) =>
    inBranch([north, south], (transaction) =>
      transaction
        .updateTable('assignments')
        .set({ valid_until: until })
        .where('id', '=', assignmentId)
        .execute(),
    );

  beforeAll(async () => {
    database = await createTestDatabase();
    clock = new FixedClock(NOW);
    transactions = new Transactions(database.app, clock);
    kit = new ClassesKit(database.migrator);
    north = await insertBranch(database.migrator, 'North');
    south = await insertBranch(database.migrator, 'South');
    northYear = await kit.year(north);
    southYear = await kit.year(south);
    editor = await kit.account();
  });

  afterAll(async () => {
    await database.destroy();
  });

  describe('a class', () => {
    it('is seen and written only in its branch', async () => {
      const { id } = await insertClass(north, northYear, { name: 'Filtered' });
      const seen = (branch: string) =>
        inBranch(branch, (transaction) =>
          transaction.selectFrom('classes').select('id').where('id', '=', id).execute(),
        );
      expect(await seen(north)).toHaveLength(1);
      expect(await seen(south)).toHaveLength(0);
      const written = await inBranch(south, (transaction) =>
        transaction
          .updateTable('classes')
          .set({ max_size: 30 })
          .where('id', '=', id)
          .executeTakeFirst(),
      );
      expect(written.numUpdatedRows).toBe(0n);
    });

    it('takes a year and a room of its own branch only', async () => {
      const southRoom = await kit.room(south);
      expect((await refusal(insertClass(north, southYear, { name: 'Wrong year' }))).code).toBe(
        FOREIGN_KEY_VIOLATION,
      );
      expect(
        (await refusal(insertClass(north, northYear, { name: 'Wrong room', room: southRoom })))
          .code,
      ).toBe(FOREIGN_KEY_VIOLATION);
    });

    it('keeps the bounds of the shared constants', async () => {
      expect(CLASS_NAME_MAX_LENGTH).toBe(40);
      expect(CLASS_MAX_SIZE).toBe(60);
      const refused = async (input: Parameters<typeof insertClass>[2]) =>
        (await refusal(insertClass(north, northYear, input))).constraint;
      // "There are no class codes such as 7-A" (05); decision 17.
      expect(await refused({ name: '7-A' })).toBe('classes_name_check');
      expect(await refused({ name: 'A' })).toBe('classes_name_check');
      expect(await refused({ name: `B${'a'.repeat(CLASS_NAME_MAX_LENGTH)}` })).toBe(
        'classes_name_check',
      );
      expect(await refused({ name: 'Grade', grade: 0 })).toBe('classes_grade_check');
      expect(await refused({ name: 'Grade', grade: 12 })).toBe('classes_grade_check');
      expect(await refused({ name: 'Size', size: 0 })).toBe('classes_max_size_check');
      expect(await refused({ name: 'Size', size: CLASS_MAX_SIZE + 1 })).toBe(
        'classes_max_size_check',
      );
      expect(await refused({ name: 'Language', language: 'en' })).toBe('classes_language_check');
      const longest = await insertClass(north, northYear, {
        name: `C${'a'.repeat(CLASS_NAME_MAX_LENGTH - 1)}`,
        grade: 11,
        size: CLASS_MAX_SIZE,
      });
      expect(longest.version).toBe(0);
    });

    it('writes the folded name itself; the application cannot', async () => {
      const { id, name_key } = await insertClass(north, northYear, { name: '  Big  Oxford ' });
      expect(name_key).toBe('big oxford');
      const refused = await refusal(
        inBranch(north, (transaction) =>
          sql`update classes set name_key = 'other' where id = ${id}`.execute(transaction),
        ),
      );
      expect(refused.code).toBe(GENERATED_ALWAYS);
    });

    // Correction 6: `class_name_key` and `classNameKey` fold the same, over
    // names generated from the letters both fold.
    it('folds a name as classNameKey of packages/shared does', async () => {
      const letters = [
        ...'ABCEHIJKMOPSTXYabceijkmopstxyhfgz',
        ...'АаВвЕеКкМмНнОоРрСсТтУуХхІіЈјЅѕ',
        ' ',
        '  ',
        '\t',
      ];
      await fc.assert(
        fc.asyncProperty(
          fc.array(fc.constantFrom(...letters), { minLength: 1, maxLength: 30 }),
          async (parts) => {
            const name = parts.join('');
            const found = await sql<{ key: string }>`
              select class_name_key(${name}) as key
            `.execute(database.migrator);
            expect(found.rows[0]?.key).toBe(classNameKey(name));
          },
        ),
        { numRuns: 300 },
      );
    });

    // 05: "The name is unique within a branch, grade and year"; archived
    // classes included (decision 3), by the folded name (decision 4).
    it('is unique by its folded name in a branch, year and grade, archived classes included', async () => {
      const first = await insertClass(north, northYear, { name: 'Princeton', grade: 8 });
      const taken = async (name: string) =>
        (await refusal(insertClass(north, northYear, { name, grade: 8 }))).code;
      expect(await taken('princeton')).toBe(UNIQUE_VIOLATION);
      // Cyrillic Р, о, с, е and а in a Latin name.
      expect(await taken('Рrincеton')).toBe(UNIQUE_VIOLATION);
      expect(await taken(' PRINCETON ')).toBe(UNIQUE_VIOLATION);
      await database.migrator
        .updateTable('classes')
        .set({ archived_at: clock.now() })
        .where('id', '=', first.id)
        .execute();
      expect(await taken('Princeton')).toBe(UNIQUE_VIOLATION);
      // Another grade, another year, another branch.
      await insertClass(north, northYear, { name: 'Princeton', grade: 9 });
      const nextYear = await kit.year(north, 'planned', '2027-09-01', '2028-05-31');
      await insertClass(north, nextYear, { name: 'Princeton', grade: 8 });
      await insertClass(south, southYear, { name: 'Princeton', grade: 8 });
    });

    it('raises its version on every change', async () => {
      const { id } = await insertClass(north, northYear, { name: 'Versioned' });
      const version = async () =>
        (
          await database.migrator
            .selectFrom('classes')
            .select('version')
            .where('id', '=', id)
            .executeTakeFirstOrThrow()
        ).version;
      expect(await version()).toBe(0);
      await inBranch(north, (transaction) =>
        transaction.updateTable('classes').set({ max_size: 26 }).where('id', '=', id).execute(),
      );
      expect(await version()).toBe(1);
    });

    // Decision 18: in a closed year a class is history.
    it('is not created, changed or archived in a closed year', async () => {
      const branch = await insertBranch(database.migrator, 'Closed');
      const year = await kit.year(branch, 'current', '2025-09-01', '2026-05-31');
      const { id } = await insertClass(branch, year, { name: 'Historic' });
      await kit.setYear(year, 'closed');
      expect((await refusal(insertClass(branch, year, { name: 'Newer' }))).constraint).toBe(
        'class_year_closed',
      );
      for (const change of [{ max_size: 30 }, { archived_at: clock.now() }]) {
        const refused = await refusal(
          inBranch(branch, (transaction) =>
            transaction.updateTable('classes').set(change).where('id', '=', id).execute(),
          ),
        );
        expect(refused.constraint).toBe('class_year_closed');
      }
    });

    // Decision 7: a room closed when chosen is refused; one closed later stays.
    it('takes a main classroom that is not closed', async () => {
      const closed = await kit.room(north, 'closed');
      const open = await kit.room(north);
      expect(
        (await refusal(insertClass(north, northYear, { name: 'Closed room', room: closed })))
          .constraint,
      ).toBe('classes_room_closed');
      const { id } = await insertClass(north, northYear, { name: 'Open room', room: open });
      await database.migrator
        .updateTable('rooms')
        .set({ status: 'closed' })
        .where('id', '=', open)
        .execute();
      // The room stays; another field of the class still changes.
      await inBranch(north, (transaction) =>
        transaction.updateTable('classes').set({ max_size: 27 }).where('id', '=', id).execute(),
      );
      const changed = await refusal(
        inBranch(north, (transaction) =>
          transaction
            .updateTable('classes')
            .set({ main_room_id: closed })
            .where('id', '=', id)
            .execute(),
        ),
      );
      expect(changed.constraint).toBe('classes_room_closed');
    });

    it('has no delete for the application, and no write of its year', async () => {
      const { id } = await insertClass(north, northYear, { name: 'Granted' });
      const deleted = await refusal(
        inBranch(north, (transaction) =>
          transaction.deleteFrom('classes').where('id', '=', id).execute(),
        ),
      );
      expect(deleted.code).toBe(INSUFFICIENT_PRIVILEGE);
      const nextYear = await kit.year(north, 'planned', '2028-09-01', '2029-05-31');
      const moved = await refusal(
        inBranch(north, (transaction) =>
          transaction
            .updateTable('classes')
            .set({ academic_year_id: nextYear })
            .where('id', '=', id)
            .execute(),
        ),
      );
      expect(moved.code).toBe(INSUFFICIENT_PRIVILEGE);
    });
  });

  describe('the Tutors of a class', () => {
    it('are one Tutor and one acting Tutor at a moment; touching ranges pass', async () => {
      const { id } = await insertClass(north, northYear, { name: 'Oneness' });
      const first = await tutor(north);
      const second = await tutor(north);
      const third = await tutor(north);
      await giveTutor(north, id, first.assignmentId, { until: at('2026-11-01T00:00:00+05:00') });
      const clash = await refusal(
        giveTutor(north, id, second.assignmentId, { from: at('2026-10-20T00:00:00+05:00') }),
      );
      expect([clash.code, clash.constraint]).toEqual([
        EXCLUSION_VIOLATION,
        'class_tutors_one_tutor',
      ]);
      await giveTutor(north, id, second.assignmentId, {
        from: at('2026-11-01T00:00:00+05:00'),
      });
      // An acting Tutor beside the Tutor, one at a time.
      await giveTutor(north, id, third.assignmentId, {
        kind: 'acting',
        until: at('2026-10-20T00:00:00+05:00'),
      });
      const acting = await refusal(
        giveTutor(north, id, first.assignmentId, {
          kind: 'acting',
          from: at('2026-10-19T00:00:00+05:00'),
        }),
      );
      expect(acting.constraint).toBe('class_tutors_one_acting');
    });

    it('hang off a Tutor role of the class branch, within its dates', async () => {
      const { id } = await insertClass(north, northYear, { name: 'Within' });
      const person = await kit.person(north, ['uz'], { further: [south] });
      const teacher = await kit.role(person.accountId, north, 'teacher');
      expect((await refusal(giveTutor(north, id, teacher))).constraint).toBe(
        'class_tutors_not_tutor',
      );
      const elsewhere = await kit.role(person.accountId, south);
      expect((await refusal(giveTutor(north, id, elsewhere))).constraint).toBe(
        'class_tutors_not_tutor',
      );
      const later = await kit.role(
        person.accountId,
        north,
        'tutor',
        at('2026-11-01T00:00:00+05:00'),
      );
      expect((await refusal(giveTutor(north, id, later))).constraint).toBe(
        'class_tutors_outside_role',
      );
      // Decision 9: never before 00:00 of today, even within the role.
      const own = await tutor(north);
      expect(
        (await refusal(giveTutor(north, id, own.assignmentId, { from: SEPTEMBER }))).constraint,
      ).toBe('class_tutors_start_past');
      await giveTutor(north, id, own.assignmentId, { from: TODAY_START });
    });

    it('end with their role when it ends before their own end (correction 2)', async () => {
      const { id } = await insertClass(north, northYear, { name: 'Clipped' });
      const person = await kit.person(north, ['uz']);
      const role = await kit.role(
        person.accountId,
        north,
        'tutor',
        SEPTEMBER,
        at('2026-12-01T00:00:00+05:00'),
      );
      const open = await giveTutor(north, id, role);
      expect(await kit.tutorRowOf(open)).toMatchObject({
        valid_until: at('2026-12-01T00:00:00+05:00'),
        own_until: null,
        end_cause: 'role',
      });
    });

    // 05, Language of instruction: "The same holds when a Tutor is given a
    // class. This is blocked, not a warning."
    it('teach in the language of the class: refused at the commit otherwise', async () => {
      const uzbek = await insertClass(north, northYear, { name: 'Uzbek one' });
      const russianOnly = await tutor(north, ['ru']);
      const refused = await refusal(giveTutor(north, uzbek.id, russianOnly.assignmentId));
      expect([refused.code, refused.constraint]).toEqual([
        CHECK_VIOLATION,
        'class_tutors_language',
      ]);
      // An account with no staff record, and a record with no language.
      const bare = await kit.account();
      const bareRole = await kit.role(bare, north);
      expect((await refusal(giveTutor(north, uzbek.id, bareRole))).constraint).toBe(
        'class_tutors_language',
      );
      const silent = await tutor(north, []);
      expect((await refusal(giveTutor(north, uzbek.id, silent.assignmentId))).constraint).toBe(
        'class_tutors_language',
      );
    });

    it('keep their language when the class changes it, until they have ended', async () => {
      const { id } = await insertClass(north, northYear, { name: 'Switching' });
      const uzbekOnly = await tutor(north, ['uz']);
      const row = await giveTutor(north, id, uzbekOnly.assignmentId);
      const change = () =>
        inBranch(north, (transaction) =>
          transaction.updateTable('classes').set({ language: 'ru' }).where('id', '=', id).execute(),
        );
      expect((await refusal(change())).constraint).toBe('class_tutors_language');
      // A planned row counts as well (decision 16: "now or planned").
      await inBranch(north, (transaction) =>
        transaction
          .updateTable('class_tutors')
          .set({ valid_until: clock.now(), end_cause: 'ended', ended_by: editor })
          .where('id', '=', row)
          .execute(),
      );
      const planned = await giveTutor(north, id, uzbekOnly.assignmentId, {
        from: at('2026-11-02T00:00:00+05:00'),
      });
      expect((await refusal(change())).constraint).toBe('class_tutors_language');
      // Withdrawn: the change passes.
      await inBranch(north, (transaction) =>
        transaction
          .updateTable('class_tutors')
          .set({
            valid_until: at('2026-11-02T00:00:00+05:00'),
            end_cause: 'ended',
            ended_by: editor,
          })
          .where('id', '=', planned)
          .execute(),
      );
      await change();
    });

    it("keep their language when the staff record drops it, from another branch's filter too", async () => {
      const { id } = await insertClass(south, southYear, { name: 'Far away', language: 'ru' });
      // A person of North who also works in South and tutors a Russian class there.
      const person = await tutor(north, ['uz', 'ru'], [south]);
      const southRole = await kit.role(person.accountId, south);
      await giveTutor(south, id, southRole);
      const drop = () =>
        inBranch(north, (transaction) =>
          transaction
            .deleteFrom('staff_languages')
            .where('staff_id', '=', person.staffId)
            .where('language', '=', 'ru')
            .execute(),
        );
      const refused = await refusal(drop());
      expect(refused.constraint).toBe('staff_languages_tutor_held');
      // Correction 4: from North the function names no South class, only a count.
      const fromNorth = await inBranch(north, async (transaction) => {
        await sql`savepoint probe`.execute(transaction);
        await transaction
          .deleteFrom('staff_languages')
          .where('staff_id', '=', person.staffId)
          .where('language', '=', 'ru')
          .execute();
        const found = await sql<{ class_ids: string[]; elsewhere: number }>`
          select class_ids, elsewhere from tutor_classes_of_language(${person.staffId}::uuid, 'ru')
        `.execute(transaction);
        await sql`rollback to savepoint probe`.execute(transaction);
        return found.rows[0];
      });
      expect(fromNorth).toEqual({ class_ids: [], elsewhere: 1 });
      const fromSouth = await inBranch(south, async (transaction) => {
        await sql`savepoint probe`.execute(transaction);
        await transaction
          .deleteFrom('staff_languages')
          .where('staff_id', '=', person.staffId)
          .where('language', '=', 'ru')
          .execute();
        const found = await sql<{ class_ids: string[]; elsewhere: number }>`
          select class_ids, elsewhere from tutor_classes_of_language(${person.staffId}::uuid, 'ru')
        `.execute(transaction);
        await sql`rollback to savepoint probe`.execute(transaction);
        return found.rows[0];
      });
      expect(fromSouth).toEqual({ class_ids: [id], elsewhere: 0 });
      // Uzbek is not needed: it goes.
      await inBranch(north, (transaction) =>
        transaction
          .deleteFrom('staff_languages')
          .where('staff_id', '=', person.staffId)
          .where('language', '=', 'uz')
          .execute(),
      );
    });

    it('end only from today, and an end that has passed is final', async () => {
      const { id } = await insertClass(north, northYear, { name: 'Ending' });
      const person = await tutor(north);
      const row = await kit.tutorRow(north, id, person.assignmentId, { givenBy: editor });
      const end = (until: Date) =>
        inBranch(north, (transaction) =>
          transaction
            .updateTable('class_tutors')
            .set({ valid_until: until, own_until: until, end_cause: 'ended', ended_by: editor })
            .where('id', '=', row)
            .execute(),
        );
      expect((await refusal(end(at('2026-10-13T12:00:00+05:00')))).constraint).toBe(
        'class_tutors_end_past',
      );
      await end(at('2026-10-14T09:00:00+05:00'));
      expect((await refusal(end(at('2026-10-20T00:00:00+05:00')))).constraint).toBe(
        'class_tutors_end_final',
      );
    });

    it('have no delete for the application, and no write of their kind or start', async () => {
      const { id } = await insertClass(north, northYear, { name: 'Tutor grants' });
      const person = await tutor(north);
      const row = await giveTutor(north, id, person.assignmentId);
      const tries: ((transaction: Transaction) => Promise<unknown>)[] = [
        (transaction: Transaction) =>
          transaction.deleteFrom('class_tutors').where('id', '=', row).execute(),
        (transaction: Transaction) =>
          transaction
            .updateTable('class_tutors')
            .set({ kind: 'acting' })
            .where('id', '=', row)
            .execute(),
        (transaction: Transaction) =>
          transaction
            .updateTable('class_tutors')
            .set({ valid_from: at('2026-10-20T00:00:00+05:00') })
            .where('id', '=', row)
            .execute(),
      ];
      for (const work of tries) {
        expect((await refusal(inBranch(north, work))).code).toBe(INSUFFICIENT_PRIVILEGE);
      }
    });
  });

  // Decision 2 (Look first) with corrections 2 and 3: the end of a Tutor
  // role is written on its class rows.
  describe('the end of a Tutor role', () => {
    it('ends the rows in force and withdraws the planned ones, and its taking back returns them', async () => {
      const inForce = await insertClass(north, northYear, { name: 'Mirror now' });
      const later = await insertClass(north, northYear, { name: 'Mirror later', grade: 6 });
      const own = await insertClass(north, northYear, { name: 'Mirror own', grade: 5 });
      const person = await tutor(north);
      const now = await giveTutor(north, inForce.id, person.assignmentId);
      const planned = await giveTutor(north, later.id, person.assignmentId, {
        from: at('2026-12-01T00:00:00+05:00'),
      });
      // Correction 3: a row given until June keeps June when the role end is taken back.
      const june = at('2027-06-01T00:00:00+05:00');
      const owned = await giveTutor(north, own.id, person.assignmentId, { until: june });
      const end = at('2026-11-01T00:00:00+05:00');
      await endRole(person.assignmentId, end);
      expect(await kit.tutorRowOf(now)).toMatchObject({ valid_until: end, end_cause: 'role' });
      // Withdrawn: an empty range at its own start.
      expect(await kit.tutorRowOf(planned)).toMatchObject({
        valid_until: at('2026-12-01T00:00:00+05:00'),
        end_cause: 'role',
      });
      expect(await kit.tutorRowOf(owned)).toMatchObject({
        valid_until: end,
        own_until: june,
        end_cause: 'role',
      });
      // Moved to March: rows return to the earlier of their own end and the role's.
      const march = at('2027-03-01T00:00:00+05:00');
      await endRole(person.assignmentId, march);
      expect(await kit.tutorRowOf(now)).toMatchObject({ valid_until: march, end_cause: 'role' });
      expect(await kit.tutorRowOf(planned)).toMatchObject({
        valid_until: march,
        end_cause: 'role',
      });
      expect(await kit.tutorRowOf(owned)).toMatchObject({ valid_until: march, end_cause: 'role' });
      // Emptied: open again, and the row with its own end ends in June, `ended`.
      await endRole(person.assignmentId, null);
      expect(await kit.tutorRowOf(now)).toMatchObject({ valid_until: null, end_cause: null });
      expect(await kit.tutorRowOf(planned)).toMatchObject({ valid_until: null, end_cause: null });
      expect(await kit.tutorRowOf(owned)).toMatchObject({ valid_until: june, end_cause: 'ended' });
    });

    it('leaves rows ended by the Academic Vice Principal or by an archive ended', async () => {
      const ended = await insertClass(north, northYear, { name: 'Ended earlier', grade: 4 });
      const archived = await insertClass(north, northYear, { name: 'Archived', grade: 3 });
      const person = await tutor(north);
      const byHand = await giveTutor(north, ended.id, person.assignmentId);
      const byArchive = await giveTutor(north, archived.id, person.assignmentId);
      const handEnd = at('2026-10-20T00:00:00+05:00');
      await inBranch(north, async (transaction) => {
        await transaction
          .updateTable('class_tutors')
          .set({ valid_until: handEnd, own_until: handEnd, end_cause: 'ended', ended_by: editor })
          .where('id', '=', byHand)
          .execute();
        await transaction
          .updateTable('class_tutors')
          .set({ valid_until: clock.now(), end_cause: 'archive', ended_by: editor })
          .where('id', '=', byArchive)
          .execute();
      });
      await endRole(person.assignmentId, at('2026-11-01T00:00:00+05:00'));
      await endRole(person.assignmentId, null);
      expect(await kit.tutorRowOf(byHand)).toMatchObject({
        valid_until: handEnd,
        end_cause: 'ended',
      });
      expect(await kit.tutorRowOf(byArchive)).toMatchObject({
        valid_until: clock.now(),
        end_cause: 'archive',
      });
    });

    // .claude/rules/database.md: a row back in service is checked again.
    it('checks the language again on a row its taking back returns', async () => {
      const { id } = await insertClass(north, northYear, { name: 'Returned', grade: 2 });
      const person = await tutor(north, ['uz', 'ru']);
      const row = await giveTutor(north, id, person.assignmentId);
      // The role ends at 00:00 today: the row, begun at 10:00, is withdrawn,
      // and the person may drop Uzbek.
      await endRole(person.assignmentId, TODAY_START);
      await inBranch(north, (transaction) =>
        transaction
          .deleteFrom('staff_languages')
          .where('staff_id', '=', person.staffId)
          .where('language', '=', 'uz')
          .execute(),
      );
      // The role end cannot move later now: it has passed (assignments_end_guard),
      // so the migrator brings it back, and the language check refuses it.
      const back = await refusal(
        database.migrator
          .transaction()
          .execute((transaction) =>
            transaction
              .updateTable('assignments')
              .set({ valid_until: null })
              .where('id', '=', person.assignmentId)
              .execute(),
          ),
      );
      expect(back.constraint).toBe('class_tutors_language');
      expect(await kit.tutorRowOf(row)).toMatchObject({ end_cause: 'role' });
    });

    it('refuses a taking back over a Tutor given meanwhile', async () => {
      const { id } = await insertClass(north, northYear, { name: 'Replaced', grade: 1 });
      const first = await tutor(north);
      const second = await tutor(north);
      await giveTutor(north, id, first.assignmentId);
      await endRole(first.assignmentId, at('2026-11-01T00:00:00+05:00'));
      await giveTutor(north, id, second.assignmentId, { from: at('2026-11-01T00:00:00+05:00') });
      const back = await refusal(endRole(first.assignmentId, null));
      expect(back.constraint).toBe('class_tutors_one_tutor');
    });
  });
});
