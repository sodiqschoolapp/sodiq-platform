import {
  DOCUMENT_TYPES,
  REGIONS,
  SCHOLARSHIP_AMOUNT_MAX,
  SCHOLARSHIP_COVERAGES,
  SCHOLARSHIP_TYPES,
  SEXES,
  STUDENT_ADDRESS_MAX_LENGTH,
  STUDENT_NAME_MAX_LENGTH,
  STUDENT_STATUSES,
  CONTRACT_NUMBER_MAX_LENGTH,
  PREVIOUS_SCHOOL_MAX_LENGTH,
  studentNameKey,
} from '@sodiq/shared';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SystemClock } from '../../clock/system-clock.js';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { moveStudentBranch } from '../../testing/members-kit.js';
import { linkRelative } from '../../testing/relatives-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

const INSUFFICIENT_PRIVILEGE = '42501';
const CHECK_VIOLATION = '23514';
const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';
const EXCLUSION_VIOLATION = '23P01';

const HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2g';
const MOMENT = new Date('2026-10-12T09:00:00+05:00');

interface StudentInput {
  branch: string;
  uid: string;
  first?: string;
  last?: string;
  jshshir?: string | null;
  documentType?: string | null;
  documentNumber?: string | null;
  contract?: string;
  status?: string;
}

