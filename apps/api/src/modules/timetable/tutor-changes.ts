import { addDays, mondayOf } from '@sodiq/timetable-rules';
import { transactionMoment, type Transaction } from '../../database/transactions.js';
import type { Notifications } from '../notifications/notifications.service.js';
import { storedLessonRows, type StoredLesson } from './stored-lessons.js';
import type { TutorFollow } from './tutor-lessons.js';
import { sendTeacherWeeks, type WeekNotices } from './week-changes.js';

/**
 * The notice and the "changed" mark of a Tutor change (task 5.5c-3b, pull
 * request #159; From line of 3.6c-2, decision 9 with review correction 5: a
 * change of a class's Tutor that moves its dated Tutor lessons notifies the
 * old and the new Tutor as a teacher change does, and the lessons it moved
 * carry the "changed" mark for a week; `06`, How surprises are prevented,
 * Everyone is told; edge/timetable, After publishing: "One notice per person
 * per event, with the week before and after. A teacher whose week did not
 * change gets none.").
 *
 * The comparison is built from the follows (decision 2): `followTutors` locks
 * the class's Tutor lessons and writes only their teacher, so the side before
 * is the side after with each changed lesson's teacher set back.
 */

/** A lesson whose teacher one request changed: its teacher before and after, `null` for "needs a teacher". */
export interface TutorChange {
  readonly lessonId: string;
  readonly from: string | null;
  readonly to: string | null;
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The follows of one request, in their order, as one change per lesson: its
 * first `from` and its last teacher. A lesson whose last teacher is its first
 * `from` did not change and is left out (spec review must-fixes 1 and 2: a
 * lesson that needed a teacher and is set to need one again, or one given back
 * and taken away again by a `left` moved to another date).
 */
export function tutorChanges(follows: readonly TutorFollow[]): TutorChange[] {
  const changes = new Map<string, { from: string | null; to: string | null }>();
  const step = (lessonId: string, from: string | null, to: string | null) => {
    const known = changes.get(lessonId);
    changes.set(lessonId, { from: known === undefined ? from : known.from, to });
  };
  for (const follow of follows) {
    for (const one of follow.moved) step(one.lessonId, one.from, one.to);
    for (const one of follow.needsTeacher) step(one.lessonId, one.from, null);
  }
  return [...changes.entries()]
    .filter(([, change]) => change.from !== change.to)
    .map(([lessonId, change]) => ({ lessonId, ...change }))
    .sort((a, b) => compare(a.lessonId, b.lessonId));
}

/** What sends the notices: the `Notifications` service. */
export type NoticeSender = Pick<Notifications, 'send'>;

const ROWS = 500;

/**
 * Marks the changed lessons with the transaction's moment and sends one
 * notice, kind `timetable.tutor_changed`, to each teacher with an account
 * (never a vacancy) whose week changed, per branch of the lessons (decision
 * 1): the old and the new teacher of each lesson, the week of that teacher's
 * earliest changed lesson. Called once per request, after its last follow.
 */
export async function sendTutorChanges(
  transaction: Transaction,
  notifications: NoticeSender,
  changes: readonly TutorChange[],
): Promise<WeekNotices> {
  if (changes.length === 0) {
    return { notified: 0, marked: 0 };
  }
  const lessons = await transaction
    .selectFrom('lessons')
    .select(['id', 'branch_id', (eb) => eb.cast<string>('lesson_date', 'text').as('lesson_date')])
    .where(
      'id',
      'in',
      changes.map((one) => one.lessonId),
    )
    .orderBy('id')
    .execute();
  const lessonOf = new Map(lessons.map((one) => [one.id, one]));

  const moment = await transactionMoment(transaction);
  for (let at = 0; at < lessons.length; at += ROWS) {
    await transaction
      .insertInto('lesson_changes')
      .values(
        lessons.slice(at, at + ROWS).map((one) => ({
          lesson_id: one.id,
          branch_id: one.branch_id,
          changed_at: moment,
        })),
      )
      .onConflict((conflict) =>
        conflict.column('lesson_id').doUpdateSet((update) => ({
          changed_at: update.ref('excluded.changed_at'),
        })),
      )
      .execute();
  }

  const branches = [...new Set(lessons.map((one) => one.branch_id))].sort(compare);
  let notified = 0;
  for (const branchId of branches) {
    const here = changes.filter((one) => lessonOf.get(one.lessonId)?.branch_id === branchId);
    const earliest = new Map<string, string>();
    for (const change of here) {
      const date = lessonOf.get(change.lessonId)?.lesson_date ?? '';
      for (const teacherId of [change.from, change.to]) {
        if (teacherId === null) continue;
        const known = earliest.get(teacherId);
        if (known === undefined || date < known) earliest.set(teacherId, date);
      }
    }
    const teachers = new Map(
      [...earliest.entries()]
        .sort(([a], [b]) => compare(a, b))
        .map(([id, date]) => [id, mondayOf(date)]),
    );
    const after: StoredLesson[] = [];
    for (const monday of [...new Set(teachers.values())].sort(compare)) {
      after.push(
        ...(await storedLessonRows(transaction, {
          branchId,
          firstDate: monday,
          lastDate: addDays(monday, 6),
          classIdsOf: () => undefined,
          cancelled: 'one_day',
          lock: false,
        })),
      );
    }
    const fromOf = new Map(here.map((one) => [one.lessonId, one.from]));
    const before = after.map((one): StoredLesson => {
      if (!fromOf.has(one.id)) return one;
      const from = fromOf.get(one.id) ?? null;
      return { ...one, lesson: { ...one.lesson, teacherIds: from === null ? [] : [from] } };
    });
    const differs = new Set(fromOf.keys());
    notified += await sendTeacherWeeks(transaction, {
      branchId,
      teachers,
      before,
      after,
      beforeDiffers: differs,
      afterDiffers: differs,
      send: (accountId, week) =>
        notifications.send(transaction, {
          kind: 'timetable.tutor_changed',
          branchId,
          accountIds: [accountId],
          data: week,
        }),
    });
  }
  return { notified, marked: lessons.length };
}
