import { Injectable, type OnModuleInit } from '@nestjs/common';
import {
  classDisplayName,
  forcedDeleteSchema,
  lessonHistorySchema,
  listName,
  type ErrorCode,
  type ForcedDelete,
  type ForcedDeleteBody,
  type ForcedLesson,
  type LessonHistory,
} from '@sodiq/shared';
import { sql } from 'kysely';
import { RequestKeys } from '../../database/request-keys.js';
import { Transactions, transactionMoment, type Transaction } from '../../database/transactions.js';
import type { JsonValue } from '../../database/types.generated.js';
import { ApiException } from '../../http/api-exception.js';
import type { Access } from '../access/permission.guard.js';
import { Audit } from '../audit/audit.service.js';
import {
  ForcedDeleteStore,
  type StoreDescription,
  type StoreRow,
} from '../audit/forced-deletes.service.js';
import { branchOf } from '../classes/classes.service.js';
import { Notifications } from '../notifications/notifications.service.js';
import { notFound } from '../setup/setup-refusals.js';
import { refuseBlocked } from './day-changes.service.js';
import { TimetablePattern } from './pattern.service.js';
import {
  PUBLISH_LOCK,
  PUBLISH_REFUSALS,
  lockPublishChain,
  refusingPublish,
} from './publish.service.js';
import { dayBeginnings } from './dated-check.js';
import { storedDayCheck, storedLessonsOn } from './stored-day.js';
import { endSubstitutionRows, lessonPlacesOf, placeOf } from './substitutions-read.js';
import { Timetable } from './timetable.service.js';
import { versionOnDate } from './version-on-date.js';
import { snapshotWeek } from './week-changes.js';

/**
 * The Super Admin's forced delete of a dated lesson and its restore (task
 * 5.8b, pull request #195; docs/spec/06-timetable.md, Protection: "Forced
 * delete is for Super Admin only, with a typed reason. The attendance and
 * marks are kept for 30 days and can be restored.").
 *
 * One lesson goes (decision 6): the other half of a double and the other
 * lessons of its block stay, and the block goes with its last lesson. The
 * rows that go with the lesson, or whose link to it becomes empty, are kept
 * in the store (`forced_deletes`, 0105) with the lesson. The database lets
 * the delete through only for a lesson that store row names, in this
 * transaction (`forced_delete_names`); the lesson history line comes from its
 * trigger (`lessons_history`).
 *
 * A restore (decisions 7 to 9) takes the same locks, reads every check after
 * them, and puts back the same ids and values: refused after its 30 days,
 * twice, in a closed year, when another version is in force on the date, when
 * an exam that cancelled the lesson no longer stands, and when the lesson,
 * not cancelled, breaks a rule (`storedDayCheck`, closures included, and the
 * constraints of 0058). A substitution of the lesson is recorded again for
 * the same record.
 */

/** What the store keeps of a lesson (`forced_deletes.rows`). */
export interface LessonRows {
  readonly lesson: {
    readonly id: string;
    readonly branch_id: string;
    readonly block_id: string;
    readonly lesson_date: string;
    readonly starts_at: string;
    readonly ends_at: string;
    readonly class_id: string | null;
    readonly group_id: string | null;
    readonly subject_id: string;
    readonly load_row_id: string;
    readonly pattern_entry_id: string;
    readonly teacher_id: string | null;
    readonly room_id: string | null;
    readonly cancel_cause: string | null;
    readonly cancel_reason: string | null;
  };
  /** The block when it went with its last lesson; `null` when it stayed. */
  readonly block: {
    readonly id: string;
    readonly branch_id: string;
    readonly academic_year_id: string;
    readonly quarter_id: string;
    readonly lesson_date: string;
    readonly starts_at: string;
    readonly ends_at: string;
    readonly version_id: string;
    readonly pattern_block_id: string;
    readonly double_pair_id: string | null;
  } | null;
  /** The block's year and version, kept whether or not it went. */
  readonly place: { readonly academicYearId: string; readonly versionId: string };
  readonly changedAt: string | null;
  readonly examCancels: readonly string[];
  readonly absenceTaught: { readonly recordedBy: string; readonly recordedAt: string } | null;
  readonly classOuts: readonly { readonly classId: string; readonly examId: string }[];
  readonly dayChanges: readonly string[];
  /** The bulk cancels whose choice named the block (`bulk_cancel_blocks`, keyed by bulk cancel and block). */
  readonly bulkCancelBlocks: readonly string[];
  readonly substitution: { readonly substitutionId: string; readonly relaxed: boolean } | null;
  /**
   * Task 6.1b-2: every journal cell of the lesson, empty ones too, as stored;
   * `changed_at` as PostgreSQL wrote it, to the microsecond, since 0111 holds
   * the delete and the restore to these exact rows. Absent from a store row of
   * 5.8b, read as none.
   */
  readonly cells?: readonly StoredCell[];
  /** Task 6.1b-2: every work of the lesson, as stored. */
  readonly works?: readonly StoredWork[];
}

/** A journal cell kept in the store (task 6.1b-2). */
export interface StoredCell {
  readonly id: string;
  readonly student_id: string;
  readonly work_id: string | null;
  readonly mark: number | null;
  readonly score: number | null;
  readonly version: number;
  readonly changed_by: string;
  readonly changed_how: string;
  readonly changed_at: string;
}

/**
 * A work kept in the store (task 6.1b-2). Task 8.1 (0119) adds its source,
 * plan link, place, carry, version and last change; a store row written
 * before has none of them.
 */
export interface StoredWork {
  readonly id: string;
  readonly kind: string;
  readonly total: number | null;
  readonly not_held: boolean;
  readonly source_lesson_id?: string | null;
  readonly plan_work_id?: string | null;
  readonly position?: number;
  readonly carried_from_lesson_id?: string | null;
  readonly version?: number;
  readonly changed_by?: string | null;
  readonly changed_how?: string;
  readonly changed_at?: string | null;
}

