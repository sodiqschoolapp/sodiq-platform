import { Injectable } from '@nestjs/common';
import {
  bulkCancelAnswerSchema,
  bulkCancelCheckAnswerSchema,
  classDisplayName,
  type BulkCancelAnswer,
  type BulkCancelBody,
  type BulkCancelCheckAnswer,
  type BulkCancelCheckBody,
  type BulkCancelChoice,
  type ErrorDetail,
} from '@sodiq/shared';
import { sql } from 'kysely';
import { RequestKeys } from '../../database/request-keys.js';
import { Transactions, transactionMoment, type Transaction } from '../../database/transactions.js';
import type { JsonValue } from '../../database/types.generated.js';
import { ApiException } from '../../http/api-exception.js';
import type { Access } from '../access/permission.guard.js';
import { Audit } from '../audit/audit.service.js';
import { branchOf } from '../classes/classes.service.js';
import { Notifications } from '../notifications/notifications.service.js';
import { notFound } from '../setup/setup-refusals.js';
import { DAY_REFUSALS, classSlotsOn, dayLessonsOf } from './day-changes.service.js';
import { dayBeginnings } from './dated-check.js';
import { PUBLISH_LOCK, lockPublishChain, refusingPublish } from './publish.service.js';
import { storedLessonsOn, type StoredDayLesson } from './stored-day.js';
import { sendWeekChanges, snapshotWeek } from './week-changes.js';

/** A chosen lesson slot of a class on the date, at the times of its own day (decision 2). */
interface Span {
  readonly classId: string;
  readonly lessonNumber: number;
  readonly startsAt: Date;
  readonly endsAt: Date;
}

/**
 * The blocks one choice covers: a block, with the other half of its double
 * when that comes in (decision 4); `blockId` the earlier one.
 */
interface Item {
  readonly blockId: string;
  readonly blockIds: readonly string[];
  /** The lessons of its blocks that are not cancelled. */
  readonly lessons: readonly StoredDayLesson[];
  /** Shared with a class not chosen. */
  readonly shared: boolean;
  /** The lessons fed by chosen classes alone, which a "keep" cancels too (decision 5). */
  readonly chosenOnly: readonly StoredDayLesson[];
  /** The lessons of a half outside the slots, brought in by its double. */
  readonly broughtIn: ReadonlySet<string>;
}

/** What a bulk cancel covers on its date, read under the locks for the save. */
interface Scope {
  readonly spans: readonly Span[];
  readonly items: readonly Item[];
  readonly alreadyCancelled: readonly StoredDayLesson[];
  readonly held: readonly StoredDayLesson[];
  readonly classNames: ReadonlyMap<string, string>;
  readonly classesOf: (lesson: StoredDayLesson) => readonly string[];
}

const byStart = (a: StoredDayLesson, b: StoredDayLesson) =>
  a.startsAt.getTime() - b.startsAt.getTime() || a.id.localeCompare(b.id);

const overlaps = (lesson: StoredDayLesson, span: Span) =>
  lesson.startsAt.getTime() < span.endsAt.getTime() &&
  span.startsAt.getTime() < lesson.endsAt.getTime();

/**
 * A bulk cancel of the published timetable (task 5.6a-3, pull request #162;
 * `06`, Changes after publishing: "Bulk cancel. For an event: chosen
 * classes, date and slots, with a reason."; edge/timetable, After
 * publishing: "7 Oxford goes on an excursion, and group 7-M-1 has students
 * from 7 Oxford and 7 Princeton. The bulk cancel lists such blocks. For each,
 * the Academic Vice Principal chooses: cancel the whole block, or keep it and
 * exempt the students of the chosen classes for those slots in the same
 * action."; edge/time-dates-calendar: "A bulk cancel is used instead, for the
 * whole branch from a chosen slot").
 *
 * A lesson is in scope when it is a lesson of a chosen class, or of a group
 * fed by one, overlapping by clock time one of the chosen lesson slots of
 * that class's own day on the date (decision 2). A block in scope is shared
 * when one of its lessons is fed by a class not chosen: it is cancelled whole
 * or kept, as chosen (decision 7); a kept block loses only its parts fed by
 * chosen classes alone (decision 5) and keeps its class claims (decision 6).
 * The other half of a double outside the slots comes in with the same
 * treatment (decision 4), unless it has started: then it is held and listed
 * (review correction 1). Started and past lessons in the slots are cancelled
 * (decision 8). A lesson already cancelled keeps its cause (decision 9).
 *
 * The save takes the locks of a one-day change (5.6a-1 decision 6), computes
 * the scope again and refuses when it differs from what the check listed
 * (decision 12); then cancels with cause `reason`, notifies each teacher once
 * with the week before and after (decision 11), stores the bulk cancel
 * (0086) and writes one audit entry (decision 13), in one transaction.
 */
