import { Injectable } from '@nestjs/common';
import {
  homeworkGivenAnswerSchema,
  lessonCardSchema,
  lessonDeliveryAnswerSchema,
  type HomeworkGiven,
  type HomeworkGivenAnswer,
  type LessonCard,
  type LessonDelivery,
  type LessonDeliveryAnswer,
  schoolDateOf,
  type ErrorCode,
} from '@sodiq/shared';
import { sql } from 'kysely';
import { Transactions, transactionMoment, type Transaction } from '../../database/transactions.js';
import type { JsonValue } from '../../database/types.generated.js';
import { ApiException } from '../../http/api-exception.js';
import type { Access } from '../access/permission.guard.js';
import { Audit } from '../audit/audit.service.js';
import { branchOf } from '../classes/classes.service.js';
import {
  enterableLesson,
  entryAssignment,
  journalFactsOf,
  ownStaffOf,
  teachesOrOwns,
} from '../journal/attendance-entry.js';
import {
  editWindowOf,
  lockOf,
  unlocksOfLessons,
  writeAssignment,
  writeDetails,
} from '../journal/edit-window.js';
import {
  attendanceOnlyOn,
  journalRows,
  plannedJournal,
  type JournalRow,
} from '../journal/journal-grid.query.js';
import { roleReadingOf } from '../journal/journal-scope.js';
import { journalsColumns } from '../journal/journal-works.query.js';
import { Notifications } from '../notifications/notifications.service.js';
import { notFound } from '../setup/setup-refusals.js';
import { ownerOn } from '../timetable/journal-owners.js';
import { substitutionsInForce } from '../timetable/substitutions-read.js';
import { PlanFollow } from './plan-follow.js';
import {
  datedQuarters,
  lockJournals,
  planIdOf,
  planItems,
  planJournalIds,
  planRows,
  referenceDateOf,
  type PlanQuarter,
  type PlanRowLesson,
} from './plan-read.js';
import { ownerIdOn } from './plan-scope.js';
import { clearUntouchedCopy } from './plan-copy-clear.js';
import { copyItems } from './plan-separate.js';
import { PlansService } from './plans.service.js';

/**
 * Plans in the journal (task 8.8, pull request #226; `09`, In the journal;
 * `edge/lesson-plans`, Plans and the journal):
 *
 * - The lesson card: "number, date, slot, topic, classworks, homeworks,
 *   objectives, materials", with "given today" and "checked today". The
 *   whole item for a reader of the plan, the lesson's teacher and its
 *   substitute in force; topic and homework titles for any other reader of
 *   the journal ("A Tutor sees topic and homework of the class through the
 *   journal").
 * - "Topic not delivered" and "homework not given": "On the lesson card the
 *   substitute or the teacher sets 'topic not delivered' and marks the
 *   item's homeworks 'not given', all or some of them, inside the edit
 *   period. This is not a plan edit. A copy of the item goes to 'not
 *   covered', a request is prepared, and the next lesson gets no column for
 *   a homework not given." Only the lesson's teacher (decision 6): the
 *   owner on the date or the substitute in force; never a correction.
 */

const DELIVERY_REFUSALS: Record<string, ErrorCode> = {
  homework_has_entries: 'homework_has_entries',
  journal_locked: 'journal_locked',
  journal_correction_role: 'journal_correction_role',
};

function mapRefusal(error: unknown): never {
  const failure = error as { code?: unknown; constraint?: unknown };
  if (
    failure.code === '23514' &&
    typeof failure.constraint === 'string' &&
    Object.hasOwn(DELIVERY_REFUSALS, failure.constraint)
  ) {
    throw new ApiException(DELIVERY_REFUSALS[failure.constraint] ?? 'internal_error', 409);
  }
  throw error;
}

interface CardLesson {
  readonly id: string;
  readonly classId: string | null;
  readonly groupId: string | null;
  readonly subjectId: string;
  readonly teacherId: string | null;
  readonly date: string;
  readonly cancelled: boolean;
}

