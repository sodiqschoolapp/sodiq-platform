import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  PAST_MARK_PREVIEW_PAGE,
  pastMarkImportRowsSchema,
  type Language,
  type PastMarkConfirmResult,
  type PastMarkImportRow,
  type PastMarkPreview,
  type PastMarkPreviewRow,
  type PastMarkUploadList,
  type PastWorkKind,
} from '@sodiq/shared';
import { sql } from 'kysely';
import { transactionMoment, Transactions, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import type { UploadedFile } from '../../http/file-routes.js';
import { XlsxFile } from '../../http/xlsx.js';
import type { Access } from '../access/permission.guard.js';
import { Audit } from '../audit/audit.service.js';
import { namedAccounts } from '../journal/cell-lines.query.js';
import { loadCalendarSettings } from './calendar-state.js';
import {
  addPastMarkFileRepeats,
  parsePastMarkRow,
  readPastMarkWorkbook,
  type ParsedPastMarkRow,
  type PastMarkContext,
  type PastMarkMembership,
  type PastMarkStudent,
} from './past-mark-import-read.js';
import {
  PAST_MARK_TEMPLATE_ASCII_NAME,
  pastMarkTemplateFileName,
  writePastMarkTemplate,
} from './past-mark-import-template.js';
import { notFound } from './setup-refusals.js';

const DEADLOCK = '40P01';
const SERIALIZATION_FAILURE = '40001';
const UNIQUE_VIOLATION = '23505';

/** The rows of one insert: well below the 65,535 parameters of one statement. */
const INSERT_BATCH = 1000;

function branchOf(access: Access): string {
  if (access.branchId === null) {
    throw new Error('The import of past marks works for the branch of the request.');
  }
  return access.branchId;
}

/** The result of a run that is rolled back: thrown out of the transaction, caught outside. */
class RolledBack extends Error {
  constructor(readonly preview: PastMarkPreview) {
    super('The run is rolled back.');
  }
}

interface UploadRecord {
  id: string;
  branchId: string;
  fileName: string;
  fileSha256: string;
  rows: PastMarkImportRow[];
  confirmedAt: Date | null;
  withdrawnAt: Date | null;
}

interface RunResult {
  rows: ParsedPastMarkRow[];
  clean: boolean;
}

/**
 * The import of past marks from before go-live (task 11.26; `10`, Past marks from before
 * go-live, The upload and Withdrawal; `edge/academic-year`, Past marks from before go-live). An
 * upload is kept with its rows as read; the preview checks them and changes nothing; the confirm
 * checks everything again under the locks of the save and writes all rows or none. The marks go
 * to their own tables (`edge/developer-rules`, Past marks), never to lessons, cells or works.
 */
@Injectable()
export class PastMarks {
  constructor(
    private readonly transactions: Transactions,
    private readonly audit: Audit,
  ) {}

  /** The system's template in the language asked; not logged. */
  async template(language: Language): Promise<XlsxFile> {
    return new XlsxFile(
      pastMarkTemplateFileName(language),
      PAST_MARK_TEMPLATE_ASCII_NAME,
      [],
      await writePastMarkTemplate(language),
    );
  }

  /** Reads an upload, keeps its rows, and answers the first page of its preview. */
  async upload(
    access: Access,
    file: UploadedFile | null,
    fileName: string,
    requestId: string,
  ): Promise<PastMarkPreview> {
    if (file === null) {
      throw new ApiException('import_not_template', 422);
    }
    const branchId = branchOf(access);
    const rows = await readPastMarkWorkbook(file.bytes);
    const fileSha256 = createHash('sha256').update(file.bytes).digest('hex');
    const id = await this.transactions.run(access.branchIds, async (transaction) => {
      const moment = await transactionMoment(transaction);
      const inserted = await transaction
        .insertInto('past_mark_uploads')
        .values({
          branch_id: branchId,
          file_name: fileName,
          file_sha256: fileSha256,
          rows: JSON.stringify(rows),
          row_count: rows.length,
          uploaded_by: access.accountId,
          uploaded_at: moment,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await this.audit.record(transaction, {
        branchId,
        actorId: access.accountId,
        assignmentId: access.assignmentId,
        action: 'past_marks.upload',
        record: { type: 'past_mark_upload', id: inserted.id },
        details: { fileName, fileSha256, rowCount: rows.length },
        requestId,
      });
      return inserted.id;
    });
    return this.preview(access, id, 1);
  }

  /** One page of the preview of a kept upload; changes nothing. */
  async preview(access: Access, id: string, page: number): Promise<PastMarkPreview> {
    try {
      return await this.transactions.run(access.branchIds, async (transaction) => {
        const record = await this.readUpload(transaction, branchOf(access), id, false);
        const result = await this.run(transaction, record, false);
        return this.previewOf(transaction, record, result, page);
      });
    } catch (error) {
      if (conflicted(error)) {
        throw new ApiException('past_marks_changed', 409);
      }
      throw error;
    }
  }

  /** Saves every row in one transaction, or nothing (`10`: "saves all rows or none"). */
  async confirm(access: Access, id: string, requestId: string): Promise<PastMarkConfirmResult> {
    const branchId = branchOf(access);
    try {
      return await this.transactions.run(access.branchIds, async (transaction) => {
        const record = await this.readUpload(transaction, branchId, id, true);
        if (record.confirmedAt !== null) {
          throw new ApiException('import_already_done', 409);
        }
        // Two confirms of the branch meet here in order, so the second's checks read the first's
        // rows and answer a repeat as a problem of its row (`10`, The upload).
        await sql`select pg_advisory_xact_lock(hashtextextended(${`past_marks:${branchId}`}, 0))`.execute(
          transaction,
        );
        if ((await this.standingOn(transaction, record)) !== null) {
          throw new ApiException('import_already_done', 409);
        }
        const result = await this.run(transaction, record, true);
        if (!result.clean) {
          throw new RolledBack(await this.previewOf(transaction, record, result, 1));
        }
        const counts = await this.save(transaction, record, result.rows);
        const moment = await transactionMoment(transaction);
        await transaction
          .updateTable('past_mark_uploads')
          .set({ confirmed_by: access.accountId, confirmed_at: moment })
          .where('id', '=', id)
          .execute();
        await this.audit.record(transaction, {
          branchId,
          actorId: access.accountId,
          assignmentId: access.assignmentId,
          action: 'past_marks.confirm',
          record: { type: 'past_mark_upload', id },
          details: {
            fileName: record.fileName,
            fileSha256: record.fileSha256,
            rowCount: record.rows.length,
            attendance: counts.attendance,
            works: counts.works,
          },
          requestId,
        });
        return {
          outcome: 'saved' as const,
          rows: record.rows.length,
          attendance: counts.attendance,
          works: counts.works,
        };
      });
    } catch (error) {
      if (error instanceof RolledBack) {
        return { outcome: 'not_clean', preview: error.preview };
      }
      if (uniqueOn(error, 'past_mark_uploads_file_standing_idx')) {
        throw new ApiException('import_already_done', 409);
      }
      if (
        conflicted(error) ||
        uniqueOn(error, 'past_attendance_standing_idx') ||
        uniqueOn(error, 'past_works_standing_idx')
      ) {
        throw new ApiException('past_marks_changed', 409);
      }
      throw error;
    }
  }

  /** The confirmed uploads of the branch, newest first (`10`, The upload). */
  async list(access: Access): Promise<PastMarkUploadList> {
    return this.transactions.run(access.branchIds, async (transaction) => {
      const rows = await transaction
        .selectFrom('past_mark_uploads')
        .select([
          'id',
          'file_name',
          'row_count',
          'confirmed_by',
          'confirmed_at',
          'withdrawn_by',
          'withdrawn_at',
          'withdraw_reason',
        ])
        .where('branch_id', '=', branchOf(access))
        .where('confirmed_at', 'is not', null)
        .orderBy('confirmed_at', 'desc')
        .orderBy('id', 'desc')
        .execute();
      const named = await namedAccounts(
        transaction,
        rows.flatMap((row) => [row.confirmed_by, row.withdrawn_by]),
      );
      const nameOf = (id: string) => named.get(id) ?? { accountId: id, login: null, name: null };
      return {
        uploads: rows.flatMap((row) =>
          row.confirmed_by === null || row.confirmed_at === null
            ? []
            : [
                {
                  id: row.id,
                  fileName: row.file_name,
                  rowCount: row.row_count,
                  confirmedBy: nameOf(row.confirmed_by),
                  confirmedAt: new Date(row.confirmed_at).toISOString(),
                  withdrawn:
                    row.withdrawn_at === null ||
                    row.withdrawn_by === null ||
                    row.withdraw_reason === null
                      ? null
                      : {
                          by: nameOf(row.withdrawn_by),
                          at: new Date(row.withdrawn_at).toISOString(),
                          reason: row.withdraw_reason,
                        },
                },
              ],
        ),
      };
    });
  }

  /** Withdraws a whole upload with a reason; its rows are kept and marked (`10`, Withdrawal). */
  async withdraw(access: Access, id: string, reason: string, requestId: string): Promise<void> {
    const branchId = branchOf(access);
    await this.transactions.run(access.branchIds, async (transaction) => {
      const record = await this.readUpload(transaction, branchId, id, true);
      if (record.confirmedAt === null || record.withdrawnAt !== null) {
        throw new ApiException('past_marks_not_standing', 409);
      }
      const moment = await transactionMoment(transaction);
      await transaction
        .updateTable('past_mark_uploads')
        .set({ withdrawn_by: access.accountId, withdrawn_at: moment, withdraw_reason: reason })
        .where('id', '=', id)
        .execute();
      const attendance = await transaction
        .updateTable('past_attendance')
        .set({ withdrawn_at: moment })
        .where('upload_id', '=', id)
        .where('withdrawn_at', 'is', null)
        .executeTakeFirst();
      const works = await transaction
        .updateTable('past_works')
        .set({ withdrawn_at: moment })
        .where('upload_id', '=', id)
        .where('withdrawn_at', 'is', null)
        .executeTakeFirst();
      await this.audit.record(transaction, {
        branchId,
        actorId: access.accountId,
        assignmentId: access.assignmentId,
        action: 'past_marks.withdraw',
        record: { type: 'past_mark_upload', id },
        details: {
          fileName: record.fileName,
          reason,
          attendance: Number(attendance.numUpdatedRows),
          works: Number(works.numUpdatedRows),
        },
        requestId,
      });
    });
  }

  /** The upload of the branch of the request; another branch's or an unknown one is not found. */
  private async readUpload(
    transaction: Transaction,
    branchId: string,
    id: string,
    lock: boolean,
  ): Promise<UploadRecord> {
    let query = transaction
      .selectFrom('past_mark_uploads')
      .select([
        'id',
        'branch_id',
        'file_name',
        'file_sha256',
        'rows',
        'confirmed_at',
        'withdrawn_at',
      ])
      .where('id', '=', id)
      .where('branch_id', '=', branchId);
    if (lock) {
      query = query.forUpdate();
    }
    const row = await query.executeTakeFirst();
    if (row === undefined) {
      throw notFound();
    }
    return {
      id: row.id,
      branchId: row.branch_id,
      fileName: row.file_name,
      fileSha256: row.file_sha256,
      rows: pastMarkImportRowsSchema.parse(row.rows),
      confirmedAt: row.confirmed_at === null ? null : new Date(row.confirmed_at),
      withdrawnAt: row.withdrawn_at === null ? null : new Date(row.withdrawn_at),
    };
  }

  /** The day an upload of the same file that still stands was confirmed, in the branch's time zone. */
  private async standingOn(transaction: Transaction, record: UploadRecord): Promise<string | null> {
    const found = await transaction
      .selectFrom('past_mark_uploads')
      .innerJoin('branches', 'branches.id', 'past_mark_uploads.branch_id')
      .select(
        sql<string>`to_char(past_mark_uploads.confirmed_at at time zone branches.time_zone, 'YYYY-MM-DD')`.as(
          'day',
        ),
      )
      .where('past_mark_uploads.branch_id', '=', record.branchId)
      .where('past_mark_uploads.file_sha256', '=', record.fileSha256)
      .where('past_mark_uploads.confirmed_at', 'is not', null)
      .where('past_mark_uploads.withdrawn_at', 'is', null)
      .executeTakeFirst();
    return found?.day ?? null;
  }

  /**
   * What the rows are checked against. With `lock` (the confirm), the students named are taken
   * `for key share` before the branch row is taken `for share` (the go-live save takes it `for
   * update`), and everything is read after the locks, in statements of their own.
   */
  private async contextOf(
    transaction: Transaction,
    record: UploadRecord,
    lock: boolean,
  ): Promise<PastMarkContext> {
    const uids = [
      ...new Set(
        record.rows.flatMap((row) => (row.cells.uid === undefined ? [] : [row.cells.uid])),
      ),
    ];
    const students = await sql<{
      student_id: string;
      uid: string;
      last_name: string;
      first_name: string;
      home_branch_id: string;
      memberships: PastMarkMembership[];
    }>`select * from past_mark_students(${record.branchId}::uuid, ${uids}::text[], ${lock})`.execute(
      transaction,
    );
    let branchQuery = transaction
      .selectFrom('branches')
      .select(['go_live_date', 'working_weekdays'])
      .where('id', '=', record.branchId);
    if (lock) {
      branchQuery = branchQuery.forShare();
    }
    const branch = await branchQuery.executeTakeFirstOrThrow();
    const year =
      (await transaction
        .selectFrom('academic_years')
        .select(['id', 'start_date', 'end_date'])
        .where('branch_id', '=', record.branchId)
        .where('status', '=', 'current')
        .executeTakeFirst()) ?? null;
    const quarters =
      year === null
        ? []
        : await transaction
            .selectFrom('quarters')
            .select(['start_date', 'end_date'])
            .where('academic_year_id', '=', year.id)
            .where('start_date', 'is not', null)
            .execute();
    const subjects = await transaction
      .selectFrom('subjects')
      .select(['id', 'name_uz', 'name_ru', 'name_en', 'journal_type'])
      .where('archived_at', 'is', null)
      .execute();
    const studentMap = new Map<string, PastMarkStudent>();
    for (const row of students.rows) {
      studentMap.set(row.uid, {
        id: row.student_id,
        uid: row.uid,
        lastName: row.last_name,
        firstName: row.first_name,
        branchId: row.home_branch_id,
        memberships: row.memberships,
      });
    }
    return {
      branchId: record.branchId,
      goLiveDate: branch.go_live_date === null ? null : String(branch.go_live_date),
      year:
        year === null
          ? null
          : { id: year.id, startDate: String(year.start_date), endDate: String(year.end_date) },
      quarters: quarters.flatMap((one) =>
        one.start_date === null || one.end_date === null
          ? []
          : [{ startDate: String(one.start_date), endDate: String(one.end_date) }],
      ),
      calendar: await loadCalendarSettings(transaction, branch.working_weekdays),
      students: studentMap,
      subjects: subjects.map((one) => ({
        id: one.id,
        names: [one.name_uz, one.name_ru, one.name_en],
        attendanceOnly: one.journal_type === 'attendance_only',
      })),
    };
  }

  /** Checks every row: on its own, the repeats in the file, then the repeats across standing uploads. */
  private async run(
    transaction: Transaction,
    record: UploadRecord,
    lock: boolean,
  ): Promise<RunResult & { yearId: string | null }> {
    const context = await this.contextOf(transaction, record, lock);
    const rows = record.rows.map((row) => parsePastMarkRow(row, context));
    addPastMarkFileRepeats(rows);
    const studentIds = [...new Set([...context.students.values()].map((one) => one.id))];
    if (studentIds.length > 0) {
      const marks = await transaction
        .selectFrom('past_attendance')
        .select(['student_id', 'subject_id', 'school_date', 'lesson_number'])
        .where('student_id', 'in', studentIds)
        .where('withdrawn_at', 'is', null)
        .execute();
      const works = await transaction
        .selectFrom('past_works')
        .select(['student_id', 'subject_id', 'school_date', 'lesson_number', 'kind', 'title_key'])
        .where('student_id', 'in', studentIds)
        .where('withdrawn_at', 'is', null)
        .execute();
      const markKeys = new Set(
        marks.map((one) =>
          lessonKeyOf(one.student_id, one.subject_id, one.school_date, one.lesson_number),
        ),
      );
      const workKeys = new Set(
        works.map(
          (one) =>
            `${lessonKeyOf(one.student_id, one.subject_id, one.school_date, one.lesson_number)}|${one.kind}|${one.title_key ?? ''}`,
        ),
      );
      for (const row of rows) {
        if (row.lessonKey === null) continue;
        if (row.markRead && markKeys.has(row.lessonKey)) {
          row.problems.push({ column: 'attendance', code: 'attendance_already_imported' });
        }
        for (const work of row.worksRead) {
          if (workKeys.has(`${row.lessonKey}|${work.kind}|${work.titleKey}`)) {
            row.problems.push({
              column: work.kind === 'classwork' ? 'classworkTitle' : 'homeworkTitle',
              code: 'work_already_imported',
            });
          }
        }
        if (row.problems.length > 0) row.record = null;
      }
    }
    return {
      rows,
      clean: rows.every((row) => row.problems.length === 0),
      yearId: context.year?.id ?? null,
    };
  }

  /** One page of the preview: rows with problems first, each part in the file's order. */
  private async previewOf(
    transaction: Transaction,
    record: UploadRecord,
    result: RunResult,
    page: number,
  ): Promise<PastMarkPreview> {
    const shown: PastMarkPreviewRow[] = result.rows.map((row) => ({
      rowNumber: row.rowNumber,
      uid: row.shown.uid,
      name: row.shown.name,
      date: row.shown.date,
      subject: row.shown.subject,
      problems: row.problems,
    }));
    const ordered = [
      ...shown.filter((row) => row.problems.length > 0),
      ...shown.filter((row) => row.problems.length === 0),
    ];
    const withProblems = ordered.filter((row) => row.problems.length > 0).length;
    const pageCount = Math.max(1, Math.ceil(ordered.length / PAST_MARK_PREVIEW_PAGE));
    const at = Math.min(page, pageCount);
    return {
      importId: record.id,
      fileName: record.fileName,
      alreadyImportedOn: await this.standingOn(transaction, record),
      counts: {
        rows: ordered.length,
        withProblems,
        clean: ordered.length - withProblems,
      },
      page: at,
      pageCount,
      rows: ordered.slice((at - 1) * PAST_MARK_PREVIEW_PAGE, at * PAST_MARK_PREVIEW_PAGE),
      clean: result.clean,
    };
  }

  /** Writes the marks of clean rows, in batches; the works numbered within their lesson and kind. */
  private async save(
    transaction: Transaction,
    record: UploadRecord,
    rows: readonly ParsedPastMarkRow[],
  ): Promise<{ attendance: number; works: number }> {
    const year = await transaction
      .selectFrom('academic_years')
      .select('id')
      .where('branch_id', '=', record.branchId)
      .where('status', '=', 'current')
      .executeTakeFirstOrThrow();
    const attendance: {
      branch_id: string;
      upload_id: string;
      academic_year_id: string;
      student_id: string;
      subject_id: string;
      school_date: string;
      lesson_number: number;
      mark: number;
    }[] = [];
    const works: {
      branch_id: string;
      upload_id: string;
      academic_year_id: string;
      student_id: string;
      subject_id: string;
      school_date: string;
      lesson_number: number;
      kind: PastWorkKind;
      position: number;
      title: string;
      total: number;
      score: number;
    }[] = [];
    const positions = await this.standingPositions(transaction, rows);
    for (const row of rows) {
      const saved = row.record;
      if (saved === null || row.lessonKey === null) continue;
      const base = {
        branch_id: record.branchId,
        upload_id: record.id,
        academic_year_id: year.id,
        student_id: saved.studentId,
        subject_id: saved.subjectId,
        school_date: saved.date,
        lesson_number: saved.lesson,
      };
      if (saved.mark !== null) {
        attendance.push({ ...base, mark: saved.mark });
      }
      for (const work of saved.works) {
        const key = `${row.lessonKey}|${work.kind}`;
        const position = (positions.get(key) ?? 0) + 1;
        positions.set(key, position);
        works.push({
          ...base,
          kind: work.kind,
          position,
          title: work.title,
          total: work.total,
          score: work.score,
        });
      }
    }
    for (let at = 0; at < attendance.length; at += INSERT_BATCH) {
      await transaction
        .insertInto('past_attendance')
        .values(attendance.slice(at, at + INSERT_BATCH))
        .execute();
    }
    for (let at = 0; at < works.length; at += INSERT_BATCH) {
      await transaction
        .insertInto('past_works')
        .values(works.slice(at, at + INSERT_BATCH))
        .execute();
    }
    return { attendance: attendance.length, works: works.length };
  }

  /** The highest position of each lesson and kind among the works that stand, so a further upload goes on after them. */
  private async standingPositions(
    transaction: Transaction,
    rows: readonly ParsedPastMarkRow[],
  ): Promise<Map<string, number>> {
    const studentIds = [
      ...new Set(rows.flatMap((row) => (row.record === null ? [] : [row.record.studentId]))),
    ];
    if (studentIds.length === 0) return new Map();
    const found = await transaction
      .selectFrom('past_works')
      .select(['student_id', 'subject_id', 'school_date', 'lesson_number', 'kind'])
      .select((eb) => eb.fn.max('position').as('position'))
      .where('student_id', 'in', studentIds)
      .where('withdrawn_at', 'is', null)
      .groupBy(['student_id', 'subject_id', 'school_date', 'lesson_number', 'kind'])
      .execute();
    return new Map(
      found.map((one) => [
        `${lessonKeyOf(one.student_id, one.subject_id, one.school_date, one.lesson_number)}|${one.kind}`,
        Number(one.position),
      ]),
    );
  }
}

/** The key of a lesson before go-live, as the reader writes it. */
function lessonKeyOf(
  studentId: string,
  subjectId: string,
  date: string | Date,
  lesson: number,
): string {
  const day = typeof date === 'string' ? date : date.toISOString().slice(0, 10);
  return `${studentId}|${subjectId}|${day}|${String(lesson)}`;
}

/** A deadlock or a serialization failure: nothing was saved, try again. */
function conflicted(error: unknown): boolean {
  const failure = error as { code?: unknown };
  return failure.code === DEADLOCK || failure.code === SERIALIZATION_FAILURE;
}

/** A unique violation of the index named. */
function uniqueOn(error: unknown, constraint: string): boolean {
  const failure = error as { code?: unknown; constraint?: unknown };
  return failure.code === UNIQUE_VIOLATION && failure.constraint === constraint;
}