@Injectable()
export class TimetableBulkCancels {
  constructor(
    private readonly transactions: Transactions,
    private readonly audit: Audit,
    private readonly requestKeys: RequestKeys,
    private readonly notifications: Notifications,
  ) {}

  /** What a bulk cancel of the input would do; writes nothing. */
  check(access: Access, input: BulkCancelCheckBody): Promise<BulkCancelCheckAnswer> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      await yearOfClasses(transaction, branchId, input);
      const scope = await scopeOf(transaction, branchId, input);
      if (scope.items.length === 0 && scope.alreadyCancelled.length === 0) {
        throw new ApiException('bulk_cancel_empty', 409);
      }
      const moment = await transactionMoment(transaction);
      const shown = await dayLessonsOf(
        transaction,
        [...scope.items.flatMap((item) => item.lessons), ...scope.alreadyCancelled, ...scope.held],
        moment,
      );
      const lessonOf = new Map(shown.map((one) => [one.id, one]));
      const show = (lessons: readonly StoredDayLesson[]) =>
        lessons.flatMap((one) => {
          const found = lessonOf.get(one.id);
          return found === undefined ? [] : [found];
        });
      const named = (ids: readonly string[]) =>
        [...ids]
          .map((id) => ({ id, name: scope.classNames.get(id) ?? '' }))
          .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
      const chosen = new Set(input.classIds);
      return bulkCancelCheckAnswerSchema.parse({
        date: input.date,
        cancel: scope.items
          .filter((item) => !item.shared)
          .flatMap((item) => item.lessons)
          .sort(byStart)
          .flatMap((one) => {
            const found = lessonOf.get(one.id);
            if (found === undefined) return [];
            const item = scope.items.find((each) => each.blockIds.includes(one.blockId));
            return [{ lesson: found, broughtIn: item?.broughtIn.has(one.id) ?? false }];
          }),
        shared: scope.items
          .filter((item) => item.shared)
          .map((item) => {
            const classes = new Set(item.lessons.flatMap((one) => scope.classesOf(one)));
            return {
              blockId: item.blockId,
              pairBlockId: item.blockIds.find((id) => id !== item.blockId) ?? null,
              lessons: show(item.lessons),
              chosenOnly: item.chosenOnly.map((one) => one.id),
              chosenClasses: named([...classes].filter((id) => chosen.has(id))),
              otherClasses: named([...classes].filter((id) => !chosen.has(id))),
            };
          }),
        alreadyCancelled: show(scope.alreadyCancelled),
        held: show(scope.held),
      });
    });
  }

  /** The bulk cancel with its reason and choices, safe to repeat with its key. */
  save(
    access: Access,
    input: BulkCancelBody,
    key: string,
    requestId: string,
  ): Promise<BulkCancelAnswer> {
    const branchId = branchOf(access);
    return refusingPublish(
      () =>
        this.transactions.run(access.branchIds, async (transaction) => {
          // The classes of the branch first, so an unknown or foreign id
          // never waits on a publish.
          await yearOfClasses(transaction, branchId, input);
          await sql`select pg_advisory_xact_lock(${PUBLISH_LOCK})`.execute(transaction);
          const once = await this.requestKeys.runOnce(
            transaction,
            {
              key,
              scope: 'timetable.bulk_cancel',
              accountId: access.accountId,
              input: {
                date: input.date,
                classIds: [...input.classIds].sort().join(','),
                lessonNumbers: input.lessonNumbers.join(','),
                reason: input.reason,
                blocks: [...input.blocks]
                  .sort((a, b) => a.blockId.localeCompare(b.blockId))
                  .map((one) => `${one.blockId}:${one.choice}`)
                  .join(','),
                lessonIds: [...input.lessonIds].sort().join(','),
              },
            },
            async () =>
              (await this.saveLocked(
                transaction,
                access,
                input,
                requestId,
              )) as unknown as JsonValue,
          );
          return bulkCancelAnswerSchema.parse(once.result);
        }),
      DAY_REFUSALS,
    );
  }

  private async saveLocked(
    transaction: Transaction,
    access: Access,
    input: BulkCancelBody,
    requestId: string,
  ): Promise<BulkCancelAnswer> {
    const branchId = branchOf(access);
    const yearId = await yearOfClasses(transaction, branchId, input);
    await lockPublishChain(transaction, branchId, yearId);
    const week = await snapshotWeek(transaction, branchId, input.date, input.date);
    const scope = await scopeOf(transaction, branchId, input);
    const moment = await transactionMoment(transaction);

    // What the check listed, against the scope read under the locks (decision 12).
    const sharedItems = scope.items.filter((item) => item.shared);
    const choiceOf = new Map(input.blocks.map((one) => [one.blockId, one.choice]));
    const missing = sharedItems.filter((item) => !choiceOf.has(item.blockId));
    if (missing.length > 0) {
      throw refusal(
        'bulk_choice_missing',
        'blocks',
        missing.map((item) => item.blockId),
      );
    }
    const sharedIds = new Set(sharedItems.map((item) => item.blockId));
    const unknown = input.blocks.filter((one) => !sharedIds.has(one.blockId));
    if (unknown.length > 0) {
      throw refusal(
        'bulk_choice_unknown',
        'blocks',
        unknown.map((one) => one.blockId),
      );
    }
    const plain = new Set(
      scope.items
        .filter((item) => !item.shared)
        .flatMap((item) => item.lessons.map((one) => one.id)),
    );
    const listed = new Set(input.lessonIds);
    const differ = [
      ...[...plain].filter((id) => !listed.has(id)),
      ...[...listed].filter((id) => !plain.has(id)),
    ].sort();
    if (differ.length > 0) {
      throw refusal('bulk_scope_changed', 'lessonIds', differ);
    }
    if (scope.items.length === 0) {
      throw new ApiException('bulk_cancel_empty', 409);
    }

    const cancelled = scope.items
      .flatMap((item) => {
        if (!item.shared) return item.lessons;
        return choiceOf.get(item.blockId) === 'cancel' ? item.lessons : item.chosenOnly;
      })
      .sort(byStart);
    const cancelledIds = cancelled.map((one) => one.id);
    if (cancelledIds.length > 0) {
      await transaction
        .updateTable('lessons')
        .set({ cancel_cause: 'reason', cancel_reason: input.reason })
        .where('id', 'in', cancelledIds)
        .execute();
    }

    const record = await transaction
      .insertInto('bulk_cancels')
      .values({
        branch_id: branchId,
        cancel_date: input.date,
        lesson_numbers: [...input.lessonNumbers],
        reason: input.reason,
        changed_at: moment,
        changed_by: access.accountId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await transaction
      .insertInto('bulk_cancel_classes')
      .values(
        [...input.classIds]
          .sort()
          .map((classId) => ({
            branch_id: branchId,
            bulk_cancel_id: record.id,
            class_id: classId,
          })),
      )
      .execute();
    if (scope.spans.length > 0) {
      await transaction
        .insertInto('bulk_cancel_spans')
        .values(
          scope.spans.map((span) => ({
            branch_id: branchId,
            bulk_cancel_id: record.id,
            class_id: span.classId,
            lesson_number: span.lessonNumber,
            starts_at: span.startsAt,
            ends_at: span.endsAt,
          })),
        )
        .execute();
    }
    const blockRows = sharedItems.flatMap((item) => {
      const choice: BulkCancelChoice = choiceOf.get(item.blockId) ?? 'cancel';
      return item.blockIds.map((blockId) => {
        const first = item.lessons.find((one) => one.blockId === blockId);
        if (first === undefined) throw new Error('A block of a shared item has no lesson.');
        return {
          branch_id: branchId,
          bulk_cancel_id: record.id,
          block_id: blockId,
          choice,
          lesson_date: first.date,
          starts_at: first.startsAt,
          ends_at: first.endsAt,
        };
      });
    });
    if (blockRows.length > 0) {
      await transaction.insertInto('bulk_cancel_blocks').values(blockRows).execute();
    }

    const notices = await sendWeekChanges(transaction, this.notifications, week, {
      kind: 'timetable.day_changed',
    });
    const kept = sharedItems
      .filter((item) => choiceOf.get(item.blockId) === 'keep')
      .flatMap((item) => item.blockIds);
    await this.audit.record(transaction, {
      branchId,
      actorId: access.accountId,
      assignmentId: access.assignmentId,
      action: 'lesson.bulk_cancel',
      record: { type: 'bulk_cancel', id: record.id },
      newValue: {
        date: input.date,
        classIds: [...input.classIds].sort(),
        lessonNumbers: [...input.lessonNumbers],
        spans: scope.spans.map((span) => ({
          classId: span.classId,
          lessonNumber: span.lessonNumber,
          startsAt: span.startsAt.toISOString(),
          endsAt: span.endsAt.toISOString(),
        })),
        reason: input.reason,
        lessonIds: cancelledIds,
        blocks: sharedItems.map((item) => ({
          blockIds: [...item.blockIds],
          choice: choiceOf.get(item.blockId) ?? 'cancel',
        })),
        alreadyCancelled: scope.alreadyCancelled.map((one) => one.id),
        held: scope.held.map((one) => one.id),
        notices: { ...notices },
      },
      requestId,
    });
    return { id: record.id, cancelled: cancelledIds, kept };
  }
}

/** A refusal that lists ids under one path. */
function refusal(
  code: 'bulk_choice_missing' | 'bulk_choice_unknown' | 'bulk_scope_changed',
  path: string,
  ids: readonly string[],
) {
  const details: ErrorDetail[] = ids.map((id) => ({
    path: `${path}.${id}`,
    code,
    message: 'An item the check and the save see differently.',
  }));
  return new ApiException(code, 409, undefined, details);
}

/**
 * The academic year of the date, whose active classes the input names: 404
 * for a class of another branch or an unknown one, `bulk_cancel_out_of_year`
 * for a date in no year of the branch, `class_not_active` for an archived
 * class or one of another year (decision 14).
 */
async function yearOfClasses(
  transaction: Transaction,
  branchId: string,
  input: BulkCancelCheckBody,
): Promise<string> {
  const classes = await transaction
    .selectFrom('classes')
    .select(['id', 'academic_year_id', 'archived_at'])
    .where('id', 'in', input.classIds)
    .where('branch_id', '=', branchId)
    .execute();
  if (classes.length !== input.classIds.length) {
    throw notFound();
  }
  const year = await transaction
    .selectFrom('academic_years')
    .select('id')
    .where('branch_id', '=', branchId)
    .where('start_date', '<=', input.date)
    .where('end_date', '>=', input.date)
    .executeTakeFirst();
  if (year === undefined) {
    throw new ApiException('bulk_cancel_out_of_year', 409);
  }
  const inactive = classes.filter(
    (one) => one.archived_at !== null || one.academic_year_id !== year.id,
  );
  if (inactive.length > 0) {
    throw new ApiException(
      'class_not_active',
      409,
      undefined,
      inactive.map((one) => ({
        path: `classIds.${one.id}`,
        code: 'class_not_active',
        message: 'An archived class, or one of another academic year.',
      })),
    );
  }
  return year.id;
}

/** What a bulk cancel of the input covers on its date (see the class's comment). */
async function scopeOf(
  transaction: Transaction,
  branchId: string,
  input: BulkCancelCheckBody,
): Promise<Scope> {
  await yearOfClasses(transaction, branchId, input);
  const moment = await transactionMoment(transaction);
  const branch = await transaction
    .selectFrom('branches')
    .select('time_zone')
    .where('id', '=', branchId)
    .executeTakeFirstOrThrow();
  const begins = await dayBeginnings(transaction, branch.time_zone, input.date, input.date);
  const dayStart = begins(input.date).getTime();
  const wanted = new Set(input.lessonNumbers);
  const spans: Span[] = [];
  for (const classId of [...input.classIds].sort()) {
    const slots = await classSlotsOn(transaction, branchId, classId, input.date);
    for (const slot of slots) {
      if (!wanted.has(slot.lessonNumber)) continue;
      spans.push({
        classId,
        lessonNumber: slot.lessonNumber,
        startsAt: new Date(dayStart + slot.start * 60_000),
        endsAt: new Date(dayStart + slot.end * 60_000),
      });
    }
  }
  const lessons = await storedLessonsOn(transaction, branchId, input.date);
  const groupIds = [
    ...new Set(lessons.flatMap((one) => (one.groupId === null ? [] : [one.groupId]))),
  ];
  const feeds =
    groupIds.length === 0
      ? []
      : await transaction
          .selectFrom('group_classes')
          .select(['group_id', 'class_id'])
          .where('group_id', 'in', groupIds)
          .orderBy('class_id')
          .execute();
  const fedBy = new Map<string, string[]>();
  for (const one of feeds)
    fedBy.set(one.group_id, [...(fedBy.get(one.group_id) ?? []), one.class_id]);
  const classesOf = (lesson: StoredDayLesson): readonly string[] =>
    lesson.classId !== null ? [lesson.classId] : (fedBy.get(lesson.groupId ?? '') ?? []);
  const chosen = new Set(input.classIds);
  const spansOf = new Map<string, Span[]>();
  for (const span of spans) spansOf.set(span.classId, [...(spansOf.get(span.classId) ?? []), span]);
  const inSlots = (lesson: StoredDayLesson) =>
    classesOf(lesson).some(
      (classId) =>
        chosen.has(classId) && (spansOf.get(classId) ?? []).some((span) => overlaps(lesson, span)),
    );

  const held = (one: StoredDayLesson) => one.cancelCause === null;
  const alreadyCancelled = lessons.filter((one) => !held(one) && inSlots(one)).sort(byStart);
  const blockIds = [
    ...new Set(lessons.filter((one) => held(one) && inSlots(one)).map((one) => one.blockId)),
  ];
  const lessonsOfBlock = (blockId: string) => lessons.filter((one) => one.blockId === blockId);
  const pairOfBlock = new Map<string, string | null>(
    lessons.map((one) => [one.blockId, one.doublePairId]),
  );
  const startOfBlock = (blockId: string) => lessonsOfBlock(blockId)[0]?.startsAt.getTime() ?? 0;

  const items: Item[] = [];
  const heldHalves: StoredDayLesson[] = [];
  const taken = new Set<string>();
  for (const blockId of blockIds.sort(
    (a, b) => startOfBlock(a) - startOfBlock(b) || a.localeCompare(b),
  )) {
    if (taken.has(blockId)) continue;
    const pair = pairOfBlock.get(blockId) ?? null;
    const partners =
      pair === null
        ? []
        : [
            ...new Set(
              lessons
                .filter((one) => one.doublePairId === pair && one.blockId !== blockId)
                .map((one) => one.blockId),
            ),
          ];
    const members = [blockId];
    const broughtIn = new Set<string>();
    for (const partner of partners) {
      if (blockIds.includes(partner)) {
        members.push(partner);
        continue;
      }
      const partnerLessons = lessonsOfBlock(partner).filter(held);
      // A half outside the slots that has started stays held (review correction 1).
      if (partnerLessons.some((one) => one.startsAt.getTime() <= moment.getTime())) {
        heldHalves.push(...partnerLessons);
        continue;
      }
      members.push(partner);
      for (const one of partnerLessons) broughtIn.add(one.id);
    }
    for (const member of members) taken.add(member);
    members.sort((a, b) => startOfBlock(a) - startOfBlock(b) || a.localeCompare(b));
    const itemLessons = members
      .flatMap((member) => lessonsOfBlock(member).filter(held))
      .sort(byStart);
    const shared = itemLessons.some((one) =>
      classesOf(one).some((classId) => !chosen.has(classId)),
    );
    const chosenOnly = itemLessons.filter((one) => {
      const classes = classesOf(one);
      return classes.length > 0 && classes.every((classId) => chosen.has(classId));
    });
    items.push({
      blockId: members[0] ?? blockId,
      blockIds: members,
      lessons: itemLessons,
      shared,
      chosenOnly,
      broughtIn,
    });
  }

  const classIds = [
    ...new Set([...input.classIds, ...items.flatMap((item) => item.lessons.flatMap(classesOf))]),
  ];
  const classes = await transaction
    .selectFrom('classes')
    .select(['id', 'grade', 'name'])
    .where('id', 'in', classIds)
    .execute();
  return {
    spans,
    items,
    alreadyCancelled,
    held: heldHalves.sort(byStart),
    classNames: new Map(classes.map((one) => [one.id, classDisplayName(one.grade, one.name)])),
    classesOf,
  };
}
