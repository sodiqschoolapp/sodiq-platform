import { Injectable } from '@nestjs/common';
import {
  PERMISSIONS,
  schoolDateOf,
  studentNameKey,
  uidOutsideSet,
  type DocumentType,
  type ErrorDetail,
  type Region,
  type SchoolDate,
  type ScholarshipCoverage,
  type ScholarshipType,
  type Sex,
  type StudentCheck,
  type StudentCheckResult,
  type StudentCreate,
  type StudentDetail,
  type StudentIdentity,
  type StudentList,
  type StudentListItem,
  type StudentRecord,
  type StudentStatus,
  type StudentUidCorrection,
} from '@sodiq/shared';
import { sql } from 'kysely';
import { transactionMoment, Transactions, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import { decide } from '../access/permission-check.js';
import type { Access } from '../access/permission.guard.js';
import { Audit } from '../audit/audit.service.js';
import { changesOf, notFound } from '../setup/setup-refusals.js';

const UNIQUE_VIOLATION = '23505';

/**
 * The unique indexes across the school (db/migrations/0032; decision 17 of
 * pull request #67) and the field each refuses. A UID once held is in
 * `student_uids` for good (decision 7), so its key refuses a UID too.
 */
const TAKEN_FIELDS: Readonly<
  Record<string, 'uid' | 'jshshir' | 'documentNumber' | 'contract.number'>
> = {
  students_uid_idx: 'uid',
  student_uids_pkey: 'uid',
  students_jshshir_idx: 'jshshir',
  students_document_idx: 'documentNumber',
  student_contracts_number_idx: 'contract.number',
};

/** A value refused as taken, with what the holder is looked up by. */
interface Taken {
  path: (typeof TAKEN_FIELDS)[string];
  value: string;
}

class TakenValue extends Error {
  constructor(readonly taken: Taken) {
    super('A value of the student is taken.');
  }
}

interface StudentRow {
  id: string;
  uid: string;
  first_name: string;
  last_name: string;
  paternal_name: string | null;
  sex: string;
  birth_date: string;
  grade: number;
  starts_on: string;
  document_type: string | null;
  document_number: string | null;
  jshshir: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  region: string | null;
  previous_school: string | null;
  diagnostic_score: number | null;
  scholarship_type: string;
  scholarship_coverage: string | null;
  scholarship_amount: number | null;
  consent_signed_on: string | null;
}

const STUDENT_COLUMNS = [
  'id',
  'uid',
  'first_name',
  'last_name',
  'paternal_name',
  'sex',
  'birth_date',
  'grade',
  'starts_on',
  'document_type',
  'document_number',
  'jshshir',
  'phone',
  'email',
  'address',
  'region',
  'previous_school',
  'diagnostic_score',
  'scholarship_type',
  'scholarship_coverage',
  'scholarship_amount',
  'consent_signed_on',
] as const;

/** The columns an edit writes, from what was typed. */
const columnsOf = (record: StudentRecord) => ({
  first_name: record.firstName,
  last_name: record.lastName,
  paternal_name: record.paternalName,
  name_key: studentNameKey(record.lastName, record.firstName),
  sex: record.sex,
  birth_date: record.birthDate,
  grade: record.grade,
  document_type: record.documentType,
  document_number: record.documentNumber,
  jshshir: record.jshshir,
  phone: record.phone,
  email: record.email,
  address: record.address,
  region: record.region,
  previous_school: record.previousSchool,
  diagnostic_score: record.diagnosticScore,
  scholarship_type: record.scholarship.type,
  scholarship_coverage: record.scholarship.coverage,
  scholarship_amount: record.scholarship.amount,
  consent_signed_on: record.consentSignedOn,
});

/** The fields of a stored record as the edit and the audit entries compare them. */
function fieldsOf(row: StudentRow, contract: { number: string; signed_on: string }): StudentRecord {
  return {
    firstName: row.first_name,
    lastName: row.last_name,
    paternalName: row.paternal_name,
    sex: row.sex as Sex,
    birthDate: row.birth_date,
    grade: row.grade,
    documentType: row.document_type as DocumentType | null,
    documentNumber: row.document_number,
    jshshir: row.jshshir,
    phone: row.phone,
    email: row.email,
    address: row.address,
    region: row.region as Region | null,
    previousSchool: row.previous_school,
    diagnosticScore: row.diagnostic_score,
    scholarship: {
      type: row.scholarship_type as ScholarshipType,
      coverage: row.scholarship_coverage as ScholarshipCoverage | null,
      amount: row.scholarship_amount,
    },
    consentSignedOn: row.consent_signed_on,
    contract: { number: contract.number, signedOn: contract.signed_on },
  };
}

function branchOf(access: Access): string {
  if (access.branchId === null) {
    throw new Error('A student route works for the branch of the request.');
  }
  return access.branchId;
}

const refused = (code: 'uid_set_mismatch' | 'no_academic_year'): ApiException =>
  new ApiException(code, 409);

/** The assignment that lets the account read a group of fields in the branch of the request. */
const readerOf = (access: Access, area: string): string | undefined =>
  decide(
    { area, action: 'view', branch: 'request' },
    access.assignments,
    access.branchId,
    PERMISSIONS,
  )?.id;

/** A current Principal assignment of the account in the branch of the request. */
const principalOf = (access: Access): string | undefined =>
  access.assignments.find(
    (assignment) => assignment.role === 'principal' && assignment.branchId === access.branchId,
  )?.id;

/**
 * Student records (docs/spec/04-people.md, Student record, UID sets; task
 * 2.4a, pull request #67). A student belongs to the branch of the request:
 * every route works in it, and another branch's student is 404. Reading a
 * student returns only the groups of fields its reader may see
 * (edge/people-roles-accounts, Personal data and the audit log; decisions 2
 * and 4), decided from every current assignment. Every change writes its audit
 * entry in its transaction. Lock order: the student, then its newest
 * contract.
 */
@Injectable()
export class Students {
  constructor(
    private readonly transactions: Transactions,
    private readonly audit: Audit,
  ) {}

  /** Today in the time zone of the branch, at the moment of the transaction. */
  private async todayIn(transaction: Transaction, branchId: string): Promise<SchoolDate> {
    const branch = await transaction
      .selectFrom('branches')
      .select('time_zone')
      .where('id', '=', branchId)
      .executeTakeFirstOrThrow();
    return schoolDateOf(await transactionMoment(transaction), branch.time_zone);
  }

  /** The students of the branch of the request: the Basic group and the status today. */
  list(access: Access): Promise<StudentList> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const today = await this.todayIn(transaction, branchId);
      const rows = await transaction
        .selectFrom('students')
        .leftJoin('student_statuses', (join) =>
          join
            .onRef('student_statuses.student_id', '=', 'students.id')
            .on('student_statuses.valid_from', '<=', today)
            .on((builder) =>
              builder.or([
                builder('student_statuses.valid_until', 'is', null),
                builder('student_statuses.valid_until', '>', today),
              ]),
            ),
        )
        .select([
          'students.id',
          'students.uid',
          'students.first_name',
          'students.last_name',
          'students.paternal_name',
          'students.sex',
          'students.grade',
          'students.starts_on',
          'student_statuses.status',
        ])
        .where('students.branch_id', '=', branchId)
        .orderBy('students.last_name')
        .orderBy('students.first_name')
        .orderBy('students.uid')
        .execute();
      const students: StudentListItem[] = rows.map((row) => ({
        id: row.id,
        uid: row.uid,
        firstName: row.first_name,
        lastName: row.last_name,
        paternalName: row.paternal_name,
        sex: row.sex as Sex,
        grade: row.grade,
        startsOn: row.starts_on,
        status: row.status as StudentStatus | null,
      }));
      return { students, today };
    });
  }

  /**
   * The duplicate warning (edge: "A matching name and date of birth, compared
   * after removing spelling differences, gives a warning that must be
   * confirmed, so twins pass"): the matches of the branch of the request by
   * name, of other branches only whether one exists (decision 3).
   */
  check(access: Access, input: StudentCheck): Promise<StudentCheckResult> {
    const branchId = branchOf(access);
    const nameKey = studentNameKey(input.lastName, input.firstName);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const today = await this.todayIn(transaction, branchId);
      let query = transaction
        .selectFrom('students')
        .leftJoin('student_statuses', (join) =>
          join
            .onRef('student_statuses.student_id', '=', 'students.id')
            .on('student_statuses.valid_from', '<=', today)
            .on((builder) =>
              builder.or([
                builder('student_statuses.valid_until', 'is', null),
                builder('student_statuses.valid_until', '>', today),
              ]),
            ),
        )
        .select([
          'students.id',
          'students.uid',
          'students.first_name',
          'students.last_name',
          'student_statuses.status',
        ])
        .where('students.name_key', '=', nameKey)
        .where('students.birth_date', '=', input.birthDate);
      if (input.studentId !== null) {
        query = query.where('students.id', '<>', input.studentId);
      }
      const rows = await query.orderBy('students.uid').execute();
      const elsewhere = await sql<{ found: boolean }>`
        select student_duplicate_elsewhere(${nameKey}, ${input.birthDate}::date) as found
      `.execute(transaction);
      return {
        sameNameAndBirth: rows.map((row) => ({
          id: row.id,
          uid: row.uid,
          firstName: row.first_name,
          lastName: row.last_name,
          status: row.status as StudentStatus | null,
        })),
        elsewhere: elsewhere.rows[0]?.found === true,
      };
    });
  }

  /**
   * A new student of the branch of the request (answer 17: the grade they
   * join and a start date). The UID is reserved in `student_uids` in the same
   * transaction (decision 7); the first contract, the first status row
   * (`active` from the start date) and the switched-off student account
   * (decision 9) are written with it.
   */
  create(access: Access, input: StudentCreate, requestId: string): Promise<StudentDetail> {
    const branchId = branchOf(access);
    return this.refusingTaken(access, () =>
      this.transactions.run(access.branchIds, async (transaction) => {
        await this.checkSet(transaction, branchId, input.uid, input.grade, input.startsOn, input);
        const moment = await transactionMoment(transaction);
        const found = await sql<{ id: string }>`select uuidv7() as id`.execute(transaction);
        const id = found.rows[0]?.id;
        if (id === undefined) {
          throw new Error('No id for the new student.');
        }
        await this.inserting(
          { uid: input.uid, jshshir: input.jshshir, documentNumber: input.documentNumber },
          () =>
            transaction
              .insertInto('students')
              .values({
                id,
                branch_id: branchId,
                uid: input.uid,
                starts_on: input.startsOn,
                created_by: access.accountId,
                ...columnsOf(input),
              })
              .execute(),
        );
        await this.inserting({ uid: input.uid }, () =>
          transaction
            .insertInto('student_uids')
            .values({ uid: input.uid, student_id: id, branch_id: branchId, held_from: moment })
            .execute(),
        );
        await this.inserting({ 'contract.number': input.contract.number }, () =>
          transaction
            .insertInto('student_contracts')
            .values({
              student_id: id,
              branch_id: branchId,
              number: input.contract.number,
              signed_on: input.contract.signedOn,
            })
            .execute(),
        );
        await transaction
          .insertInto('student_statuses')
          .values({
            student_id: id,
            branch_id: branchId,
            status: 'active',
            valid_from: input.startsOn,
          })
          .execute();
        await transaction
          .insertInto('student_accounts')
          .values({ student_id: id, branch_id: branchId, created_at: moment })
          .execute();
        const { confirmUidSet: _confirmed, ...record } = input;
        await this.audit.record(transaction, {
          branchId,
          actorId: access.accountId,
          assignmentId: access.assignmentId,
          action: 'student.create',
          record: { type: 'student', id },
          newValue: record,
          requestId,
        });
        return this.readDetail(transaction, access, id);
      }),
    );
  }

  /** One student of the branch of the request, with the groups its reader may see. */
  detail(access: Access, id: string): Promise<StudentDetail> {
    this.refuseTutorOnly(access);
    return this.transactions.run(access.branchIds, (transaction) =>
      this.readDetail(transaction, access, id),
    );
  }

  /**
   * Changes every field but the UID and the start date; the newest contract
   * is corrected in place (2.4b adds a contract on a return).
   */
  edit(
    access: Access,
    id: string,
    record: StudentRecord,
    requestId: string,
  ): Promise<StudentDetail> {
    const branchId = branchOf(access);
    return this.refusingTaken(access, () =>
      this.transactions.run(access.branchIds, async (transaction) => {
        const row = await this.lockStudent(transaction, id);
        const contract = await this.lockNewestContract(transaction, id);
        const before = fieldsOf(row, contract);
        const changes = changesOf({ ...before }, { ...record });
        if (changes === null) {
          return this.readDetail(transaction, access, id);
        }
        await this.inserting(
          { jshshir: record.jshshir, documentNumber: record.documentNumber },
          () =>
            transaction
              .updateTable('students')
              .set(columnsOf(record))
              .where('id', '=', id)
              .execute(),
        );
        if (
          contract.number !== record.contract.number ||
          contract.signed_on !== record.contract.signedOn
        ) {
          await this.inserting({ 'contract.number': record.contract.number }, () =>
            transaction
              .updateTable('student_contracts')
              .set({ number: record.contract.number, signed_on: record.contract.signedOn })
              .where('id', '=', contract.id)
              .execute(),
          );
        }
        await this.audit.record(transaction, {
          branchId,
          actorId: access.accountId,
          assignmentId: access.assignmentId,
          action: 'student.edit',
          record: { type: 'student', id },
          oldValue: changes.oldValue,
          newValue: changes.newValue,
          requestId,
        });
        return this.readDetail(transaction, access, id);
      }),
    );
  }

  /**
   * The correction of a mistyped UID with a reason (edge: "A mistyped UID can
   * be corrected by the Academic Vice Principal with a reason; the old value
   * stays in history"). The old UID stays reserved to the student in
   * `student_uids` (decision 7); a UID the student held before is taken back.
   */
  correctUid(
    access: Access,
    id: string,
    input: StudentUidCorrection,
    requestId: string,
  ): Promise<StudentDetail> {
    const branchId = branchOf(access);
    return this.refusingTaken(access, () =>
      this.transactions.run(access.branchIds, async (transaction) => {
        const row = await this.lockStudent(transaction, id);
        if (row.uid === input.uid) {
          return this.readDetail(transaction, access, id);
        }
        await this.checkSet(transaction, branchId, input.uid, row.grade, row.starts_on, input);
        const held = await transaction
          .selectFrom('student_uids')
          .select('uid')
          .where('uid', '=', input.uid)
          .where('student_id', '=', id)
          .executeTakeFirst();
        if (held === undefined) {
          const moment = await transactionMoment(transaction);
          await this.inserting({ uid: input.uid }, () =>
            transaction
              .insertInto('student_uids')
              .values({ uid: input.uid, student_id: id, branch_id: branchId, held_from: moment })
              .execute(),
          );
        }
        await this.inserting({ uid: input.uid }, () =>
          transaction
            .updateTable('students')
            .set({ uid: input.uid })
            .where('id', '=', id)
            .execute(),
        );
        await this.audit.record(transaction, {
          branchId,
          actorId: access.accountId,
          assignmentId: access.assignmentId,
          action: 'student.uid_corrected',
          record: { type: 'student', id },
          oldValue: { uid: row.uid },
          newValue: { uid: input.uid },
          reason: input.reason,
          requestId,
        });
        return this.readDetail(transaction, access, id);
      }),
    );
  }

  /**
   * The identity fields for a reader who sees them hidden, the Principal
   * (edge: "the Principal sees them hidden, with a logged show"). Every show
   * is an audit entry; a reader who sees them, or may not, is refused.
   */
  identity(access: Access, id: string, requestId: string): Promise<StudentIdentity> {
    const branchId = branchOf(access);
    const principal = principalOf(access);
    if (readerOf(access, 'student_identity') !== undefined || principal === undefined) {
      throw new ApiException('permission_denied', 403);
    }
    return this.transactions.run(access.branchIds, async (transaction) => {
      const row = await this.readStudent(transaction, id);
      await this.audit.record(transaction, {
        branchId,
        actorId: access.accountId,
        assignmentId: principal,
        action: 'student.identity_shown',
        record: { type: 'student', id },
        requestId,
      });
      return identityOf(row);
    });
  }

  // ---------------------------------------------------------------------------

  /**
   * A Tutor opens the profiles of their own class only (`02`), and no class
   * exists before task 3.1 (decision 6): a reader whose only permitting
   * assignments are Tutor ones is refused.
   */
  private refuseTutorOnly(access: Access): void {
    if (access.permitting.every((assignment) => assignment.role === 'tutor')) {
      throw new ApiException('permission_denied', 403);
    }
  }

  /**
   * The UID set warning (`04`, UID sets, Release 1; decision 5 as changed by
   * correction 2 of #67): the set of the grade in the academic year of the
   * branch that holds the start date, or the first that begins after it.
   */
  private async checkSet(
    transaction: Transaction,
    branchId: string,
    uid: string,
    grade: number,
    startsOn: SchoolDate,
    input: { confirmUidSet: boolean },
  ): Promise<void> {
    const year = await transaction
      .selectFrom('academic_years')
      .select('start_date')
      .where('branch_id', '=', branchId)
      .where('end_date', '>=', startsOn)
      .orderBy('start_date')
      .executeTakeFirst();
    if (year === undefined) {
      throw refused('no_academic_year');
    }
    if (!input.confirmUidSet && uidOutsideSet(uid, grade, Number(year.start_date.slice(0, 4)))) {
      throw refused('uid_set_mismatch');
    }
  }

  /**
   * Runs a write; a unique violation becomes `TakenValue` with the value that
   * was refused, so the holder can be looked up after the transaction ended.
   * The index that refused names the field; `values` gives the value written
   * for each field the write covers.
   */
  private async inserting<T>(
    values: Partial<Record<Taken['path'], string | null>>,
    work: () => Promise<T>,
  ): Promise<T> {
    try {
      return await work();
    } catch (error) {
      const failure = error as { code?: unknown; constraint?: unknown };
      const path =
        failure.code === UNIQUE_VIOLATION && typeof failure.constraint === 'string'
          ? TAKEN_FIELDS[failure.constraint]
          : undefined;
      if (path === undefined) {
        throw error;
      }
      throw new TakenValue({ path, value: values[path] ?? '' });
    }
  }

  /**
   * Turns a taken value into 409 `already_exists` naming the field. The holder
   * is looked up in a new transaction through the branch filter (correction
   * 6 of #67): a student of this branch is named by id (the screen opens it);
   * one of another branch is only said to exist (`held_elsewhere`, decision 3).
   */
  private async refusingTaken<T>(access: Access, work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (!(error instanceof TakenValue)) {
        throw error;
      }
      const { path, value } = error.taken;
      const holder =
        value === ''
          ? undefined
          : await this.transactions.run(access.branchIds, (transaction) =>
              this.holderOf(transaction, path, value),
            );
      const detail: ErrorDetail =
        holder === undefined
          ? { path, code: 'held_elsewhere', message: 'A student of another branch holds it.' }
          : { path, code: 'already_exists', message: 'A student holds it.', recordId: holder };
      throw new ApiException('already_exists', 409, undefined, [detail]);
    }
  }

  /** The id of the student of the branch of the transaction that holds a value, if any. */
  private async holderOf(
    transaction: Transaction,
    path: Taken['path'],
    value: string,
  ): Promise<string | undefined> {
    switch (path) {
      case 'uid':
        return (
          await transaction
            .selectFrom('student_uids')
            .select('student_id')
            .where('uid', '=', value)
            .executeTakeFirst()
        )?.student_id;
      case 'jshshir':
        return (
          await transaction
            .selectFrom('students')
            .select('id')
            .where('jshshir', '=', value)
            .executeTakeFirst()
        )?.id;
      case 'documentNumber':
        return (
          await transaction
            .selectFrom('students')
            .select('id')
            .where('document_number', '=', value)
            .executeTakeFirst()
        )?.id;
      case 'contract.number':
        return (
          await transaction
            .selectFrom('student_contracts')
            .select('student_id')
            .where(sql<boolean>`upper(number) = upper(${value})`)
            .executeTakeFirst()
        )?.student_id;
    }
  }

  private async readStudent(transaction: Transaction, id: string): Promise<StudentRow> {
    const row = await transaction
      .selectFrom('students')
      .select(STUDENT_COLUMNS)
      .where('id', '=', id)
      .executeTakeFirst();
    if (row === undefined) {
      throw notFound();
    }
    return row;
  }

  private async lockStudent(transaction: Transaction, id: string): Promise<StudentRow> {
    const row = await transaction
      .selectFrom('students')
      .select(STUDENT_COLUMNS)
      .where('id', '=', id)
      .forUpdate()
      .executeTakeFirst();
    if (row === undefined) {
      throw notFound();
    }
    return row;
  }

  private async lockNewestContract(
    transaction: Transaction,
    id: string,
  ): Promise<{ id: string; number: string; signed_on: string }> {
    return transaction
      .selectFrom('student_contracts')
      .select(['id', 'number', 'signed_on'])
      .where('student_id', '=', id)
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(1)
      .forUpdate()
      .executeTakeFirstOrThrow();
  }

  private async readDetail(
    transaction: Transaction,
    access: Access,
    id: string,
  ): Promise<StudentDetail> {
    const branchId = branchOf(access);
    const row = await this.readStudent(transaction, id);
    const today = await this.todayIn(transaction, branchId);
    const statuses = await transaction
      .selectFrom('student_statuses')
      .select(['status', 'valid_from', 'valid_until'])
      .where('student_id', '=', id)
      .whereRef('valid_from', '<', sql`coalesce(valid_until, 'infinity'::date)`)
      .orderBy('valid_from')
      .execute();
    const now = statuses.find(
      (status) =>
        status.valid_from <= today && (status.valid_until === null || status.valid_until > today),
    );
    const contact = readerOf(access, 'student_contact') !== undefined;
    const identity = readerOf(access, 'student_identity') !== undefined;
    const financial = readerOf(access, 'student_financial') !== undefined;
    const contracts = financial
      ? await transaction
          .selectFrom('student_contracts')
          .select(['id', 'number', 'signed_on'])
          .where('student_id', '=', id)
          .orderBy('created_at', 'desc')
          .orderBy('id', 'desc')
          .execute()
      : [];
    return {
      id: row.id,
      uid: row.uid,
      firstName: row.first_name,
      lastName: row.last_name,
      paternalName: row.paternal_name,
      sex: row.sex as Sex,
      grade: row.grade,
      startsOn: row.starts_on,
      status: (now?.status ?? null) as StudentStatus | null,
      contact: contact ? { phone: row.phone, email: row.email } : null,
      identity: identity ? identityOf(row) : null,
      identityHidden: !identity && principalOf(access) !== undefined,
      financial: financial
        ? {
            contracts: contracts.map((contract) => ({
              id: contract.id,
              number: contract.number,
              signedOn: contract.signed_on,
            })),
            scholarship: {
              type: row.scholarship_type as ScholarshipType,
              coverage: row.scholarship_coverage as ScholarshipCoverage | null,
              amount: row.scholarship_amount,
            },
            previousSchool: row.previous_school,
            diagnosticScore: row.diagnostic_score,
            consentSignedOn: row.consent_signed_on,
          }
        : null,
      statuses: statuses.map((status) => ({
        status: status.status as StudentStatus,
        from: status.valid_from,
        until: status.valid_until,
      })),
      canEdit:
        decide(
          { area: 'students', action: 'edit', branch: 'request' },
          access.assignments,
          access.branchId,
          PERMISSIONS,
        ) !== undefined,
      today,
    };
  }
}

function identityOf(row: StudentRow): StudentIdentity {
  return {
    birthDate: row.birth_date,
    documentType: row.document_type as DocumentType | null,
    documentNumber: row.document_number,
    jshshir: row.jshshir,
    address: row.address,
    region: row.region as Region | null,
  };
}
