import { Injectable, Logger } from '@nestjs/common';
import { Transactions, transactionMoment, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import type { Access } from '../access/permission.guard.js';

/**
 * The refusals of saves (task 8.9, pull request #227, decision 7;
 * `edge/journal`, "My grade disappeared": the support view "shows every save,
 * every refusal"). A save of attendance, numbers or a rating entry that the
 * route refuses (400, 403 or 409) writes one row per student of its body to
 * `journal_save_refusals` (0131), in a transaction of its own after the
 * refused one rolled back; then the refusal is answered unchanged. Nothing is
 * written for a lesson or journal outside the branch, or for a student who is
 * not the branch's (404: they name nothing the view can show), and a failure
 * to record never changes the answer.
 */

/** One value of the body: the student, the work or the plan's work, what was sent and on which version. */
export interface RefusedCell {
  studentId: string;
  workId?: string | null;
  planWorkId?: string | null;
  value: number | null;
  entryKind?: 'score' | 'did_not_sit' | 'exempt' | null;
  version: number | null;
}

export type RefusedSave =
  | { kind: 'attendance' | 'score'; lessonId: string; cells: readonly RefusedCell[] }
  | { kind: 'rating'; journalId: string; quarterId: string; cells: readonly RefusedCell[] };

/** The statuses of a refusal that is recorded. */
const RECORDED = new Set([400, 403, 409]);

@Injectable()
export class SaveRefusals {
  private readonly logger = new Logger('SaveRefusals');

  constructor(private readonly transactions: Transactions) {}

  /** Runs the save; a refusal of it is recorded, then thrown as it came. */
  async recorded<T>(
    access: Access,
    save: RefusedSave,
    requestId: string | undefined,
    work: () => Promise<T>,
  ): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof ApiException && RECORDED.has(error.getStatus())) {
        await this.record(access, save, error.code, requestId).catch((failure: unknown) => {
          this.logger.error(
            `A refusal could not be recorded: ${failure instanceof Error ? failure.message : 'unknown'}`,
          );
        });
      }
      throw error;
    }
  }

  private async journalOf(
    transaction: Transaction,
    branchId: string,
    lessonId: string,
  ): Promise<string | undefined> {
    const lesson = await transaction
      .selectFrom('lessons')
      .select(['class_id', 'group_id', 'subject_id'])
      .where('id', '=', lessonId)
      .where('branch_id', '=', branchId)
      .executeTakeFirst();
    if (lesson === undefined) return undefined;
    let journals = transaction
      .selectFrom('journals')
      .select('id')
      .where('branch_id', '=', branchId)
      .where('subject_id', '=', lesson.subject_id);
    journals =
      lesson.class_id === null
        ? journals.where('group_id', '=', lesson.group_id ?? '')
        : journals.where('class_id', '=', lesson.class_id);
    return (await journals.executeTakeFirst())?.id;
  }

  private async record(
    access: Access,
    save: RefusedSave,
    code: string,
    requestId: string | undefined,
  ): Promise<void> {
    const branchId = access.branchId;
    if (branchId === null) return;
    await this.transactions.run(access.branchIds, async (transaction) => {
      let journalId: string | undefined;
      if (save.kind === 'rating') {
        journalId = (
          await transaction
            .selectFrom('journals')
            .innerJoin('quarters', 'quarters.academic_year_id', 'journals.academic_year_id')
            .select('journals.id')
            .where('journals.id', '=', save.journalId)
            .where('journals.branch_id', '=', branchId)
            .where('quarters.id', '=', save.quarterId)
            .executeTakeFirst()
        )?.id;
      } else {
        journalId = await this.journalOf(transaction, branchId, save.lessonId);
      }
      if (journalId === undefined) return;
      const ids = [...new Set(save.cells.map((cell) => cell.studentId.toLowerCase()))];
      if (ids.length === 0) return;
      const students = new Set(
        (
          await transaction
            .selectFrom('students')
            .select('id')
            .where('id', 'in', ids)
            .where('branch_id', '=', branchId)
            .execute()
        ).map((row) => row.id.toLowerCase()),
      );
      const cells = save.cells.filter((cell) => students.has(cell.studentId.toLowerCase()));
      if (cells.length === 0) return;
      const moment = await transactionMoment(transaction);
      const found = journalId;
      await transaction
        .insertInto('journal_save_refusals')
        .values(
          cells.map((cell) => ({
            branch_id: branchId,
            journal_id: found,
            lesson_id: save.kind === 'rating' ? null : save.lessonId,
            quarter_id: save.kind === 'rating' ? save.quarterId : null,
            student_id: cell.studentId.toLowerCase(),
            work_id: save.kind === 'score' ? (cell.workId ?? null) : null,
            plan_work_id: save.kind === 'score' ? (cell.planWorkId ?? null) : null,
            kind: save.kind,
            value_sent: cell.value,
            entry_kind: save.kind === 'rating' ? (cell.entryKind ?? null) : null,
            version_sent: cell.version,
            code,
            account_id: access.accountId,
            // The trigger writes the transaction's moment over it.
            refused_at: moment,
            request_id: requestId ?? null,
          })),
        )
        .execute();
    });
  }
}
