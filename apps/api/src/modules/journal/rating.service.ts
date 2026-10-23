import { Inject, Injectable } from '@nestjs/common';
import type {
  RatingDate,
  RatingEntrySave,
  RatingEntryValue,
  RatingExam,
  RatingHistory,
} from '@sodiq/shared';
import { sql } from 'kysely';
import { Transactions, transactionMoment, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import type { Access } from '../access/permission.guard.js';
import { Audit } from '../audit/audit.service.js';
import { branchOf } from '../classes/classes.service.js';
import { clockOf } from '../plans/plan-read.js';
import { notFound, refusingConstraints } from '../setup/setup-refusals.js';
import { holdSubjectSwitches } from '../setup/subject-switches.js';
import { ownerFactsOf } from '../timetable/journal-owners.js';
import { entryAssignment, ownStaffOf } from './attendance-entry.js';
import { namedAccounts } from './cell-lines.query.js';
import { JournalGridReader } from './journal-grid.service.js';
import { journalRows, switchesIn, type JournalRow } from './journal-grid.query.js';
import {
  entryOf,
  ratingDateOf,
  ratingExamOf,
  ratingRightsOf,
  ratingRowOf,
  type RatingRights,
  type RatingRow,
} from './rating.js';
import { refuseOtherStudents } from './students-of-branch.js';

/**
 * The rating exam routes (task 8.2, pull request #218): the hand-set date,
 * "not held" and a student's entry, each audited in its transaction, with the
 * history the triggers of 0120 write. The database refuses what it can
 * itself (the switch, the date, "not held", the member, the reason); the
 * route refuses first with the same codes, and maps the database's refusals
 * to them (`.claude/rules/api.md`).
 */
const RATING_REFUSALS = {
  journal_rating_switch_off: 'rating_exam_off',
  journal_rating_no_date: 'rating_exam_no_date',
  journal_rating_not_yet: 'rating_exam_not_yet',
  journal_rating_not_held: 'rating_exam_not_held',
  journal_rating_not_member: 'rating_exam_not_member',
  journal_rating_reason: 'rating_exam_reason',
  journal_rating_date_quarter: 'rating_exam_date_quarter',
} as const;

interface Scene {
  readonly access: Access;
  readonly branchId: string;
  readonly journal: JournalRow;
  readonly quarterId: string;
  readonly today: string;
  readonly rights: RatingRights;
  readonly requestId: string;
}

const scopeRefusal = () => new ApiException('rating_exam_scope', 403);

const sameEntry = (a: RatingEntryValue | null, b: RatingEntryValue | null): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

@Injectable()
export class RatingService {
  constructor(
    @Inject(Transactions) private readonly transactions: Transactions,
    @Inject(Audit) private readonly audit: Audit,
    @Inject(JournalGridReader) private readonly grids: JournalGridReader,
  ) {}

  /** The hand-set date: the journal's teacher today or the Academic Vice Principal (decision 5). */
  setDate(
    access: Access,
    journalId: string,
    quarterId: string,
    input: RatingDate,
    requestId: string,
  ): Promise<RatingExam> {
    return this.write(access, journalId, quarterId, requestId, async (transaction, scene) => {
      if (!scene.rights.teacher && scene.rights.vicePrincipal === null) throw scopeRefusal();
      const { fromExam } = await ratingDateOf(transaction, journalId, quarterId);
      if (fromExam) throw new ApiException('rating_exam_linked', 409);
      const row = await this.lockedRow(transaction, scene);
      if (row.version !== input.version && !(row.fresh && input.version === null)) {
        throw new ApiException('rating_exam_stale', 409);
      }
      if (row.examDate === input.date) return;
      await transaction
        .updateTable('journal_rating_exams')
        .set({ exam_date: input.date, changed_by: scene.access.accountId })
        .where('id', '=', row.id)
        .execute();
      await this.audit.record(transaction, {
        branchId: scene.branchId,
        actorId: scene.access.accountId,
        assignmentId: scene.rights.teacher
          ? entryAssignment(scene.access)
          : (scene.rights.vicePrincipal ?? scene.access.assignmentId),
        action: 'journal.rating_date',
        record: { type: 'journal', id: journalId },
        oldValue: { date: row.examDate },
        newValue: { date: input.date },
        details: { quarterId },
        requestId,
      });
    });
  }

  /** "Not held" for the journal and quarter: the Academic Vice Principal (decision 7). */
  setNotHeld(
    access: Access,
    journalId: string,
    quarterId: string,
    input: {
      readonly notHeld: boolean;
      readonly version: number | null;
      readonly confirm: boolean;
    },
    requestId: string,
  ): Promise<RatingExam> {
    return this.write(access, journalId, quarterId, requestId, async (transaction, scene) => {
      const vicePrincipal = scene.rights.vicePrincipal;
      if (vicePrincipal === null) throw scopeRefusal();
      const row = await this.lockedRow(transaction, scene);
      if (row.version !== input.version && !(row.fresh && input.version === null)) {
        throw new ApiException('rating_exam_stale', 409);
      }
      if (row.notHeld === input.notHeld) return;
      if (input.notHeld && !input.confirm) {
        const counted = await transaction
          .selectFrom('journal_rating_entries')
          .select(sql<number>`count(*)::int`.as('count'))
          .where('rating_exam_id', '=', row.id)
          .where('kind', 'is not', null)
          .executeTakeFirstOrThrow();
        if (counted.count > 0) {
          throw new ApiException('rating_exam_entries', 409, undefined, [
            { path: 'notHeld', code: 'entries', message: 'Entries exist.', count: counted.count },
          ]);
        }
      }
      await transaction
        .updateTable('journal_rating_exams')
        .set({ not_held: input.notHeld, changed_by: scene.access.accountId })
        .where('id', '=', row.id)
        .execute();
      await this.audit.record(transaction, {
        branchId: scene.branchId,
        actorId: scene.access.accountId,
        assignmentId: vicePrincipal,
        action: 'journal.rating_not_held',
        record: { type: 'journal', id: journalId },
        oldValue: { notHeld: row.notHeld },
        newValue: { notHeld: input.notHeld },
        details: { quarterId },
        requestId,
      });
    });
  }

  /**
   * A student's entry (decisions 5, 8 and 9): a score or "did not sit" by the
   * journal's teacher today, "exempt" by the Academic Vice Principal; an entry
   * "exempt" is changed only by the Academic Vice Principal. From the date in
   * force; a write over an entry needs its reason.
   */
  saveEntry(
    access: Access,
    journalId: string,
    quarterId: string,
    input: RatingEntrySave,
    requestId: string,
  ): Promise<RatingExam> {
    return this.write(
      access,
      journalId,
      quarterId,
      requestId,
      async (transaction, scene) => {
        if (!scene.rights.teacher && scene.rights.vicePrincipal === null) throw scopeRefusal();
        const existing = await ratingRowOf(transaction, journalId, quarterId);
        const storedBefore =
          existing === null
            ? undefined
            : await transaction
                .selectFrom('journal_rating_entries')
                .select(['kind'])
                .where('rating_exam_id', '=', existing.id)
                .where('student_id', '=', input.studentId)
                .executeTakeFirst();
        const touchesExempt = input.entry?.kind === 'exempt' || storedBefore?.kind === 'exempt';
        const assignmentId = touchesExempt
          ? scene.rights.vicePrincipal
          : scene.rights.teacher
            ? entryAssignment(scene.access)
            : null;
        if (assignmentId === null) throw scopeRefusal();
        if (input.entry === null && existing === null) {
          if (input.version !== null) throw new ApiException('rating_exam_stale', 409);
          return;
        }
        const row = await this.lockedRow(transaction, scene);
        const stored = await transaction
          .selectFrom('journal_rating_entries')
          .select(['id', 'kind', 'score', 'version'])
          .where('rating_exam_id', '=', row.id)
          .where('student_id', '=', input.studentId)
          .forUpdate()
          .executeTakeFirst();
        if ((stored?.version ?? null) !== input.version) {
          throw new ApiException('rating_exam_stale', 409, undefined, [
            {
              path: 'version',
              code: 'stale',
              message: 'The entry was changed.',
              recordId: input.studentId,
              ...(stored === undefined
                ? {}
                : { storedRating: { entry: entryOf(stored), version: stored.version } }),
            },
          ]);
        }
        const before = stored === undefined ? null : entryOf(stored);
        if (sameEntry(before, input.entry)) return;
        if (stored !== undefined && input.reason === null) {
          throw new ApiException('rating_exam_reason', 409);
        }
        if (input.entry !== null) {
          if (row.notHeld) throw new ApiException('rating_exam_not_held', 409);
          const { date } = await ratingDateOf(transaction, journalId, quarterId);
          if (date === null) throw new ApiException('rating_exam_no_date', 409);
          if (scene.today < date) throw new ApiException('rating_exam_not_yet', 409);
        }
        const values = {
          kind: input.entry?.kind ?? null,
          score: input.entry?.kind === 'score' ? input.entry.score : null,
          reason: input.reason,
          changed_by: scene.access.accountId,
          changed_how: 'entry',
        };
        if (stored === undefined) {
          const moment = await transactionMoment(transaction);
          await transaction
            .insertInto('journal_rating_entries')
            .values({
              ...values,
              branch_id: scene.branchId,
              rating_exam_id: row.id,
              student_id: input.studentId,
              version: 1,
              changed_at: moment,
            })
            .execute();
        } else {
          await transaction
            .updateTable('journal_rating_entries')
            .set(values)
            .where('id', '=', stored.id)
            .execute();
        }
        await this.audit.record(transaction, {
          branchId: scene.branchId,
          actorId: scene.access.accountId,
          personId: input.studentId,
          assignmentId,
          action: 'journal.rating_entry',
          record: { type: 'journal', id: journalId },
          oldValue: { entry: before },
          newValue: { entry: input.entry, reason: input.reason },
          details: { quarterId, studentId: input.studentId },
          requestId,
        });
      },
      [input.studentId],
    );
  }

  /** The history of a student's entry and of the exam's date and "not held" (`07`: "Every cell keeps its history"). */
  history(
    access: Access,
    journalId: string,
    quarterId: string,
    studentId: string,
  ): Promise<RatingHistory> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const [journal] = await journalRows(transaction, branchId, { journalId });
      if (journal === undefined || switchesIn(journal, quarterId) === undefined) throw notFound();
      await refuseOtherStudents(transaction, [studentId]);
      const shows = await this.grids.ratingShownIn(
        transaction,
        access,
        branchId,
        journalId,
        quarterId,
        studentId,
      );
      if (!shows) throw new ApiException('journal_scope', 403);
      const rows = await transaction
        .selectFrom('journal_rating_history')
        .select([
          'student_id',
          'version',
          'kind_before',
          'kind_after',
          'score_before',
          'score_after',
          sql<string | null>`date_before::text`.as('date_before'),
          sql<string | null>`date_after::text`.as('date_after'),
          'not_held_before',
          'not_held_after',
          'reason',
          'changed_by',
          'changed_at',
        ])
        .where('journal_id', '=', journalId)
        .where('quarter_id', '=', quarterId)
        .where((where) =>
          where.or([where('student_id', '=', studentId), where('student_id', 'is', null)]),
        )
        .orderBy('changed_at')
        .orderBy('student_id', (order) => order.nullsFirst())
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
            kind: row.student_id === null ? ('exam' as const) : ('entry' as const),
            before: entryOf({ kind: row.kind_before, score: row.score_before }),
            after: entryOf({ kind: row.kind_after, score: row.score_after }),
            dateBefore: row.date_before,
            dateAfter: row.date_after,
            notHeldBefore: row.not_held_before,
            notHeldAfter: row.not_held_after,
            reason: row.reason,
            changedBy: named?.name ?? named?.login ?? null,
            changedAt: row.changed_at.toISOString(),
          };
        }),
      };
    });
  }

  /**
   * The frame of every write: the journal and quarter of the branch (404),
   * the ids of the body (404), the reader's rights, the subject row FOR SHARE
   * before the switch is read (item 8 of the plan), the quarter's switch, then
   * the work, and the rating exam as it stands after it.
   */
  private write(
    access: Access,
    journalId: string,
    quarterId: string,
    requestId: string,
    work: (transaction: Transaction, scene: Scene) => Promise<void>,
    studentIds: readonly string[] = [],
  ): Promise<RatingExam> {
    const branchId = branchOf(access);
    return refusingConstraints(
      () =>
        this.transactions.run(access.branchIds, async (transaction) => {
          const [unlocked] = await journalRows(transaction, branchId, { journalId });
          if (unlocked === undefined || switchesIn(unlocked, quarterId) === undefined) {
            throw notFound();
          }
          if (studentIds.length > 0) await refuseOtherStudents(transaction, studentIds);
          const { today } = await clockOf(transaction, branchId);
          const facts = await ownerFactsOf(transaction, branchId, [
            {
              id: unlocked.id,
              academic_year_id: unlocked.academicYearId,
              class_id: unlocked.classId,
              group_id: unlocked.groupId,
              subject_id: unlocked.subjectId,
            },
          ]);
          const staffId = await ownStaffOf(transaction, access.accountId);
          const rights = ratingRightsOf(access, branchId, {
            journal: unlocked,
            facts,
            staffId,
            today,
          });
          if (!rights.teacher && rights.vicePrincipal === null) throw scopeRefusal();
          await holdSubjectSwitches(transaction, unlocked.subjectId);
          const [journal] = await journalRows(transaction, branchId, { journalId });
          if (journal === undefined) throw notFound();
          if (switchesIn(journal, quarterId)?.ratingExam !== true) {
            throw new ApiException('rating_exam_off', 409);
          }
          const scene: Scene = { access, branchId, journal, quarterId, today, rights, requestId };
          await work(transaction, scene);
          const answer = await ratingExamOf(transaction, {
            journal,
            quarterId,
            rights,
            today,
            studentIds: null,
          });
          if (answer === null) throw new ApiException('rating_exam_off', 409);
          return answer;
        }),
      RATING_REFUSALS,
    );
  }

  /**
   * The rating exam row, locked FOR UPDATE; written at the first write (decision
   * 4). Two first writes at one moment meet on the unique key: the second
   * waits and then reads the row the first wrote.
   */
  private async lockedRow(
    transaction: Transaction,
    scene: Scene,
  ): Promise<RatingRow & { readonly fresh: boolean }> {
    const found = await ratingRowOf(transaction, scene.journal.id, scene.quarterId, 'update');
    if (found !== null) return { ...found, fresh: false };
    const moment = await transactionMoment(transaction);
    await transaction
      .insertInto('journal_rating_exams')
      .values({
        branch_id: scene.branchId,
        journal_id: scene.journal.id,
        quarter_id: scene.quarterId,
        version: 1,
        changed_by: scene.access.accountId,
        changed_at: moment,
      })
      .onConflict((conflict) =>
        conflict.columns(['branch_id', 'journal_id', 'quarter_id']).doNothing(),
      )
      .execute();
    const row = await ratingRowOf(transaction, scene.journal.id, scene.quarterId, 'update');
    if (row === null) throw new Error('The rating exam row was just written.');
    return { ...row, fresh: row.version === 1 && row.examDate === null && !row.notHeld };
  }
}
