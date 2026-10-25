import { Inject, Injectable } from '@nestjs/common';
import { addDays } from '@sodiq/timetable-rules';
import {
  classDisplayName,
  schoolDateOf,
  type JournalUnlock,
  type JournalUnlocks,
  type UnlockCreate,
  type UnlockDecision,
  type UnlockStatus,
  type UnlockWithdraw,
} from '@sodiq/shared';
import { sql } from 'kysely';
import { Transactions, transactionMoment, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import { refuseOwnRequest } from '../access/own-request.js';
import type { Access } from '../access/permission.guard.js';
import { postHolders, postsOf } from '../access/request-posts.js';
import { decisionReach, firstTier, type RequestOn } from '../access/request-routing.js';
import { Audit } from '../audit/audit.service.js';
import { branchOf } from '../classes/classes.service.js';
import { Notifications } from '../notifications/notifications.service.js';
import { lockOpenJournalQuarter, refusingClosedQuarter } from '../setup/closed-quarters.js';
import { notFound } from '../setup/setup-refusals.js';
import { ownerFactsOf, personOutOf } from '../timetable/journal-owners.js';
import {
  entryAssignment,
  entryStateOf,
  journalFactsOf,
  lockedLesson,
  ownStaffOf,
  refuseState,
  teachesOrOwns,
} from './attendance-entry.js';
import { namedAccounts } from './cell-lines.query.js';
import { editWindowOf, lockOf, openUnlocksOf, outToday, type LockTarget } from './edit-window.js';
import { journalRows, staffNames, switchesIn } from './journal-grid.query.js';
import { ratingDateOf, ratingRightsOf } from './rating.js';

/**
 * Unlock requests of the journal (task 8.4, pull request #222; `07`, Editing
 * rules and locks: "To change a locked lesson the teacher sends an unlock
 * request"; `edge/journal`, Locks, unlocks and corrections: "The teacher
 * sends an unlock request ... approves and sets 1 to 7 days. The unlock covers
 * that lesson and that person only"; `02`, Head Teachers and Senior Head
 * Teachers, "Who approves" and "Own requests"; decisions 4, 7, 8 and 11).
 *
 * A request is the person's own, on a lesson they may enter or on the rating
 * exam of a journal they teach today, once it is locked. It is routed by the
 * posts in force on each request (`access/request-routing.ts`; From 3.4c and
 * 3.6b-3: it follows any change of a post with no job); a Tutor's Ma'naviyat
 * soati or Homework slot lesson goes to the Academic Vice Principal (decision
 * 11). Nobody decides their own. A request of a person no longer active in
 * the branch reads as `cancelled` and cannot be decided (decision 7).
 */

const UNLOCK_COLUMNS = [
  'id',
  'branch_id',
  'target',
  'lesson_id',
  'journal_id',
  'quarter_id',
  'staff_id',
  'requested_by',
  'reason',
  'requested_at',
  'status',
  'days',
  'open_until',
  'decided_by',
  'decided_at',
  'refuse_reason',
  'version',
] as const;

interface UnlockRow {
  id: string;
  branch_id: string;
  target: string;
  lesson_id: string | null;
  journal_id: string | null;
  quarter_id: string | null;
  staff_id: string;
  requested_by: string;
  reason: string;
  requested_at: Date;
  status: string;
  days: number | null;
  open_until: Date | null;
  decided_by: string | null;
  decided_at: Date | null;
  refuse_reason: string | null;
  version: number;
}

/** What a request is on, as the answer and the routing read it. */
interface Subject {
  readonly subjectId: string;
  readonly unit: JournalUnlock['unit'];
  readonly subject: JournalUnlock['subject'];
  readonly date: string | null;
  readonly on: RequestOn;
}

/** The roles that read every request of the branch (`view=branch`). */
const BRANCH_READERS = ['super_admin', 'principal', 'academic_vice_principal'] as const;

const statusOf = (status: string): UnlockStatus =>
  status === 'approved' || status === 'refused' || status === 'withdrawn' ? status : 'sent';

const scopeRefusal = () => new ApiException('journal_unlock_scope', 403);

const UNIQUE_VIOLATION = '23505';

@Injectable()
export class UnlocksService {
  constructor(
    @Inject(Transactions) private readonly transactions: Transactions,
    @Inject(Audit) private readonly audit: Audit,
    @Inject(Notifications) private readonly notifications: Notifications,
  ) {}

  // -------------------------------------------------------------------------
  // Reads.

  /** The requests the reader decides now, the reader's own, or (for its readers) the branch's. */
  list(access: Access, view: 'deciding' | 'own' | 'branch'): Promise<JournalUnlocks> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      if (
        view === 'branch' &&
        !access.assignments.some(
          (one) =>
            (BRANCH_READERS as readonly string[]).includes(one.role) &&
            (one.branchId === null || one.branchId === branchId.toLowerCase()),
        )
      ) {
        throw scopeRefusal();
      }
      let query = transaction
        .selectFrom('journal_unlocks')
        .select(UNLOCK_COLUMNS)
        .where('branch_id', '=', branchId);
      if (view === 'own') query = query.where('requested_by', '=', access.accountId);
      if (view === 'deciding') query = query.where('status', '=', 'sent');
      // Every waiting request for "deciding" (the routing filters them); the newest 500 otherwise.
      const ordered = query.orderBy('requested_at', 'desc').orderBy('id');
      const rows = await (view === 'deciding' ? ordered : ordered.limit(500)).execute();
      const answered = await this.answersOf(transaction, access, branchId, rows);
      return {
        requests: view === 'deciding' ? answered.filter((one) => one.canDecide) : answered,
      };
    });
  }

  /** The answers of rows: what each is on, its people and what the reader may do with it. */
  private async answersOf(
    transaction: Transaction,
    access: Access,
    branchId: string,
    rows: readonly UnlockRow[],
  ): Promise<JournalUnlock[]> {
    if (rows.length === 0) return [];
    const now = await transactionMoment(transaction);
    const today = schoolDateOf(now, await zoneOf(transaction, branchId));
    const out = await personOutOf(
      transaction,
      branchId,
      rows.map((row) => row.staff_id),
    );
    const people = await staffNames(transaction, [...new Set(rows.map((row) => row.staff_id))]);
    const deciders = await namedAccounts(
      transaction,
      rows.map((row) => row.decided_by),
    );
    const subjects = new Map<string, Subject>();
    const holdersOf = new Map<string, Awaited<ReturnType<typeof postHolders>>>();
    const answers: JournalUnlock[] = [];
    for (const row of rows) {
      const key = row.lesson_id ?? `${row.journal_id ?? ''}/${row.quarter_id ?? ''}`;
      let subject = subjects.get(key);
      if (subject === undefined) {
        subject = await subjectOf(transaction, branchId, row);
        subjects.set(key, subject);
      }
      let holders = holdersOf.get(subject.subjectId);
      if (holders === undefined) {
        holders = await postHolders(transaction, branchId, subject.subjectId, now);
        holdersOf.set(subject.subjectId, holders);
      }
      const cancelled = row.status === 'sent' && out(row.staff_id, today);
      const status: UnlockStatus = cancelled ? 'cancelled' : statusOf(row.status);
      const reach = decisionReach(
        { accountId: access.accountId, posts: postsOf(holders, access.accountId) },
        { accountId: row.requested_by, posts: postsOf(holders, row.requested_by) },
        subject.on,
      );
      const decider = row.decided_by === null ? undefined : deciders.get(row.decided_by);
      answers.push({
        id: row.id,
        target: row.target === 'rating' ? 'rating' : 'lesson',
        lessonId: row.lesson_id,
        journalId: row.journal_id,
        quarterId: row.quarter_id,
        date: subject.date,
        unit: subject.unit,
        subject: subject.subject,
        person: people.get(row.staff_id) ?? '',
        reason: row.reason,
        requestedAt: new Date(row.requested_at).toISOString(),
        status,
        days: row.days,
        openUntil: row.open_until === null ? null : new Date(row.open_until).toISOString(),
        open:
          status === 'approved' &&
          row.open_until !== null &&
          new Date(row.open_until).getTime() > now.getTime() &&
          !out(row.staff_id, today),
        decidedBy: decider === undefined ? null : (decider.name ?? decider.login ?? null),
        decidedAt: row.decided_at === null ? null : new Date(row.decided_at).toISOString(),
        refuseReason: row.refuse_reason,
        version: row.version,
        canDecide: status === 'sent' && reach === 'decide',
        canWithdraw: status === 'sent' && row.requested_by === access.accountId,
      });
    }
    return answers;
  }

  // -------------------------------------------------------------------------
  // Requests.

  /** A request on a locked lesson the person may enter (decision 8). */
  requestLesson(
    access: Access,
    lessonId: string,
    input: UnlockCreate,
    requestId: string,
  ): Promise<JournalUnlock> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      // Task 9.2b: the lesson's quarter before the lesson's lock; refused after the scope.
      const quarterId = await lessonQuarterOf(transaction, branchId, lessonId);
      await holdQuarter(transaction, quarterId);
      const lesson = await lockedLesson(transaction, branchId, lessonId);
      const now = await transactionMoment(transaction);
      const today = schoolDateOf(now, await zoneOf(transaction, branchId));
      const staffId = await ownStaffOf(transaction, access.accountId);
      const facts = await journalFactsOf(transaction, branchId, lesson.journalId);
      if (
        staffId === null ||
        // An unlock is for a lesson the person teaches or owns on its own date (From 5.7a-3c:
        // the acting teacher's unlock path is for the lessons of the period); the owner today
        // enters the lessons still open only.
        !teachesOrOwns(lesson, facts, staffId, lesson.date) ||
        (await outToday(transaction, branchId, staffId, today))
      ) {
        throw new ApiException('journal_entry_scope', 403);
      }
      refuseState(await entryStateOf(transaction, lesson, now));
      // Task 9.2b (From 8.4): no unlock request in a closed quarter; 9.2c: a reopened journal
      // takes one until its end.
      if (quarterId !== null) {
        await lockOpenJournalQuarter(
          transaction,
          quarterId,
          lesson.journalId ?? (await lessonJournalOf(transaction, branchId, lesson.id)),
        );
      }
      return this.send(transaction, access, branchId, {
        target: { kind: 'lesson', lessonId: lesson.id },
        staffId,
        reason: input.reason,
        requestId,
        assignmentId: entryAssignment(access),
      });
    });
  }

  /** A request on a journal's locked rating exam, by its teacher today. */
  requestRating(
    access: Access,
    journalId: string,
    quarterId: string,
    input: UnlockCreate,
    requestId: string,
  ): Promise<JournalUnlock> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const [journal] = await journalRows(transaction, branchId, { journalId });
      if (journal === undefined || switchesIn(journal, quarterId) === undefined) {
        throw notFound();
      }
      const now = await transactionMoment(transaction);
      const today = schoolDateOf(now, await zoneOf(transaction, branchId));
      const staffId = await ownStaffOf(transaction, access.accountId);
      const facts = await ownerFactsOf(transaction, branchId, [
        {
          id: journal.id,
          academic_year_id: journal.academicYearId,
          class_id: journal.classId,
          group_id: journal.groupId,
          subject_id: journal.subjectId,
        },
      ]);
      const rights = ratingRightsOf(access, branchId, { journal, facts, staffId, today });
      if (!rights.teacher || staffId === null) {
        throw new ApiException('rating_exam_scope', 403);
      }
      if (switchesIn(journal, quarterId)?.ratingExam !== true) {
        throw new ApiException('rating_exam_off', 409);
      }
      // Task 9.2b (From 8.4): no unlock request in a closed quarter; nothing is locked before.
      await lockOpenJournalQuarter(transaction, quarterId, journal.id);
      return this.send(transaction, access, branchId, {
        target: { kind: 'rating', journalId: journal.id, quarterId },
        staffId,
        reason: input.reason,
        requestId,
        assignmentId: entryAssignment(access),
      });
    });
  }

  /** Stores a request on a locked target, audits it and tells the first tier of its deciders. */
  private async send(
    transaction: Transaction,
    access: Access,
    branchId: string,
    input: {
      readonly target: LockTarget;
      readonly staffId: string;
      readonly reason: string;
      readonly requestId: string;
      readonly assignmentId: string;
    },
  ): Promise<JournalUnlock> {
    const now = await transactionMoment(transaction);
    const locksAt = await lockOf(transaction, input.target);
    const window = editWindowOf(
      locksAt,
      await openUnlocksOf(transaction, input.target, input.staffId, now),
      input.staffId,
      now,
    );
    if (window.kind !== 'locked') throw new ApiException('journal_not_locked', 409);
    const target = input.target;
    let id: string;
    try {
      await sql`savepoint unlock_request`.execute(transaction);
      const row = await transaction
        .insertInto('journal_unlocks')
        .values({
          branch_id: branchId,
          target: target.kind,
          lesson_id: target.kind === 'lesson' ? target.lessonId : null,
          journal_id: target.kind === 'rating' ? target.journalId : null,
          quarter_id: target.kind === 'rating' ? target.quarterId : null,
          staff_id: input.staffId,
          requested_by: access.accountId,
          reason: input.reason,
          // Overwritten by journal_unlocks_write.
          requested_at: now,
          status: 'sent',
          version: 1,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await sql`release savepoint unlock_request`.execute(transaction);
      id = row.id;
    } catch (error) {
      const failure = error as { code?: unknown };
      if (failure.code === UNIQUE_VIOLATION) {
        await sql`rollback to savepoint unlock_request`.execute(transaction);
        throw new ApiException('journal_unlock_waiting', 409);
      }
      throw error;
    }
    const row = await this.rowOf(transaction, branchId, id);
    const subject = await subjectOf(transaction, branchId, row);
    await this.audit.record(transaction, {
      branchId,
      actorId: access.accountId,
      assignmentId: input.assignmentId,
      action: 'journal.unlock_request',
      record: { type: 'journal_unlock', id },
      newValue: {
        target: target.kind,
        ...(target.kind === 'lesson'
          ? { lessonId: target.lessonId }
          : { journalId: target.journalId, quarterId: target.quarterId }),
        reason: input.reason,
      },
      requestId: input.requestId,
    });
    const holders = await postHolders(transaction, branchId, subject.subjectId, now);
    const told = firstTier(
      { accountId: access.accountId, posts: postsOf(holders, access.accountId) },
      holders,
      subject.on,
    );
    const name = (await staffNames(transaction, [input.staffId])).get(input.staffId) ?? '';
    if (subject.date !== null) {
      for (const accountId of told) {
        await this.notifications.send(transaction, {
          kind: 'journal.unlock_requested',
          branchId,
          accountIds: [accountId],
          data: {
            name: name === '' ? subject.unit.name : name,
            unit: subject.unit.name,
            date: subject.date,
          },
        });
      }
    }
    return this.answerOf(transaction, access, branchId, id);
  }

  // -------------------------------------------------------------------------
  // Decisions.

  /**
   * Approves with 1 to 7 days or refuses (`edge/journal`). Own first (403
   * `own_request`), then the routing (403 `journal_unlock_scope`), then the
   * state (409 `journal_unlock_decided`, `journal_unlock_cancelled`) and the
   * version (409 `journal_unlock_stale`).
   */
  decide(
    access: Access,
    unlockId: string,
    input: UnlockDecision,
    requestId: string,
  ): Promise<JournalUnlock> {
    const branchId = branchOf(access);
    const approve = input.decision === 'approve';
    return refusingClosedQuarter(() =>
      this.transactions.run(access.branchIds, async (transaction) => {
        const seen = await this.rowOf(transaction, branchId, unlockId);
        // Task 9.2b (From 8.4): an approval takes the quarter before the request's lock (the close
        // locks the quarter, then ends the open unlocks); it is refused after the routing.
        const quarterId = approve ? await quarterOfUnlock(transaction, branchId, seen) : null;
        await holdQuarter(transaction, quarterId);
        const row = await this.lockRow(transaction, unlockId);
        refuseOwnRequest(access.accountId, row.requested_by);
        const now = await transactionMoment(transaction);
        const today = schoolDateOf(now, await zoneOf(transaction, branchId));
        const subject = await subjectOf(transaction, branchId, row);
        const holders = await postHolders(transaction, branchId, subject.subjectId, now);
        const reach = decisionReach(
          { accountId: access.accountId, posts: postsOf(holders, access.accountId) },
          { accountId: row.requested_by, posts: postsOf(holders, row.requested_by) },
          subject.on,
        );
        if (reach !== 'decide') throw scopeRefusal();
        // Task 9.2b (From 8.4): an approval in a closed quarter is refused; a refusal still works.
        // 9.2c: a reopened journal takes one until its end.
        if (quarterId !== null) {
          await lockOpenJournalQuarter(
            transaction,
            quarterId,
            row.journal_id ?? (await lessonJournalOf(transaction, branchId, row.lesson_id)),
          );
        }
        if (row.status !== 'sent') throw new ApiException('journal_unlock_decided', 409);
        if (await outToday(transaction, branchId, row.staff_id, today)) {
          throw new ApiException('journal_unlock_cancelled', 409);
        }
        if (row.version !== input.version) throw new ApiException('journal_unlock_stale', 409);
        const updated = await transaction
          .updateTable('journal_unlocks')
          .set({
            status: approve ? 'approved' : 'refused',
            days: approve ? input.days : null,
            decided_by: access.accountId,
            refuse_reason: approve ? null : input.reason,
          })
          .where('id', '=', row.id)
          .returning(['open_until', 'version'])
          .executeTakeFirstOrThrow();
        await this.audit.record(transaction, {
          branchId,
          actorId: access.accountId,
          assignmentId: access.assignmentId,
          action: 'journal.unlock_decide',
          record: { type: 'journal_unlock', id: row.id },
          oldValue: { status: row.status, version: row.version },
          newValue: approve
            ? {
                status: 'approved',
                days: input.days,
                openUntil: updated.open_until?.toISOString() ?? null,
                version: updated.version,
              }
            : { status: 'refused', reason: input.reason, version: updated.version },
          requestId,
        });
        if (subject.date !== null) {
          if (approve && updated.open_until !== null) {
            const zone = await zoneOf(transaction, branchId);
            await this.notifications.send(transaction, {
              kind: 'journal.unlock_approved',
              branchId,
              accountIds: [row.requested_by],
              data: {
                unit: subject.unit.name,
                date: subject.date,
                // The last open day: the day before the stored 00:00.
                until: addDays(schoolDateOf(new Date(updated.open_until), zone), -1),
              },
            });
          } else if (!approve) {
            await this.notifications.send(transaction, {
              kind: 'journal.unlock_refused',
              branchId,
              accountIds: [row.requested_by],
              data: { unit: subject.unit.name, date: subject.date, reason: input.reason ?? '' },
            });
          }
        }
        return this.answerOf(transaction, access, branchId, row.id);
      }),
    );
  }

  /** The requester takes back a waiting request. */
  withdraw(
    access: Access,
    unlockId: string,
    input: UnlockWithdraw,
    requestId: string,
  ): Promise<JournalUnlock> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      await this.rowOf(transaction, branchId, unlockId);
      const row = await this.lockRow(transaction, unlockId);
      if (row.requested_by !== access.accountId) throw scopeRefusal();
      if (row.status !== 'sent') throw new ApiException('journal_unlock_decided', 409);
      if (row.version !== input.version) throw new ApiException('journal_unlock_stale', 409);
      await transaction
        .updateTable('journal_unlocks')
        .set({ status: 'withdrawn', decided_by: null })
        .where('id', '=', row.id)
        .execute();
      await this.audit.record(transaction, {
        branchId,
        actorId: access.accountId,
        assignmentId: access.assignmentId,
        action: 'journal.unlock_withdraw',
        record: { type: 'journal_unlock', id: row.id },
        oldValue: { status: row.status, version: row.version },
        newValue: { status: 'withdrawn' },
        requestId,
      });
      return this.answerOf(transaction, access, branchId, row.id);
    });
  }

  // -------------------------------------------------------------------------
  // Helpers.

  /** A request of the branch, 404 otherwise. */
  private async rowOf(
    transaction: Transaction,
    branchId: string,
    unlockId: string,
  ): Promise<UnlockRow> {
    const row = await transaction
      .selectFrom('journal_unlocks')
      .select(UNLOCK_COLUMNS)
      .where('id', '=', unlockId)
      .where('branch_id', '=', branchId)
      .executeTakeFirst();
    if (row === undefined) throw notFound();
    return row;
  }

  /** The request FOR UPDATE, then read again (`database.md`). */
  private async lockRow(transaction: Transaction, unlockId: string): Promise<UnlockRow> {
    await transaction
      .selectFrom('journal_unlocks')
      .select('id')
      .where('id', '=', unlockId)
      .forUpdate()
      .execute();
    return transaction
      .selectFrom('journal_unlocks')
      .select(UNLOCK_COLUMNS)
      .where('id', '=', unlockId)
      .executeTakeFirstOrThrow();
  }

  private async answerOf(
    transaction: Transaction,
    access: Access,
    branchId: string,
    unlockId: string,
  ): Promise<JournalUnlock> {
    const row = await this.rowOf(transaction, branchId, unlockId);
    const [answer] = await this.answersOf(transaction, access, branchId, [row]);
    if (answer === undefined) throw notFound();
    return answer;
  }
}

