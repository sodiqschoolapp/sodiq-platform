import { LOAD_LESSONS_MAX } from '@sodiq/shared';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { LoadKit, type LoadRowValues } from '../../testing/load-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

const INSUFFICIENT_PRIVILEGE = '42501';
const CHECK_VIOLATION = '23514';
const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';

/** Thursday 15 October 2026, 10:00 in Tashkent. */
const NOW = '2026-10-15T10:00:00+05:00';
/** The intended start of the drafts: Monday 19 October 2026. */
const STARTS_ON = '2026-10-19';

/** The error a promise was refused with, or a failure when it was not refused. */
async function refusal(work: Promise<unknown>): Promise<{ code?: string; constraint?: string }> {
  try {
    await work;
  } catch (error) {
    return error as { code?: string; constraint?: string };
  }
  throw new Error('The database did not refuse it.');
}

/** A transaction held open after `work`, released by the test. */
function holding(
  run: (work: (transaction: Transaction) => Promise<void>) => Promise<void>,
  work: (transaction: Transaction) => Promise<void>,
): { ready: Promise<void>; release: () => void; done: Promise<void> } {
  let release: () => void = () => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let ready: () => void = () => undefined;
  const isReady = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const done = run(async (transaction) => {
    await work(transaction);
    ready();
    await released;
  });
  return { ready: Promise.race([isReady, done]), release, done };
}

/** What a promise came to: `written`, or the constraint that refused it. */
const outcome = (work: Promise<unknown>): Promise<string | undefined> =>
  work.then(
    () => 'written',
    (error: unknown) => (error as { constraint?: string }).constraint,
  );

