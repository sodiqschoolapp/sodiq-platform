import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type {
  CommentHistory,
  CommentHistoryQuery,
  CommentSave,
  JournalComment,
} from '@sodiq/shared';
import { Transactions, transactionMoment, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import type { Access } from '../access/permission.guard.js';
import { Audit } from '../audit/audit.service.js';
import { branchOf } from '../classes/classes.service.js';
import { clockOf } from '../plans/plan-read.js';
import { notFound, refusingConstraints } from '../setup/setup-refusals.js';
import { ownerFactsOf } from '../timetable/journal-owners.js';
import { enterableLesson, entryAssignment, ownStaffOf } from './attendance-entry.js';
import { namedAccounts } from './cell-lines.query.js';
import { noticeLessonCorrection } from './corrections.js';
import { Notifications } from '../notifications/notifications.service.js';
import {
  LOCK_REFUSALS,
  correctorAssignment,
  decideWrite,
  writeAssignment,
  writeDetails,
  type WriteHow,
} from './edit-window.js';
import {
  COMMENT_COLUMNS,
  commentsAnswer,
  visibilityOf,
  type CommentRow,
} from './comments.query.js';
import { JournalGridReader } from './journal-grid.service.js';
import { journalRows, switchesIn } from './journal-grid.query.js';
import { ratingRightsOf, ratingRowOf } from './rating.js';
import { refuseOtherStudents } from './students-of-branch.js';

/**
 * Comments in the journal (task 8.2, pull request #218; `07`, Entering data,
 * Comments: "A comment can be attached to any attendance mark or score, and a
 * general note to a student for a lesson. Each comment is either 'staff only'
 * or 'visible to parents'"). One comment per target, written or cleared and
 * never deleted, with history (decision 10). Whoever may enter the target may
 * comment on it: the lesson's entry (6.3) for a mark, a number or a note, the
 * rating exam's rights for a rating entry.
 */

/** The keys of a stored comment's target. */
interface TargetKeys {
  readonly target: 'mark' | 'work' | 'note' | 'rating';
  readonly studentId: string;
  readonly lessonId: string | null;
  readonly workId: string | null;
  readonly ratingExamId: string | null;
}

@Injectable()
export class CommentsService {
  constructor(
    @Inject(Transactions) private readonly transactions: Transactions,
    @Inject(Audit) private readonly audit: Audit,
    @Inject(JournalGridReader) private readonly grids: JournalGridReader,
    @Inject(Notifications) private readonly notifications: Notifications,
  ) {}

  /** Writes or clears the comment of a target (decision 10). */
  save(access: Access, input: CommentSave, requestId: string): Promise<JournalComment> {
    const branchId = branchOf(access);
    // Two first comments on one target at one moment meet on its key: the second is stale.
    // The lesson refusals of `journal_comments_write` meet a save that the checks of
    // `targetOf` let through at the same moment (a membership or a cancel committed
    // meanwhile), with the codes of a cell (code review round 1, defect 1).
    return refusingConstraints(() => this.saveIn(access, branchId, input, requestId), {
      journal_comments_key: 'comment_stale',
      journal_cell_not_member: 'cell_closed',
      journal_cell_cancelled: 'lesson_cancelled_cell',
      ...LOCK_REFUSALS,
    });
  }

  private saveIn(
    access: Access,
    branchId: string,
    input: CommentSave,
    requestId: string,
  ): Promise<JournalComment> {
    return this.transactions.run(access.branchIds, async (transaction) => {
      const { keys, assignmentId, write } = await this.targetOf(
        transaction,
        access,
        branchId,
        input.on,
        input.correction,
      );
      const stored = await this.storedOf(transaction, keys, true);
      if ((stored?.version ?? null) !== input.version) {
        throw new ApiException('comment_stale', 409);
      }
      if (stored === undefined && input.body === null) throw notFound();
      if (
        stored !== undefined &&
        stored.body === input.body &&
        stored.visibility === input.visibility
      ) {
        return (await commentsAnswer(transaction, [stored]))[0] ?? notFoundOf();
      }
      if (stored === undefined) {
        const moment = await transactionMoment(transaction);
        await transaction
          .insertInto('journal_comments')
          .values({
            branch_id: branchId,
            student_id: keys.studentId,
            target: keys.target,
            lesson_id: keys.lessonId,
            work_id: keys.workId,
            rating_exam_id: keys.ratingExamId,
            body: input.body,
            visibility: input.visibility,
            version: 1,
            changed_by: access.accountId,
            changed_how: 'entry',
            changed_at: moment,
          })
          .execute();
      } else {
        await transaction
          .updateTable('journal_comments')
          .set({
            body: input.body,
            visibility: input.visibility,
            changed_by: access.accountId,
            changed_how: 'entry',
          })
          .where('id', '=', stored.id)
          .execute();
      }
      const saved = await this.storedOf(transaction, keys, false);
      if (saved === undefined) throw new Error('The comment was just written.');
      await this.audit.record(transaction, {
        branchId,
        actorId: access.accountId,
        personId: keys.studentId,
        assignmentId,
        action: 'journal.comment',
        record: { type: 'journal_comment', id: saved.id },
        oldValue: stored === undefined ? {} : { body: stored.body, visibility: stored.visibility },
        newValue: { body: input.body, visibility: input.visibility },
        details: {
          target: keys.target,
          studentId: keys.studentId,
          ...(keys.lessonId === null ? {} : { lessonId: keys.lessonId }),
          ...(keys.workId === null ? {} : { workId: keys.workId }),
          ...(keys.ratingExamId === null ? {} : { ratingExamId: keys.ratingExamId }),
          ...writeDetails(write, input.correction),
        },
        requestId,
      });
      // Task 8.4 (decision 10): a corrected comment of a lesson is told to its teacher.
      if (input.correction !== undefined && keys.lessonId !== null) {
        await noticeLessonCorrection(transaction, this.notifications, {
          branchId,
          lessonId: keys.lessonId,
          correctorId: access.accountId,
          reason: input.correction.reason,
        });
      }
      return (await commentsAnswer(transaction, [saved]))[0] ?? notFoundOf();
    });
  }

  /** The history of one comment, with the reader's scope of its target. */
  history(access: Access, query: CommentHistoryQuery): Promise<CommentHistory> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      await refuseOtherStudents(transaction, [query.studentId]);
      let keys: Omit<TargetKeys, 'ratingExamId'> & { ratingExamId: string | null };
      if (query.target === 'rating') {
        if (query.journalId === undefined || query.quarterId === undefined) throw notFound();
        const [journal] = await journalRows(transaction, branchId, { journalId: query.journalId });
        if (journal === undefined || switchesIn(journal, query.quarterId) === undefined) {
          throw notFound();
        }
        const shows = await this.grids.ratingShownIn(
          transaction,
          access,
          branchId,
          query.journalId,
          query.quarterId,
          query.studentId,
        );
        if (!shows) throw new ApiException('journal_scope', 403);
        const row = await ratingRowOf(transaction, query.journalId, query.quarterId);
        if (row === null) return { lines: [] };
        keys = {
          target: 'rating',
          studentId: query.studentId,
          lessonId: null,
          workId: null,
          ratingExamId: row.id,
        };
      } else {
        if (query.lessonId === undefined) throw notFound();
        const lesson = await transaction
          .selectFrom('lessons')
          .select('id')
          .where('id', '=', query.lessonId)
          .where('branch_id', '=', branchId)
          .executeTakeFirst();
        if (lesson === undefined) throw notFound();
        if (query.target === 'work') {
          if (query.workId === undefined) throw notFound();
          // A work of that lesson only, as the save refuses another.
          const work = await transaction
            .selectFrom('journal_works')
            .select('id')
            .where('id', '=', query.workId)
            .where('lesson_id', '=', lesson.id)
            .executeTakeFirst();
          if (work === undefined) throw notFound();
        }
        const shape = await this.grids.cellShapeIn(
          transaction,
          access,
          branchId,
          lesson.id,
          query.studentId,
        );
        if (shape === null || (shape === 'attendance' && query.target !== 'mark')) {
          throw new ApiException('journal_scope', 403);
        }
        keys = {
          target: query.target,
          studentId: query.studentId,
          lessonId: lesson.id,
          workId: query.target === 'work' ? (query.workId ?? null) : null,
          ratingExamId: null,
        };
      }
      const stored = await this.storedOf(transaction, keys, false);
      if (stored === undefined) return { lines: [] };
      const rows = await transaction
        .selectFrom('journal_comment_history')
        .select([
          'version',
          'body_before',
          'body_after',
          'visibility_before',
          'visibility_after',
          'changed_by',
          'changed_how',
          'changed_at',
        ])
        .where('comment_id', '=', stored.id)
        .orderBy('changed_at')
        .orderBy('version')
        .execute();
      const names = await namedAccounts(
        transaction,
        rows.map((row) => row.changed_by),
      );
      return {
        lines: rows.map((row) => {
          const named = names.get(row.changed_by);
          return {
            version: row.version,
            bodyBefore: row.body_before,
            bodyAfter: row.body_after,
            visibilityBefore: visibilityOf(row.visibility_before),
            visibilityAfter: visibilityOf(row.visibility_after),
            changedBy: named?.name ?? named?.login ?? null,
            changedHow:
              row.changed_how === 'restored' || row.changed_how === 'forced_delete'
                ? row.changed_how
                : 'entry',
            changedAt: row.changed_at.toISOString(),
          };
        }),
      };
    });
  }

  /**
   * The target of a write, checked: the ids of the branch (404), who may enter
   * it (403 `comment_scope`), and a value on a mark, a number or a rating
   * entry (409 `comment_no_value`). The lesson is locked FOR SHARE by the
   * entry's check, as a save of its cells.
   */
  private async targetOf(
    transaction: Transaction,
    access: Access,
    branchId: string,
    on: CommentSave['on'],
    correction: CommentSave['correction'],
  ): Promise<{ keys: TargetKeys; assignmentId: string; write: WriteHow }> {
    await refuseOtherStudents(transaction, [on.studentId]);
    if (on.target === 'rating') {
      const [journal] = await journalRows(transaction, branchId, { journalId: on.journalId });
      if (journal === undefined || switchesIn(journal, on.quarterId) === undefined) {
        throw notFound();
      }
      // The subject has the rating exam in the quarter (spec review of the code, should-fix 4).
      if (switchesIn(journal, on.quarterId)?.ratingExam !== true) {
        throw new ApiException('rating_exam_off', 409);
      }
      const { today } = await clockOf(transaction, branchId);
      const facts = await ownerFactsOf(transaction, branchId, [
        {
          id: journal.id,
          academic_year_id: journal.academicYearId,
          class_id: journal.classId,
          group_id: journal.groupId,
          subject_id: journal.subjectId,
        },
      ]);
      const staffId = await ownStaffOf(transaction, access.accountId);
      const rights = ratingRightsOf(access, branchId, { journal, facts, staffId, today });
      const row = await ratingRowOf(transaction, journal.id, on.quarterId);
      const entry =
        row === null
          ? undefined
          : await transaction
              .selectFrom('journal_rating_entries')
              .select('kind')
              .where('rating_exam_id', '=', row.id)
              .where('student_id', '=', on.studentId)
              .executeTakeFirst();
      // Whoever may enter the entry (decision 10): "exempt" is the Academic Vice
      // Principal's, a score and "did not sit" the journal teacher's. Task 8.4: a
      // correction is the Academic Vice Principal's or the Super Admin's.
      if (correction !== undefined && correctorAssignment(access, branchId) === null) {
        throw new ApiException('journal_correction_role', 403);
      }
      const assignmentId =
        correction !== undefined
          ? correctorAssignment(access, branchId)
          : entry?.kind === 'exempt'
            ? rights.vicePrincipal
            : rights.teacher
              ? entryAssignment(access)
              : null;
      if (assignmentId === null) throw new ApiException('comment_scope', 403);
      if (row === null || entry?.kind == null) throw new ApiException('comment_no_value', 409);
      const write = await decideWrite(transaction, {
        access,
        branchId,
        target: { kind: 'rating', journalId: journal.id, quarterId: on.quarterId },
        staffId,
        correction,
      });
      return {
        write,
        keys: {
          target: 'rating',
          studentId: on.studentId,
          lessonId: null,
          workId: null,
          ratingExamId: row.id,
        },
        assignmentId,
      };
    }
    // The work named is checked against the branch before any refusal of scope
    // (`.claude/rules/api.md`).
    const work =
      on.target === 'work'
        ? await transaction
            .selectFrom('journal_works')
            .select(['id', 'lesson_id'])
            .where('id', '=', on.workId)
            .executeTakeFirst()
        : undefined;
    if (on.target === 'work' && work === undefined) throw notFound();
    let write: WriteHow;
    try {
      ({ write } = await enterableLesson(transaction, access, branchId, on.lessonId, {
        correction,
      }));
    } catch (error) {
      if (error instanceof ApiException && error.code === 'journal_entry_scope') {
        throw new ApiException('comment_scope', 403);
      }
      throw error;
    }
    if (work !== undefined && work.lesson_id !== on.lessonId) {
      throw new ApiException('work_not_in_lesson', 409);
    }
    if (on.target === 'note') {
      // The student is expected in the lesson, as for a cell (code review round 1,
      // defect 1): a note on a closed cell (a student who joined later or left
      // earlier) is refused, never a 500 from the trigger. A mark or a number
      // needs its value, and the trigger refuses one of a student no longer
      // expected, mapped in `save`.
      const { rows: expected } = await sql<{ expected: boolean }>`
        select lesson_student_expected(${on.lessonId}, ${on.studentId}) as expected
      `.execute(transaction);
      if (expected[0]?.expected !== true) throw new ApiException('cell_closed', 409);
    }
    if (on.target !== 'note') {
      const cell = await transaction
        .selectFrom('journal_cells')
        .select(['mark', 'score'])
        .where('lesson_id', '=', on.lessonId)
        .where('student_id', '=', on.studentId)
        .where((where) =>
          on.target === 'work' ? where('work_id', '=', on.workId) : where('work_id', 'is', null),
        )
        .executeTakeFirst();
      const value = on.target === 'work' ? cell?.score : cell?.mark;
      if (value == null) throw new ApiException('comment_no_value', 409);
    }
    return {
      keys: {
        target: on.target,
        studentId: on.studentId,
        lessonId: on.lessonId,
        workId: on.target === 'work' ? on.workId : null,
        ratingExamId: null,
      },
      assignmentId: writeAssignment(write, entryAssignment(access)),
      write,
    };
  }

  private async storedOf(
    transaction: Transaction,
    keys: TargetKeys,
    lock: boolean,
  ): Promise<CommentRow | undefined> {
    let query = transaction
      .selectFrom('journal_comments')
      .select(COMMENT_COLUMNS)
      .where('student_id', '=', keys.studentId)
      .where('target', '=', keys.target);
    query =
      keys.lessonId === null
        ? query.where('lesson_id', 'is', null)
        : query.where('lesson_id', '=', keys.lessonId);
    query =
      keys.workId === null
        ? query.where('work_id', 'is', null)
        : query.where('work_id', '=', keys.workId);
    query =
      keys.ratingExamId === null
        ? query.where('rating_exam_id', 'is', null)
        : query.where('rating_exam_id', '=', keys.ratingExamId);
    if (lock) query = query.forUpdate();
    return query.executeTakeFirst();
  }
}

function notFoundOf(): never {
  throw notFound();
}
