import type { ErrorCode, ErrorDetail, SchoolDate } from '@sodiq/shared';
import { sql } from 'kysely';
import type { Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import type { Access } from '../access/permission.guard.js';
import type { Audit } from '../audit/audit.service.js';
import { notFound } from '../setup/setup-refusals.js';
import {
  groupMembershipsOf,
  lockGroups,
  peakWith,
  type HeldRange,
  type StoredGroupMembership,
} from './group-membership-rows.js';
import { classesOfGroups } from './group-rows.js';
import { writtenByCancelledMove } from './membership-plan.js';

/**
 * Groups on every class membership path (task 3.2c, pull request #93):
 * `edge/students-classes-groups`, first row, "A class membership cannot be
 * saved without a group for every split or group subject of that class, from
 * the same date. Bulk placement puts students into the smallest suitable
 * group and tags them \"placed automatically, review\"."
 *
 * Every path that writes a class row ("Put into a class", the create of a
 * student with a class, the cancel and the undo of a leaving, the replace of
 * a scheduled leaving) covers each day of the row with a group row of every
 * split or group subject of its class, in its transaction: a cancel or an
 * undo first gives back the group rows the leaving cut (decision 6), then
 * every day still without a group of a subject gets the smallest suitable
 * group (decision 7). The database checks the same at the commit
 * (`class_memberships_need_groups`, 0049).
 *
 * Lock order (decision 9): the students FOR UPDATE by id, the classes of the
 * rows FOR UPDATE by id, then every group the change may touch FOR UPDATE by
 * id in one call (`lockClassGroups`), then the writes.
 */

/** The refusal of the database from the class side, answered only as a fault (decision 1). */
export const CLASS_GROUP_REFUSALS: Readonly<Record<string, ErrorCode>> = {
  class_memberships_need_groups: 'class_group_missing',
};

/** A group as a class path reads it, after its lock. */
export interface CoverGroup {
  id: string;
  branchId: string;
  subjectId: string;
  nameKey: string;
  maxSize: number;
  /** Not archived, in a year that is not closed. */
  inService: boolean;
  classIds: ReadonlySet<string>;
}

/** A class row the change writes, whose days need groups. */
export interface ClassRowToCover {
  studentId: string;
  classId: string;
  from: SchoolDate;
  /** The end in force: the own end, or the first inactive day of a scheduled leaving. */
  until: SchoolDate;
  ownUntil: SchoolDate;
  /** The leaving that cuts the row, if any. */
  leavingId: string | null;
  /** The move that cuts the row at `until`, if any (a row given back up to a later move, task 3.5c). */
  endedByMoveId?: string | null;
}

/** A group row a class path writes, or gives back by growing it (`growId`, task 3.5c). */
export interface CoverRow {
  studentId: string;
  groupId: string;
  subjectId: string;
  branchId: string;
  from: SchoolDate;
  until: SchoolDate;
  ownUntil: SchoolDate;
  leavingId: string | null;
  cause: 'automatic' | 'cancel' | 'undo';
  review: boolean;
  /** The move whose action writes the row (task 3.3a, 0050), if any. */
  writtenByMoveId: string | null;
  /** The move that cuts the row at `until` (task 3.5c), if any. */
  endedByMoveId: string | null;
  /** The row a take-back grows again (task 3.5c, decision 1), instead of a new row. */
  growId?: string;
}

/** A group row written, as the audit entry of the change names it (should-fix 9). */
export interface GroupRowWritten {
  id: string;
  studentId: string;
  groupId: string;
  subjectId: string;
  from: SchoolDate;
  until: SchoolDate;
  cause: CoverRow['cause'];
  review: boolean;
}

/** The ids of the active groups that draw from the classes, by id. */
async function groupsDrawingFrom(
  transaction: Transaction,
  classIds: readonly string[],
): Promise<string[]> {
  if (classIds.length === 0) {
    return [];
  }
  const rows = await transaction
    .selectFrom('group_classes')
    .innerJoin('groups', 'groups.id', 'group_classes.group_id')
    .select('groups.id')
    .where('group_classes.class_id', 'in', [...classIds])
    .where('groups.archived_at', 'is', null)
    .execute();
  return [...new Set(rows.map((row) => row.id.toLowerCase()))].sort();
}

/**
 * Every group a class path may touch, locked FOR UPDATE in the order of
 * their id in one call (spec review of the plan, should-fix 2): the active
 * groups that draw from the classes of the rows it writes, and the groups of
 * the student's own group rows (`others`: the rows a leaving cuts or a cancel
 * gives back). Called after the classes are locked FOR UPDATE, so a group
 * create or edit, which takes its classes FOR SHARE first, has either
 * committed and is read here, or waits for this change. Then read.
 */
export async function lockClassGroups(
  transaction: Transaction,
  classIds: readonly string[],
  others: readonly string[],
): Promise<Map<string, CoverGroup>> {
  const drawing = await groupsDrawingFrom(transaction, classIds);
  const ids = [...new Set([...drawing, ...others.map((id) => id.toLowerCase())])].sort();
  await lockGroups(transaction, ids);
  const found = new Map<string, CoverGroup>();
  if (ids.length === 0) {
    return found;
  }
  const rows = await transaction
    .selectFrom('groups')
    .innerJoin('academic_years', 'academic_years.id', 'groups.academic_year_id')
    .select([
      'groups.id',
      'groups.branch_id',
      'groups.subject_id',
      'groups.name',
      'groups.name_key',
      'groups.max_size',
      'groups.archived_at',
      'academic_years.status',
    ])
    .where('groups.id', 'in', ids)
    .execute();
  const classes = await classesOfGroups(
    transaction,
    rows.map((row) => row.id),
  );
  for (const row of rows) {
    found.set(row.id.toLowerCase(), {
      id: row.id,
      branchId: row.branch_id,
      subjectId: row.subject_id,
      // A generated column (0046), never empty for a stored name.
      nameKey: row.name_key ?? row.name,
      maxSize: row.max_size,
      inService: row.archived_at === null && row.status !== 'closed',
      classIds: new Set((classes.get(row.id) ?? []).map((one) => one.id.toLowerCase())),
    });
  }
  return found;
}

/**
 * `lockClassGroups` for a placement into classes (decision 9), before its
 * first write: the active groups of the classes and the groups of the
 * students' own rows.
 */
export async function lockPlacementGroups(
  transaction: Transaction,
  classIds: readonly string[],
  studentIds: readonly string[],
): Promise<Map<string, CoverGroup>> {
  const own: string[] = [];
  for (const id of studentIds) {
    own.push(...(await groupMembershipsOf(transaction, id)).map((row) => row.groupId));
  }
  return lockClassGroups(transaction, classIds, own);
}

/**
 * The rows with days of each group, as the seats are counted: those stored
 * (read once, when a group is first asked) and those this change adds.
 */
export class SeatBook {
  private readonly stored = new Map<string, HeldRange[]>();
  private readonly added = new Map<string, HeldRange[]>();

  constructor(private readonly transaction: Transaction) {}

  /** The stored rows with days of the group. */
  async storedOf(groupId: string): Promise<HeldRange[]> {
    const key = groupId.toLowerCase();
    const known = this.stored.get(key);
    if (known !== undefined) {
      return known;
    }
    const rows = await this.transaction
      .selectFrom('group_memberships')
      .select(['valid_from', 'valid_until'])
      .where('group_id', '=', groupId)
      .whereRef('valid_from', '<', 'valid_until')
      .execute();
    const ranges = rows.map((row) => ({ from: row.valid_from, until: row.valid_until }));
    this.stored.set(key, ranges);
    return ranges;
  }

  addedTo(groupId: string): HeldRange[] {
    return this.added.get(groupId.toLowerCase()) ?? [];
  }

  /** Whether the group has a seat on every day of `range`, the rows added so far counted. */
  async fits(group: { id: string; maxSize: number }, range: HeldRange): Promise<boolean> {
    if (range.from >= range.until) {
      return true;
    }
    return (
      peakWith(await this.storedOf(group.id), [...this.addedTo(group.id), range]) <= group.maxSize
    );
  }

  /** The members of the group on `day`, the rows added so far counted. */
  async membersOn(groupId: string, day: SchoolDate): Promise<number> {
    return [...(await this.storedOf(groupId)), ...this.addedTo(groupId)].filter(
      (range) => range.from <= day && day < range.until,
    ).length;
  }

  add(groupId: string, range: HeldRange): void {
    if (range.from >= range.until) {
      return;
    }
    const key = groupId.toLowerCase();
    this.added.set(key, [...(this.added.get(key) ?? []), range]);
  }
}

/**
 * "The smallest suitable group" (`edge/students-classes-groups`; 3.2b,
 * decisions 12 and 13; this task, decision 7), one rule for the placement
 * screen and the class paths: among the groups offered, one with a free seat
 * on every day of `range` (the rows of this change counted), the fewest
 * members on its first day, ties by name then id. `undefined` when none has
 * a seat.
 */
export async function smallestGroup<G extends { id: string; maxSize: number; nameKey: string }>(
  book: SeatBook,
  groups: readonly G[],
  range: HeldRange,
): Promise<G | undefined> {
  const options: { group: G; members: number }[] = [];
  for (const group of groups) {
    if (await book.fits(group, range)) {
      options.push({ group, members: await book.membersOn(group.id, range.from) });
    }
  }
  options.sort(
    (a, b) =>
      a.members - b.members ||
      a.group.nameKey.localeCompare(b.group.nameKey) ||
      a.group.id.localeCompare(b.group.id),
  );
  return options[0]?.group;
}

const later = (a: SchoolDate, b: SchoolDate): SchoolDate => (a > b ? a : b);

/**
 * A change taken back: a leaving (a cancel, an undo, a replace), with its row
 * and first inactive day, or a move (its cancel or undo, task 3.3a), with its
 * date. The rows it cut come back from `from`.
 */
export interface TakenBackLeaving {
  leavingId: string | null;
  moveId?: string | null;
  from: SchoolDate;
}

/** Whether the change taken back cut the row. */
function cutBy(row: StoredGroupMembership, takenBack: TakenBackLeaving): boolean {
  return (
    (takenBack.leavingId !== null &&
      row.endedBy === 'leaving' &&
      row.leavingId === takenBack.leavingId) ||
    (takenBack.moveId !== undefined &&
      takenBack.moveId !== null &&
      row.endedBy === 'transfer' &&
      row.endedByMoveId === takenBack.moveId)
  );
}

/**
 * The group rows a change taken back gives back (decision 6 of 3.2c; task
 * 3.5c, decision 1: by growing each again), as `planMemberships` gives back
 * class rows: each row the change cut grows from its end (the later of the
 * first day taken back and the row's own start) up to its own end, but
 * inside the run of class rows given back of its group's classes that holds
 * that day, and never past the start of the next row of the subject given
 * back; cut by a new leaving as the class row is, or ended by the move that
 * ends that run or wrote that next row; its `review` kept. A row of a group
 * out of service, of a class not given back, of a group with no seat on
 * every day, or that would end before its own end with nothing to end it, is
 * not given back: its days go to the smallest suitable group
 * (`planClassGroups`). A row the new leaving takes over as it is (its date
 * on or before the row's) is renamed by `cutGroupRows`, not given back.
 */
export async function planGiveBack(
  book: SeatBook,
  groups: ReadonlyMap<string, CoverGroup>,
  studentId: string,
  rows: readonly StoredGroupMembership[],
  classRows: readonly ClassRowToCover[],
  takenBack: TakenBackLeaving,
  leave: { from: SchoolDate; leavingId: string } | null,
  cause: 'cancel' | 'undo',
  reviewOf: ReadonlyMap<string, boolean>,
  cancelledMoves: ReadonlySet<string> = new Set(),
): Promise<CoverRow[]> {
  const cut = rows
    // Task 3.3a, decision 8: a row a cancelled move wrote never comes back.
    .filter((row) => cutBy(row, takenBack) && !writtenByCancelledMove(row, cancelledMoves))
    .map((row) => ({ row, start: later(takenBack.from, row.validFrom) }))
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  const given: CoverRow[] = [];
  for (const [index, { row, start }] of cut.entries()) {
    if (leave !== null && leave.from <= start) {
      continue;
    }
    const group = groups.get(row.groupId.toLowerCase());
    if (group === undefined || !group.inService) {
      continue;
    }
    const inGroup = (one: ClassRowToCover): boolean =>
      one.studentId === studentId && group.classIds.has(one.classId.toLowerCase());
    const first = classRows.find((one) => inGroup(one) && one.from <= start && start < one.until);
    if (first === undefined) {
      continue;
    }
    // The class rows given back of the group's classes, back to back.
    let holder: ClassRowToCover = first;
    for (;;) {
      const runEnd: SchoolDate = holder.until;
      const after: ClassRowToCover | undefined = classRows.find(
        (one) => inGroup(one) && one.from === runEnd && one.from < one.until,
      );
      if (after === undefined) {
        break;
      }
      holder = after;
    }
    // Where the run of class rows ends before the group row's own end, the
    // group row ends as the run does: at a leaving or at a move.
    const capped = holder.until < row.ownUntil;
    let end = capped ? holder.until : row.ownUntil;
    let endMove = capped ? (holder.endedByMoveId ?? null) : null;
    let endLeaving = capped ? holder.leavingId : null;
    const next = cut
      .slice(index + 1)
      .find(
        (one) =>
          groups.get(one.row.groupId.toLowerCase())?.subjectId === group.subjectId &&
          one.start > start,
      );
    if (next !== undefined && next.start < end) {
      end = next.start;
      endMove = next.row.writtenByMoveId;
      endLeaving = null;
    }
    if (start >= end) {
      continue;
    }
    const until = leave !== null && leave.from < end ? leave.from : end;
    const leavingId =
      until < end && leave !== null ? leave.leavingId : until < row.ownUntil ? endLeaving : null;
    const endedByMoveId = leavingId === null && until < row.ownUntil ? endMove : null;
    if (until < row.ownUntil && leavingId === null && endedByMoveId === null) {
      continue;
    }
    if (!(await book.fits(group, { from: start, until }))) {
      continue;
    }
    book.add(group.id, { from: start, until });
    given.push({
      studentId,
      groupId: group.id,
      subjectId: group.subjectId,
      branchId: group.branchId,
      from: start,
      until,
      ownUntil: row.ownUntil,
      leavingId,
      cause,
      review: reviewOf.get(row.id) ?? false,
      writtenByMoveId: takenBack.moveId ?? null,
      endedByMoveId,
      growId: row.id,
    });
  }
  return given;
}

/** The subjects of the active groups that draw from the class (decision 5), from the groups read. */
export function groupSubjectsOf(
  groups: ReadonlyMap<string, CoverGroup>,
  classId: string,
): string[] {
  const key = classId.toLowerCase();
  return [
    ...new Set(
      [...groups.values()]
        .filter((group) => group.inService && group.classIds.has(key))
        .map((group) => group.subjectId),
    ),
  ].sort();
}

/**
 * The automatic rows that cover the class rows (decision 7): for each class
 * row, in the order given (the students by surname, first name and UID), each
 * split or group subject of its class, each run of its days held by no group
 * row of the subject (the student's rows and the rows of this change), the
 * smallest suitable group of the subject that draws from the class. A row
 * runs to the end of the class row, cut at the same leaving, or stops where
 * the next group row of the subject begins, its own end that day (spec review
 * of the plan, must-fix 1). Refusals are named per student and subject.
 *
 * A group named by `preferredOf` for the student and subject (task 3.3b,
 * decision 5 with correction 1: the group a leaving cut, on a return into the
 * class left) is tried first, among the same groups offered and with the same
 * seat count; when it is not offered (archived, of a closed year, no longer
 * drawing from the class) or has no seat on every day of the run, the
 * smallest suitable group is chosen. Either way the row is automatic and
 * tagged for review.
 */
export async function planClassGroups(
  book: SeatBook,
  groups: ReadonlyMap<string, CoverGroup>,
  classRows: readonly { index: number; row: ClassRowToCover }[],
  heldOf: (
    studentId: string,
  ) => readonly { subjectId: string; from: SchoolDate; until: SchoolDate }[],
  pathOf: (index: number) => string = (index) => `students.${String(index)}`,
  moveId: string | null = null,
  preferredOf: (studentId: string, subjectId: string) => string | undefined = () => undefined,
): Promise<{ rows: CoverRow[]; refused: ErrorDetail[] }> {
  const rows: CoverRow[] = [];
  const refused: ErrorDetail[] = [];
  for (const { index, row } of classRows) {
    if (row.from >= row.until) {
      continue;
    }
    for (const subjectId of groupSubjectsOf(groups, row.classId)) {
      const held = [
        ...heldOf(row.studentId).filter((one) => one.subjectId === subjectId),
        ...rows.filter((one) => one.studentId === row.studentId && one.subjectId === subjectId),
      ]
        .filter((one) => one.from < one.until)
        .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
      const offered = [...groups.values()].filter(
        (group) =>
          group.inService &&
          group.subjectId === subjectId &&
          group.classIds.has(row.classId.toLowerCase()),
      );
      const preferredId = preferredOf(row.studentId, subjectId)?.toLowerCase();
      const preferred =
        preferredId === undefined
          ? undefined
          : offered.find((group) => group.id.toLowerCase() === preferredId);
      let day = row.from;
      while (day < row.until) {
        const holding = held.find((one) => one.from <= day && day < one.until);
        if (holding !== undefined) {
          day = holding.until;
          continue;
        }
        const next = held.find((one) => one.from > day && one.from < row.until);
        const stop = next === undefined ? row.until : next.from;
        const best =
          preferred !== undefined && (await book.fits(preferred, { from: day, until: stop }))
            ? preferred
            : await smallestGroup(book, offered, { from: day, until: stop });
        if (best === undefined) {
          refused.push({
            path: pathOf(index),
            code: 'class_group_no_seat',
            message: 'No group of a subject of the class has a free seat for the student.',
            recordId: row.studentId,
            subjectId,
          });
          break;
        }
        book.add(best.id, { from: day, until: stop });
        const ownEnd = next === undefined ? row.ownUntil : stop;
        rows.push({
          studentId: row.studentId,
          groupId: best.id,
          subjectId,
          branchId: best.branchId,
          from: day,
          until: stop,
          ownUntil: ownEnd,
          leavingId: next === undefined && row.until < row.ownUntil ? row.leavingId : null,
          cause: 'automatic',
          review: true,
          writtenByMoveId: moveId,
          endedByMoveId:
            next === undefined && row.until < row.ownUntil && row.leavingId === null
              ? (row.endedByMoveId ?? null)
              : null,
        });
        day = stop;
      }
    }
  }
  return { rows, refused };
}

/** Throws the refusals of `planClassGroups`, all or none (decision 3); the code is the first one's. */
export function refuseNoSeat(refused: readonly ErrorDetail[]): void {
  if (refused.length > 0) {
    throw new ApiException('class_group_no_seat', 409, undefined, [...refused]);
  }
}

/**
 * Writes the group rows of a class path, after its class rows. An automatic
 * row gets a `student.group_joined` entry of its own (3.2b, decision 5); the
 * rows given back are named in the entry of the cancel or the undo. Answers
 * what was written.
 */
export async function writeCoverRows(
  transaction: Transaction,
  audit: Audit,
  access: Access,
  rows: readonly CoverRow[],
  requestId: string,
): Promise<GroupRowWritten[]> {
  const written: GroupRowWritten[] = [];
  for (const row of rows) {
    if (row.growId !== undefined) {
      // Task 3.5c, decision 1: a row given back grows again; the days it
      // gets back are checked at the commit (`group_memberships_regained`).
      await transaction
        .updateTable('group_memberships')
        .set({
          valid_until: row.until,
          ...endedAs(row),
        })
        .where('id', '=', row.growId)
        .where('student_id', '=', row.studentId)
        .execute();
      written.push({
        id: row.growId,
        studentId: row.studentId,
        groupId: row.groupId,
        subjectId: row.subjectId,
        from: row.from,
        until: row.until,
        cause: row.cause,
        review: row.review,
      });
      continue;
    }
    const inserted = await transaction
      .insertInto('group_memberships')
      .values({
        branch_id: row.branchId,
        student_id: row.studentId,
        group_id: row.groupId,
        subject_id: row.subjectId,
        valid_from: row.from,
        valid_until: row.until,
        own_until: row.ownUntil,
        cause: row.cause,
        review: row.review,
        ...endedAs(row),
        written_by_move_id: row.writtenByMoveId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    written.push({
      id: inserted.id,
      studentId: row.studentId,
      groupId: row.groupId,
      subjectId: row.subjectId,
      from: row.from,
      until: row.until,
      cause: row.cause,
      review: row.review,
    });
    if (row.cause === 'automatic') {
      await audit.record(transaction, {
        branchId: row.branchId,
        actorId: access.accountId,
        assignmentId: access.assignmentId,
        action: 'student.group_joined',
        record: { type: 'student', id: row.studentId },
        newValue: {
          groupId: row.groupId,
          membershipId: inserted.id,
          from: row.from,
          until: row.until,
          cause: row.cause,
          review: row.review,
          ...(row.writtenByMoveId === null ? {} : { moveId: row.writtenByMoveId }),
        },
        requestId,
      });
    }
  }
  return written;
}

/**
 * One stay in a group is one row (task 3.5c, `group_memberships_one_stay`):
 * an automatic row that ends where a row given back of the same group begins
 * takes that row's days and end, and the row given back stays as the change
 * left it (a planned row a leaving emptied, filled from the first day taken
 * back); a row given back that ends where an automatic row of its group
 * begins takes the automatic row's days and end, when they lie inside its own
 * end.
 */
export function joinCoverRows(
  given: readonly CoverRow[],
  automatic: readonly CoverRow[],
): { given: CoverRow[]; automatic: CoverRow[] } {
  const keptGiven = [...given];
  const keptAutomatic: CoverRow[] = [];
  for (const row of automatic) {
    const sameGroup = (one: CoverRow) =>
      one.studentId === row.studentId && one.groupId.toLowerCase() === row.groupId.toLowerCase();
    const after = keptGiven.findIndex((one) => sameGroup(one) && one.from === row.until);
    const before = keptGiven.findIndex(
      (one) => sameGroup(one) && one.until === row.from && row.until <= one.ownUntil,
    );
    const following = keptGiven[after];
    const preceding = keptGiven[before];
    if (following !== undefined) {
      keptGiven.splice(after, 1);
      keptAutomatic.push({
        ...row,
        until: following.until,
        ownUntil: following.ownUntil,
        leavingId: following.leavingId,
        endedByMoveId: following.endedByMoveId,
      });
    } else if (preceding !== undefined) {
      keptGiven[before] = {
        ...preceding,
        until: row.until,
        leavingId: row.leavingId,
        endedByMoveId: row.endedByMoveId,
      };
    } else {
      keptAutomatic.push(row);
    }
  }
  return { given: keptGiven, automatic: keptAutomatic };
}

/** The end of a group row a class path writes: a leaving, a move, or none (its own end). */
function endedAs(row: CoverRow): {
  ended_by: 'leaving' | 'transfer' | null;
  leaving_id: string | null;
  ended_by_move_id: string | null;
} {
  if (row.leavingId !== null) {
    return { ended_by: 'leaving', leaving_id: row.leavingId, ended_by_move_id: null };
  }
  if (row.endedByMoveId !== null) {
    return { ended_by: 'transfer', leaving_id: null, ended_by_move_id: row.endedByMoveId };
  }
  return { ended_by: null, leaving_id: null, ended_by_move_id: null };
}

/** The group rows with days of a student, as `planClassGroups` reads them. */
export function heldRows(
  rows: readonly StoredGroupMembership[],
  groups: ReadonlyMap<string, CoverGroup>,
  subjectOf: ReadonlyMap<string, string>,
): { subjectId: string; from: SchoolDate; until: SchoolDate }[] {
  return rows
    .filter((row) => row.validFrom < row.validUntil)
    .map((row) => ({
      subjectId: groups.get(row.groupId.toLowerCase())?.subjectId ?? subjectOf.get(row.id) ?? '',
      from: row.validFrom,
      until: row.validUntil,
    }));
}

/** The subject and review tag of each group row of the students, by row id. */
export async function rowFacts(
  transaction: Transaction,
  studentIds: readonly string[],
): Promise<{ subjectOf: Map<string, string>; reviewOf: Map<string, boolean> }> {
  const subjectOf = new Map<string, string>();
  const reviewOf = new Map<string, boolean>();
  if (studentIds.length === 0) {
    return { subjectOf, reviewOf };
  }
  const rows = await transaction
    .selectFrom('group_memberships')
    .select(['id', 'subject_id', 'review'])
    .where('student_id', 'in', [...studentIds])
    .execute();
  for (const row of rows) {
    subjectOf.set(row.id, row.subject_id);
    reviewOf.set(row.id, row.review);
  }
  return { subjectOf, reviewOf };
}

/**
 * The students in the order an automatic placement decides them (3.2b,
 * decision 12): surname, first name and UID.
 */
export async function inNameOrder(
  transaction: Transaction,
  studentIds: readonly string[],
): Promise<string[]> {
  if (studentIds.length === 0) {
    return [];
  }
  const rows = await transaction
    .selectFrom('students')
    .select('id')
    .where('id', 'in', [...studentIds])
    .orderBy('last_name')
    .orderBy('first_name')
    .orderBy('uid')
    .execute();
  return rows.map((row) => row.id);
}

/**
 * The covering of one class path, planned and written: the groups locked,
 * the rows a leaving taken back cut given back, every day still without a
 * group filled, all or none. `classRows` are the class rows the change has
 * written or writes, each with the index of its student in the request.
 */
export async function coverClassRows(
  transaction: Transaction,
  audit: Audit,
  access: Access,
  input: {
    classRows: readonly { index: number; row: ClassRowToCover }[];
    giveBack: {
      studentId: string;
      takenBack: TakenBackLeaving;
      leave: { from: SchoolDate; leavingId: string } | null;
      cause: 'cancel' | 'undo';
    } | null;
    /** Groups already locked by the caller (a leaving's), or null to lock here. */
    groups: ReadonlyMap<string, CoverGroup> | null;
    /** The path of a refusal in `details`: `students.<n>` unless named (the create: `classId`). */
    pathOf?: (index: number) => string;
    /** The move whose action writes the automatic rows (task 3.3a), if any. */
    moveId?: string | null;
    /** The moves cancelled: their rows are never given back (task 3.3a, decision 8). */
    cancelledMoves?: ReadonlySet<string>;
    /**
     * The group to try first for a student and a subject, by student id then
     * subject id (task 3.3b, decision 5 with correction 1).
     */
    preferred?: ReadonlyMap<string, ReadonlyMap<string, string>>;
  },
  requestId: string,
): Promise<{ written: GroupRowWritten[]; automatic: GroupRowWritten[] }> {
  const studentIds = [...new Set(input.classRows.map(({ row }) => row.studentId))];
  const own = new Map<string, StoredGroupMembership[]>();
  for (const id of studentIds) {
    own.set(id, await groupMembershipsOf(transaction, id));
  }
  const groups =
    input.groups ??
    (await lockClassGroups(
      transaction,
      input.classRows.map(({ row }) => row.classId),
      [...own.values()].flat().map((row) => row.groupId),
    ));
  const { subjectOf, reviewOf } = await rowFacts(transaction, studentIds);
  const book = new SeatBook(transaction);
  const given =
    input.giveBack === null
      ? []
      : await planGiveBack(
          book,
          groups,
          input.giveBack.studentId,
          own.get(input.giveBack.studentId) ?? [],
          input.classRows.map(({ row }) => row),
          input.giveBack.takenBack,
          input.giveBack.leave,
          input.giveBack.cause,
          reviewOf,
          input.cancelledMoves,
        );
  const order = await inNameOrder(transaction, studentIds);
  const sorted = [...input.classRows].sort(
    (a, b) => order.indexOf(a.row.studentId) - order.indexOf(b.row.studentId) || a.index - b.index,
  );
  const planned = await planClassGroups(
    book,
    groups,
    sorted,
    (studentId) => [
      ...heldRows(own.get(studentId) ?? [], groups, subjectOf),
      ...given
        .filter((row) => row.studentId === studentId)
        .map((row) => ({ subjectId: row.subjectId, from: row.from, until: row.until })),
    ],
    input.pathOf,
    input.moveId ?? null,
    (studentId, subjectId) => input.preferred?.get(studentId)?.get(subjectId),
  );
  refuseNoSeat(
    [...planned.refused].sort(
      (a, b) =>
        Number(a.path.split('.')[1] ?? 0) - Number(b.path.split('.')[1] ?? 0) ||
        (a.subjectId ?? '').localeCompare(b.subjectId ?? ''),
    ),
  );
  const joined = joinCoverRows(given, planned.rows);
  const written = await writeCoverRows(transaction, audit, access, joined.given, requestId);
  const automatic = await writeCoverRows(transaction, audit, access, joined.automatic, requestId);
  return { written: [...written, ...automatic], automatic };
}

/**
 * `group_placement_gaps` (0049, decision 8), the check task 3.4 calls before
 * a load row of a group or split is valid: the students of the classes whose
 * class rows hold a day from `from` on with no group row of the subject, with
 * the first such day. A class the transaction cannot see is refused first
 * (spec review of the plan, should-fix 7): "no gaps" never means "not seen";
 * so is a class of another branch than `branchId`, the branch of the request,
 * also in a transaction that holds every branch (a Super Admin's; permission
 * review of the build, should-fix 5).
 */
export async function groupPlacementGaps(
  transaction: Transaction,
  branchId: string,
  classIds: readonly string[],
  subjectId: string,
  from: SchoolDate,
): Promise<{ studentId: string; classId: string; membershipId: string; firstDay: SchoolDate }[]> {
  const ids = [...new Set(classIds.map((id) => id.toLowerCase()))];
  if (ids.length === 0) {
    return [];
  }
  const seen = await transaction
    .selectFrom('classes')
    .select('id')
    .where('id', 'in', ids)
    .where('branch_id', '=', branchId)
    .execute();
  if (seen.length !== ids.length) {
    throw notFound();
  }
  const found = await sql<{
    student_id: string;
    class_id: string;
    membership_id: string;
    first_day: SchoolDate;
  }>`
    select student_id, class_id, membership_id, first_day::text as first_day
    from group_placement_gaps(${sql.val(ids)}::uuid[], ${subjectId}::uuid, ${from}::date)
  `.execute(transaction);
  return found.rows.map((row) => ({
    studentId: row.student_id,
    classId: row.class_id,
    membershipId: row.membership_id,
    firstDay: row.first_day,
  }));
}