const keyOf = (journal: JournalRow) => ({
  subjectId: journal.subjectId,
  classId: journal.classId,
  groupClassIds: journal.groupClassIds,
});

/** What a write of the marks has decided first. */
interface MarkScene {
  readonly branchId: string;
  readonly lessonId: string;
  readonly date: string;
  readonly journal: JournalRow;
  readonly quarter: PlanQuarter;
  readonly planId: string;
  readonly row: PlanRowLesson;
  readonly rows: readonly PlanRowLesson[];
  readonly item: Awaited<ReturnType<typeof planItems>>[number];
  readonly staffId: string;
  readonly today: string;
  readonly write: Awaited<ReturnType<typeof enterableLesson>>['write'];
  readonly assignmentId: string;
}

@Injectable()
export class PlanDelivery {
  constructor(
    private readonly transactions: Transactions,
    private readonly audit: Audit,
    private readonly notifications: Notifications,
    private readonly follow: PlanFollow,
    private readonly plans: PlansService,
  ) {}

  /** The lesson of a branch and the journal and quarter that hold it, else 404. */
  private async lessonOf(
    transaction: Transaction,
    branchId: string,
    lessonId: string,
  ): Promise<{ lesson: CardLesson; journal: JournalRow; quarter: PlanQuarter }> {
    const row = await transaction
      .selectFrom('lessons')
      .select([
        'id',
        'class_id',
        'group_id',
        'subject_id',
        'teacher_id',
        'cancel_cause',
        sql<string>`lesson_date::text`.as('lesson_date'),
      ])
      .where('id', '=', lessonId)
      .where('branch_id', '=', branchId)
      .executeTakeFirst();
    if (row === undefined) throw notFound();
    const found = await transaction
      .selectFrom('journals')
      .innerJoin('academic_years', 'academic_years.id', 'journals.academic_year_id')
      .select(['journals.id', 'journals.academic_year_id'])
      .where('journals.branch_id', '=', branchId)
      .where('journals.subject_id', '=', row.subject_id)
      .where((builder) =>
        row.class_id === null
          ? builder('journals.group_id', '=', row.group_id)
          : builder('journals.class_id', '=', row.class_id),
      )
      .where('academic_years.start_date', '<=', row.lesson_date)
      .where('academic_years.end_date', '>=', row.lesson_date)
      .executeTakeFirst();
    if (found === undefined) throw notFound();
    const [journal] = await journalRows(transaction, branchId, { journalId: found.id });
    if (journal === undefined) throw notFound();
    const quarter = (await datedQuarters(transaction, found.academic_year_id)).find(
      (one) => one.startDate <= row.lesson_date && row.lesson_date <= one.endDate,
    );
    // A lesson in no dated quarter has no plan row (`planRows`).
    if (quarter === undefined) throw notFound();
    return {
      lesson: {
        id: row.id,
        classId: row.class_id,
        groupId: row.group_id,
        subjectId: row.subject_id,
        teacherId: row.teacher_id,
        date: row.lesson_date,
        cancelled: row.cancel_cause !== null,
      },
      journal,
      quarter,
    };
  }