/**
 * Takes a quarter `for key share` with no refusal (task 9.2b; `.claude/rules/database.md`):
 * before the first row lock, so the close (the quarter `for update` first) never waits on a
 * writer that waits on it; the refusal (`lockOpenQuarter`) comes after the reading checks.
 */
async function holdQuarter(transaction: Transaction, quarterId: string | null): Promise<void> {
  if (quarterId === null) return;
  await transaction
    .selectFrom('quarters')
    .select('id')
    .where('id', '=', quarterId)
    .forKeyShare()
    .execute();
}

/** The quarter of a dated lesson of the branch (`lesson_quarter`, 0133), null when none. */
async function lessonQuarterOf(
  transaction: Transaction,
  branchId: string,
  lessonId: string,
): Promise<string | null> {
  const found = await sql<{ quarter: string | null }>`
    select lesson_quarter(l.id) as quarter from lessons l
    where l.id = ${lessonId}::uuid and l.branch_id = ${branchId}::uuid
  `.execute(transaction);
  return found.rows[0]?.quarter ?? null;
}

/** The journal of a dated lesson of the branch (`lesson_journal`, 0135). */
async function lessonJournalOf(
  transaction: Transaction,
  branchId: string,
  lessonId: string | null,
): Promise<string> {
  const found = await sql<{ journal: string | null }>`
    select lesson_journal(l.id) as journal from lessons l
    where l.id = ${lessonId}::uuid and l.branch_id = ${branchId}::uuid
  `.execute(transaction);
  const journal = found.rows[0]?.journal ?? null;
  // A request names a lesson of the branch, which has a journal (`journals`, 0081).
  if (journal === null) throw new Error('The lesson of the request has no journal.');
  return journal;
}

