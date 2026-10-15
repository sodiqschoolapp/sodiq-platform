import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { LoadKit, type LoadRowValues } from '../../testing/load-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

const CHECK_VIOLATION = '23514';

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

// The block rules and the split-or-whole rule that the database itself keeps
// at the commit (db/migrations/0056; task 3.4b, pull request #100, decisions 2,
// 3 and 12), also when the application has a fault: edge/timetable,
// Structure, "all parts have equal lessons per week and different teachers. A
// mixed block is allowed"; 05, Group, "Whether a class is split for a subject
// is set in the teaching load". Every fixture passes every rule of 0055 (the
// teachers have the subject, grade 7 and Uzbek), so nothing earlier refuses
// first. `load_split_and_whole` is reached on insert only: the unit and the
// subject of a row never change (`teaching_load_rows_fixed`). Also two writes
// at the same moment and `teacher_load_elsewhere` (decision 8 with
// correction 1). All names are invented.
describe('the blocks of a teaching load in the database', () => {
  let database: TestDatabase;
  let transactions: Transactions;
  let kit: LoadKit;
  let north: string;
  let south: string;
  let northYear: string;
  let southYear: string;
  let subject: string;

  const inBranch = <T>(branch: string, work: (transaction: Transaction) => Promise<T>) =>
    transactions.run([branch], work);

  /** A row inserted as the application inserts it. */
  const insertRow = (values: LoadRowValues) =>
    inBranch(values.branch_id, (transaction) =>
      transaction
        .insertInto('teaching_load_rows')
        .values({ lessons_per_week: 3, ...values })
        .returning('id')
        .executeTakeFirstOrThrow()
        .then((row) => row.id),
    );

  type Change = {
    teacher_id?: string;
    lessons_per_week?: number;
    mixed_block?: boolean;
    room_type?: string | null;
  };

  /** Rows updated as the application updates them, in one transaction. */
  const updateRows = (changes: readonly [string, Change][]) =>
    inBranch(north, async (transaction) => {
      for (const [id, values] of changes) {
        await transaction
          .updateTable('teaching_load_rows')
          .set(values)
          .where('id', '=', id)
          .execute();
      }
    });

  /** A class of grade 7 in Uzbek of the north. */
  const schoolClass = () => kit.classes.schoolClass(north, northYear, { grade: 7, language: 'uz' });

  /** A teacher of the north who may take every row of the subject in grade 7. */
  const teacher = async (branch = north) =>
    (await kit.teacher(branch, { subjects: [{ subject, grades: [7] }] })).staffId;

  let version: string;
  let oxford: string;
  let princeton: string;
  let first: string;
  let second: string;
  let third: string;

  beforeAll(async () => {
    database = await createTestDatabase();
    transactions = new Transactions(database.app, new FixedClock(NOW));
    kit = new LoadKit(database.migrator);
    north = await insertBranch(database.migrator, 'North');
    south = await insertBranch(database.migrator, 'South');
    northYear = await kit.classes.year(north);
    southYear = await kit.classes.year(south);
    subject = await kit.classes.subject({ grades: [7, 8] });
  });

  beforeEach(async () => {
    version = await kit.version(north, northYear, { startsOn: STARTS_ON });
    oxford = await schoolClass();
    princeton = await schoolClass();
    first = await teacher();
    second = await teacher();
    third = await teacher();
  });

  afterAll(async () => {
    await database.destroy();
  });

  /** A split of one class: two groups of the subject that draw from it only. */
  const split = async (classId = oxford) => [
    await kit.classes.group(north, northYear, subject, [classId]),
    await kit.classes.group(north, northYear, subject, [classId]),
  ];

  const part = (group: string, values: Partial<LoadRowValues> = {}): LoadRowValues => ({
    branch_id: north,
    version_id: version,
    group_id: group,
    subject_id: subject,
    teacher_id: first,
    ...values,
  });

  describe('equal lessons per week (load_block_lessons)', () => {
    it('refuses a part with other lessons on insert', async () => {
      const [a = '', b = ''] = await split();
      await insertRow(part(a, { lessons_per_week: 3 }));
      expect(
        await refusal(insertRow(part(b, { teacher_id: second, lessons_per_week: 2 }))),
      ).toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'load_block_lessons',
      });
      await insertRow(part(b, { teacher_id: second, lessons_per_week: 3 }));
    });

    it('refuses lessons changed on one part only, and passes every part changed in one transaction', async () => {
      const [a = '', b = ''] = await split();
      const rowA = await insertRow(part(a));
      const rowB = await insertRow(part(b, { teacher_id: second }));
      expect(await refusal(updateRows([[rowA, { lessons_per_week: 4 }]]))).toMatchObject({
        constraint: 'load_block_lessons',
      });
      await updateRows([
        [rowA, { lessons_per_week: 4 }],
        [rowB, { lessons_per_week: 4 }],
      ]);
    });

    it('binds parallel groups of one grade with no class in common', async () => {
      const cambridge = await schoolClass();
      const yale = await schoolClass();
      const m1 = await kit.classes.group(north, northYear, subject, [oxford, princeton]);
      const m2 = await kit.classes.group(north, northYear, subject, [cambridge, yale]);
      await insertRow(part(m1));
      expect(
        await refusal(insertRow(part(m2, { teacher_id: second, lessons_per_week: 2 }))),
      ).toMatchObject({
        constraint: 'load_block_lessons',
      });
    });

    it('leaves splits of two classes apart', async () => {
      const [a = ''] = await split(oxford);
      const [c = ''] = await split(princeton);
      await insertRow(part(a));
      await insertRow(part(c, { lessons_per_week: 2 }));
    });
  });

  describe('different teachers (load_block_teacher)', () => {
    it('refuses one teacher on two parts on insert and on update', async () => {
      const [a = '', b = ''] = await split();
      await insertRow(part(a));
      expect(await refusal(insertRow(part(b)))).toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'load_block_teacher',
      });
      const rowB = await insertRow(part(b, { teacher_id: second }));
      expect(await refusal(updateRows([[rowB, { teacher_id: first }]]))).toMatchObject({
        constraint: 'load_block_teacher',
      });
    });
  });

  describe('a mixed block (decision 12)', () => {
    it('lets one teacher take both halves of a split marked mixed, equal lessons still binding', async () => {
      const [a = '', b = ''] = await split();
      const rowA = await insertRow(part(a, { mixed_block: true }));
      const rowB = await insertRow(part(b, { mixed_block: true }));
      expect(await refusal(updateRows([[rowB, { lessons_per_week: 2 }]]))).toMatchObject({
        constraint: 'load_block_lessons',
      });
      // Clearing the mark on both halves is a teacher change: one teacher twice.
      expect(
        await refusal(
          updateRows([
            [rowA, { mixed_block: false }],
            [rowB, { mixed_block: false }],
          ]),
        ),
      ).toMatchObject({ constraint: 'load_block_teacher' });
    });

    it('refuses halves of one split that disagree on the mark (load_block_mixed)', async () => {
      const [a = '', b = ''] = await split();
      const rowA = await insertRow(part(a, { mixed_block: true }));
      expect(await refusal(insertRow(part(b, { teacher_id: second })))).toMatchObject({
        constraint: 'load_block_mixed',
      });
      await insertRow(part(b, { teacher_id: second, mixed_block: true }));
      expect(await refusal(updateRows([[rowA, { mixed_block: false }]]))).toMatchObject({
        constraint: 'load_block_mixed',
      });
    });

    it('refuses the mark on a group across classes (load_mixed_not_split), on insert and on update', async () => {
      const m1 = await kit.classes.group(north, northYear, subject, [oxford, princeton]);
      expect(await refusal(insertRow(part(m1, { mixed_block: true })))).toMatchObject({
        constraint: 'load_mixed_not_split',
      });
      const row = await insertRow(part(m1));
      expect(await refusal(updateRows([[row, { mixed_block: true }]]))).toMatchObject({
        constraint: 'load_mixed_not_split',
      });
    });

    it('lets PE and technology splits of one class have other lessons and one teacher', async () => {
      const technology = await kit.classes.subject({ grades: [7] });
      await kit.profile(first, [{ subject: technology, grades: [7] }]);
      const [pe1 = '', pe2 = ''] = await split();
      const tech1 = await kit.classes.group(north, northYear, technology, [oxford]);
      const tech2 = await kit.classes.group(north, northYear, technology, [oxford]);
      await insertRow(part(pe1, { mixed_block: true, lessons_per_week: 2 }));
      await insertRow(part(pe2, { mixed_block: true, lessons_per_week: 2 }));
      await insertRow(
        part(tech1, { subject_id: technology, mixed_block: true, lessons_per_week: 1 }),
      );
      await insertRow(
        part(tech2, { subject_id: technology, mixed_block: true, lessons_per_week: 1 }),
      );
    });
  });

  describe('a whole class and a split of one subject (load_split_and_whole)', () => {
    it('refuses a group row beside a class row of its class and subject', async () => {
      const [a = ''] = await split();
      await insertRow({
        branch_id: north,
        version_id: version,
        class_id: oxford,
        subject_id: subject,
        teacher_id: first,
      });
      expect(await refusal(insertRow(part(a, { teacher_id: second })))).toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'load_split_and_whole',
      });
    });

    it('refuses a class row beside a group row that draws from the class', async () => {
      const m1 = await kit.classes.group(north, northYear, subject, [oxford, princeton]);
      await insertRow(part(m1));
      expect(
        await refusal(
          insertRow({
            branch_id: north,
            version_id: version,
            class_id: princeton,
            subject_id: subject,
            teacher_id: second,
          }),
        ),
      ).toMatchObject({ constraint: 'load_split_and_whole' });
      // Another class, or another subject of the class, passes.
      const other = await kit.classes.subject({ grades: [7] });
      await kit.profile(second, [{ subject: other, grades: [7] }]);
      await insertRow({
        branch_id: north,
        version_id: version,
        class_id: princeton,
        subject_id: other,
        teacher_id: second,
      });
    });
  });

  describe('a block broken by a later change elsewhere (decision 3)', () => {
    /** Two splits of two classes, joined into one block when Princeton is added to Oxford's group. */
    async function broken(values: { lessons: [number, number]; teachers: [string, string] }) {
      const [a = ''] = await split(oxford);
      const [c = ''] = await split(princeton);
      await insertRow(
        part(a, { lessons_per_week: values.lessons[0], teacher_id: values.teachers[0] }),
      );
      const rowC = await insertRow(
        part(c, { lessons_per_week: values.lessons[1], teacher_id: values.teachers[1] }),
      );
      // Not refused: a later change elsewhere is listed, not refused (3.4a decision 3).
      await database.migrator
        .insertInto('group_classes')
        .values({ group_id: a, class_id: princeton, branch_id: north })
        .execute();
      return rowC;
    }

    it('refuses no teacher-only edit for unequal lessons', async () => {
      const rowC = await broken({ lessons: [3, 2], teachers: [first, second] });
      await updateRows([[rowC, { teacher_id: third }]]);
    });

    it('refuses no lessons-only edit for one teacher twice', async () => {
      const rowC = await broken({ lessons: [3, 2], teachers: [first, first] });
      await updateRows([[rowC, { lessons_per_week: 3 }]]);
      // A room edit is refused for neither.
      await updateRows([[rowC, { room_type: 'laboratory' }]]);
    });
  });

  // Writes that bypass the API take no version lock before their rows, so they
  // run side by side; the commit checks run one after the other (an advisory
  // lock of the version), and the one that commits second sees the first's
  // rows and is refused. The API takes the version FOR UPDATE first (route
  // tests of teaching-load.test.ts).
  describe('two writes at the same moment', () => {
    /** The held side writes and stays open; the other writes and commits; then the held side commits. */
    async function race(
      held: (transaction: Transaction) => Promise<void>,
      other: (transaction: Transaction) => Promise<void>,
    ): Promise<{ held: string | undefined; other: string | undefined }> {
      const holder = holding((run) => inBranch(north, run), held);
      await holder.ready;
      const otherOutcome = await outcome(inBranch(north, other));
      holder.release();
      return { held: await outcome(holder.done), other: otherOutcome };
    }

    const insertPart = (values: LoadRowValues) => async (transaction: Transaction) => {
      await transaction
        .insertInto('teaching_load_rows')
        .values({ lessons_per_week: 3, ...values })
        .execute();
    };

    it('refuses the second of two parts with unequal lessons to commit, in both orders', async () => {
      for (const [heldLessons, otherLessons] of [
        [3, 2],
        [2, 3],
      ] as const) {
        const [a = '', b = ''] = await split(await schoolClass());
        expect(
          await race(
            insertPart(part(a, { lessons_per_week: heldLessons })),
            insertPart(part(b, { teacher_id: second, lessons_per_week: otherLessons })),
          ),
        ).toEqual({ held: 'load_block_lessons', other: 'written' });
      }
    });

    it('refuses a class row and a group row of one class and subject, whichever commits second', async () => {
      for (const order of ['class held', 'group held'] as const) {
        const classId = await schoolClass();
        const [g = ''] = await split(classId);
        const classRow = insertPart({
          branch_id: north,
          version_id: version,
          class_id: classId,
          subject_id: subject,
          teacher_id: first,
        });
        const groupRow = insertPart(part(g, { teacher_id: second }));
        const [held, other] = order === 'class held' ? [classRow, groupRow] : [groupRow, classRow];
        expect(await race(held, other), order).toEqual({
          held: 'load_split_and_whole',
          other: 'written',
        });
      }
    });

    it('refuses a part inserted against a lessons edit of its block, in both orders', async () => {
      for (const order of ['edit held', 'insert held'] as const) {
        const classId = await schoolClass();
        const groups = [
          await kit.classes.group(north, northYear, subject, [classId]),
          await kit.classes.group(north, northYear, subject, [classId]),
          await kit.classes.group(north, northYear, subject, [classId]),
        ] as const;
        const rowA = await insertRow(part(groups[0], { lessons_per_week: 3 }));
        const rowB = await insertRow(part(groups[1], { teacher_id: second, lessons_per_week: 3 }));
        const edit = async (transaction: Transaction) => {
          for (const id of [rowA, rowB]) {
            await transaction
              .updateTable('teaching_load_rows')
              .set({ lessons_per_week: 4 })
              .where('id', '=', id)
              .execute();
          }
        };
        const insert = insertPart(part(groups[2], { teacher_id: third, lessons_per_week: 3 }));
        const [held, other] = order === 'edit held' ? [edit, insert] : [insert, edit];
        expect(await race(held, other), order).toEqual({
          held: 'load_block_lessons',
          other: 'written',
        });
      }
    });

    it('refuses the second of two parts with one teacher to commit', async () => {
      const [a = '', b = ''] = await split();
      expect(await race(insertPart(part(a)), insertPart(part(b)))).toEqual({
        held: 'load_block_teacher',
        other: 'written',
      });
    });
  });

  describe('teacher_load_elsewhere (decision 8, correction 1)', () => {
    /** A south class and a draft of the south holding a row of the teacher, then given `status`. */
    async function southRow(
      teacherId: string,
      input: { lessons: number; startsOn: string; status?: 'draft' | 'published' },
    ): Promise<string> {
      const classId = await kit.classes.schoolClass(south, southYear, { grade: 7, language: 'uz' });
      const southVersion = await kit.version(south, southYear, { startsOn: input.startsOn });
      await kit.row({
        branch_id: south,
        version_id: southVersion,
        class_id: classId,
        subject_id: subject,
        teacher_id: teacherId,
        lessons_per_week: input.lessons,
      });
      if (input.status === 'published') {
        await kit.setVersion(southVersion, 'published');
      }
      return southVersion;
    }

    /** A teacher of the north who also works in the south. */
    async function sharedTeacher(): Promise<string> {
      const id = await teacher();
      await database.migrator
        .insertInto('staff_branches')
        .values({ staff_id: id, branch_id: south, is_main: false })
        .execute();
      return id;
    }

    const elsewhere = (branches: string[], branchRef: string, ids: string[], day = STARTS_ON) =>
      transactions.run(
        branches,
        async (transaction) =>
          (
            await sql<{ teacher_id: string; branch_id: string; lessons: number; draft: boolean }>`
            select * from teacher_load_elsewhere(${branchRef}::uuid, ${sql.val(ids)}::uuid[], ${day}::date)
          `.execute(transaction)
          ).rows,
      );

    it('counts the published version in force in another branch, past the filter, counts only', async () => {
      const shared = await sharedTeacher();
      await southRow(shared, { lessons: 4, startsOn: '2026-10-12', status: 'published' });
      // A draft of the south does not count while a published version is in force.
      await southRow(shared, { lessons: 9, startsOn: '2026-10-19' });
      expect(await elsewhere([north], north, [shared])).toEqual([
        { teacher_id: shared, branch_id: south, lessons: 4, draft: false },
      ]);
    });

    it('counts the draft with the latest start on or before the day, else the earliest later one', async () => {
      const early = await sharedTeacher();
      const late = await sharedTeacher();
      // A branch of its own without a published version.
      const east = await insertBranch(database.migrator, 'Far east');
      const eastYear = await kit.classes.year(east);
      for (const id of [early, late]) {
        await database.migrator
          .insertInto('staff_branches')
          .values({ staff_id: id, branch_id: east, is_main: false })
          .execute();
      }
      const eastRow = async (teacherId: string, lessons: number, startsOn: string) => {
        const classId = await kit.classes.schoolClass(east, eastYear, { grade: 7, language: 'uz' });
        const eastVersion = await kit.version(east, eastYear, { startsOn });
        await kit.row({
          branch_id: east,
          version_id: eastVersion,
          class_id: classId,
          subject_id: subject,
          teacher_id: teacherId,
          lessons_per_week: lessons,
        });
      };
      await eastRow(early, 2, '2026-10-12');
      await eastRow(early, 5, '2026-10-16');
      await eastRow(early, 7, '2026-11-02');
      const found = await elsewhere([north], north, [early]);
      expect(found).toEqual([{ teacher_id: early, branch_id: east, lessons: 5, draft: true }]);
      // Only a later draft: it still counts, marked draft (correction 1).
      const lateOnly = await insertBranch(database.migrator, 'Far west');
      const westYear = await kit.classes.year(lateOnly);
      await database.migrator
        .insertInto('staff_branches')
        .values({ staff_id: late, branch_id: lateOnly, is_main: false })
        .execute();
      const westClass = await kit.classes.schoolClass(lateOnly, westYear, {
        grade: 7,
        language: 'uz',
      });
      const westVersion = await kit.version(lateOnly, westYear, { startsOn: '2026-11-02' });
      await kit.row({
        branch_id: lateOnly,
        version_id: westVersion,
        class_id: westClass,
        subject_id: subject,
        teacher_id: late,
        lessons_per_week: 6,
      });
      expect(await elsewhere([north], north, [late])).toEqual([
        { teacher_id: late, branch_id: lateOnly, lessons: 6, draft: true },
      ]);
    });

    it('refuses a branch outside the transaction and answers nothing for a record not linked to it', async () => {
      const shared = await sharedTeacher();
      await southRow(shared, { lessons: 4, startsOn: '2026-10-12', status: 'published' });
      expect(await refusal(elsewhere([north], south, [shared]))).toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'teacher_load_branch',
      });
      const southOnly = await teacher(south);
      await southRow(southOnly, { lessons: 3, startsOn: '2026-10-12', status: 'published' });
      expect(await elsewhere([north], north, [southOnly])).toEqual([]);
    });

    it('never counts the branch named as elsewhere, in a transaction of every branch', async () => {
      const shared = await sharedTeacher();
      await southRow(shared, { lessons: 4, startsOn: '2026-10-12', status: 'published' });
      const northVersion = await kit.version(north, northYear, { startsOn: '2026-10-12' });
      await kit.row({
        branch_id: north,
        version_id: northVersion,
        class_id: await schoolClass(),
        subject_id: subject,
        teacher_id: shared,
        lessons_per_week: 8,
      });
      await kit.setVersion(northVersion, 'published');
      expect(await elsewhere([north, south], north, [shared])).toEqual([
        { teacher_id: shared, branch_id: south, lessons: 4, draft: false },
      ]);
    });
  });
});