  /** `09`: "Clicking it opens the lesson card." */
  card(access: Access, lessonId: string): Promise<LessonCard> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const { lesson, journal, quarter } = await this.lessonOf(transaction, branchId, lessonId);
      const scene = await this.plans.sceneOf(transaction, access, branchId, journal.id, quarter.id);
      const own = scene.reader.staffId;
      const facts = await journalFactsOf(transaction, branchId, journal.id);
      const ownerOnDate =
        facts === null
          ? null
          : ownerOn(
              facts.runs.get(journal.id) ?? [],
              facts.periods.get(journal.id) ?? [],
              facts.out,
              lesson.date,
            );
      const owns =
        own !== null &&
        ownerOnDate !== null &&
        ownerOnDate.kind !== 'none' &&
        ownerOnDate.staffId === own;
      // The lesson's teacher: its substitute while a substitution is in force (From 5.7b-1).
      const teaches = own !== null && lesson.teacherId === own;
      const substitute =
        teaches && !owns && lesson.teacherId !== null
          ? (
              await substitutionsInForce(transaction, [
                { id: lesson.id, teacherId: lesson.teacherId },
              ])
            ).has(lesson.id)
          : false;
      const whole = scene.reach.read || owns || substitute;
      if (!whole && roleReadingOf(access, keyOf(journal)) === null && !teaches) {
        throw new ApiException('journal_scope', 403);
      }
      const rows = await planRows(
        transaction,
        branchId,
        journal,
        quarter,
        scene.timeZone,
        scene.now,
      );
      const row = rows.find((one) => one.lessonId === lesson.id);
      const planId = await planIdOf(transaction, journal.id, quarter.id);
      const items =
        planId === null || row === undefined
          ? []
          : await planItems(transaction, planId, journal.id);
      const item = items.find((one) => one.position === row?.number) ?? null;
      const plan = await journalsColumns(transaction, [journal], scene.timeZone, scene.now);
      const columns = plan.journals.get(journal.id);
      const own_ = columns?.columns.get(lesson.id);
      const lessonsById = new Map((columns?.lessons ?? []).map((one) => [one.id, one]));
      const yearRows = new Map<string, number | null>();
      // The slot of a check lesson in this quarter (the warning names it), else none.
      for (const one of rows) yearRows.set(one.lessonId, one.slot);
      const descriptionOf = (planWorkId: string | null): string | null =>
        planWorkId === null
          ? null
          : (item?.homeworks.find((work) => work.id === planWorkId)?.description ?? null);
      const givenToday = (own_?.given ?? []).map((one) => {
        const check = one.checkAt === null ? undefined : lessonsById.get(one.checkAt);
        return {
          planWorkId: one.planWorkId,
          title: one.title,
          description: whole ? descriptionOf(one.planWorkId) : null,
          notGiven: one.notGiven,
          checkAt:
            check === undefined
              ? null
              : { lessonId: check.id, date: check.date, slot: yearRows.get(check.id) ?? null },
          checkedSameDay: check !== undefined && check.date === lesson.date,
          ungraded: one.ungraded,
        };
      });
      const checkedToday = (own_?.columns ?? [])
        .filter((column) => column.kind === 'homework')
        .map((column) => ({
          title: column.title,
          givenOn:
            column.carriedFrom !== null || column.sourceLessonId === null
              ? null
              : (lessonsById.get(column.sourceLessonId)?.date ?? null),
        }));
      const delivery = await transaction
        .selectFrom('journal_lesson_deliveries')
        .select(['not_delivered', 'version'])
        .where('lesson_id', '=', lesson.id)
        .where('journal_id', '=', journal.id)
        .executeTakeFirst();
      let canMark = false;
      if ((owns || teaches) && own !== null && row?.held === true && item !== null) {
        const graded = !attendanceOnlyOn(journal, lesson.date);
        const locksAt = await lockOf(transaction, { kind: 'lesson', lessonId: lesson.id });
        const unlocks = await unlocksOfLessons(transaction, [lesson.id], own);
        const window = editWindowOf(
          locksAt,
          unlocks.get(lesson.id)?.approved ?? [],
          own,
          scene.now,
        );
        canMark = graded && window.kind !== 'locked';
      }
      return lessonCardSchema.parse({
        lessonId: lesson.id,
        journalId: journal.id,
        number: row?.number ?? null,
        date: lesson.date,
        start: row?.start ?? lessonsById.get(lesson.id)?.start ?? 0,
        end: row?.end ?? lessonsById.get(lesson.id)?.end ?? 1,
        slot: row?.slot ?? null,
        held: row?.held === true,
        planItem: item !== null,
        topic: item?.topic ?? null,
        whole,
        classworks: whole ? (item?.classworks ?? []) : [],
        objectives: whole ? (item?.objectives ?? null) : null,
        links: whole ? (item?.links ?? []) : [],
        files: whole ? (item?.files ?? []) : [],
        givenToday,
        checkedToday,
        delivery: {
          notDelivered: delivery?.not_delivered ?? false,
          version: delivery?.version ?? null,
        },
        canMark,
        editedAfterLesson: item?.editedAfterLesson ?? false,
        movedFrom: item?.movedFrom ?? null,
      });
    });
  }

  /**
   * The scene of a write of the marks (decision 6): the lesson as attendance
   * entry decides it (404, the scope, a held lesson, the edit period), then
   * only its teacher (the owner on the date, or the substitute in force), a
   * graded subject, and the item of its row; the plan's journals locked as
   * every plan write locks them.
   */
  private async markScene(
    transaction: Transaction,
    access: Access,
    lessonId: string,
  ): Promise<MarkScene> {
    const branchId = branchOf(access);
    const { lesson, now, timeZone, write } = await enterableLesson(
      transaction,
      access,
      branchId,
      lessonId,
    );
    const staffId = await ownStaffOf(transaction, access.accountId);
    const facts = await journalFactsOf(transaction, branchId, lesson.journalId);
    if (staffId === null || write.how === 'assigned_entry') {
      throw new ApiException('journal_entry_scope', 403);
    }
    const today = schoolDateOf(now, timeZone);
    if (!teachesOrOwns(lesson, facts, staffId, today)) {
      throw new ApiException('journal_entry_scope', 403);
    }
    const { journal, quarter } = await this.lessonOf(transaction, branchId, lesson.id);
    if (!plannedJournal(journal) || attendanceOnlyOn(journal, lesson.date)) {
      throw new ApiException('lesson_attendance_only', 409);
    }
    const planId = await planIdOf(transaction, journal.id, quarter.id);
    if (planId === null) throw new ApiException('no_plan_item', 409);
    await lockJournals(transaction, await planJournalIds(transaction, planId));
    const rows = await planRows(transaction, branchId, journal, quarter, timeZone, now);
    const row = rows.find((one) => one.lessonId === lesson.id);
    const item =
      row === undefined
        ? undefined
        : (await planItems(transaction, planId, journal.id)).find(
            (one) => one.position === row.number,
          );
    if (row === undefined || item === undefined) throw new ApiException('no_plan_item', 409);
    return {
      branchId,
      lessonId: lesson.id,
      date: lesson.date,
      journal,
      quarter,
      planId,
      row,
      rows,
      item,
      staffId,
      today,
      write,
      assignmentId: writeAssignment(write, entryAssignment(access)),
    };
  }

  /** "Topic not delivered" set or undone (decisions 5 to 9, corrections 3). */
  setDelivery(
    access: Access,
    lessonId: string,
    input: LessonDelivery,
    requestId?: string,
  ): Promise<LessonDeliveryAnswer> {
    return this.transactions.run(access.branchIds, async (transaction) => {
      const scene = await this.markScene(transaction, access, lessonId);
      const stored = await transaction
        .selectFrom('journal_lesson_deliveries')
        .select(['id', 'not_delivered', 'version', 'copy_item_id'])
        .where('lesson_id', '=', scene.lessonId)
        .where('journal_id', '=', scene.journal.id)
        .forUpdate()
        .executeTakeFirst();
      if ((stored?.version ?? null) !== input.version) {
        throw new ApiException('delivery_stale', 409, undefined, [
          {
            path: 'version',
            code: 'delivery_stale',
            message: 'The mark was changed since it was read.',
          },
        ]);
      }
      if ((stored?.not_delivered ?? false) === input.notDelivered) {
        return lessonDeliveryAnswerSchema.parse({
          notDelivered: input.notDelivered,
          version: stored?.version ?? 1,
          copyItemId: stored?.copy_item_id ?? null,
        });
      }
      let copyItemId: string | null = null;
      let oldValue: Record<string, JsonValue> = { notDelivered: stored?.not_delivered ?? false };
      if (input.notDelivered) {
        // A copy of the item, past the journal's last row: "not covered" of this class only.
        const made = await copyItems(
          transaction,
          scene.branchId,
          scene.planId,
          [scene.item.id],
          true,
          false,
          scene.lessonId,
        );
        copyItemId = made.get(scene.item.id) ?? null;
        if (copyItemId === null) throw new Error('The item of the row is copied.');
        const last = await transaction
          .selectFrom('lesson_plan_places')
          .select(sql<number>`coalesce(max(position), 0)`.as('position'))
          .where('plan_id', '=', scene.planId)
          .where('journal_id', '=', scene.journal.id)
          .executeTakeFirstOrThrow();
        await transaction
          .insertInto('lesson_plan_places')
          .values({
            branch_id: scene.branchId,
            plan_id: scene.planId,
            journal_id: scene.journal.id,
            item_id: copyItemId,
            position: Math.max(scene.rows.length, Number(last.position)) + 1,
          })
          .execute();
        await this.follow.prepareFor(transaction, {
          branchId: scene.branchId,
          plan: { planId: scene.planId, journal: scene.journal, quarter: scene.quarter },
          causes: [{ kind: 'not_covered', onDate: scene.date, items: 1, staffId: null }],
          actor: { actorId: access.accountId, assignmentId: scene.assignmentId },
        });
      } else if (stored?.copy_item_id !== null && stored?.copy_item_id !== undefined) {
        const cleared = await clearUntouchedCopy(
          transaction,
          scene.rows.length,
          stored.copy_item_id,
        );
        if (cleared === 'used') throw new ApiException('not_delivered_copy_used', 409);
        if (cleared !== null) oldValue = { ...oldValue, copy: cleared };
      }
      let saved: { version: number };
      try {
        saved =
          stored === undefined
            ? await transaction
                .insertInto('journal_lesson_deliveries')
                .values({
                  branch_id: scene.branchId,
                  lesson_id: scene.lessonId,
                  journal_id: scene.journal.id,
                  item_id: scene.item.id,
                  copy_item_id: copyItemId,
                  not_delivered: true,
                  changed_by: access.accountId,
                  changed_how: 'entry',
                  changed_at: await transactionMoment(transaction),
                })
                .returning('version')
                .executeTakeFirstOrThrow()
            : await transaction
                .updateTable('journal_lesson_deliveries')
                .set({
                  not_delivered: input.notDelivered,
                  copy_item_id: copyItemId,
                  version: stored.version + 1,
                  changed_by: access.accountId,
                  changed_how: input.notDelivered ? 'entry' : 'undo',
                })
                .where('id', '=', stored.id)
                .returning('version')
                .executeTakeFirstOrThrow();
      } catch (error) {
        mapRefusal(error);
      }
      await this.audit.record(transaction, {
        branchId: scene.branchId,
        actorId: access.accountId,
        assignmentId: scene.assignmentId,
        action: 'journal.topic_not_delivered',
        record: { type: 'lesson', id: scene.lessonId },
        oldValue,
        newValue: {
          notDelivered: input.notDelivered,
          journalId: scene.journal.id,
          planId: scene.planId,
          itemId: scene.item.id,
          copyItemId,
          version: saved.version,
        },
        details: writeDetails(scene.write),
        ...(requestId === undefined ? {} : { requestId }),
      });
      if (input.notDelivered) await this.tellOwner(transaction, scene);
      return lessonDeliveryAnswerSchema.parse({
        notDelivered: input.notDelivered,
        version: saved.version,
        copyItemId,
      });
    });
  }

  /** Decision 18: the owner is told when the substitute set the mark. */
  private async tellOwner(transaction: Transaction, scene: MarkScene): Promise<void> {
    const ownerId = await ownerIdOn(
      transaction,
      scene.branchId,
      scene.journal,
      referenceDateOf(scene.quarter, scene.today),
    );
    if (ownerId === null || ownerId === scene.staffId) return;
    const owner = await transaction
      .selectFrom('staff')
      .select('account_id')
      .where('id', '=', ownerId)
      .executeTakeFirst();
    if (owner?.account_id === null || owner?.account_id === undefined) return;
    await this.notifications.send(transaction, {
      kind: 'plans.not_delivered',
      data: { unit: scene.journal.unitName, date: scene.date },
      branchId: scene.branchId,
      accountIds: [owner.account_id],
    });
  }

  /** "Not given" set or undone on homeworks of the lesson's item (decision 4, correction 4). */
  setHomework(
    access: Access,
    lessonId: string,
    input: HomeworkGiven,
    requestId?: string,
  ): Promise<HomeworkGivenAnswer> {
    return this.transactions.run(access.branchIds, async (transaction) => {
      const ids = input.planWorkIds.map((id) => id.toLowerCase()).sort();
      // The ids of the body are checked against the branch first (`.claude/rules/api.md`).
      const known = await transaction
        .selectFrom('lesson_plan_works')
        .select(['id', 'item_id', 'kind'])
        .where('id', 'in', ids)
        .execute();
      if (known.length !== ids.length) throw notFound();
      const scene = await this.markScene(transaction, access, lessonId);
      if (known.some((work) => work.item_id !== scene.item.id || work.kind !== 'homework')) {
        throw new ApiException('homework_not_in_lesson', 409);
      }
      // The plan works in the order of the id, as the first write of a planned work takes it.
      await transaction
        .selectFrom('lesson_plan_works')
        .select('id')
        .where('id', 'in', ids)
        .orderBy('id')
        .forNoKeyUpdate()
        .execute();
      const live = await transaction
        .selectFrom('journal_homework_not_given')
        .select(['id', 'plan_work_id'])
        .where('lesson_id', '=', scene.lessonId)
        .where('plan_work_id', 'in', ids)
        .where('undone_at', 'is', null)
        .forUpdate()
        .execute();
      const marked = new Set(live.map((row) => row.plan_work_id));
      const changed: string[] = [];
      try {
        for (const id of ids) {
          if (input.notGiven && !marked.has(id)) {
            await transaction
              .insertInto('journal_homework_not_given')
              .values({
                branch_id: scene.branchId,
                lesson_id: scene.lessonId,
                journal_id: scene.journal.id,
                plan_work_id: id,
                changed_by: access.accountId,
                changed_how: 'entry',
                set_at: await transactionMoment(transaction),
              })
              .execute();
            changed.push(id);
          } else if (!input.notGiven && marked.has(id)) {
            await transaction
              .updateTable('journal_homework_not_given')
              .set({
                changed_by: access.accountId,
                changed_how: 'undo',
                undone_at: await transactionMoment(transaction),
              })
              .where('lesson_id', '=', scene.lessonId)
              .where('plan_work_id', '=', id)
              .where('undone_at', 'is', null)
              .execute();
            changed.push(id);
          }
        }
      } catch (error) {
        mapRefusal(error);
      }
      const now = await transaction
        .selectFrom('journal_homework_not_given')
        .select('plan_work_id')
        .where('lesson_id', '=', scene.lessonId)
        .where('undone_at', 'is', null)
        .orderBy('plan_work_id')
        .execute();
      if (changed.length > 0) {
        await this.audit.record(transaction, {
          branchId: scene.branchId,
          actorId: access.accountId,
          assignmentId: scene.assignmentId,
          action: 'journal.homework_not_given',
          record: { type: 'lesson', id: scene.lessonId },
          oldValue: { notGiven: [...marked].sort() },
          newValue: {
            notGiven: now.map((row) => row.plan_work_id),
            changed,
            journalId: scene.journal.id,
            itemId: scene.item.id,
          },
          details: writeDetails(scene.write),
          ...(requestId === undefined ? {} : { requestId }),
        });
      }
      return homeworkGivenAnswerSchema.parse({ notGiven: now.map((row) => row.plan_work_id) });
    });
  }
}
