import { sql } from 'kysely';
import { transactionMoment, type Transaction } from '../../database/transactions.js';
import type { Audit } from '../audit/audit.service.js';
import type { Notifications } from '../notifications/notifications.service.js';
import { addDays } from './exemption-effects.js';

/**
 * What the changes of a student's record do to the student's exemptions
 * (task 8.5, pull request #223; `edge/exemptions`: "The exemption belongs to
 * the student and follows a transfer. It ends on leaving. On a branch move it
 * goes to the new branch's Academic Vice Principal to confirm or drop").
 * A transfer needs nothing: the exemption names the student, not a class.
 */

interface Actor {
  readonly branchId: string;
  readonly actorId: string;
  readonly assignmentId: string;
  readonly requestId: string;
}

/**
 * A leaving (decision 14, `edge/students-classes-groups`: "Open exemptions
 * end"): the leaving taken back gives back the ends and voids it wrote; a new
 * leaving ends each live exemption running past its last day on that day and
 * voids one that starts after it, keeping the end it cut. One audit entry each
 * way, when anything changed.
 */
export async function exemptionsFollowLeaving(
  transaction: Transaction,
  audit: Audit,
  actor: Actor,
  input: {
    readonly studentId: string;
    readonly takenBack: string | null;
    readonly leaving: { readonly id: string; readonly firstInactiveDay: string } | null;
  },
): Promise<void> {
  if (input.takenBack !== null) {
    const cut = await transaction
      .selectFrom('exemptions')
      .select(['id', sql<string>`end_before_leaving::text`.as('end'), 'voided_at'])
      .where('leaving_id', '=', input.takenBack)
      .where('branch_id', '=', actor.branchId)
      .orderBy('id')
      .forUpdate()
      .execute();
    for (const row of cut) {
      await transaction
        .updateTable('exemptions')
        .set(
          row.voided_at === null
            ? { end_date: row.end, leaving_id: null, end_before_leaving: null }
            : {
                voided_at: null,
                voided_by: null,
                void_cause: null,
                leaving_id: null,
                end_before_leaving: null,
              },
        )
        .where('id', '=', row.id)
        .execute();
    }
    if (cut.length > 0) {
      await audit.record(transaction, {
        branchId: actor.branchId,
        actorId: actor.actorId,
        assignmentId: actor.assignmentId,
        action: 'exemption.leaving_undo',
        record: { type: 'student', id: input.studentId },
        newValue: { exemptionIds: cut.map((row) => row.id), leavingId: input.takenBack },
        requestId: actor.requestId,
      });
    }
  }
  if (input.leaving !== null) {
    const lastDay = addDays(input.leaving.firstInactiveDay, -1);
    const live = await transaction
      .selectFrom('exemptions')
      .select([
        'id',
        sql<string>`start_date::text`.as('start'),
        sql<string>`end_date::text`.as('end'),
      ])
      .where('student_id', '=', input.studentId)
      .where('branch_id', '=', actor.branchId)
      .where('voided_at', 'is', null)
      .where('end_date', '>', lastDay)
      .orderBy('id')
      .forUpdate()
      .execute();
    const moment = await transactionMoment(transaction);
    const changed: { id: string; endBefore: string; voided: boolean }[] = [];
    for (const row of live) {
      const voided = row.start > lastDay;
      await transaction
        .updateTable('exemptions')
        .set(
          voided
            ? {
                voided_at: moment,
                voided_by: actor.actorId,
                void_cause: 'leaving',
                leaving_id: input.leaving.id,
                end_before_leaving: row.end,
              }
            : { end_date: lastDay, leaving_id: input.leaving.id, end_before_leaving: row.end },
        )
        .where('id', '=', row.id)
        .execute();
      changed.push({ id: row.id, endBefore: row.end, voided });
    }
    if (changed.length > 0) {
      await audit.record(transaction, {
        branchId: actor.branchId,
        actorId: actor.actorId,
        assignmentId: actor.assignmentId,
        action: 'exemption.leaving',
        record: { type: 'student', id: input.studentId },
        newValue: { leavingId: input.leaving.id, lastDay, exemptions: changed },
        requestId: actor.requestId,
      });
    }
  }
}