/** The constraints a restore meets after its check: the refusal its check would give. */
export const RESTORE_REFUSALS: Readonly<Record<string, ErrorCode>> = {
  ...PUBLISH_REFUSALS,
  time_claims_teacher_excl: 'forced_delete_restore_blocked',
  time_claims_room_excl: 'forced_delete_restore_blocked',
  time_claims_class_excl: 'forced_delete_restore_blocked',
  room_shared_full: 'forced_delete_restore_blocked',
  room_shared_capacity: 'forced_delete_restore_blocked',
  lesson_block_student_twice: 'forced_delete_restore_blocked',
  lesson_double_pair: 'forced_delete_restore_blocked',
  // The guards of a standing exam (0060) that the lesson put back meets: the
  // restored lesson breaks a rule, never "try again" (spec review of the code,
  // should-fix 4).
  exam_group_slots: 'forced_delete_restore_blocked',
  exam_incomplete: 'forced_delete_restore_blocked',
  lesson_block_class_out_exam: 'forced_delete_parent_changed',
  forced_delete_expired: 'forced_delete_expired',
  forced_delete_restored: 'forced_delete_restored',
};

const iso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

@Injectable()
export class LessonForcedDeletes implements OnModuleInit {
  constructor(
    private readonly transactions: Transactions,
    private readonly audit: Audit,
    private readonly requestKeys: RequestKeys,
    private readonly timetable: Timetable,
    private readonly pattern: TimetablePattern,
    private readonly notifications: Notifications,
    private readonly store: ForcedDeleteStore,
  ) {}

  onModuleInit(): void {
    this.store.register('lesson', {
      describe: (transaction, rows) => describeLessons(transaction, rows),
      restore: (transaction, access, row, requestId) =>
        this.restoreLocked(transaction, access, row, requestId),
      refusals: RESTORE_REFUSALS,
      busy: 'timetable_busy',
      lock: async (transaction, branchId, row) => {
        const yearId = (row.rows as unknown as LessonRows).place.academicYearId;
        await sql`select pg_advisory_xact_lock(${PUBLISH_LOCK})`.execute(transaction);
        await lockPublishChain(transaction, branchId, yearId);
        await refuseClosedYear(transaction, yearId);
      },
    });
  }

  /** The forced delete of one dated lesson with its reason, safe to repeat with its key. */
  forceDelete(
    access: Access,
    id: string,
    input: ForcedDeleteBody,
    key: string,
    requestId: string,
  ): Promise<ForcedDelete> {
    const branchId = branchOf(access);
    return refusingPublish(() =>
      this.transactions.run(access.branchIds, async (transaction) => {
        // The lesson of the branch first, so an unknown or foreign id never
        // waits on a publish; a repeat with the key finds it in the store.
        const found =
          (await transaction
            .selectFrom('lessons')
            .innerJoin('lesson_blocks', 'lesson_blocks.id', 'lessons.block_id')
            .select('lesson_blocks.academic_year_id')
            .where('lessons.id', '=', id)
            .where('lessons.branch_id', '=', branchId)
            .executeTakeFirst()) ??
          (await transaction
            .selectFrom('forced_deletes')
            .select(sql<string>`rows -> 'place' ->> 'academicYearId'`.as('academic_year_id'))
            .where('record_type', '=', 'lesson')
            .where('record_id', '=', id)
            .where('branch_id', '=', branchId)
            .orderBy('deleted_at', 'desc')
            .executeTakeFirst());
        if (found === undefined) {
          throw notFound();
        }
        await sql`select pg_advisory_xact_lock(${PUBLISH_LOCK})`.execute(transaction);
        const once = await this.requestKeys.runOnce(
          transaction,
          {
            key,
            scope: 'timetable.lesson_forced_delete',
            accountId: access.accountId,
            input: { lessonId: id, reason: input.reason },
          },
          async () =>
            (await this.deleteLocked(
              transaction,
              access,
              id,
              found.academic_year_id,
              input.reason,
              requestId,
            )) as unknown as JsonValue,
        );
        return forcedDeleteSchema.parse(once.result);
      }),
    );
  }