// The rules of student records that the database itself keeps (db/migrations/
// 0032), also when the application has a fault: a UID of seven digits that is
// never used twice across the school, whatever the holder's status, also once
// corrected away (edge/developer-rules, Identifiers; 04, UID sets; decision 7
// of pull request #67); JSHSHIR, the document number and the contract number
// unique across the school (edge/students-classes-groups; answer 22); the
// checks of what is typed; the branch filter; status rows that never overlap
// and only shrink; the student account switched off until Release 2; the
// move to another branch carried by the keys (decision 15). All names are
// invented.
describe('student records in the database', () => {
  let database: TestDatabase;
  let transactions: Transactions;
  let north: string;
  let south: string;
  let account: string;
  let count = 0;

  const inBranch = <T>(branch: string, work: (transaction: Transaction) => Promise<T>) =>
    transactions.run([branch], work);

  async function newId(transaction: Transaction): Promise<string> {
    const found = await sql<{ id: string }>`select uuidv7() as id`.execute(transaction);
    return found.rows[0]?.id ?? '';
  }

  /** The writes of a create, in the order of the service. */
  async function writeStudent(transaction: Transaction, input: StudentInput): Promise<string> {
    count += 1;
    const id = await newId(transaction);
    const first = input.first ?? 'Oʻtkir';
    const last = input.last ?? `Saidov${'a'.repeat(count % 5)}`;
    await transaction
      .insertInto('students')
      .values({
        id,
        branch_id: input.branch,
        uid: input.uid,
        first_name: first,
        last_name: last,
        name_key: studentNameKey(last, first),
        sex: 'male',
        birth_date: '2014-03-02',
        grade: 7,
        starts_on: '2026-09-02',
        jshshir: input.jshshir ?? null,
        document_type: input.documentType ?? null,
        document_number: input.documentNumber ?? null,
        created_by: account,
      })
      .execute();
    await transaction
      .insertInto('student_uids')
      .values({ uid: input.uid, student_id: id, branch_id: input.branch, held_from: MOMENT })
      .execute();
    await transaction
      .insertInto('student_contracts')
      .values({
        student_id: id,
        branch_id: input.branch,
        number: input.contract ?? `C-${String(count)}`,
        signed_on: '2026-08-20',
      })
      .execute();
    await transaction
      .insertInto('student_statuses')
      .values({
        student_id: id,
        branch_id: input.branch,
        status: 'active',
        valid_from: '2026-09-02',
        cause: 'start',
      })
      .execute();
    await transaction
      .insertInto('student_accounts')
      .values({ student_id: id, branch_id: input.branch, created_at: MOMENT })
      .execute();
    await linkRelative(transaction, id, input.branch, MOMENT);
    return id;
  }

  const createStudent = (input: StudentInput) =>
    inBranch(input.branch, (transaction) => writeStudent(transaction, input));

  /**
   * A student of another status, written by the migrator: the application
   * has no route to inactive or graduated before task 2.4b.
   */
  async function studentWithStatus(input: StudentInput & { status: string }): Promise<string> {
    const id = await createStudent(input);
    await database.migrator
      .updateTable('student_statuses')
      .set({ valid_until: '2026-10-01' })
      .where('student_id', '=', id)
      .execute();
    await database.migrator
      .insertInto('student_statuses')
      .values({
        student_id: id,
        branch_id: input.branch,
        status: input.status,
        valid_from: '2026-10-01',
        cause:
          input.status === 'graduated'
            ? 'graduation'
            : input.status === 'inactive'
              ? 'leaving'
              : 'start',
        reason: input.status === 'inactive' ? 'Moved away' : null,
      })
      .execute();
    return id;
  }

  beforeAll(async () => {
    database = await createTestDatabase();
    transactions = new Transactions(database.app, new SystemClock());
    north = await insertBranch(database.migrator, 'North');
    south = await insertBranch(database.migrator, 'South');
    account = (
      await database.migrator
        .insertInto('accounts')
        .values({
          login: 'a.karimova',
          password_hash: HASH,
          must_change_password: false,
          created_at: MOMENT,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
  });

  afterAll(async () => {
    await database.destroy();
  });

  describe('the UID (the done-when of task 2.4)', () => {
    it.each(['active', 'inactive', 'graduated'])(
      'refuses a UID held by a student who is %s, in the same branch and in another',
      async (status) => {
        const uid = `26070${String(10 + STUDENT_STATUSES.indexOf(status as never))}`;
        await studentWithStatus({ branch: north, uid, status });
        for (const branch of [north, south]) {
          await expect(createStudent({ branch, uid })).rejects.toMatchObject({
            code: UNIQUE_VIOLATION,
          });
        }
      },
    );

    it('refuses a UID once held by a student and corrected away, for good', async () => {
      const id = await createStudent({ branch: north, uid: '2607020' });
      await inBranch(north, async (transaction) => {
        await transaction
          .insertInto('student_uids')
          .values({ uid: '2607021', student_id: id, branch_id: north, held_from: MOMENT })
          .execute();
        await transaction
          .updateTable('students')
          .set({ uid: '2607021' })
          .where('id', '=', id)
          .execute();
      });
      await expect(createStudent({ branch: south, uid: '2607020' })).rejects.toMatchObject({
        code: UNIQUE_VIOLATION,
        constraint: 'student_uids_pkey',
      });
    });

    it('refuses a current UID that is not reserved for the student, at the commit', async () => {
      const id = await createStudent({ branch: north, uid: '2607030' });
      await expect(
        inBranch(north, (transaction) =>
          transaction
            .updateTable('students')
            .set({ uid: '2607031' })
            .where('id', '=', id)
            .execute(),
        ),
      ).rejects.toMatchObject({
        code: FOREIGN_KEY_VIOLATION,
        constraint: 'students_uid_held_fkey',
      });
      const other = await createStudent({ branch: north, uid: '2607032' });
      // Another student's reserved UID is not this one's either.
      await expect(
        inBranch(north, (transaction) =>
          transaction
            .updateTable('students')
            .set({ uid: '2607032' })
            .where('id', '=', id)
            .execute(),
        ),
      ).rejects.toMatchObject({ code: UNIQUE_VIOLATION, constraint: 'students_uid_idx' });
      expect(other).not.toBe(id);
    });

    it('keeps the start date and the branch: no update of either', async () => {
      const id = await createStudent({ branch: north, uid: '2607045' });
      await expect(
        inBranch(north, (transaction) =>
          transaction
            .updateTable('students')
            .set({ starts_on: '2026-09-15' })
            .where('id', '=', id)
            .execute(),
        ),
      ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
      // Task 3.3c (decision 4 of pull request #97, Look first): the branch
      // has an update grant, guarded: never without a move accepted in the
      // transaction (`students_branch_move`, 0053).
      await expect(
        transactions.run([north, south], (transaction) =>
          transaction
            .updateTable('students')
            .set({ branch_id: south })
            .where('id', '=', id)
            .execute(),
        ),
      ).rejects.toMatchObject({ constraint: 'students_branch_move' });
    });

    it('keeps a reserved UID: no update and no delete of student_uids', async () => {
      await createStudent({ branch: north, uid: '2607040' });
      await expect(
        inBranch(north, (transaction) =>
          transaction
            .updateTable('student_uids')
            .set({ uid: '2607041' })
            .where('uid', '=', '2607040')
            .execute(),
        ),
      ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
      await expect(
        inBranch(north, (transaction) =>
          transaction.deleteFrom('student_uids').where('uid', '=', '2607040').execute(),
        ),
      ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
    });

    it('wants seven digits', async () => {
      for (const uid of ['260700', '26070011', 'SI26070', '']) {
        await expect(createStudent({ branch: north, uid }), uid).rejects.toMatchObject({
          code: CHECK_VIOLATION,
        });
      }
    });
  });

  describe('the other values unique across the school', () => {
    it('refuses a JSHSHIR held in any branch', async () => {
      await createStudent({ branch: north, uid: '2607050', jshshir: '31403141234567' });
      await expect(
        createStudent({ branch: south, uid: '2607051', jshshir: '31403141234567' }),
      ).rejects.toMatchObject({ code: UNIQUE_VIOLATION, constraint: 'students_jshshir_idx' });
    });

    it('refuses a document number held in any branch, under any type', async () => {
      await createStudent({
        branch: north,
        uid: '2607060',
        documentType: 'passport',
        documentNumber: 'AA1234567',
      });
      await expect(
        createStudent({
          branch: south,
          uid: '2607061',
          documentType: 'id_card',
          documentNumber: 'AA1234567',
        }),
      ).rejects.toMatchObject({ code: UNIQUE_VIOLATION, constraint: 'students_document_idx' });
    });

    it('refuses a contract number that differs in case only (answer 22)', async () => {
      await createStudent({ branch: north, uid: '2607070', contract: 'SQ-2026/070' });
      await expect(
        createStudent({ branch: south, uid: '2607071', contract: 'sq-2026/070' }),
      ).rejects.toMatchObject({
        code: UNIQUE_VIOLATION,
        constraint: 'student_contracts_number_idx',
      });
      // Outer spaces are not stored at all (the shared schema drops them).
      await expect(
        createStudent({ branch: south, uid: '2607072', contract: ' SQ-2026/071' }),
      ).rejects.toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'student_contracts_number_check',
      });
    });
  });

  describe('check what is typed', () => {
    async function definition(name: string): Promise<string> {
      return (
        (
          await sql<{ definition: string }>`
            select pg_get_constraintdef(oid) as definition from pg_constraint where conname = ${name}
          `.execute(database.migrator)
        ).rows[0]?.definition ?? ''
      );
    }

    const valuesOf = async (name: string): Promise<string[]> =>
      [...(await definition(name)).matchAll(/'([a-z_]+)'/g)].map((match) => match[1] ?? '');

    it('keep the lists and bounds equal to those of packages/shared', async () => {
      expect(await valuesOf('students_sex_check')).toEqual([...SEXES]);
      expect(await valuesOf('students_document_type_check')).toEqual([...DOCUMENT_TYPES]);
      expect(await valuesOf('students_region_check')).toEqual([...REGIONS]);
      expect(await valuesOf('students_scholarship_type_check')).toEqual([...SCHOLARSHIP_TYPES]);
      expect(await valuesOf('students_scholarship_coverage_check')).toEqual([
        ...SCHOLARSHIP_COVERAGES,
      ]);
      expect(await valuesOf('student_statuses_status_check')).toEqual([...STUDENT_STATUSES]);
      expect(await definition('students_address_check')).toContain(
        String(STUDENT_ADDRESS_MAX_LENGTH),
      );
      expect(await definition('students_previous_school_check')).toContain(
        String(PREVIOUS_SCHOOL_MAX_LENGTH),
      );
      expect(await definition('student_contracts_number_check')).toContain(
        String(CONTRACT_NUMBER_MAX_LENGTH),
      );
      expect(await definition('students_scholarship_amount_check')).toContain(
        String(SCHOLARSHIP_AMOUNT_MAX),
      );
      const nameValid = await sql<{ source: string }>`
        select prosrc as source from pg_proc where proname = 'student_name_valid'
      `.execute(database.migrator);
      expect(nameValid.rows[0]?.source).toContain(`<= ${String(STUDENT_NAME_MAX_LENGTH)}`);
    });

    const refusedUpdate = async (values: Record<string, unknown>) => {
      count += 1;
      const id = await createStudent({ branch: north, uid: String(2507000 + count) });
      return expect(
        inBranch(north, (transaction) =>
          transaction.updateTable('students').set(values).where('id', '=', id).execute(),
        ),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION });
    };

    it('refuses a name of two scripts, digits or an empty one', async () => {
      for (const first_name of ['Otkirов', 'Otkir2', '', ' Otkir']) {
        await refusedUpdate({ first_name });
      }
    });

    it('takes a Latin and a Cyrillic name', async () => {
      const id = await createStudent({
        branch: north,
        uid: '2507900',
        first: 'Ўткир',
        last: 'Саидов',
      });
      expect(id).not.toBe('');
      await createStudent({ branch: north, uid: '2507901', first: 'Gʻayrat', last: 'Qodirov' });
    });

    it('wants a document type and its number together', async () => {
      await refusedUpdate({ document_type: 'passport' });
      await refusedUpdate({ document_number: 'AA1234567' });
      await refusedUpdate({ document_type: 'passport', document_number: 'aa1234567' });
    });

    it('couples the scholarship type, coverage and amount (answer 21)', async () => {
      await refusedUpdate({ scholarship_type: 'merit' });
      await refusedUpdate({ scholarship_coverage: 'full' });
      await refusedUpdate({ scholarship_type: 'gift', scholarship_coverage: 'partial' });
      await refusedUpdate({
        scholarship_type: 'gift',
        scholarship_coverage: 'full',
        scholarship_amount: 100,
      });
      await refusedUpdate({
        scholarship_type: 'gift',
        scholarship_coverage: 'partial',
        scholarship_amount: 0,
      });
    });

    it('keeps the grade, the score, the JSHSHIR and the phone in shape', async () => {
      await refusedUpdate({ grade: 12 });
      await refusedUpdate({ grade: 0 });
      await refusedUpdate({ diagnostic_score: 101 });
      await refusedUpdate({ jshshir: '1234' });
      await refusedUpdate({ phone: '998901234567' });
      await refusedUpdate({ region: 'moscow' });
    });

    // Task 2.4b-2 (db/migrations/0035): a photo is a JPEG or PNG, its id and type together.
    it('couples the photo and its type, JPEG or PNG only', async () => {
      const photo = '0199a000-0000-7000-8000-0000000000bb';
      await refusedUpdate({ photo_id: photo });
      await refusedUpdate({ photo_type: 'image/jpeg' });
      await refusedUpdate({ photo_id: photo, photo_type: 'image/gif' });
      const id = await createStudent({ branch: north, uid: '2308977' });
      await inBranch(north, (transaction) =>
        transaction
          .updateTable('students')
          .set({ photo_id: photo, photo_type: 'image/png' })
          .where('id', '=', id)
          .execute(),
      );
      const stored = await database.migrator
        .selectFrom('students')
        .select(['photo_id', 'photo_type'])
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      expect(stored).toEqual({ photo_id: photo, photo_type: 'image/png' });
    });

    // The update grant covers the two columns; a photo is never written at create.
    it('lets the application write no photo at create', async () => {
      await expect(
        inBranch(north, (transaction) =>
          transaction
            .insertInto('students')
            .values({
              branch_id: north,
              photo_id: '0199a000-0000-7000-8000-0000000000cc',
              photo_type: 'image/png',
            } as never)
            .execute(),
        ),
      ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
    });
  });

  describe('the branch filter', () => {
    it('shows each table of a student only in its branch', async () => {
      const id = await createStudent({ branch: north, uid: '2607080' });
      for (const [branch, expected] of [
        [north, 1],
        [south, 0],
      ] as const) {
        const counts = await inBranch(branch, async (transaction) => [
          (await transaction.selectFrom('students').select('id').where('id', '=', id).execute())
            .length,
          (
            await transaction
              .selectFrom('student_uids')
              .select('uid')
              .where('student_id', '=', id)
              .execute()
          ).length,
          (
            await transaction
              .selectFrom('student_contracts')
              .select('id')
              .where('student_id', '=', id)
              .execute()
          ).length,
          (
            await transaction
              .selectFrom('student_statuses')
              .select('id')
              .where('student_id', '=', id)
              .execute()
          ).length,
          (
            await transaction
              .selectFrom('student_accounts')
              .select('student_id')
              .where('student_id', '=', id)
              .execute()
          ).length,
        ]);
        expect(counts).toEqual([expected, expected, expected, expected, expected]);
      }
    });

    it('refuses a student written into another branch than the transaction', async () => {
      await expect(
        inBranch(south, (transaction) =>
          writeStudent(transaction, { branch: north, uid: '2607081' }),
        ),
      ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
    });

    it('carries the rows of a student when its branch changes (the move of task 3.3)', async () => {
      const id = await createStudent({ branch: north, uid: '2607082' });
      // Task 3.3c: the branch changes only with an accepted move (0053).
      await moveStudentBranch(database.migrator, id, north, south);
      for (const table of [
        'student_uids',
        'student_contracts',
        'student_statuses',
        'student_accounts',
      ] as const) {
        const rows = await database.migrator
          .selectFrom(table)
          .select('branch_id')
          .where('student_id', '=', id)
          .execute();
        expect(
          rows.map((row) => row.branch_id),
          table,
        ).toEqual(rows.map(() => south));
      }
    });

    // Task 3.3c (decision 4 of pull request #97, Look first): the right is
    // granted on the column alone and guarded by `students_branch_move`.
    it('lets the application change the branch of a student only with a move accepted in the transaction', async () => {
      const id = await createStudent({ branch: north, uid: '2607083' });
      await expect(
        transactions.run([north, south], (transaction) =>
          transaction
            .updateTable('students')
            .set({ branch_id: south })
            .where('id', '=', id)
            .execute(),
        ),
      ).rejects.toMatchObject({ constraint: 'students_branch_move' });
    });
  });

  describe('history and the account', () => {
    // The student itself is deleted only through `students_delete_guard` (task
    // 2.4b-1, decision 4); its rows go with it (`student-leaving.database.test.ts`).
    it('lets the application delete no UID, contract, status or account row', async () => {
      const id = await createStudent({ branch: north, uid: '2607090' });
      for (const table of [
        'student_uids',
        'student_contracts',
        'student_statuses',
        'student_accounts',
      ] as const) {
        await expect(
          inBranch(north, (transaction) =>
            transaction.deleteFrom(table).where('student_id', '=', id).execute(),
          ),
          table,
        ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
      }
    });

    it('keeps status rows from overlapping and lets them only shrink', async () => {
      const id = await createStudent({ branch: north, uid: '2607091' });
      await expect(
        inBranch(north, (transaction) =>
          transaction
            .insertInto('student_statuses')
            .values({
              student_id: id,
              branch_id: north,
              status: 'inactive',
              valid_from: '2026-10-20',
              cause: 'leaving',
              reason: 'Moved away',
            })
            .execute(),
        ),
      ).rejects.toMatchObject({ code: EXCLUSION_VIOLATION });
      await inBranch(north, (transaction) =>
        transaction
          .updateTable('student_statuses')
          .set({ valid_until: '2026-10-20' })
          .where('student_id', '=', id)
          .execute(),
      );
      await expect(
        inBranch(north, (transaction) =>
          transaction
            .updateTable('student_statuses')
            .set({ valid_until: '2026-10-25' })
            .where('student_id', '=', id)
            .execute(),
        ),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: 'dated_rows_only_shrink' });
    });

    it('keeps the student account switched off until Release 2', async () => {
      const id = await createStudent({ branch: north, uid: '2607092' });
      await expect(
        database.migrator
          .updateTable('student_accounts')
          .set({ switched_on_at: MOMENT })
          .where('student_id', '=', id)
          .execute(),
      ).rejects.toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'student_accounts_switched_off_check',
      });
      await expect(
        inBranch(north, (transaction) =>
          transaction
            .updateTable('student_accounts')
            .set({ created_at: MOMENT })
            .where('student_id', '=', id)
            .execute(),
        ),
      ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
    });
  });

  describe('the duplicate warning across branches', () => {
    it('answers whether a student of another branch has the same folded name and birth date', async () => {
      await createStudent({ branch: south, uid: '2607100', first: 'Ўткир', last: 'Раҳимов' });
      const elsewhere = (branch: string, key: string, birth = '2014-03-02') =>
        inBranch(
          branch,
          async (transaction) =>
            (
              await sql<{ found: boolean }>`
              select student_duplicate_elsewhere(${key}, ${birth}::date) as found
            `.execute(transaction)
            ).rows[0]?.found,
        );
      const key = studentNameKey('Rahimov', "O'tkir");
      expect(await elsewhere(north, key)).toBe(true);
      expect(await elsewhere(south, key)).toBe(false);
      expect(await elsewhere(north, key, '2014-03-03')).toBe(false);
    });
  });
});