// The rules of draft versions and load rows that the database itself keeps
// (db/migrations/0055), also when the application has a fault: the branch
// filter and the keys of the branch; a version in an open year (correction
// 2), fixed and written only while a draft; every blocked rule of one row
// (decisions 2, 7, 9, 11 and 13; corrections 3 and 4), on insert and, for the
// teacher and the room, on update; the draft and the open year on insert,
// update and delete; one row per unit and subject; the vacancy that a row
// names (04, Vacancy); the grants. All names are invented.
describe('teaching load in the database', () => {
  let database: TestDatabase;
  let transactions: Transactions;
  let kit: LoadKit;
  let north: string;
  let south: string;
  let northYear: string;
  let southYear: string;
  let subject: string;
  let nextYear: string;
  let branchCount = 0;

  const inBranch = <T>(branch: string, work: (transaction: Transaction) => Promise<T>) =>
    transactions.run([branch], work);

  /** A row inserted as the application inserts it. */
  const insertRow = (values: LoadRowValues) =>
    inBranch(values.branch_id, (transaction) =>
      transaction
        .insertInto('teaching_load_rows')
        .values({ lessons_per_week: 2, ...values })
        .returning('id')
        .executeTakeFirstOrThrow()
        .then((row) => row.id),
    );

  const updateRow = (
    branch: string,
    id: string,
    values: {
      teacher_id?: string;
      lessons_per_week?: number;
      room_id?: string | null;
      room_type?: string | null;
    },
  ) =>
    inBranch(branch, (transaction) =>
      transaction.updateTable('teaching_load_rows').set(values).where('id', '=', id).execute(),
    );

  const deleteRow = (branch: string, id: string) =>
    inBranch(branch, (transaction) =>
      transaction.deleteFrom('teaching_load_rows').where('id', '=', id).execute(),
    );

  /** A class of grade 7 in the north with a teacher who may take it, in a new draft. */
  async function fitting(
    input: { grade?: number; language?: 'uz' | 'ru'; branch?: string; year?: string } = {},
  ): Promise<{ version: string; classId: string; teacher: string; year: string; branch: string }> {
    const branch = input.branch ?? north;
    const year = input.year ?? northYear;
    const classId = await kit.classes.schoolClass(branch, year, {
      grade: input.grade ?? 7,
      language: input.language ?? 'uz',
    });
    const { staffId } = await kit.teacher(branch, {
      languages: [input.language ?? 'uz'],
      subjects: [{ subject, grades: [input.grade ?? 7] }],
    });
    const version = await kit.version(branch, year, { startsOn: STARTS_ON });
    return { version, classId, teacher: staffId, year, branch };
  }

  /** A branch of its own with a current year, for a test that closes the year. */
  async function ownBranch(): Promise<{ branch: string; year: string }> {
    branchCount += 1;
    const branch = await insertBranch(database.migrator, `Branch ${String(branchCount)}`);
    return { branch, year: await kit.classes.year(branch) };
  }

  /** How many connections to the test database wait for a lock right now. */
  async function waitingForALock(): Promise<number> {
    const found = await sql<{ waiting: number }>`
      select count(distinct l.pid)::int as waiting
      from pg_locks l join pg_stat_activity a on a.pid = l.pid
      where a.datname = current_database() and not l.granted
    `.execute(database.migrator);
    return found.rows[0]?.waiting ?? 0;
  }

  beforeAll(async () => {
    database = await createTestDatabase();
    transactions = new Transactions(database.app, new FixedClock(NOW));
    kit = new LoadKit(database.migrator);
    north = await insertBranch(database.migrator, 'North');
    south = await insertBranch(database.migrator, 'South');
    northYear = await kit.classes.year(north);
    southYear = await kit.classes.year(south);
    subject = await kit.classes.subject({ grades: [7, 8, 9, 10] });
    nextYear = await kit.classes.year(north, 'planned', '2027-09-01', '2028-05-31');
  });

  afterAll(async () => {
    await database.destroy();
  });

  describe('the Tutors department (decision 2, correction 5)', () => {
    it('is the one department marked, and the application cannot mark another', async () => {
      const marked = await database.migrator
        .selectFrom('departments')
        .select('name_en')
        .where('tutors', '=', true)
        .execute();
      expect(marked).toEqual([{ name_en: 'Tutors' }]);
      const refused = await refusal(
        inBranch(north, (transaction) =>
          transaction.updateTable('departments').set({ tutors: true }).execute(),
        ),
      );
      expect(refused.code).toBe(INSUFFICIENT_PRIVILEGE);
      expect(
        (
          await refusal(
            database.migrator
              .updateTable('departments')
              .set({ tutors: true })
              .where('name_en', '=', 'STEAM')
              .execute(),
          )
        ).code,
      ).toBe(UNIQUE_VIOLATION);
    });
  });

  describe('a version', () => {
    it('is invisible from another branch, and its year is of its branch', async () => {
      const version = await kit.version(south, southYear);
      const seen = await inBranch(north, (transaction) =>
        transaction
          .selectFrom('timetable_versions')
          .select('id')
          .where('id', '=', version)
          .execute(),
      );
      expect(seen).toEqual([]);
      const refused = await refusal(
        inBranch(north, (transaction) =>
          transaction
            .insertInto('timetable_versions')
            .values({
              branch_id: north,
              academic_year_id: southYear,
              number: 1,
              starts_on: STARTS_ON,
            })
            .execute(),
        ),
      );
      expect(refused.code).toBe(FOREIGN_KEY_VIOLATION);
    });

    it('starts from a version of its own branch and year only', async () => {
      const otherYear = nextYear;
      const source = await kit.version(north, otherYear);
      const refused = await refusal(
        inBranch(north, (transaction) =>
          transaction
            .insertInto('timetable_versions')
            .values({
              branch_id: north,
              academic_year_id: northYear,
              number: 90,
              starts_on: STARTS_ON,
              from_version_id: source,
            })
            .execute(),
        ),
      );
      expect(refused).toMatchObject({
        code: FOREIGN_KEY_VIOLATION,
        constraint: 'timetable_versions_from_fkey',
      });
      const same = await kit.version(north, otherYear);
      await kit.version(north, otherYear, { from: same });
    });

    it('takes each number once per branch and year', async () => {
      const year = await kit.classes.year(north, 'planned', '2028-09-01', '2029-05-31');
      await kit.version(north, year);
      const refused = await refusal(
        inBranch(north, (transaction) =>
          transaction
            .insertInto('timetable_versions')
            .values({ branch_id: north, academic_year_id: year, number: 1, starts_on: STARTS_ON })
            .execute(),
        ),
      );
      expect(refused).toMatchObject({
        code: UNIQUE_VIOLATION,
        constraint: 'timetable_versions_number_key',
      });
    });

    it('is refused in a closed year (correction 2)', async () => {
      const { branch, year: closed } = await ownBranch();
      await kit.classes.setYear(closed, 'closed');
      const refused = await refusal(
        inBranch(branch, (transaction) =>
          transaction
            .insertInto('timetable_versions')
            .values({
              branch_id: branch,
              academic_year_id: closed,
              number: 1,
              starts_on: STARTS_ON,
            })
            .execute(),
        ),
      );
      expect(refused.constraint).toBe('version_year_closed');
    });

    it('changes its start date and dismisses its left rows only while a draft in an open year', async () => {
      const { branch, year } = await ownBranch();
      const draft = await kit.version(branch, year);
      await inBranch(branch, (transaction) =>
        transaction
          .updateTable('timetable_versions')
          .set({ starts_on: '2026-10-26' })
          .where('id', '=', draft)
          .execute(),
      );
      const published = await kit.version(branch, year, { status: 'published' });
      const refused = await refusal(
        inBranch(branch, (transaction) =>
          transaction
            .updateTable('timetable_versions')
            .set({ starts_on: '2026-10-26' })
            .where('id', '=', published)
            .execute(),
        ),
      );
      expect(refused.constraint).toBe('timetable_versions_draft');
      await kit.classes.setYear(year, 'closed');
      const closed = await refusal(
        inBranch(branch, (transaction) =>
          transaction
            .updateTable('timetable_versions')
            .set({ left_rows: JSON.stringify([]) })
            .where('id', '=', draft)
            .execute(),
        ),
      );
      expect(closed.constraint).toBe('version_year_closed');
    });

    it('keeps its year, number and source, and its left rows are only dismissed', async () => {
      const draft = await kit.version(north, northYear);
      for (const values of [{ number: 77 }, { from_version_id: draft }]) {
        expect(
          (
            await refusal(
              database.migrator
                .updateTable('timetable_versions')
                .set(values)
                .where('id', '=', draft)
                .execute(),
            )
          ).constraint,
        ).toBe('timetable_versions_fixed');
      }
      const left = JSON.stringify([{ codes: ['load_teacher_status'] }]);
      const written = await refusal(
        inBranch(north, (transaction) =>
          transaction
            .updateTable('timetable_versions')
            .set({ left_rows: left })
            .where('id', '=', draft)
            .execute(),
        ),
      );
      expect(written.constraint).toBe('timetable_versions_fixed');
      // Dismissing them is the one change.
      await inBranch(north, (transaction) =>
        transaction
          .updateTable('timetable_versions')
          .set({ left_rows: JSON.stringify([]) })
          .where('id', '=', draft)
          .execute(),
      );
    });

    // Task 5.5a-1 (0073) grants the status to publish; its trigger
    // `timetable_versions_status` lets a draft only be published
    // (publish.database.test.ts).
    it('grants no write of its year, number or source, and no delete', async () => {
      const draft = await kit.version(north, northYear);
      for (const values of [
        { academic_year_id: southYear },
        { number: 50 },
        { from_version_id: null },
      ]) {
        const refused = await refusal(
          inBranch(north, (transaction) =>
            transaction
              .updateTable('timetable_versions')
              .set(values)
              .where('id', '=', draft)
              .execute(),
          ),
        );
        expect(refused.code).toBe(INSUFFICIENT_PRIVILEGE);
      }
      const deleted = await refusal(
        inBranch(north, (transaction) =>
          transaction.deleteFrom('timetable_versions').where('id', '=', draft).execute(),
        ),
      );
      expect(deleted.code).toBe(INSUFFICIENT_PRIVILEGE);
    });
  });

  describe('a load row', () => {
    it('is invisible from another branch', async () => {
      const classId = await kit.classes.schoolClass(south, southYear);
      const { staffId } = await kit.teacher(south, { subjects: [{ subject, grades: [7] }] });
      const version = await kit.version(south, southYear);
      const id = await kit.row({
        branch_id: south,
        version_id: version,
        class_id: classId,
        subject_id: subject,
        teacher_id: staffId,
      });
      const seen = await inBranch(north, (transaction) =>
        transaction.selectFrom('teaching_load_rows').select('id').where('id', '=', id).execute(),
      );
      expect(seen).toEqual([]);
    });

    it("refuses another branch's version, class, group and room (composite keys)", async () => {
      const own = await fitting();
      const southClass = await kit.classes.schoolClass(south, southYear);
      const southGroup = await kit.classes.group(south, southYear, subject, [southClass]);
      const southRoom = await kit.classes.room(south);
      const southVersion = await kit.version(south, southYear);
      const base = {
        branch_id: north,
        version_id: own.version,
        class_id: own.classId,
        subject_id: subject,
        teacher_id: own.teacher,
      };
      for (const values of [
        { ...base, version_id: southVersion },
        { ...base, class_id: southClass },
        { ...base, class_id: null, group_id: southGroup },
        { ...base, room_id: southRoom },
      ]) {
        // The migrator sees both branches; the keys still refuse.
        const refused = await refusal(
          database.migrator
            .insertInto('teaching_load_rows')
            .values({ lessons_per_week: 2, ...values })
            .execute(),
        );
        expect(refused.code).toBe(FOREIGN_KEY_VIOLATION);
      }
    });

    it('holds the bounds and the choices of its columns (decisions 12 and 13, correction 3)', async () => {
      const own = await fitting();
      const room = await kit.classes.room(north);
      const base = {
        branch_id: north,
        version_id: own.version,
        class_id: own.classId,
        subject_id: subject,
        teacher_id: own.teacher,
      };
      expect(LOAD_LESSONS_MAX).toBe(40);
      for (const [values, constraint] of [
        [{ lessons_per_week: 0 }, 'teaching_load_rows_lessons_check'],
        [{ lessons_per_week: LOAD_LESSONS_MAX + 1 }, 'teaching_load_rows_lessons_check'],
        [{ room_type: 'garden' }, 'teaching_load_rows_room_type_check'],
        [{ room_id: room, room_type: 'laboratory' }, 'teaching_load_rows_room_check'],
        [
          { group_id: await kit.classes.group(north, northYear, subject, [own.classId]) },
          'teaching_load_rows_unit_check',
        ],
        [{ class_id: null }, 'teaching_load_rows_unit_check'],
      ] as const) {
        const refused = await refusal(insertRow({ ...base, ...values }));
        expect(refused).toMatchObject({ code: CHECK_VIOLATION, constraint });
      }
      const refused = await refusal(insertRow({ ...base, teacher_id: null as unknown as string }));
      expect(refused.code).toBe('23502');
      const id = await insertRow({
        ...base,
        lessons_per_week: LOAD_LESSONS_MAX,
        room_type: 'laboratory',
      });
      expect(id).toBeTypeOf('string');
    });

    it('is one per class and subject, and one per group, in a version', async () => {
      const own = await fitting();
      const base = {
        branch_id: north,
        version_id: own.version,
        class_id: own.classId,
        subject_id: subject,
        teacher_id: own.teacher,
      };
      await insertRow(base);
      expect(await refusal(insertRow(base))).toMatchObject({
        code: UNIQUE_VIOLATION,
        constraint: 'teaching_load_rows_class_key',
      });
      // A group of another class: a version never holds a whole-class row and a
      // group row of one class and subject (task 3.4b, load_split_and_whole).
      const otherClass = await kit.classes.schoolClass(north, northYear, {
        grade: 7,
        language: 'uz',
      });
      const group = await kit.classes.group(north, northYear, subject, [otherClass]);
      const groupRow = { ...base, class_id: null, group_id: group };
      await insertRow(groupRow);
      expect(await refusal(insertRow(groupRow))).toMatchObject({
        code: UNIQUE_VIOLATION,
        constraint: 'teaching_load_rows_group_key',
      });
      // Another version takes the same class and subject.
      const other = await kit.version(north, northYear);
      await insertRow({ ...base, version_id: other });
    });

    it('grants no update of its version, unit or subject', async () => {
      const own = await fitting();
      const id = await insertRow({
        branch_id: north,
        version_id: own.version,
        class_id: own.classId,
        subject_id: subject,
        teacher_id: own.teacher,
      });
      for (const values of [
        { version_id: await kit.version(north, northYear) },
        { class_id: own.classId },
        { group_id: null },
        { subject_id: subject },
        { branch_id: north },
      ]) {
        const refused = await refusal(
          inBranch(north, (transaction) =>
            transaction
              .updateTable('teaching_load_rows')
              .set(values)
              .where('id', '=', id)
              .execute(),
          ),
        );
        expect(refused.code).toBe(INSUFFICIENT_PRIVILEGE);
      }
      const other = await kit.classes.schoolClass(north, northYear);
      const fixed = await refusal(
        database.migrator
          .updateTable('teaching_load_rows')
          .set({ class_id: other })
          .where('id', '=', id)
          .execute(),
      );
      expect(fixed.constraint).toBe('teaching_load_rows_fixed');
    });
  });

  describe('the blocked rules of one row (06, Rules; 05, Teaching load)', () => {
    it('is written for a teacher with the subject, the grade and the language', async () => {
      const own = await fitting();
      const id = await insertRow({
        branch_id: north,
        version_id: own.version,
        class_id: own.classId,
        subject_id: subject,
        teacher_id: own.teacher,
      });
      expect(id).toBeTypeOf('string');
    });

    it('is refused in a version that is not a draft, on insert, update and delete', async () => {
      const own = await fitting();
      const base = {
        branch_id: north,
        version_id: own.version,
        class_id: own.classId,
        subject_id: subject,
        teacher_id: own.teacher,
      };
      const id = await insertRow(base);
      await kit.setVersion(own.version, 'published');
      const other = await kit.classes.schoolClass(north, northYear);
      expect((await refusal(insertRow({ ...base, class_id: other }))).constraint).toBe(
        'load_version_draft',
      );
      expect((await refusal(updateRow(north, id, { lessons_per_week: 3 }))).constraint).toBe(
        'load_version_draft',
      );
      expect((await refusal(deleteRow(north, id))).constraint).toBe('load_version_draft');
    });

    it('is refused in a closed year, on insert, update and delete', async () => {
      const { branch, year } = await ownBranch();
      const own = await fitting({ branch, year });
      const base = {
        branch_id: branch,
        version_id: own.version,
        class_id: own.classId,
        subject_id: subject,
        teacher_id: own.teacher,
      };
      const id = await insertRow(base);
      const other = await kit.classes.schoolClass(branch, year);
      await kit.classes.setYear(year, 'closed');
      expect((await refusal(insertRow({ ...base, class_id: other }))).constraint).toBe(
        'load_year_closed',
      );
      expect((await refusal(updateRow(branch, id, { lessons_per_week: 3 }))).constraint).toBe(
        'load_year_closed',
      );
      expect((await refusal(deleteRow(branch, id))).constraint).toBe('load_year_closed');
    });

    it('takes a class or group of the version year only, and an active one', async () => {
      const own = await fitting();
      const otherYear = nextYear;
      const elsewhere = await kit.classes.schoolClass(north, otherYear);
      const base = {
        branch_id: north,
        version_id: own.version,
        subject_id: subject,
        teacher_id: own.teacher,
      };
      expect((await refusal(insertRow({ ...base, class_id: elsewhere }))).constraint).toBe(
        'load_unit_year',
      );
      const archived = await kit.classes.schoolClass(north, northYear);
      await database.migrator
        .updateTable('classes')
        .set({ archived_at: new Date(NOW) })
        .where('id', '=', archived)
        .execute();
      expect((await refusal(insertRow({ ...base, class_id: archived }))).constraint).toBe(
        'load_unit_archived',
      );
      const group = await kit.classes.group(north, northYear, subject, [own.classId]);
      await database.migrator
        .updateTable('groups')
        .set({ archived_at: new Date(NOW) })
        .where('id', '=', group)
        .execute();
      expect((await refusal(insertRow({ ...base, group_id: group }))).constraint).toBe(
        'load_unit_archived',
      );
    });

    it("takes a group's own subject only", async () => {
      const own = await fitting();
      const other = await kit.classes.subject({ grades: [7] });
      await kit.profile(own.teacher, [{ subject: other, grades: [7] }]);
      const group = await kit.classes.group(north, northYear, subject, [own.classId]);
      const refused = await refusal(
        insertRow({
          branch_id: north,
          version_id: own.version,
          group_id: group,
          subject_id: other,
          teacher_id: own.teacher,
        }),
      );
      expect(refused.constraint).toBe('load_group_subject');
    });

    it('takes an active subject taught in every grade of the unit', async () => {
      const own = await fitting();
      const archived = await kit.classes.subject({ grades: [7] });
      await kit.profile(own.teacher, [{ subject: archived, grades: [7] }]);
      await database.migrator
        .updateTable('subjects')
        .set({ archived_at: new Date(NOW) })
        .where('id', '=', archived)
        .execute();
      const base = {
        branch_id: north,
        version_id: own.version,
        class_id: own.classId,
        teacher_id: own.teacher,
      };
      expect((await refusal(insertRow({ ...base, subject_id: archived }))).constraint).toBe(
        'load_subject_archived',
      );
      const later = await kit.classes.subject({ grades: [8, 9] });
      expect((await refusal(insertRow({ ...base, subject_id: later }))).constraint).toBe(
        'load_subject_grade',
      );
    });

    it('needs the subject in both grades of a two-grade group', async () => {
      const two = await kit.classes.subject({ grades: [7, 8] });
      const seventh = await kit.classes.schoolClass(north, northYear, { grade: 7 });
      const eighth = await kit.classes.schoolClass(north, northYear, { grade: 8 });
      const group = await kit.classes.group(north, northYear, two, [seventh, eighth]);
      const version = await kit.version(north, northYear);
      const one = await kit.teacher(north, { subjects: [{ subject: two, grades: [7] }] });
      const both = await kit.teacher(north, { subjects: [{ subject: two, grades: [7, 8] }] });
      const base = { branch_id: north, version_id: version, group_id: group, subject_id: two };
      expect((await refusal(insertRow({ ...base, teacher_id: one.staffId }))).constraint).toBe(
        'load_teacher_subject',
      );
      await insertRow({ ...base, teacher_id: both.staffId });
    });

    it('takes a teacher of the branch only', async () => {
      const own = await fitting();
      const away = await kit.teacher(south, { subjects: [{ subject, grades: [7] }] });
      const refused = await refusal(
        insertRow({
          branch_id: north,
          version_id: own.version,
          class_id: own.classId,
          subject_id: subject,
          teacher_id: away.staffId,
        }),
      );
      expect(refused.constraint).toBe('load_teacher_branch');
    });

    it.each(['inactive', 'left'] as const)(
      'refuses a teacher %s on the start date, and takes one with no status row then (decision 11)',
      async (status) => {
        const own = await fitting();
        await kit.status(own.teacher, status, '2026-10-19');
        const base = {
          branch_id: north,
          version_id: own.version,
          class_id: own.classId,
          subject_id: subject,
        };
        expect((await refusal(insertRow({ ...base, teacher_id: own.teacher }))).constraint).toBe(
          'load_teacher_status',
        );
        // Out only after the start date: in.
        const later = await kit.teacher(north, { subjects: [{ subject, grades: [7] }] });
        await kit.status(later.staffId, status, '2026-10-20');
        await insertRow({ ...base, teacher_id: later.staffId });
        // No row on the start date counts as in.
        const none = await kit.teacher(north, { subjects: [{ subject, grades: [7] }] });
        await database.migrator
          .updateTable('staff_statuses')
          .set({ valid_until: '2026-10-01' })
          .where('staff_id', '=', none.staffId)
          .execute();
        const other = await kit.classes.schoolClass(north, northYear);
        await insertRow({ ...base, class_id: other, teacher_id: none.staffId });
      },
    );

    // Spec review of the build, should-fix 3: a draft whose start date has
    // passed reads a status on today (the moment of the transaction).
    it('reads the status on today when the start date has passed', async () => {
      const classId = await kit.classes.schoolClass(north, northYear);
      const version = await kit.version(north, northYear, { startsOn: '2026-10-05' });
      const vacancy = await kit.vacancy(north, { subjects: [{ subject, grades: [7] }] });
      await kit.status(vacancy, 'closed', '2026-10-14');
      const refused = await refusal(
        insertRow({
          branch_id: north,
          version_id: version,
          class_id: classId,
          subject_id: subject,
          teacher_id: vacancy,
        }),
      );
      expect(refused.constraint).toBe('load_teacher_status');
    });

    it('needs the subject and the grade in the profile', async () => {
      const own = await fitting();
      const other = await kit.classes.subject({ grades: [7, 8] });
      const wrongGrade = await kit.teacher(north, { subjects: [{ subject, grades: [8] }] });
      const noSubject = await kit.teacher(north, { subjects: [{ subject: other, grades: [7] }] });
      const base = {
        branch_id: north,
        version_id: own.version,
        class_id: own.classId,
        subject_id: subject,
      };
      for (const teacher of [wrongGrade.staffId, noSubject.staffId]) {
        expect((await refusal(insertRow({ ...base, teacher_id: teacher }))).constraint).toBe(
          'load_teacher_subject',
        );
      }
    });

    it('needs the language of the unit while the language rule applies (05)', async () => {
      const own = await fitting({ language: 'ru' });
      const uzbek = await kit.teacher(north, {
        languages: ['uz'],
        subjects: [{ subject, grades: [7] }],
      });
      const base = {
        branch_id: north,
        version_id: own.version,
        class_id: own.classId,
        subject_id: subject,
      };
      expect((await refusal(insertRow({ ...base, teacher_id: uzbek.staffId }))).constraint).toBe(
        'load_teacher_language',
      );
      // "With the switch off, any teacher of the subject can take any class."
      const free = await kit.classes.subject({ grades: [7], languageRule: false });
      await kit.profile(uzbek.staffId, [{ subject: free, grades: [7] }]);
      await insertRow({ ...base, subject_id: free, teacher_id: uzbek.staffId });
    });

    it('binds a vacancy by the same rules, and refuses a closed one (06, Rules)', async () => {
      const own = await fitting({ language: 'ru' });
      const base = {
        branch_id: north,
        version_id: own.version,
        class_id: own.classId,
        subject_id: subject,
      };
      const noGrade = await kit.vacancy(north, {
        languages: ['ru'],
        subjects: [{ subject, grades: [8] }],
      });
      expect((await refusal(insertRow({ ...base, teacher_id: noGrade }))).constraint).toBe(
        'load_teacher_subject',
      );
      const noLanguage = await kit.vacancy(north, {
        languages: ['uz'],
        subjects: [{ subject, grades: [7] }],
      });
      expect((await refusal(insertRow({ ...base, teacher_id: noLanguage }))).constraint).toBe(
        'load_teacher_language',
      );
      const closed = await kit.vacancy(north, {
        languages: ['ru'],
        subjects: [{ subject, grades: [7] }],
      });
      await kit.status(closed, 'closed', '2026-10-15');
      expect((await refusal(insertRow({ ...base, teacher_id: closed }))).constraint).toBe(
        'load_teacher_status',
      );
      const open = await kit.vacancy(north, {
        languages: ['ru'],
        subjects: [{ subject, grades: [7] }],
      });
      await insertRow({ ...base, teacher_id: open });
    });

    it('refuses a closed room and takes one under repair (decision 13)', async () => {
      const own = await fitting();
      const base = {
        branch_id: north,
        version_id: own.version,
        class_id: own.classId,
        subject_id: subject,
        teacher_id: own.teacher,
      };
      const closed = await kit.classes.room(north, 'closed');
      expect((await refusal(insertRow({ ...base, room_id: closed }))).constraint).toBe(
        'load_room_closed',
      );
      const repair = await kit.classes.room(north);
      await database.migrator
        .updateTable('rooms')
        .set({ status: 'under_repair' })
        .where('id', '=', repair)
        .execute();
      await insertRow({ ...base, room_id: repair });
    });
  });

  // 3.4a decision 2 as narrowed by task 3.6c-2 (decision 1, review correction
  // 1; db/migrations/0067): a Tutor row holds the class's Tutor on the later
  // of the start date and today, the acting one while one is set, and nobody
  // else; a group row of a Tutor subject keeps the profile rule. The refusals
  // that were `load_teacher_subject` under 3.4a's "a Tutor of the class, or
  // anyone with the profile row" are now `load_no_tutor` and
  // `load_tutor_row_teacher`.
  describe('a Tutor subject (decision 2 as narrowed by 3.6c-2)', () => {
    let tutorSubject: string;

    beforeAll(async () => {
      tutorSubject = await kit.tutorSubject();
    });

    /** A class, a person who tutors it from `from` to `until`, and a draft. */
    async function tutored(
      input: {
        from?: Date;
        until?: Date | null;
        kind?: 'tutor' | 'acting';
        languages?: ('uz' | 'ru')[];
      } = {},
    ) {
      const classId = await kit.classes.schoolClass(north, northYear, { grade: 7 });
      const person = await kit.teacher(north, { languages: input.languages ?? ['uz'] });
      await kit.tutorOf(north, classId, person.accountId, {
        kind: input.kind ?? 'tutor',
        ...(input.from === undefined ? {} : { from: input.from }),
        ...(input.until === undefined ? {} : { until: input.until }),
      });
      const version = await kit.version(north, northYear, { startsOn: STARTS_ON });
      return {
        classId,
        person,
        version,
        base: {
          branch_id: north,
          version_id: version,
          class_id: classId,
          subject_id: tutorSubject,
        },
      };
    }

    it('is taken by the Tutor of the class without the subject in the profile', async () => {
      const own = await tutored();
      await insertRow({ ...own.base, teacher_id: own.person.staffId });
    });

    it('is taken by the acting Tutor too', async () => {
      const own = await tutored({ kind: 'acting', until: new Date('2026-12-01T00:00:00+05:00') });
      await insertRow({ ...own.base, teacher_id: own.person.staffId });
    });

    it('is taken by a Tutor given during the start date, and refused with no Tutor when the row ended before it', async () => {
      const given = await tutored({ from: new Date('2026-10-19T15:00:00+05:00') });
      await insertRow({ ...given.base, teacher_id: given.person.staffId });
      const ended = await tutored({
        from: new Date('2026-09-01T00:00:00+05:00'),
        until: new Date('2026-10-19T00:00:00+05:00'),
      });
      expect(
        (await refusal(insertRow({ ...ended.base, teacher_id: ended.person.staffId }))).constraint,
      ).toBe('load_no_tutor');
    });

    it('is refused for another teacher, also one with the subject in the profile', async () => {
      const own = await tutored();
      const other = await kit.teacher(north);
      expect(
        (await refusal(insertRow({ ...own.base, teacher_id: other.staffId }))).constraint,
      ).toBe('load_tutor_row_teacher');
      const holder = await kit.tutorSubjectHolder(north, tutorSubject, [7]);
      expect(
        (await refusal(insertRow({ ...own.base, teacher_id: holder.staffId }))).constraint,
      ).toBe('load_tutor_row_teacher');
    });

    it('is refused for the main Tutor while an acting one is set, and taken by the acting one', async () => {
      const own = await tutored();
      const acting = await kit.teacher(north);
      await kit.tutorOf(north, own.classId, acting.accountId, {
        kind: 'acting',
        from: new Date('2026-10-01T00:00:00+05:00'),
        until: new Date('2026-11-01T00:00:00+05:00'),
      });
      expect(
        (await refusal(insertRow({ ...own.base, teacher_id: own.person.staffId }))).constraint,
      ).toBe('load_tutor_row_teacher');
      await insertRow({ ...own.base, teacher_id: acting.staffId });
    });

    it('reads the Tutor of today in a draft whose start date has passed', async () => {
      const classId = await kit.classes.schoolClass(north, northYear, { grade: 7 });
      const before = await kit.teacher(north);
      const now = await kit.teacher(north);
      await kit.tutorOf(north, classId, before.accountId, {
        until: new Date('2026-10-14T00:00:00+05:00'),
      });
      await kit.tutorOf(north, classId, now.accountId, {
        from: new Date('2026-10-14T00:00:00+05:00'),
      });
      const version = await kit.version(north, northYear, { startsOn: '2026-10-12' });
      const base = {
        branch_id: north,
        version_id: version,
        class_id: classId,
        subject_id: tutorSubject,
      };
      expect((await refusal(insertRow({ ...base, teacher_id: before.staffId }))).constraint).toBe(
        'load_tutor_row_teacher',
      );
      await insertRow({ ...base, teacher_id: now.staffId });
    });

    it('lets a row written by the rule of 3.4a keep its teacher through an edit of its lessons', async () => {
      const own = await tutored();
      const holder = await kit.tutorSubjectHolder(north, tutorSubject, [7]);
      const id = await insertRow({ ...own.base, teacher_id: own.person.staffId });
      // As 3.4a let it be written: another teacher with the profile row.
      await database.migrator.transaction().execute(async (transaction) => {
        await sql`alter table teaching_load_rows disable trigger teaching_load_rows_check`.execute(
          transaction,
        );
        await transaction
          .updateTable('teaching_load_rows')
          .set({ teacher_id: holder.staffId })
          .where('id', '=', id)
          .execute();
        await sql`set constraints all immediate`.execute(transaction);
        await sql`alter table teaching_load_rows enable trigger teaching_load_rows_check`.execute(
          transaction,
        );
      });
      // The teacher does not change: no teacher rule is read (3.4a decision 7).
      await updateRow(north, id, { lessons_per_week: 3 });
      // A change of its teacher must name the Tutor.
      const other = await kit.tutorSubjectHolder(north, tutorSubject, [7]);
      expect((await refusal(updateRow(north, id, { teacher_id: other.staffId }))).constraint).toBe(
        'load_tutor_row_teacher',
      );
      await updateRow(north, id, { teacher_id: own.person.staffId });
    });

    it('refuses the Tutor of another class and keeps the profile rule on a group row', async () => {
      const own = await tutored();
      const elsewhere = await tutored();
      expect(
        (await refusal(insertRow({ ...own.base, teacher_id: elsewhere.person.staffId })))
          .constraint,
      ).toBe('load_tutor_row_teacher');
      const group = await kit.classes.group(north, northYear, tutorSubject, [own.classId]);
      expect(
        (
          await refusal(
            insertRow({
              branch_id: north,
              version_id: own.version,
              group_id: group,
              subject_id: tutorSubject,
              teacher_id: own.person.staffId,
            }),
          )
        ).constraint,
      ).toBe('load_teacher_subject');
      const holder = await kit.tutorSubjectHolder(north, tutorSubject, [7]);
      await insertRow({
        branch_id: north,
        version_id: own.version,
        group_id: group,
        subject_id: tutorSubject,
        teacher_id: holder.staffId,
      });
    });

    it('is refused for the Tutor without the language of the class', async () => {
      const own = await tutored({ languages: ['uz', 'ru'] });
      // The Tutor rule of 3.1a keeps a Tutor in the language of the class;
      // the load checks it all the same, so the migrator removes it past the
      // triggers.
      await database.migrator.transaction().execute(async (transaction) => {
        await sql`alter table staff_languages disable trigger staff_languages_tutor_held`.execute(
          transaction,
        );
        await transaction
          .deleteFrom('staff_languages')
          .where('staff_id', '=', own.person.staffId)
          .where('language', '=', 'uz')
          .execute();
        await sql`set constraints all immediate`.execute(transaction);
        await sql`alter table staff_languages enable trigger staff_languages_tutor_held`.execute(
          transaction,
        );
      });
      expect(
        (await refusal(insertRow({ ...own.base, teacher_id: own.person.staffId }))).constraint,
      ).toBe('load_teacher_language');
    });
  });

  describe('an update (decision 7)', () => {
    async function writtenRow() {
      const own = await fitting();
      const id = await insertRow({
        branch_id: north,
        version_id: own.version,
        class_id: own.classId,
        subject_id: subject,
        teacher_id: own.teacher,
      });
      return { ...own, id };
    }

    it('checks the teacher rules when the teacher changes', async () => {
      const row = await writtenRow();
      const noGrade = await kit.teacher(north, { subjects: [{ subject, grades: [8] }] });
      const away = await kit.teacher(south, { subjects: [{ subject, grades: [7] }] });
      const noLanguage = await kit.teacher(north, {
        languages: ['ru'],
        subjects: [{ subject, grades: [7] }],
      });
      const out = await kit.teacher(north, { subjects: [{ subject, grades: [7] }] });
      await kit.status(out.staffId, 'inactive', '2026-10-16');
      for (const [teacher, constraint] of [
        [noGrade.staffId, 'load_teacher_subject'],
        [away.staffId, 'load_teacher_branch'],
        [noLanguage.staffId, 'load_teacher_language'],
        [out.staffId, 'load_teacher_status'],
      ] as const) {
        expect((await refusal(updateRow(north, row.id, { teacher_id: teacher }))).constraint).toBe(
          constraint,
        );
      }
    });

    it('checks the room when the room changes', async () => {
      const row = await writtenRow();
      const closed = await kit.classes.room(north, 'closed');
      expect((await refusal(updateRow(north, row.id, { room_id: closed }))).constraint).toBe(
        'load_room_closed',
      );
    });

    it('takes a change of lessons on a row with a problem it does not touch (decision 3)', async () => {
      const row = await writtenRow();
      const room = await kit.classes.room(north);
      await updateRow(north, row.id, { room_id: room });
      // A later change elsewhere is not refused because the row needs it.
      await kit.status(row.teacher, 'inactive', '2026-10-16');
      await database.migrator
        .updateTable('rooms')
        .set({ status: 'closed' })
        .where('id', '=', room)
        .execute();
      await database.migrator
        .deleteFrom('staff_subjects')
        .where('staff_id', '=', row.teacher)
        .execute();
      await updateRow(north, row.id, { lessons_per_week: 5 });
      await deleteRow(north, row.id);
    });
  });

  describe('a vacancy a row names (04, Vacancy; decision 6)', () => {
    async function namedVacancy() {
      const own = await fitting();
      const vacancy = await kit.vacancy(north, { subjects: [{ subject, grades: [7] }] });
      const id = await insertRow({
        branch_id: north,
        version_id: own.version,
        class_id: own.classId,
        subject_id: subject,
        teacher_id: vacancy,
      });
      return { vacancy, id };
    }

    it('is neither deleted nor closed while the row is there, and is once it is gone', async () => {
      const { vacancy, id } = await namedVacancy();
      const deleted = await refusal(
        inBranch(north, (transaction) =>
          sql`select vacancy_delete(${vacancy})`.execute(transaction),
        ),
      );
      expect(deleted.constraint).toBe('vacancy_has_load');
      const closed = await refusal(
        inBranch(north, async (transaction) => {
          await transaction
            .updateTable('staff_statuses')
            .set({ valid_until: '2026-10-15' })
            .where('staff_id', '=', vacancy)
            .execute();
          await transaction
            .insertInto('staff_statuses')
            .values({ staff_id: vacancy, status: 'closed', valid_from: '2026-10-15' })
            .execute();
        }),
      );
      expect(closed.constraint).toBe('vacancy_has_load');
      await deleteRow(north, id);
      await inBranch(north, (transaction) =>
        sql`select vacancy_delete(${vacancy})`.execute(transaction),
      );
    });

    it('waits for a load row being written before a close reads the rows', async () => {
      const own = await fitting();
      const vacancy = await kit.vacancy(north, { subjects: [{ subject, grades: [7] }] });
      const held = holding(
        (run) => inBranch(north, run),
        async (transaction) => {
          await transaction
            .insertInto('teaching_load_rows')
            .values({
              branch_id: north,
              version_id: own.version,
              class_id: own.classId,
              subject_id: subject,
              teacher_id: vacancy,
              lessons_per_week: 2,
            })
            .execute();
        },
      );
      await held.ready;
      const closing = outcome(
        inBranch(north, async (transaction) => {
          await transaction
            .selectFrom('staff')
            .select('id')
            .where('id', '=', vacancy)
            .forUpdate()
            .execute();
          await transaction
            .updateTable('staff_statuses')
            .set({ valid_until: '2026-10-15' })
            .where('staff_id', '=', vacancy)
            .execute();
          await transaction
            .insertInto('staff_statuses')
            .values({ staff_id: vacancy, status: 'closed', valid_from: '2026-10-15' })
            .execute();
        }),
      );
      await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBe(1);
      held.release();
      expect(await outcome(held.done)).toBe('written');
      expect(await closing).toBe('vacancy_has_load');
    });

    it('refuses a row for a vacancy closed while the row waited for the record', async () => {
      const own = await fitting();
      const vacancy = await kit.vacancy(north, { subjects: [{ subject, grades: [7] }] });
      const held = holding(
        (run) => inBranch(north, run),
        async (transaction) => {
          await transaction
            .selectFrom('staff')
            .select('id')
            .where('id', '=', vacancy)
            .forUpdate()
            .execute();
          await transaction
            .updateTable('staff_statuses')
            .set({ valid_until: '2026-10-15' })
            .where('staff_id', '=', vacancy)
            .execute();
          await transaction
            .insertInto('staff_statuses')
            .values({ staff_id: vacancy, status: 'closed', valid_from: '2026-10-15' })
            .execute();
        },
      );
      await held.ready;
      const inserted = outcome(
        insertRow({
          branch_id: north,
          version_id: own.version,
          class_id: own.classId,
          subject_id: subject,
          teacher_id: vacancy,
        }),
      );
      await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBe(1);
      held.release();
      expect(await outcome(held.done)).toBe('written');
      expect(await inserted).toBe('load_teacher_status');
    });
  });

  describe('two changes at the same moment', () => {
    it('makes a year close wait for a load row being written', async () => {
      const { branch, year } = await ownBranch();
      const own = await fitting({ branch, year });
      const held = holding(
        (run) => inBranch(branch, run),
        async (transaction) => {
          await transaction
            .insertInto('teaching_load_rows')
            .values({
              branch_id: branch,
              version_id: own.version,
              class_id: own.classId,
              subject_id: subject,
              teacher_id: own.teacher,
              lessons_per_week: 2,
            })
            .execute();
        },
      );
      await held.ready;
      const closing = outcome(kit.classes.setYear(year, 'closed'));
      await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBe(1);
      held.release();
      expect(await outcome(held.done)).toBe('written');
      expect(await closing).toBe('written');
    });

    it('refuses a load row written after a year close it waited for', async () => {
      const { branch, year } = await ownBranch();
      const own = await fitting({ branch, year });
      const held = holding(
        (run) => database.migrator.transaction().execute(run),
        async (transaction) => {
          await transaction
            .updateTable('academic_years')
            .set({ status: 'closed' })
            .where('id', '=', year)
            .execute();
        },
      );
      await held.ready;
      const inserted = outcome(
        insertRow({
          branch_id: branch,
          version_id: own.version,
          class_id: own.classId,
          subject_id: subject,
          teacher_id: own.teacher,
        }),
      );
      await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBe(1);
      held.release();
      expect(await outcome(held.done)).toBe('written');
      expect(await inserted).toBe('load_year_closed');
    });
  });
});