/**
 * An accepted move to another branch (decision 3, Look first): each live
 * exemption of the sending branch running on or after the move's date ends
 * the day before (one that starts on it or later is voided), and the
 * receiving branch gets an offer with the dates still to run, which its
 * Academic Vice Principal confirms or drops. The audit entry of the sending
 * branch holds ids and dates only; the receiving branch's holds the offer.
 */
export async function exemptionsFollowBranchMove(
  transaction: Transaction,
  audit: Audit,
  notifications: Notifications,
  actor: Actor,
  input: {
    readonly moveId: string;
    readonly studentId: string;
    readonly fromBranchId: string;
    readonly from: string;
  },
): Promise<void> {
  const live = await transaction
    .selectFrom('exemptions')
    .select([
      'id',
      'kind',
      'all_subjects',
      sql<string>`start_date::text`.as('start'),
      sql<string>`end_date::text`.as('end'),
      'start_time',
      'end_time',
      'category',
      'detail',
      'document_key',
      'document_type',
      'document_name',
    ])
    .where('student_id', '=', input.studentId)
    .where('branch_id', '=', input.fromBranchId)
    .where('voided_at', 'is', null)
    .where('end_date', '>=', input.from)
    .orderBy('id')
    .forUpdate()
    .execute();
  if (live.length === 0) return;
  const moment = await transactionMoment(transaction);
  const offers: string[] = [];
  for (const row of live) {
    const subjects = row.all_subjects
      ? []
      : (
          await transaction
            .selectFrom('exemption_subjects')
            .select('subject_id')
            .where('exemption_id', '=', row.id)
            .orderBy('subject_id')
            .execute()
        ).map((one) => one.subject_id);
    await transaction
      .updateTable('exemptions')
      .set(
        row.start >= input.from
          ? { voided_at: moment, voided_by: actor.actorId, void_cause: 'branch_move' }
          : { end_date: addDays(input.from, -1), end_cause: 'branch_move' },
      )
      .where('id', '=', row.id)
      .execute();
    const offer = await transaction
      .insertInto('exemption_move_offers')
      .values({
        branch_id: actor.branchId,
        move_id: input.moveId,
        source_id: row.id,
        student_id: input.studentId,
        kind: row.kind,
        all_subjects: row.all_subjects,
        subject_ids: subjects,
        start_date: row.start > input.from ? row.start : input.from,
        end_date: row.end,
        start_time: row.start_time,
        end_time: row.end_time,
        category: row.category,
        detail: row.detail,
        document_key: row.document_key,
        document_type: row.document_type,
        document_name: row.document_name,
        offered_at: moment,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    offers.push(offer.id);
  }
  await audit.record(transaction, {
    branchId: input.fromBranchId,
    actorId: actor.actorId,
    action: 'exemption.branch_move',
    record: { type: 'student', id: input.studentId },
    newValue: {
      moveId: input.moveId,
      from: input.from,
      exemptions: live.map((row) => ({ id: row.id, start: row.start, end: row.end })),
    },
    requestId: actor.requestId,
  });
  await audit.record(transaction, {
    branchId: actor.branchId,
    actorId: actor.actorId,
    assignmentId: actor.assignmentId,
    action: 'exemption.offer',
    record: { type: 'student', id: input.studentId },
    newValue: { moveId: input.moveId, offerIds: offers },
    requestId: actor.requestId,
  });
  const vices = await sql<{ account_id: string }>`
    select distinct a.account_id from assignments a
    where a.role = 'academic_vice_principal' and a.branch_id = ${actor.branchId}::uuid
      and a.valid_from <= ${moment}::timestamptz
      and (a.valid_until is null or a.valid_until > ${moment}::timestamptz)
      and a.account_id <> ${actor.actorId}::uuid
  `.execute(transaction);
  if (vices.rows.length === 0) return;
  const student = await transaction
    .selectFrom('students')
    .select(['first_name', 'last_name'])
    .where('id', '=', input.studentId)
    .executeTakeFirstOrThrow();
  for (const row of live) {
    await notifications.send(transaction, {
      kind: 'journal.exemption_offer',
      branchId: actor.branchId,
      accountIds: vices.rows.map((one) => one.account_id),
      data: {
        student: `${student.last_name} ${student.first_name}`.trim() || '—',
        from: row.start > input.from ? row.start : input.from,
        until: row.end,
      },
    });
  }
}

/**
 * The notice of a kept block (From 5.6a-3: "sends the exemption notice to the
 * Tutor and the teachers of the kept lessons"): for each held lesson of the
 * blocks that takes students out (`lesson_kept_out_students`, 0123), one
 * notice to the lesson's teacher and the Tutors of the classes taken out on
 * the date, never to the person who made the change.
 */
export async function noticeKeptBlocks(
  transaction: Transaction,
  notifications: Notifications,
  input: {
    readonly branchId: string;
    readonly blockIds: readonly string[];
    readonly actorId: string;
  },
): Promise<number> {
  if (input.blockIds.length === 0) return 0;
  const found = await sql<{
    lesson_id: string;
    date: string;
    start: string;
    unit: string;
    teacher_account: string | null;
    classes: string;
    tutors: string[] | null;
  }>`
    with lessons_kept as (
      select l.id, l.lesson_date, l.starts_at, l.class_id, l.group_id, l.teacher_id, b.time_zone
      from lessons l
      join branches b on b.id = l.branch_id
      where l.block_id = any(${[...input.blockIds]}::uuid[]) and l.cancel_cause is null
    ),
    out_classes as (
      select k.id as lesson_id, m.class_id
      from lessons_kept k
      cross join lateral lesson_kept_out_students(k.id) as o(student_id)
      join class_memberships m on m.student_id = o.student_id
        and m.valid_from <= k.lesson_date and k.lesson_date < m.valid_until
      group by k.id, m.class_id
    )
    select k.id as lesson_id, k.lesson_date::text as date,
      to_char(k.starts_at at time zone k.time_zone, 'HH24:MI') as start,
      coalesce(g.name, c.grade::text || ' ' || c.name) as unit,
      st.account_id as teacher_account,
      string_agg(distinct oc.grade::text || ' ' || oc.name, ', ') as classes,
      array_remove(array_agg(distinct a.account_id), null) as tutors
    from lessons_kept k
    join out_classes o on o.lesson_id = k.id
    join classes oc on oc.id = o.class_id
    left join groups g on g.id = k.group_id
    left join classes c on c.id = k.class_id
    left join staff st on st.id = k.teacher_id
    left join class_tutors t on t.class_id = o.class_id
      and t.valid_from < ((k.lesson_date + 1)::timestamp at time zone k.time_zone)
      and (t.valid_until is null or t.valid_until > (k.lesson_date::timestamp at time zone k.time_zone))
    left join assignments a on a.id = t.assignment_id
    group by k.id, k.lesson_date, k.starts_at, k.time_zone, g.name, c.grade, c.name, st.account_id
    order by k.starts_at, k.id
  `.execute(transaction);
  let sent = 0;
  for (const row of found.rows) {
    const accounts = [
      ...new Set([
        ...(row.tutors ?? []),
        ...(row.teacher_account === null ? [] : [row.teacher_account]),
      ]),
    ].filter((one) => one !== input.actorId);
    if (accounts.length === 0) continue;
    await notifications.send(transaction, {
      kind: 'journal.exemption_kept_block',
      branchId: input.branchId,
      accountIds: accounts.sort(),
      data: { unit: row.unit, date: row.date, start: row.start, classes: row.classes },
    });
    sent += 1;
  }
  return sent;
}