  private async deleteLocked(
    transaction: Transaction,
    access: Access,
    id: string,
    yearId: string,
    reason: string,
    requestId: string,
  ): Promise<ForcedDelete> {
    const branchId = branchOf(access);
    await lockPublishChain(transaction, branchId, yearId);
    await refuseClosedYear(transaction, yearId);
    const dated = await transaction
      .selectFrom('lessons')
      .select([sql<string>`lesson_date::text`.as('date'), 'room_id'])
      .where('id', '=', id)
      .where('branch_id', '=', branchId)
      .executeTakeFirst();
    if (dated === undefined) {
      throw notFound();
    }
    // The store row names the lesson's room, which no key holds once the
    // lesson is gone: the room is held until the commit, before the lessons,
    // so its forced delete (task 5.8c, pull request #196, database point 4)
    // waits and then finds the store row.
    if (dated.room_id !== null) {
      await transaction
        .selectFrom('rooms')
        .select('id')
        .where('id', '=', dated.room_id)
        .forKeyShare()
        .execute();
    }
    // The blocks and lessons of the date, locked in the writers' order.
    await snapshotWeek(transaction, branchId, dated.date, dated.date);
    const lesson = await transaction
      .selectFrom('lessons')
      .select([
        'id',
        'branch_id',
        'block_id',
        sql<string>`lesson_date::text`.as('lesson_date'),
        'starts_at',
        'ends_at',
        'class_id',
        'group_id',
        'subject_id',
        'load_row_id',
        'pattern_entry_id',
        'teacher_id',
        'room_id',
        'cancel_cause',
        'cancel_reason',
      ])
      .where('id', '=', id)
      .where('branch_id', '=', branchId)
      .executeTakeFirst();
    if (lesson === undefined) {
      throw notFound();
    }
    const block = await transaction
      .selectFrom('lesson_blocks')
      .select([
        'id',
        'branch_id',
        'academic_year_id',
        'quarter_id',
        sql<string>`lesson_date::text`.as('lesson_date'),
        'starts_at',
        'ends_at',
        'version_id',
        'pattern_block_id',
        'double_pair_id',
      ])
      .where('id', '=', lesson.block_id)
      .executeTakeFirstOrThrow();
    const others = await transaction
      .selectFrom('lessons')
      .select('id')
      .where('block_id', '=', block.id)
      .where('id', '<>', id)
      .execute();
    const blockGoes = others.length === 0;
    const [mark, examCancels, taught, classOuts, dayChanges, bulkBlocks] = await Promise.all([
      transaction
        .selectFrom('lesson_changes')
        .select('changed_at')
        .where('lesson_id', '=', id)
        .executeTakeFirst(),
      transaction
        .selectFrom('lesson_exam_cancels')
        .select('exam_id')
        .where('lesson_id', '=', id)
        .orderBy('exam_id')
        .execute(),
      transaction
        .selectFrom('lesson_absence_taught')
        .select(['recorded_by', 'recorded_at'])
        .where('lesson_id', '=', id)
        .executeTakeFirst(),
      blockGoes
        ? transaction
            .selectFrom('lesson_block_class_outs')
            .select(['class_id', 'exam_id'])
            .where('block_id', '=', block.id)
            .orderBy('class_id')
            .execute()
        : Promise.resolve([]),
      transaction
        .selectFrom('lesson_day_changes')
        .select('id')
        .where('lesson_id', '=', id)
        .orderBy('id')
        .execute(),
      blockGoes
        ? transaction
            .selectFrom('bulk_cancel_blocks')
            .select('bulk_cancel_id')
            .where('block_id', '=', block.id)
            .orderBy('bulk_cancel_id')
            .execute()
        : Promise.resolve([]),
    ]);
    // Task 6.1b-2: the lesson's cells and works, read after the lesson's lock
    // (`snapshotWeek`), which a save of cells waits for or has committed before.
    const [cells, works] = await Promise.all([
      transaction
        .selectFrom('journal_cells')
        .select([
          'id',
          'student_id',
          'work_id',
          'mark',
          'score',
          'version',
          'changed_by',
          'changed_how',
          sql<string>`changed_at::text`.as('changed_at'),
        ])
        .where('lesson_id', '=', id)
        .orderBy('id')
        .execute(),
      transaction
        .selectFrom('journal_works')
        .select([
          'id',
          'kind',
          'total',
          'not_held',
          'source_lesson_id',
          'plan_work_id',
          'position',
          'carried_from_lesson_id',
          'version',
          'changed_by',
          'changed_how',
          sql<string | null>`changed_at::text`.as('changed_at'),
        ])
        .where('lesson_id', '=', id)
        .orderBy('id')
        .execute(),
    ]);
    const moment = await transactionMoment(transaction);
    // A substitution in force of the lesson ends with its own cause (decision 9).
    const live = await transaction
      .selectFrom('substitution_lessons')
      .innerJoin('substitutions', 'substitutions.id', 'substitution_lessons.substitution_id')
      .select(['substitution_lessons.substitution_id', 'substitution_lessons.relaxed'])
      .where('substitution_lessons.lesson_id', '=', id)
      .where('substitution_lessons.ended_at', 'is', null)
      .where('substitutions.substitute_id', '=', lesson.teacher_id)
      .executeTakeFirst();
    await endSubstitutionRows(transaction, {
      lessonIds: [id],
      cause: 'forced_delete',
      accountId: access.accountId,
      moment,
    });
    const rows: LessonRows = {
      lesson: {
        ...lesson,
        starts_at: iso(lesson.starts_at),
        ends_at: iso(lesson.ends_at),
      },
      block: blockGoes
        ? { ...block, starts_at: iso(block.starts_at), ends_at: iso(block.ends_at) }
        : null,
      place: { academicYearId: block.academic_year_id, versionId: block.version_id },
      changedAt: mark === undefined ? null : iso(mark.changed_at),
      examCancels: examCancels.map((one) => one.exam_id),
      absenceTaught:
        taught === undefined
          ? null
          : { recordedBy: taught.recorded_by, recordedAt: iso(taught.recorded_at) },
      classOuts: classOuts.map((one) => ({ classId: one.class_id, examId: one.exam_id })),
      dayChanges: dayChanges.map((one) => one.id),
      bulkCancelBlocks: bulkBlocks.map((one) => one.bulk_cancel_id),
      substitution:
        live === undefined ? null : { substitutionId: live.substitution_id, relaxed: live.relaxed },
      cells,
      works,
    };
    const stored = await transaction
      .insertInto('forced_deletes')
      .values({
        branch_id: branchId,
        record_type: 'lesson',
        record_id: id,
        rows: JSON.stringify(rows),
        reason,
        deleted_by: access.accountId,
        // Overwritten by `forced_deletes_write` with the moment of the transaction.
        deleted_at: moment,
        restore_until: moment,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    // The rows whose key to the lesson or block has no action go first; the
    // cells and works only as the store row holds them (0111).
    await transaction.deleteFrom('journal_cells').where('lesson_id', '=', id).execute();
    await transaction.deleteFrom('journal_works').where('lesson_id', '=', id).execute();
    await transaction.deleteFrom('lesson_absence_taught').where('lesson_id', '=', id).execute();
    if (blockGoes) {
      await transaction
        .deleteFrom('lesson_block_class_outs')
        .where('block_id', '=', block.id)
        .execute();
    }
    await transaction.deleteFrom('lessons').where('id', '=', id).execute();
    if (blockGoes) {
      await transaction.deleteFrom('lesson_blocks').where('id', '=', block.id).execute();
    }
    const notices = {
      notified: await this.tell(
        transaction,
        access,
        branchId,
        lesson,
        'timetable.lesson_force_deleted',
      ),
    };
    await this.audit.record(transaction, {
      branchId,
      actorId: access.accountId,
      assignmentId: access.assignmentId,
      action: 'lesson.forced_delete',
      record: { type: 'lesson', id },
      oldValue: rows as unknown as JsonValue,
      newValue: { forcedDeleteId: stored.id, notices: { ...notices } },
      reason,
      requestId,
    });
    return this.store.answerOf(transaction, branchId, stored.id);
  }

  /**
   * The notice of a forced delete or a restore (task 5.8b;
   * edge/people-roles-accounts: "It notifies the branch's Academic Vice
   * Principal, the Principal and the teacher."): the Academic Vice Principals
   * and the Principals of the branch in force at the moment, and the
   * lesson's teacher with an account (never a vacancy), past lessons
   * included; the author left out. `assignments` has no row filter, so the
   * branch is named here. Answers the number of accounts told.
   */
  private async tell(
    transaction: Transaction,
    access: Access,
    branchId: string,
    lesson: {
      readonly teacher_id: string | null;
      readonly class_id: string | null;
      readonly group_id: string | null;
      readonly lesson_date: string;
      readonly starts_at: Date | string;
    },
    kind: 'timetable.lesson_force_deleted' | 'timetable.lesson_restored',
  ): Promise<number> {
    const moment = await transactionMoment(transaction);
    const leaders = await transaction
      .selectFrom('assignments')
      .select('account_id')
      .where('role', 'in', ['academic_vice_principal', 'principal'])
      .where('branch_id', '=', branchId)
      .where('valid_from', '<=', moment)
      .where((eb) => eb.or([eb('valid_until', 'is', null), eb('valid_until', '>', moment)]))
      .execute();
    const teacher =
      lesson.teacher_id === null
        ? undefined
        : await transaction
            .selectFrom('staff')
            .select(['kind', 'account_id'])
            .where('id', '=', lesson.teacher_id)
            .executeTakeFirst();
    const accountIds = [
      ...new Set([
        ...leaders.map((one) => one.account_id),
        ...(teacher === undefined || teacher.kind === 'vacancy' || teacher.account_id === null
          ? []
          : [teacher.account_id]),
      ]),
    ]
      .filter((one) => one !== access.accountId)
      .sort();
    if (accountIds.length === 0) return 0;
    const unit =
      lesson.class_id !== null
        ? await transaction
            .selectFrom('classes')
            .select(['grade', 'name'])
            .where('id', '=', lesson.class_id)
            .executeTakeFirstOrThrow()
            .then((one) => classDisplayName(one.grade, one.name))
        : await transaction
            .selectFrom('groups')
            .select('name')
            .where('id', '=', lesson.group_id ?? '')
            .executeTakeFirstOrThrow()
            .then((one) => one.name);
    const branch = await transaction
      .selectFrom('branches')
      .select('time_zone')
      .where('id', '=', branchId)
      .executeTakeFirstOrThrow();
    const start = new Intl.DateTimeFormat('en-GB', {
      timeZone: branch.time_zone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(lesson.starts_at));
    await this.notifications.send(transaction, {
      kind,
      data: { unit, date: lesson.lesson_date, start },
      branchId,
      accountIds,
    });
    return accountIds.length;
  }

  private async restoreLocked(
    transaction: Transaction,
    access: Access,
    row: StoreRow,
    requestId: string,
  ): Promise<void> {
    const branchId = branchOf(access);
    const rows = row.rows as unknown as LessonRows;
    const { lesson } = rows;
    await snapshotWeek(transaction, branchId, lesson.lesson_date, lesson.lesson_date);
    // Another version in force on the date, or the block taken by a publish (decision 7).
    const inForce =
      (await versionOnDate(transaction, branchId, rows.place.academicYearId, lesson.lesson_date))
        ?.id ?? null;
    const blockNow = await transaction
      .selectFrom('lesson_blocks')
      .select(['id', 'lesson_date', 'starts_at', 'ends_at', 'double_pair_id'])
      .where('id', '=', lesson.block_id)
      .executeTakeFirst();
    if (inForce !== rows.place.versionId || (rows.block !== null && blockNow !== undefined)) {
      throw new ApiException('forced_delete_version', 409);
    }
    // The block that stayed with the block's other lessons is gone since (they
    // went too, or a write of the date removed it): nothing to come back into.
    if (rows.block === null && blockNow === undefined) {
      throw new ApiException('forced_delete_block_gone', 409);
    }
    // The lesson's room deleted for good since (task 5.8c): its store row
    // refuses that while it can be restored, so this is the second line.
    if (lesson.room_id !== null) {
      const room = await transaction
        .selectFrom('rooms')
        .select('id')
        .where('id', '=', lesson.room_id)
        .forKeyShare()
        .executeTakeFirst();
      if (room === undefined) {
        throw new ApiException('forced_delete_parent_changed', 409, undefined, [
          {
            path: 'room',
            code: 'not_found',
            message: 'The room of the lesson was deleted for good since.',
          },
        ]);
      }
    }
    // A lesson comes back at its block's times: a block that stayed may have
    // been retimed since (a template or calendar change moves it in place).
    const placed =
      blockNow === undefined
        ? lesson
        : {
            ...lesson,
            lesson_date: blockNow.lesson_date,
            starts_at: blockNow.starts_at.toISOString(),
            ends_at: blockNow.ends_at.toISOString(),
          };
    if (placed.lesson_date !== lesson.lesson_date) {
      await snapshotWeek(transaction, branchId, placed.lesson_date, placed.lesson_date);
    }
    // An exam that cancelled the lesson must still stand (decision 9).
    const examIds = [...new Set([...rows.examCancels, ...rows.classOuts.map((one) => one.examId)])];
    if (examIds.length > 0) {
      const standing = await transaction
        .selectFrom('exams')
        .select('id')
        .where('id', 'in', examIds)
        .where('cancel_cause', 'is', null)
        .forShare()
        .execute();
      if (standing.length !== examIds.length) {
        throw new ApiException('forced_delete_parent_changed', 409, undefined, [
          {
            path: 'exams',
            code: 'exam_cancelled',
            message: 'An exam that cancelled the lesson was cancelled since.',
          },
        ]);
      }
    }
    // The substitution kept must still stand (decision 9): neither its absence
    // withdrawn nor another of its lessons given back since the delete, or the
    // lesson would come back with a substitute the school no longer has.
    if (rows.substitution !== null) {
      const parentChanged = (path: string, code: string, message: string) =>
        new ApiException('forced_delete_parent_changed', 409, undefined, [{ path, code, message }]);
      // A substitution never changes (no update grant), so it is read without
      // a lock; its absence and the rows of its lessons are held.
      const substitution = await transaction
        .selectFrom('substitutions')
        .select('absence_id')
        .where('id', '=', rows.substitution.substitutionId)
        .executeTakeFirstOrThrow();
      if (substitution.absence_id !== null) {
        const absence = await transaction
          .selectFrom('absences')
          .select('withdrawn_at')
          .where('id', '=', substitution.absence_id)
          .forShare()
          .executeTakeFirst();
        if (absence === undefined || absence.withdrawn_at !== null) {
          throw parentChanged(
            'absences',
            'absence_withdrawn',
            'The absence of the substitution was withdrawn since.',
          );
        }
      }
      const { deleted_at: deletedAt } = await transaction
        .selectFrom('forced_deletes')
        .select('deleted_at')
        .where('id', '=', row.id)
        .executeTakeFirstOrThrow();
      const lessonRows = await transaction
        .selectFrom('substitution_lessons')
        .select(['end_cause', 'ended_at'])
        .where('substitution_id', '=', rows.substitution.substitutionId)
        .forShare()
        .execute();
      const givenBack = lessonRows.some(
        (one) =>
          (one.end_cause === 'withdrawn' || one.end_cause === 'returned') &&
          one.ended_at !== null &&
          one.ended_at >= deletedAt,
      );
      if (givenBack) {
        throw parentChanged(
          'substitutions',
          'substitution_withdrawn',
          'The substitution was withdrawn from another of its lessons since.',
        );
      }
    }
    await refuseExamsMoved(
      transaction,
      rows,
      placed,
      rows.block?.double_pair_id ?? blockNow?.double_pair_id ?? null,
    );
    // The store row first: the database lets the same ids back in only then.
    await transaction
      .updateTable('forced_deletes')
      .set({ restored_by: access.accountId, restored_at: new Date(0) })
      .where('id', '=', row.id)
      .execute();
    if (rows.block !== null) {
      await transaction.insertInto('lesson_blocks').values(rows.block).execute();
    }
    await transaction.insertInto('lessons').values(placed).execute();
    if (rows.changedAt !== null) {
      await transaction
        .insertInto('lesson_changes')
        .values({ lesson_id: lesson.id, branch_id: branchId, changed_at: rows.changedAt })
        .execute();
    }
    if (rows.examCancels.length > 0) {
      await transaction
        .insertInto('lesson_exam_cancels')
        .values(
          rows.examCancels.map((examId) => ({
            branch_id: branchId,
            lesson_id: lesson.id,
            exam_id: examId,
          })),
        )
        .execute();
    }
    if (rows.absenceTaught !== null) {
      await transaction
        .insertInto('lesson_absence_taught')
        .values({
          branch_id: branchId,
          lesson_id: lesson.id,
          recorded_by: rows.absenceTaught.recordedBy,
          recorded_at: rows.absenceTaught.recordedAt,
        })
        .execute();
    }
    if (rows.block !== null && rows.classOuts.length > 0) {
      await transaction
        .insertInto('lesson_block_class_outs')
        .values(
          rows.classOuts.map((one) => ({
            branch_id: branchId,
            block_id: lesson.block_id,
            class_id: one.classId,
            exam_id: one.examId,
          })),
        )
        .execute();
    }
    if (rows.dayChanges.length > 0) {
      await transaction
        .updateTable('lesson_day_changes')
        .set({ lesson_id: lesson.id })
        .where('id', 'in', rows.dayChanges)
        .where('lesson_id', 'is', null)
        .execute();
    }
    if (rows.block !== null && rows.bulkCancelBlocks.length > 0) {
      await transaction
        .updateTable('bulk_cancel_blocks')
        .set({ block_id: lesson.block_id })
        .where('bulk_cancel_id', 'in', rows.bulkCancelBlocks)
        .where('block_id', 'is', null)
        .where('lesson_date', '=', rows.block.lesson_date)
        .where('starts_at', '=', new Date(rows.block.starts_at))
        .where('ends_at', '=', new Date(rows.block.ends_at))
        .execute();
    }
    await restoreCells(transaction, branchId, lesson.id, rows);
    if (rows.substitution !== null) {
      const places = await lessonPlacesOf(transaction, [lesson.id]);
      await transaction
        .insertInto('substitution_lessons')
        .values({
          substitution_id: rows.substitution.substitutionId,
          branch_id: branchId,
          lesson_id: lesson.id,
          lesson_date: placed.lesson_date,
          relaxed: rows.substitution.relaxed,
          ...placeOf(places, lesson.id),
        })
        .execute();
    }
    // Every rule checked again for a lesson held (edge/timetable, After publishing).
    if (lesson.cancel_cause === null) {
      const [restored] = await storedLessonsOn(transaction, branchId, placed.lesson_date, {
        lessonIds: [lesson.id],
      });
      if (restored === undefined) throw new Error('The restored lesson is not stored.');
      const checked = await storedDayCheck(
        transaction,
        { timetable: this.timetable, pattern: this.pattern },
        {
          accountId: access.accountId,
          lessons: [restored],
          closures: true,
          ...(rows.substitution === null
            ? { keepTeacher: true }
            : {
                substitutes: new Map([
                  [
                    lesson.id,
                    {
                      teacherId: lesson.teacher_id ?? '',
                      relaxed: rows.substitution.relaxed,
                    },
                  ],
                ]),
              }),
        },
      );
      await refuseBlocked(transaction, branchId, 'forced_delete_restore_blocked', checked);
    }
    await sql`set constraints all immediate`.execute(transaction);
    const notices = {
      notified: await this.tell(transaction, access, branchId, placed, 'timetable.lesson_restored'),
    };
    await this.audit.record(transaction, {
      branchId,
      actorId: access.accountId,
      assignmentId: access.assignmentId,
      action: 'forced_delete.restore',
      record: { type: 'lesson', id: lesson.id },
      oldValue: { forcedDeleteId: row.id },
      newValue: { ...(rows as unknown as Record<string, JsonValue>), notices: { ...notices } },
      requestId,
    });
  }
}

/**
 * Puts back the works, then the cells, of a lesson restored (task 6.1b-2):
 * the same ids and values; the database writes each cell's version, the
 * restorer and the history line, and lets in only rows of the store row
 * (0111). A student gone since is refused by the cell's key, which reads past
 * the branch filter (review correction 1): `forced_delete_parent_changed`.
 */
async function restoreCells(
  transaction: Transaction,
  branchId: string,
  lessonId: string,
  rows: LessonRows,
): Promise<void> {
  const works = rows.works ?? [];
  const cells = rows.cells ?? [];
  if (works.length > 0) {
    // Task 8.1 (spec review should-fix 9): a source or carry lesson, or a plan
    // work, gone since comes back as none; the row is then a column of its own.
    const lessonsNamed = works.flatMap((one) => [
      one.source_lesson_id ?? null,
      one.carried_from_lesson_id ?? null,
    ]);
    const named = lessonsNamed.filter((one): one is string => one !== null && one !== lessonId);
    const lessonsThere = new Set(
      named.length === 0
        ? []
        : (
            await transaction
              .selectFrom('lessons')
              .select('id')
              .where('id', 'in', [...new Set(named)])
              .execute()
          ).map((one) => one.id),
    );
    lessonsThere.add(lessonId);
    const planNamed = works.flatMap((one) => (one.plan_work_id == null ? [] : [one.plan_work_id]));
    const plansThere = new Set(
      planNamed.length === 0
        ? []
        : (
            await transaction
              .selectFrom('lesson_plan_works')
              .select('id')
              .where('id', 'in', [...new Set(planNamed)])
              .execute()
          ).map((one) => one.id),
    );
    const there = (id: string | null | undefined, set: Set<string>) =>
      id != null && set.has(id) ? id : null;
    await transaction
      .insertInto('journal_works')
      .values(
        works.map((one) => ({
          id: one.id,
          kind: one.kind,
          total: one.total,
          not_held: one.not_held,
          branch_id: branchId,
          lesson_id: lessonId,
          source_lesson_id:
            one.source_lesson_id === undefined ? lessonId : there(one.source_lesson_id, lessonsThere),
          plan_work_id: there(one.plan_work_id, plansThere),
          position: one.position ?? 1,
          carried_from_lesson_id: there(one.carried_from_lesson_id, lessonsThere),
          version: one.version ?? 1,
          changed_by: one.changed_by ?? null,
          changed_how: 'restored',
          changed_at: one.changed_at ?? null,
        })),
      )
      .execute();
  }
  if (cells.length === 0) return;
  try {
    await transaction
      .insertInto('journal_cells')
      .values(cells.map((one) => ({ ...one, branch_id: branchId, lesson_id: lessonId })))
      .execute();
  } catch (error) {
    const failure = error as { code?: unknown; constraint?: unknown };
    if (failure.code === '23503' && failure.constraint === 'journal_cells_student_fkey') {
      throw new ApiException('forced_delete_parent_changed', 409, undefined, [
        {
          path: 'students',
          code: 'not_found',
          message: 'A student of the lesson’s entries is gone since.',
        },
      ]);
    }
    throw error;
  }
}

/**
 * Refuses a restore whose exam cancel no longer holds (decision 9; spec review
 * of the code, should-fix 4): a link is kept only while its exam still meets
 * the lesson's block or the other half of its double on the date and seats a
 * class or group of those blocks, the rule of 0094 for every link.
 */
async function refuseExamsMoved(
  transaction: Transaction,
  rows: LessonRows,
  placed: LessonRows['lesson'],
  pairId: string | null,
): Promise<void> {
  if (rows.examCancels.length === 0) return;
  const blocks =
    pairId === null
      ? []
      : await transaction
          .selectFrom('lesson_blocks')
          .select(['id', 'starts_at', 'ends_at'])
          .where('id', '!=', placed.block_id)
          .where('double_pair_id', '=', pairId)
          .execute();
  const spans = [
    { from: new Date(placed.starts_at), until: new Date(placed.ends_at) },
    ...blocks.map((one) => ({ from: one.starts_at, until: one.ends_at })),
  ];
  const units = await transaction
    .selectFrom('lessons')
    .select(['class_id', 'group_id'])
    .where('block_id', 'in', [placed.block_id, ...blocks.map((one) => one.id)])
    .execute();
  const classIds = [placed.class_id, ...units.map((one) => one.class_id)].filter(
    (one): one is string => one !== null,
  );
  const groupIds = [placed.group_id, ...units.map((one) => one.group_id)].filter(
    (one): one is string => one !== null,
  );
  const exams = await transaction
    .selectFrom('exams')
    .select(['id', 'exam_date', 'starts_at', 'ends_at'])
    .where('id', 'in', rows.examCancels)
    .execute();
  const seated = new Set(
    (
      await transaction
        .selectFrom('exam_room_classes')
        .select('exam_id')
        .where('exam_id', 'in', rows.examCancels)
        .where((where) =>
          where.or([
            ...(classIds.length === 0 ? [] : [where('class_id', 'in', classIds)]),
            ...(groupIds.length === 0 ? [] : [where('group_id', 'in', groupIds)]),
          ]),
        )
        .execute()
    ).map((one) => one.exam_id),
  );
  const holds = (exam: (typeof exams)[number]) =>
    exam.exam_date === placed.lesson_date &&
    seated.has(exam.id) &&
    spans.some((one) => exam.starts_at < one.until && one.from < exam.ends_at);
  if (exams.length !== rows.examCancels.length || !exams.every(holds)) {
    throw new ApiException('forced_delete_parent_changed', 409, undefined, [
      {
        path: 'exams',
        code: 'exam_moved',
        message: 'An exam that cancelled the lesson no longer meets it.',
      },
    ]);
  }
}

/** Refuses a change of a lesson of a closed year: its timetable is read only (decision 6). */
export async function refuseClosedYear(transaction: Transaction, yearId: string): Promise<void> {
  const year = await transaction
    .selectFrom('academic_years')
    .select('status')
    .where('id', '=', yearId)
    .executeTakeFirstOrThrow();
  if (year.status === 'closed') {
    throw new ApiException('timetable_year_closed', 409);
  }
}

/** The lessons of store rows as the list shows them, by store id, names read now. */
async function describeLessons(
  transaction: Transaction,
  stored: readonly StoreRow[],
): Promise<Map<string, StoreDescription>> {
  const lessons = stored.map((one) => ({
    storeId: one.id,
    ...(one.rows as unknown as LessonRows).lesson,
  }));
  const described = new Map<string, StoreDescription>();
  if (lessons.length === 0) return described;
  const uniq = (values: readonly (string | null)[]) => [
    ...new Set(values.filter((one): one is string => one !== null)),
  ];
  const classIds = uniq(lessons.map((one) => one.class_id));
  const groupIds = uniq(lessons.map((one) => one.group_id));
  const subjectIds = uniq(lessons.map((one) => one.subject_id));
  const teacherIds = uniq(lessons.map((one) => one.teacher_id));
  const roomIds = uniq(lessons.map((one) => one.room_id));
  const [classes, groups, subjects, teachers, rooms] = await Promise.all([
    classIds.length === 0
      ? Promise.resolve([])
      : transaction
          .selectFrom('classes')
          .select(['id', 'grade', 'name'])
          .where('id', 'in', classIds)
          .execute(),
    groupIds.length === 0
      ? Promise.resolve([])
      : transaction
          .selectFrom('groups')
          .select(['id', 'name'])
          .where('id', 'in', groupIds)
          .execute(),
    transaction
      .selectFrom('subjects')
      .select(['id', 'name_uz', 'name_ru', 'name_en'])
      .where('id', 'in', subjectIds)
      .execute(),
    teacherIds.length === 0
      ? Promise.resolve([])
      : transaction
          .selectFrom('staff')
          .select(['id', 'kind', 'first_name', 'last_name', 'vacancy_name'])
          .where('id', 'in', teacherIds)
          .execute(),
    roomIds.length === 0
      ? Promise.resolve([])
      : transaction.selectFrom('rooms').select(['id', 'name']).where('id', 'in', roomIds).execute(),
  ]);
  const classOf = new Map(classes.map((one) => [one.id, classDisplayName(one.grade, one.name)]));
  const groupOf = new Map(groups.map((one) => [one.id, one.name]));
  const subjectOf = new Map(
    subjects.map((one) => [one.id, { uz: one.name_uz, ru: one.name_ru, en: one.name_en }]),
  );
  const teacherOf = new Map(
    teachers.map((one) => [
      one.id,
      one.kind === 'vacancy'
        ? (one.vacancy_name ?? '')
        : listName({ firstName: one.first_name ?? '', lastName: one.last_name ?? '' }),
    ]),
  );
  const roomOf = new Map(rooms.map((one) => [one.id, one.name]));
  const branch = await transaction
    .selectFrom('branches')
    .select('time_zone')
    .where('id', '=', stored[0]?.branchId ?? '')
    .executeTakeFirstOrThrow();
  const dates = lessons.map((one) => one.lesson_date).sort();
  const begins = await dayBeginnings(
    transaction,
    branch.time_zone,
    dates[0] ?? '',
    dates[dates.length - 1] ?? '',
  );
  const minutesOf = (date: string, moment: string) =>
    Math.round((new Date(moment).getTime() - begins(date).getTime()) / 60_000);
  for (const one of lessons) {
    const lesson: ForcedLesson = {
      id: one.id,
      date: one.lesson_date,
      startsAt: one.starts_at,
      endsAt: one.ends_at,
      start: minutesOf(one.lesson_date, one.starts_at),
      end: minutesOf(one.lesson_date, one.ends_at),
      unit:
        one.class_id !== null
          ? { kind: 'class', id: one.class_id, name: classOf.get(one.class_id) ?? '' }
          : { kind: 'group', id: one.group_id ?? '', name: groupOf.get(one.group_id ?? '') ?? '' },
      subject: {
        id: one.subject_id,
        names: subjectOf.get(one.subject_id) ?? { uz: '', ru: '', en: '' },
      },
      teacher:
        one.teacher_id === null
          ? null
          : { id: one.teacher_id, name: teacherOf.get(one.teacher_id) ?? '' },
      room: one.room_id === null ? null : { id: one.room_id, name: roomOf.get(one.room_id) ?? '' },
      cancelCause: one.cancel_cause as ForcedLesson['cancelCause'],
    };
    described.set(one.storeId, { lesson });
  }
  return described;
}

/**
 * The history of one lesson (task 5.8b, decision 4; `06`, Protection: "Every
 * change records who, when, the value before and the value after"): its lines
 * of `lesson_history` (0105), each with the actor of the audit entry of its
 * transaction in the branch, or none for the system. A lesson force-deleted
 * still has its history.
 */
@Injectable()
export class LessonHistoryReader {
  constructor(private readonly transactions: Transactions) {}

  history(access: Access, id: string): Promise<LessonHistory> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const lines = await transaction
        .selectFrom('lesson_history')
        .selectAll()
        .select(sql<string>`written_xact::text`.as('xact'))
        .select(sql<string | null>`date_before::text`.as('date_before_text'))
        .select(sql<string | null>`date_after::text`.as('date_after_text'))
        .where('lesson_id', '=', id)
        .where('branch_id', '=', branchId)
        .orderBy('changed_at')
        .orderBy('id')
        .execute();
      if (lines.length === 0) {
        const lesson = await transaction
          .selectFrom('lessons')
          .select('id')
          .where('id', '=', id)
          .where('branch_id', '=', branchId)
          .executeTakeFirst();
        if (lesson === undefined) {
          throw notFound();
        }
        return lessonHistorySchema.parse({ lines: [] });
      }
      const xacts = [...new Set(lines.map((one) => one.xact))];
      const entries = await transaction
        .selectFrom('audit_log')
        .select(['actor_id', sql<string>`written_xact::text`.as('xact')])
        .where('branch_id', '=', branchId)
        .where(sql<boolean>`written_xact::text = any(${xacts}::text[])`)
        .orderBy('occurred_at')
        .orderBy('id')
        .execute();
      const actorOf = new Map<string, string | null>();
      for (const one of entries) {
        if (!actorOf.has(one.xact) || actorOf.get(one.xact) === null) {
          actorOf.set(one.xact, one.actor_id);
        }
      }
      const accounts = [
        ...new Set([...actorOf.values()].filter((one): one is string => one !== null)),
      ];
      const names = new Map<string, string>();
      if (accounts.length > 0) {
        const found = await sql<{
          id: string;
          first_name: string | null;
          last_name: string | null;
        }>`
          select id, first_name, last_name from audit_names(${accounts}::uuid[])
        `.execute(transaction);
        for (const one of found.rows) {
          names.set(
            one.id,
            listName({ firstName: one.first_name ?? '', lastName: one.last_name ?? '' }),
          );
        }
      }
      const staffIds = [
        ...new Set(
          lines
            .flatMap((one) => [one.teacher_before, one.teacher_after])
            .filter((one): one is string => one !== null),
        ),
      ];
      const roomIds = [
        ...new Set(
          lines
            .flatMap((one) => [one.room_before, one.room_after])
            .filter((one): one is string => one !== null),
        ),
      ];
      const [staff, rooms] = await Promise.all([
        staffIds.length === 0
          ? Promise.resolve([])
          : transaction
              .selectFrom('staff')
              .select(['id', 'kind', 'first_name', 'last_name', 'vacancy_name'])
              .where('id', 'in', staffIds)
              .execute(),
        roomIds.length === 0
          ? Promise.resolve([])
          : transaction
              .selectFrom('rooms')
              .select(['id', 'name'])
              .where('id', 'in', roomIds)
              .execute(),
      ]);
      const staffOf = new Map(
        staff.map((one) => [
          one.id,
          one.kind === 'vacancy'
            ? (one.vacancy_name ?? '')
            : listName({ firstName: one.first_name ?? '', lastName: one.last_name ?? '' }),
        ]),
      );
      const roomOf = new Map(rooms.map((one) => [one.id, one.name]));
      const person = (ref: string | null) =>
        ref === null ? null : { id: ref, name: staffOf.get(ref) ?? '' };
      const room = (ref: string | null) =>
        ref === null ? null : { id: ref, name: roomOf.get(ref) ?? '' };
      const moment = (value: Date | null) => (value === null ? null : value.toISOString());
      return lessonHistorySchema.parse({
        lines: lines.map((one) => {
          const actor = actorOf.get(one.xact) ?? null;
          return {
            id: one.id,
            kind: one.kind,
            changedAt: one.changed_at.toISOString(),
            who: actor === null ? null : { id: actor, name: names.get(actor) ?? '' },
            teacher: { before: person(one.teacher_before), after: person(one.teacher_after) },
            room: { before: room(one.room_before), after: room(one.room_after) },
            date: { before: one.date_before_text, after: one.date_after_text },
            startsAt: { before: moment(one.starts_before), after: moment(one.starts_after) },
            endsAt: { before: moment(one.ends_before), after: moment(one.ends_after) },
            cancelCause: { before: one.cancel_before, after: one.cancel_after },
            cancelReason: { before: one.cancel_reason_before, after: one.cancel_reason_after },
          };
        }),
      });
    });
  }
}