/** The quarter of a request: the rating exam's, or its lesson's. */
function quarterOfUnlock(
  transaction: Transaction,
  branchId: string,
  row: Pick<UnlockRow, 'lesson_id' | 'quarter_id'>,
): Promise<string | null> {
  return row.lesson_id === null
    ? Promise.resolve(row.quarter_id)
    : lessonQuarterOf(transaction, branchId, row.lesson_id);
}

async function zoneOf(transaction: Transaction, branchId: string): Promise<string> {
  const branch = await transaction
    .selectFrom('branches')
    .select('time_zone')
    .where('id', '=', branchId)
    .executeTakeFirstOrThrow();
  return branch.time_zone;
}

/**
 * What a request is on: the lesson's class or group, subject and date (a
 * Tutor's lesson when its subject is of a Tutors' department and it is a
 * class's, decision 11), or the rating exam's journal and date in force.
 */
async function subjectOf(
  transaction: Transaction,
  branchId: string,
  row: Pick<UnlockRow, 'lesson_id' | 'journal_id' | 'quarter_id'>,
): Promise<Subject> {
  if (row.lesson_id !== null) {
    const lesson = await transaction
      .selectFrom('lessons')
      .innerJoin('subjects', 'subjects.id', 'lessons.subject_id')
      .innerJoin('departments', 'departments.id', 'subjects.department_id')
      .leftJoin('classes', 'classes.id', 'lessons.class_id')
      .leftJoin('groups', 'groups.id', 'lessons.group_id')
      .select([
        sql<string>`lessons.lesson_date::text`.as('date'),
        'lessons.class_id',
        'lessons.group_id',
        'lessons.subject_id',
        'subjects.name_uz',
        'subjects.name_ru',
        'subjects.name_en',
        'subjects.colour',
        'departments.tutors',
        'classes.name as class_name',
        'classes.grade',
        'groups.name as group_name',
      ])
      .where('lessons.id', '=', row.lesson_id)
      .executeTakeFirstOrThrow();
    return {
      subjectId: lesson.subject_id,
      date: lesson.date,
      unit: {
        kind: lesson.class_id === null ? 'group' : 'class',
        id: lesson.class_id ?? lesson.group_id ?? '',
        name:
          lesson.class_id === null
            ? (lesson.group_name ?? '')
            : classDisplayName(lesson.grade ?? 0, lesson.class_name ?? ''),
      },
      subject: {
        id: lesson.subject_id,
        names: { uz: lesson.name_uz, ru: lesson.name_ru, en: lesson.name_en },
        colour: lesson.colour as JournalUnlock['subject']['colour'],
      },
      on: { tutorLesson: lesson.tutors && lesson.class_id !== null },
    };
  }
  const [journal] = await journalRows(transaction, branchId, { journalId: row.journal_id ?? '' });
  if (journal === undefined) throw notFound();
  const { date } = await ratingDateOf(transaction, journal.id, row.quarter_id ?? '');
  return {
    subjectId: journal.subjectId,
    date,
    unit: {
      kind: journal.classId === null ? 'group' : 'class',
      id: journal.classId ?? journal.groupId ?? '',
      name: journal.unitName,
    },
    subject: {
      id: journal.subjectId,
      names: journal.subject.names,
      colour: journal.subject.colour as JournalUnlock['subject']['colour'],
    },
    on: {},
  };
}
