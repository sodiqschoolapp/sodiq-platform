import { Injectable } from '@nestjs/common';
import {
  relationshipSchema,
  scholarshipCoverageSchema,
  scholarshipTypeSchema,
  schoolDateSchema,
  type AuditAction,
  type SchoolDate,
  type JournalEntriesChoice,
  type StudentMerge,
  type StudentMergeField,
  type StudentMergePreview,
  type StudentMergeResult,
  type StudentMergeRow,
  type StudentMergeSide,
  type StudentStatus,
} from '@sodiq/shared';
import { sql } from 'kysely';
import { Transactions, transactionMoment, type Transaction } from '../../database/transactions.js';
import type { JsonValue } from '../../database/types.generated.js';
import { ApiException } from '../../http/api-exception.js';
import type { Access } from '../access/permission.guard.js';
import { Audit } from '../audit/audit.service.js';
import {
  entriesFrom,
  entriesLeft,
  entryDetail,
  lockStudentEntries,
  voidEntries,
  type MetEntry,
} from '../journal/journal-entries.js';
import { lockClassGroups } from '../classes/class-groups.js';
import {
  classesInService,
  joinAdjoiningRows,
  studentClassesOn,
} from '../classes/class-membership-rows.js';
import { notFound, refusingConstraints } from '../setup/setup-refusals.js';
import { branchNames } from './branch-moves.js';
import {
  digestOf,
  fateOf,
  FIELD_COLUMNS,
  scalarText,
  textOf,
  joinedLife,
  keptOf,
  MERGE_REFUSALS,
  type Fate,
  type Side,
  type Stretch,
} from './student-merges.js';
import { Students } from './students.service.js';

/** Plain data for an audit entry or an archive: dates as text, no class instances. */
const asJson = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue;

const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

function branchOf(access: Access): string {
  if (access.branchId === null) {
    throw new Error('A merge works for the branch of the request.');
  }
  return access.branchId;
}

/** A refusal that names the UID field. */
const uidRefusal = (code: 'student_merge_same' | 'student_merge_not_found'): ApiException =>
  new ApiException(code, 422, undefined, [
    {
      path: 'uid',
      code,
      message:
        code === 'student_merge_same'
          ? 'The UID is the record’s own.'
          : 'No student holds the UID.',
    },
  ]);

/** The tables a merge reads whole, keyed by the student under `column`, in a fixed order. */
const WHOLE_TABLES = [
  { table: 'student_statuses', column: 'student_id', order: 'id' },
  { table: 'student_contracts', column: 'student_id', order: 'id' },
  { table: 'class_memberships', column: 'student_id', order: 'id' },
  { table: 'group_memberships', column: 'student_id', order: 'id' },
  { table: 'student_moves', column: 'student_id', order: 'id' },
  { table: 'student_branch_moves', column: 'student_id', order: 'id' },
  { table: 'student_relatives', column: 'student_id', order: 'id' },
  { table: 'student_accounts', column: 'student_id', order: 'student_id' },
  { table: 'student_uids', column: 'student_id', order: 'uid' },
  { table: 'student_merges', column: 'kept_id', order: 'id' },
] as const;

type WholeTable = (typeof WHOLE_TABLES)[number]['table'];

/** A row read whole (`to_jsonb`), with the record it belongs to. */
interface WholeRow {
  id: string;
  studentId: string;
  row: Record<string, unknown>;
}

/** One record of the pair as the merge reads it. */
interface Record_ {
  id: string;
  uid: string;
  branchId: string;
  grade: number;
  firstName: string;
  lastName: string;
  whole: Record<string, unknown>;
  firstHeld: Date;
  uids: string[];
}

interface StatusRow {
  id: string;
  side: Side;
  status: StudentStatus;
  from: SchoolDate;
  until: SchoolDate | null;
  branchId: string;
}

interface MemberRow {
  id: string;
  side: Side;
  from: SchoolDate;
  until: SchoolDate;
  branchId: string;
  endedBy: string | null;
  leavingId: string | null;
  writtenByMoveId: string | null;
  endedByMoveId: string | null;
  endedByBranchMoveId: string | null;
  /** The class or the group. */
  ownerId: string;
  name: string;
}

interface MoveRow {
  id: string;
  side: Side;
  branchId: string;
  effectiveOn: SchoolDate;
  cancelled: boolean;
  undone: boolean;
  cancelledByLeavingId: string | null;
}

interface BranchMoveRow {
  id: string;
  side: Side;
  open: boolean;
  accepted: boolean;
  effectiveOn: SchoolDate;
  cancelledByLeavingId: string | null;
}

interface LinkRow {
  id: string;
  side: Side;
  relativeId: string;
  relationship: string;
  mainContact: boolean;
  portalAccess: boolean;
  receivesNotices: boolean;
  live: boolean;
}

/** Everything a merge decides, read in the Super Admin's transaction of every branch. */
interface MergePlan {
  kept: Record_;
  merged: Record_;
  life: Stretch[];
  later: Side;
  startsOn: SchoolDate | null;
  statuses: { row: StatusRow; fate: Fate }[];
  classRows: { row: MemberRow; fate: Fate }[];
  groupRows: { row: MemberRow; fate: Fate }[];
  moves: { row: MoveRow; left: boolean }[];
  branchMoves: BranchMoveRow[];
  links: LinkRow[];
  whole: Map<WholeTable, WholeRow[]>;
  filled: StudentMergeField[];
  differing: { field: StudentMergeField; kept: string; merged: string }[];
  refusal: ApiException | null;
  digest: string;
}

const overlap = (day: SchoolDate): ApiException =>
  new ApiException('student_merge_overlap', 409, undefined, [
    { path: '', code: 'student_merge_overlap', message: `A row would lose days from ${day}.`, day },
  ]);

/**
 * The merge of two student records (`edge/students-classes-groups`, "A
 * student who left in 2025 is created again as new": "The Super Admin can
 * merge two records; the older UID survives"; task 3.3d, pull request #98).
 * The record of the path is of the branch of the request (404 otherwise);
 * the other, named by a UID, of any branch (decision 16). Both run in the
 * Super Admin's transaction of every branch, and the preview and the merge
 * read the same state the same way, so that the digest of one is the
 * digest of the other (correction 3).
 *
 * Lock order (correction 4): the two students FOR UPDATE in the order of
 * their id, then the classes of every class row the merge carries, cuts or
 * leaves FOR UPDATE by id, then the groups of the classes and of the group
 * rows FOR UPDATE by id (`lockClassGroups`), then the writes.
 */
@Injectable()
export class StudentMerges {
  constructor(
    private readonly transactions: Transactions,
    private readonly audit: Audit,
    private readonly students: Students,
  ) {}

  /** The preview (decisions 4, 7 and 12): what the merge would do, or why it is refused. */
  async preview(access: Access, id: string, uid: string): Promise<StudentMergePreview> {
    const branchId = branchOf(access);
    const { branches } = await this.reach(access);
    return this.transactions.run(branches, async (transaction) => {
      const pair = await this.pairOf(transaction, branchId, id, uid);
      const plan = await this.plan(transaction, pair);
      return this.previewOf(transaction, plan);
    });
  }

  /**
   * The merge, all or none (decisions 1 to 15, corrections 1 to 4): the
   * pair locked and read again, the digest compared, the classes and groups
   * locked, then the merge row, the cuts, the kept record's grade, branch
   * and scholarship, the carries, the start, the relatives, the fields, the
   * chain, the removal of the merged record and an entry in every branch
   * whose rows changed. The kept record is read afterwards in a new
   * transaction of every branch, with its branch (correction 1).
   */
  async merge(
    access: Access,
    id: string,
    input: StudentMerge,
    requestId: string,
  ): Promise<StudentMergeResult> {
    const branchId = branchOf(access);
    const { assignmentId, branches } = await this.reach(access);
    const kept = await refusingConstraints(
      () =>
        this.transactions.run(branches, async (transaction) => {
          const pair = await this.pairOf(transaction, branchId, id, input.uid);
          await this.lockPair(transaction, pair);
          // Read again after the locks: a merge that came first removed one.
          const locked = await this.pairOf(transaction, branchId, id, input.uid);
          if (!same(locked[0], pair[0]) || !same(locked[1], pair[1])) {
            throw uidRefusal('student_merge_not_found');
          }
          const plan = await this.plan(transaction, pair);
          if (plan.digest !== input.digest) {
            throw new ApiException('student_changed', 409);
          }
          if (plan.refusal !== null) {
            throw plan.refusal;
          }
          await this.write(
            transaction,
            access,
            assignmentId,
            plan,
            input.reason,
            requestId,
            input.journalEntries,
          );
          return { id: plan.kept.id, branchId: this.finalBranch(plan) };
        }),
      MERGE_REFUSALS,
    );
    return this.transactions.run(branches, async (transaction) => {
      const names = await branchNames(transaction, [kept.branchId]);
      // Read as of the kept record's branch (correction 1): the Super Admin
      // works in every branch, and the record may have left the request's.
      return {
        student: await this.students.readDetail(
          transaction,
          { ...access, branchId: kept.branchId },
          kept.id,
        ),
        branch: { id: kept.branchId, name: names.get(kept.branchId.toLowerCase()) ?? '' },
      };
    });
  }

  // ---------------------------------------------------------------------------

  /**
   * The Super Admin assignment and every branch, decided from every current
   * assignment (`.claude/rules/api.md`), so that a later widening of the area
   * never opens every branch to another role.
   */
  private async reach(access: Access): Promise<{ assignmentId: string; branches: string[] }> {
    const superAdmin = access.assignments.find((assignment) => assignment.role === 'super_admin');
    if (superAdmin === undefined) {
      throw new ApiException('permission_denied', 403);
    }
    const branches = await this.transactions.run([], async (transaction) =>
      (await transaction.selectFrom('branches').select('id').orderBy('id').execute()).map(
        (row) => row.id,
      ),
    );
    return { assignmentId: superAdmin.id, branches };
  }

  /**
   * The record of the path, of the branch of the request (404 otherwise,
   * also for the Super Admin, `.claude/rules/api.md`), and the record that
   * holds the UID, of any branch.
   */
  private async pairOf(
    transaction: Transaction,
    branchId: string,
    id: string,
    uid: string,
  ): Promise<[string, string]> {
    const path = await transaction
      .selectFrom('students')
      .select(['id', 'branch_id'])
      .where('id', '=', id)
      .executeTakeFirst();
    if (path === undefined || !same(path.branch_id, branchId)) {
      throw notFound();
    }
    const other = await transaction
      .selectFrom('student_uids')
      .select('student_id')
      .where('uid', '=', uid)
      .where('student_id', 'is not', null)
      .executeTakeFirst();
    if (other?.student_id === undefined || other.student_id === null) {
      throw uidRefusal('student_merge_not_found');
    }
    if (same(other.student_id, path.id)) {
      throw uidRefusal('student_merge_same');
    }
    return [path.id, other.student_id];
  }

  /** The two students FOR UPDATE in the order of their id. */
  private async lockPair(transaction: Transaction, pair: [string, string]): Promise<void> {
    const found = await transaction
      .selectFrom('students')
      .select('id')
      .where('id', 'in', pair)
      .orderBy('id')
      .forUpdate()
      .execute();
    // The record of the path removed meanwhile (merged into another) is
    // gone: 404; the record of the UID removed: no student holds it now.
    if (!found.some((one) => same(one.id, pair[0]))) {
      throw notFound();
    }
    if (found.length !== 2) {
      throw uidRefusal('student_merge_not_found');
    }
  }

  /** Every row of both records, whole, by table, each list by its order column. */
  private async wholeRows(
    transaction: Transaction,
    pair: readonly string[],
  ): Promise<Map<WholeTable, WholeRow[]>> {
    const found = new Map<WholeTable, WholeRow[]>();
    for (const { table, column, order } of WHOLE_TABLES) {
      const rows = await sql<{ row: Record<string, unknown> }>`
        select to_jsonb(t) as row from ${sql.table(table)} t
        where t.${sql.ref(column)} in (${sql.join(pair.map((one) => sql`${one}::uuid`))})
        order by t.${sql.ref(order)}
      `.execute(transaction);
      found.set(
        table,
        rows.rows.map(({ row }) => ({
          id: String(row[order]),
          studentId: String(row[column]),
          row,
        })),
      );
    }
    return found;
  }

  /** What the merge does with the pair, or the refusal it gives, and the digest of the state. */
  private async plan(transaction: Transaction, pair: [string, string]): Promise<MergePlan> {
    const students = await sql<{ row: Record<string, unknown> }>`
      select to_jsonb(s) as row from students s
      where s.id in (${pair[0]}::uuid, ${pair[1]}::uuid)
      order by s.id
    `.execute(transaction);
    const whole = await this.wholeRows(transaction, pair);
    const uids = whole.get('student_uids') ?? [];
    const records = pair.map((id): Record_ => {
      const row = students.rows.find((one) => same(String(one.row.id), id))?.row;
      if (row === undefined) {
        throw uidRefusal('student_merge_not_found');
      }
      const own = uids.filter((one) => same(one.studentId, id));
      const current = String(row.uid);
      const held = own
        .map((one) => new Date(String(one.row.held_from)))
        .sort((a, b) => a.getTime() - b.getTime());
      return {
        id,
        uid: current,
        branchId: String(row.branch_id),
        grade: Number(row.grade),
        firstName: String(row.first_name),
        lastName: String(row.last_name),
        whole: row,
        firstHeld: held[0] ?? new Date(0),
        uids: [
          current,
          ...own
            .map((one) => one.id)
            .filter((one) => one !== current)
            .sort(),
        ],
      };
    });
    const [a, b] = records as [Record_, Record_];
    const [kept, merged] = keptOf(a, b);
    const sideOf = (studentId: string): Side => (same(studentId, kept.id) ? 'kept' : 'merged');
    const date = (value: unknown): SchoolDate | null => scalarText(value);

    const statuses: StatusRow[] = (whole.get('student_statuses') ?? []).map(({ row }) => ({
      id: String(row.id),
      side: sideOf(String(row.student_id)),
      status: row.status as StudentStatus,
      from: String(row.valid_from),
      until: date(row.valid_until),
      branchId: String(row.branch_id),
    }));
    const names = await this.ownerNames(transaction, whole);
    const memberOf = (row: Record<string, unknown>, owner: string): MemberRow => ({
      id: String(row.id),
      side: sideOf(String(row.student_id)),
      from: String(row.valid_from),
      until: String(row.valid_until),
      branchId: String(row.branch_id),
      endedBy: scalarText(row.ended_by),
      leavingId: scalarText(row.leaving_id),
      writtenByMoveId: scalarText(row.written_by_move_id),
      endedByMoveId: scalarText(row.ended_by_move_id),
      endedByBranchMoveId: scalarText(row.ended_by_branch_move_id),
      ownerId: owner,
      name: names.get(owner.toLowerCase()) ?? '',
    });
    const classMembers = (whole.get('class_memberships') ?? []).map(({ row }) =>
      memberOf(row, String(row.class_id)),
    );
    const groupMembers = (whole.get('group_memberships') ?? []).map(({ row }) =>
      memberOf(row, String(row.group_id)),
    );
    const moves: MoveRow[] = (whole.get('student_moves') ?? []).map(({ row }) => ({
      id: String(row.id),
      side: sideOf(String(row.student_id)),
      branchId: String(row.branch_id),
      effectiveOn: String(row.effective_on),
      cancelled: row.cancelled_at !== null,
      undone: row.undone_at !== null,
      cancelledByLeavingId: scalarText(row.cancelled_by_leaving_id),
    }));
    const branchMoves: BranchMoveRow[] = (whole.get('student_branch_moves') ?? []).map(
      ({ row }) => ({
        id: String(row.id),
        side: sideOf(String(row.student_id)),
        open: row.cancelled_at === null && row.declined_at === null && row.accepted_at === null,
        accepted: row.accepted_at !== null,
        effectiveOn: String(row.effective_on),
        cancelledByLeavingId: scalarText(row.cancelled_by_leaving_id),
      }),
    );
    const links: LinkRow[] = (whole.get('student_relatives') ?? []).map(({ row }) => ({
      id: String(row.id),
      side: sideOf(String(row.student_id)),
      relativeId: String(row.relative_id),
      relationship: String(row.relationship),
      mainContact: row.main_contact === true,
      portalAccess: row.portal_access === true,
      receivesNotices: row.receives_notices === true,
      live: row.unlinked_at === null,
    }));

    const life = joinedLife(statuses);
    // A row of the kept record never loses a day it holds in class: its
    // active days win every tie (decision 4). Only rows with no end are cut.
    const statusFates = statuses.map((row) => ({ row, fate: fateOf(row, life, true) }));
    const classFates = classMembers.map((row) => ({
      row,
      fate: fateOf(row, life, row.endedBy === null),
    }));
    const groupFates = groupMembers.map((row) => ({
      row,
      fate: fateOf(row, life, row.endedBy === null),
    }));
    const leftIds = new Set(
      [...statusFates, ...classFates, ...groupFates]
        .filter((one) => one.fate.action === 'left')
        .map((one) => one.row.id.toLowerCase()),
    );
    // A move is left behind with the rows that name it, when it is named and
    // every row naming it is left behind; a move named by no row is carried.
    const namedBy = (moveId: string) =>
      [...classFates, ...groupFates].filter(
        (one) =>
          (one.row.writtenByMoveId !== null && same(one.row.writtenByMoveId, moveId)) ||
          (one.row.endedByMoveId !== null && same(one.row.endedByMoveId, moveId)),
      );
    const moveFates = moves.map((row) => {
      const naming = namedBy(row.id);
      return {
        row,
        left: naming.length > 0 && naming.every((one) => one.fate.action === 'left'),
      };
    });

    const later: Side = life.at(-1)?.side ?? 'kept';
    const refusal =
      this.refusalOf({
        kept,
        merged,
        life,
        statusFates,
        classFates,
        groupFates,
        moveFates,
        branchMoves,
        leftIds,
      }) ??
      (await this.pendingOf(transaction, moves, branchMoves)) ??
      (await this.gradeRefusal(
        transaction,
        classFates,
        later === 'merged' ? merged.grade : kept.grade,
      ));

    const startsOn = life[0]?.from ?? null;
    const filled: StudentMergeField[] = [];
    const differing: MergePlan['differing'] = [];
    for (const [field, columns] of Object.entries(FIELD_COLUMNS) as [
      StudentMergeField,
      readonly string[],
    ][]) {
      const mine = textOf(kept.whole, columns);
      const theirs = textOf(merged.whole, columns);
      if (mine === null && theirs !== null) {
        filled.push(field);
      } else if (mine !== null && theirs !== null && mine !== theirs) {
        differing.push({ field, kept: mine, merged: theirs });
      }
    }

    const digest = digestOf({
      kept: kept.id,
      students: students.rows.map(({ row }) => row),
      rows: Object.fromEntries(
        [...whole.entries()].map(([table, rows]) => [table, rows.map((one) => one.row)]),
      ),
    });
    return {
      kept,
      merged,
      life,
      later,
      startsOn,
      statuses: statusFates,
      classRows: classFates,
      groupRows: groupFates,
      moves: moveFates,
      branchMoves,
      links,
      whole,
      filled,
      differing,
      refusal,
      digest,
    };
  }

  /**
   * The refusal the joined life gives (decision 4): the first row, by its
   * first lost day, that loses its start or its middle, or a row carried
   * that names a row left behind (a leaving, a move).
   */
  private refusalOf(facts: {
    kept: Record_;
    merged: Record_;
    life: readonly Stretch[];
    statusFates: { row: StatusRow; fate: Fate }[];
    classFates: { row: MemberRow; fate: Fate }[];
    groupFates: { row: MemberRow; fate: Fate }[];
    moveFates: { row: MoveRow; left: boolean }[];
    branchMoves: BranchMoveRow[];
    leftIds: Set<string>;
  }): ApiException | null {
    const refused = [...facts.statusFates, ...facts.classFates, ...facts.groupFates]
      .map((one) => one.fate)
      .filter((fate): fate is { action: 'refused'; day: SchoolDate } => fate.action === 'refused')
      .map((fate) => fate.day)
      .sort();
    if (refused[0] !== undefined) {
      return overlap(refused[0]);
    }
    const leftStatuses = facts.statusFates.filter((one) => one.fate.action === 'left');
    const leftDay = (leavingId: string | null): SchoolDate | undefined =>
      leavingId === null
        ? undefined
        : leftStatuses.find((one) => same(one.row.id, leavingId))?.row.from;
    const days: SchoolDate[] = [];
    for (const one of [...facts.classFates, ...facts.groupFates]) {
      if (one.fate.action !== 'left') {
        const day = leftDay(one.row.leavingId);
        if (day !== undefined) {
          days.push(day);
        }
      }
    }
    for (const one of facts.moveFates) {
      if (!one.left) {
        const day = leftDay(one.row.cancelledByLeavingId);
        if (day !== undefined) {
          days.push(day);
        }
      }
    }
    for (const move of facts.branchMoves) {
      const day = leftDay(move.cancelledByLeavingId);
      if (day !== undefined) {
        days.push(day);
      }
      // An accepted move of the merged record into a branch on a day its
      // life loses to the kept record's (spec review of the build, should-fix
      // 9): the move would name a life the record no longer has.
      if (
        move.side === 'merged' &&
        move.accepted &&
        facts.life.some(
          (stretch) =>
            stretch.side === 'kept' &&
            stretch.from <= move.effectiveOn &&
            (stretch.until === null || move.effectiveOn < stretch.until),
        )
      ) {
        days.push(move.effectiveOn);
      }
    }
    const first = days.sort()[0];
    return first === undefined ? null : overlap(first);
  }

  /**
   * Refused while something is pending on either record (decision 11): an
   * open release to another branch, or a class or group move scheduled or
   * begun after today in its branch's time zone.
   */
  private async pendingOf(
    transaction: Transaction,
    moves: readonly MoveRow[],
    branchMoves: readonly BranchMoveRow[],
  ): Promise<ApiException | null> {
    if (branchMoves.some((move) => move.open)) {
      return new ApiException('student_merge_release_open', 409);
    }
    for (const move of moves) {
      if (!move.cancelled && !move.undone) {
        const today = await this.students.todayIn(transaction, move.branchId);
        if (move.effectiveOn > today) {
          return new ApiException('student_merge_move_scheduled', 409);
        }
      }
    }
    return null;
  }

  /**
   * The grade after the merge is the later life's (decision 7): a class row
   * that stays on the kept record (carried, or cut and still holding days)
   * and is in force after today in its branch must be of that grade, as
   * `students_grade_class` asks of a grade change (spec review of the build,
   * should-fix 8). A row of the past keeps its grade.
   */
  private async gradeRefusal(
    transaction: Transaction,
    classFates: readonly { row: MemberRow; fate: Fate }[],
    grade: number,
  ): Promise<ApiException | null> {
    const staying = classFates.filter(
      ({ row, fate }) => fate.action !== 'left' && row.from < row.until,
    );
    if (staying.length === 0) {
      return null;
    }
    const grades = new Map(
      (
        await transaction
          .selectFrom('classes')
          .select(['id', 'grade'])
          .where(
            'id',
            'in',
            staying.map(({ row }) => row.ownerId),
          )
          .execute()
      ).map((one) => [one.id.toLowerCase(), one.grade]),
    );
    for (const { row, fate } of staying) {
      const until = fate.action === 'cut' ? fate.at : row.until;
      const today = await this.students.todayIn(transaction, row.branchId);
      if (until > today && grades.get(row.ownerId.toLowerCase()) !== grade) {
        return new ApiException('student_merge_grade', 409);
      }
    }
    return null;
  }

  /** The names of the classes ("7 Oxford") and groups of the rows read. */
  private async ownerNames(
    transaction: Transaction,
    whole: Map<WholeTable, WholeRow[]>,
  ): Promise<Map<string, string>> {
    const classIds = (whole.get('class_memberships') ?? []).map(({ row }) => String(row.class_id));
    const groupIds = (whole.get('group_memberships') ?? []).map(({ row }) => String(row.group_id));
    const found = new Map<string, string>();
    if (classIds.length > 0) {
      for (const row of await transaction
        .selectFrom('classes')
        .select(['id', 'grade', 'name'])
        .where('id', 'in', classIds)
        .execute()) {
        found.set(row.id.toLowerCase(), `${String(row.grade)} ${row.name}`);
      }
    }
    if (groupIds.length > 0) {
      for (const row of await transaction
        .selectFrom('groups')
        .select(['id', 'name'])
        .where('id', 'in', groupIds)
        .execute()) {
        found.set(row.id.toLowerCase(), row.name);
      }
    }
    return found;
  }

  /** The kept record's branch after the merge: the later life's (decision 7). */
  private finalBranch(plan: MergePlan): string {
    return plan.later === 'merged' ? plan.merged.branchId : plan.kept.branchId;
  }

  private async previewOf(transaction: Transaction, plan: MergePlan): Promise<StudentMergePreview> {
    const branchId = this.finalBranch(plan);
    const names = await branchNames(transaction, [
      plan.kept.branchId,
      plan.merged.branchId,
      branchId,
    ]);
    const rows: StudentMergeRow[] = [];
    const add = (
      kind: StudentMergeRow['kind'],
      list: readonly {
        row: { side: Side; from: SchoolDate; until: SchoolDate | null };
        fate: Fate;
      }[],
      nameOf: (row: never) => string,
    ) => {
      for (const { row, fate } of list) {
        if (fate.action === 'cut' || fate.action === 'left') {
          rows.push({
            kind,
            side: row.side,
            action: fate.action,
            name: nameOf(row as never),
            from: row.from,
            until: row.until,
            cutAt: fate.action === 'cut' ? fate.at : null,
          });
        }
      }
    };
    add('status', plan.statuses, (row: StatusRow) => row.status);
    add('class', plan.classRows, (row: MemberRow) => row.name);
    add('group', plan.groupRows, (row: MemberRow) => row.name);
    const mergedRows =
      plan.statuses.filter((one) => one.row.side === 'merged' && one.fate.action === 'carried')
        .length +
      [...plan.classRows, ...plan.groupRows].filter(
        (one) => one.row.side === 'merged' && one.fate.action === 'carried',
      ).length +
      plan.moves.filter((one) => one.row.side === 'merged' && !one.left).length +
      plan.branchMoves.filter((one) => one.side === 'merged').length +
      (plan.whole.get('student_contracts') ?? []).filter((one) =>
        same(one.studentId, plan.merged.id),
      ).length;
    return {
      kept: await this.sideOf(transaction, plan.kept, names),
      merged: await this.sideOf(transaction, plan.merged, names),
      branch: { id: branchId, name: names.get(branchId.toLowerCase()) ?? '' },
      life: plan.life.map((stretch) => ({ ...stretch })),
      rows,
      carried: mergedRows,
      filled: plan.filled,
      differing: plan.differing,
      refusal:
        plan.refusal === null
          ? null
          : {
              code: plan.refusal.code,
              day: plan.refusal.details?.find((detail) => detail.day !== undefined)?.day ?? null,
            },
      values: await this.valuesOf(transaction, plan),
      digest: plan.digest,
    };
  }

  /**
   * The values beside the personal fields and what the merge keeps of each
   * (task 3.5b, H29 of issue #105), as `write` does: the start of the joined
   * life, the later life's grade and scholarship, every contract, and the
   * relatives with what happens to each link.
   */
  private async valuesOf(
    transaction: Transaction,
    plan: MergePlan,
  ): Promise<StudentMergePreview['values']> {
    const scholarshipOf = (record: Record_) => ({
      type: scholarshipTypeSchema.parse(record.whole.scholarship_type),
      coverage: scholarshipCoverageSchema
        .nullable()
        .parse(scalarText(record.whole.scholarship_coverage)),
      amount:
        record.whole.scholarship_amount === null ? null : Number(record.whole.scholarship_amount),
    });
    const sideOfStudent = (studentId: string): Side =>
      same(studentId, plan.kept.id) ? 'kept' : 'merged';
    const contracts = (plan.whole.get('student_contracts') ?? []).map(({ studentId, row }) => ({
      side: sideOfStudent(studentId),
      number: String(row.number),
      signedOn: String(row.signed_on),
    }));
    const live = plan.links.filter((link) => link.live);
    const ids = [...new Set(live.map((link) => link.relativeId.toLowerCase()))].sort();
    const names =
      ids.length === 0
        ? []
        : await transaction
            .selectFrom('relatives')
            .select(['id', 'full_name'])
            .where('id', 'in', ids)
            .execute();
    const nameOf = (id: string) => names.find((one) => same(one.id, id))?.full_name ?? '';
    const keptIds = new Set(
      live.filter((link) => link.side === 'kept').map((link) => link.relativeId.toLowerCase()),
    );
    const relatives = live
      .map((link) => ({
        side: link.side,
        fullName: nameOf(link.relativeId),
        relationship: relationshipSchema.parse(link.relationship),
        fate:
          link.side === 'kept'
            ? ('stays' as const)
            : keptIds.has(link.relativeId.toLowerCase())
              ? ('already_linked' as const)
              : ('added' as const),
      }))
      .sort((a, b) => a.side.localeCompare(b.side) || a.fullName.localeCompare(b.fullName));
    return {
      later: plan.later,
      startsOn: {
        kept: String(plan.kept.whole.starts_on),
        merged: String(plan.merged.whole.starts_on),
        result: plan.startsOn,
      },
      grade: { kept: plan.kept.grade, merged: plan.merged.grade },
      scholarship: { kept: scholarshipOf(plan.kept), merged: scholarshipOf(plan.merged) },
      contracts,
      relatives,
    };
  }

  private async sideOf(
    transaction: Transaction,
    record: Record_,
    names: ReadonlyMap<string, string>,
  ): Promise<StudentMergeSide> {
    const today = await this.students.todayIn(transaction, record.branchId);
    const rows = (await this.students.statusRowsOf(transaction, record.id)).get(record.id) ?? [];
    const now = rows
      .filter((row) => row.validFrom !== row.validUntil)
      .find((row) => row.validUntil === null || row.validUntil > today);
    const held = (await studentClassesOn(transaction, today, record.id)).get(record.id)?.current;
    return {
      id: record.id,
      uid: record.uid,
      firstName: record.firstName,
      lastName: record.lastName,
      grade: record.grade,
      branch: {
        id: record.branchId,
        name: names.get(record.branchId.toLowerCase()) ?? '',
      },
      // As the list reads it (`statusOfStudentOn`): before the start date the
      // first row, active, so a later start reads "From <date>" (issue #105, H13).
      status: now === undefined ? null : now.status,
      startsOn: schoolDateSchema.parse(record.whole.starts_on),
      today,
      class: held === undefined || held === null ? null : { grade: held.grade, name: held.name },
    };
  }

  /** The writes of a merge, in the order the triggers need (step 5 of the plan). */
  private async write(
    transaction: Transaction,
    access: Access,
    assignmentId: string,
    plan: MergePlan,
    reason: string,
    requestId: string,
    journalEntries: JournalEntriesChoice | undefined,
  ): Promise<void> {
    const { kept, merged } = plan;
    const finalBranch = this.finalBranch(plan);
    const moment = await transactionMoment(transaction);
    // Task 8.6: the journal entries of both records, then their class and
    // group rows, before any row is cut (`journal-entries.ts`): a cell save
    // updates its cell before its trigger takes the memberships.
    await lockStudentEntries(transaction, [kept.id, merged.id]);
    const mergedEntries = await entriesFrom(transaction, merged.id, '0001-01-01');
    // Correction 4: the classes, then the groups, before the first write.
    const classIds = plan.classRows.map((one) => one.row.ownerId);
    await classesInService(transaction, classIds);
    await lockClassGroups(
      transaction,
      classIds,
      plan.groupRows.map((one) => one.row.ownerId),
    );

    const left = (table: WholeTable, ids: ReadonlySet<string>) =>
      (plan.whole.get(table) ?? [])
        .filter((one) => ids.has(one.id.toLowerCase()))
        .map((one) => one.row);
    const leftOf = <T extends { row: { id: string } }>(
      list: readonly T[],
      test: (one: T) => boolean,
    ) => new Set(list.filter(test).map((one) => one.row.id.toLowerCase()));
    const leftStatuses = leftOf(plan.statuses, (one) => one.fate.action === 'left');
    const leftClasses = leftOf(plan.classRows, (one) => one.fate.action === 'left');
    const leftGroups = leftOf(plan.groupRows, (one) => one.fate.action === 'left');
    const leftMoves = leftOf(plan.moves, (one) => one.left);
    const mergedOnly = (table: WholeTable) =>
      (plan.whole.get(table) ?? []).filter((one) => same(one.studentId, merged.id));
    const leftRows = {
      student_statuses: left('student_statuses', leftStatuses),
      class_memberships: left('class_memberships', leftClasses),
      group_memberships: left('group_memberships', leftGroups),
      student_moves: left('student_moves', leftMoves),
      student_relatives: mergedOnly('student_relatives').map((one) => one.row),
      student_accounts: mergedOnly('student_accounts').map((one) => one.row),
    };

    const mergeRow = await transaction
      .insertInto('student_merges')
      .values({
        branch_id: kept.branchId,
        kept_id: kept.id,
        merged_id: merged.id,
        merged_branch_id: merged.branchId,
        kept_uid: kept.uid,
        merged_uid: merged.uid,
        merged_uids: merged.uids,
        merged_record: JSON.stringify(merged.whole),
        left_rows: JSON.stringify(leftRows),
        reason,
        merged_by: access.accountId,
        assignment_id: assignmentId,
        merged_at: moment,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    // The cuts, while each row is still its record's.
    const cuts: { table: string; id: string; until: SchoolDate; was: SchoolDate | null }[] = [];
    for (const { row, fate } of plan.statuses) {
      if (fate.action === 'cut') {
        await transaction
          .updateTable('student_statuses')
          .set({ valid_until: fate.at })
          .where('id', '=', row.id)
          .execute();
        cuts.push({ table: 'student_statuses', id: row.id, until: fate.at, was: row.until });
      }
    }
    for (const [table, list] of [
      ['class_memberships', plan.classRows],
      ['group_memberships', plan.groupRows],
    ] as const) {
      for (const { row, fate } of list) {
        if (fate.action === 'cut') {
          await transaction
            .updateTable(table)
            .set({ valid_until: fate.at, ended_by: 'merge' })
            .where('id', '=', row.id)
            .execute();
          cuts.push({ table, id: row.id, until: fate.at, was: row.until });
        }
      }
    }

    // The kept record takes the later life's grade, branch and scholarship
    // (decision 7), before the merged record's rows come to it.
    if (plan.later === 'merged') {
      await transaction
        .updateTable('students')
        .set({
          grade: merged.grade,
          scholarship_type: String(merged.whole.scholarship_type),
          scholarship_coverage: scalarText(merged.whole.scholarship_coverage),
          scholarship_amount:
            merged.whole.scholarship_amount === null
              ? null
              : Number(merged.whole.scholarship_amount),
        })
        .where('id', '=', kept.id)
        .execute();
      if (!same(merged.branchId, kept.branchId)) {
        await transaction
          .updateTable('students')
          .set({ branch_id: merged.branchId })
          .where('id', '=', kept.id)
          .execute();
      }
    }

    // The carries: every row of the merged record not left behind.
    const carried: Record<string, string[]> = {};
    const carry = async (
      table:
        | 'student_statuses'
        | 'student_contracts'
        | 'student_branch_moves'
        | 'class_memberships'
        | 'group_memberships'
        | 'student_moves',
      skip: ReadonlySet<string>,
      withBranch: boolean,
    ) => {
      const ids = mergedOnly(table)
        .map((one) => one.id)
        .filter((one) => !skip.has(one.toLowerCase()));
      carried[table] = ids;
      for (const rowId of ids) {
        await sql`
          update ${sql.table(table)}
          set student_id = ${kept.id}::uuid
            ${withBranch ? sql`, branch_id = ${finalBranch}::uuid` : sql``}
          where id = ${rowId}::uuid
        `.execute(transaction);
      }
    };
    await carry('student_statuses', leftStatuses, true);
    await carry('class_memberships', leftClasses, false);
    await carry('group_memberships', leftGroups, false);
    await carry('student_moves', leftMoves, false);
    await carry('student_branch_moves', new Set(), true);
    await carry('student_contracts', new Set(), true);
    // Task 3.5c (decision 2): a stay of one record in a class or a group that
    // the other record's row continues is one stay: the rows are joined
    // (`class_memberships_one_stay`, checked at the commit).
    const joined = await joinAdjoiningRows(transaction, kept.id);
    if (plan.startsOn !== null && plan.startsOn !== String(kept.whole.starts_on)) {
      await transaction
        .updateTable('students')
        .set({ starts_on: plan.startsOn })
        .where('id', '=', kept.id)
        .execute();
    }

    // The relatives (decision 9, the 2.5b-1 way): the relatives locked in the
    // order of their id; a new link on the kept record first, then the
    // merged record's links unlinked, so no relative is archived between.
    const keptLive = new Set(
      plan.links
        .filter((link) => link.side === 'kept' && link.live)
        .map((link) => link.relativeId.toLowerCase()),
    );
    const mergedLive = plan.links.filter((link) => link.side === 'merged' && link.live);
    const relativeIds = [...new Set(mergedLive.map((link) => link.relativeId))].sort();
    if (relativeIds.length > 0) {
      await transaction
        .selectFrom('relatives')
        .select('id')
        .where('id', 'in', relativeIds)
        .orderBy('id')
        .forUpdate()
        .execute();
    }
    const linked: string[] = [];
    for (const link of mergedLive) {
      if (!keptLive.has(link.relativeId.toLowerCase())) {
        const row = await transaction
          .insertInto('student_relatives')
          .values({
            student_id: kept.id,
            branch_id: finalBranch,
            relative_id: link.relativeId,
            relationship: link.relationship,
            main_contact: false,
            portal_access: link.portalAccess,
            receives_notices: link.receivesNotices,
            linked_at: moment,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        keptLive.add(link.relativeId.toLowerCase());
        linked.push(row.id);
      }
    }
    if (mergedLive.length > 0) {
      await transaction
        .updateTable('student_relatives')
        .set({ unlinked_at: moment })
        .where('student_id', '=', merged.id)
        .where('unlinked_at', 'is', null)
        .execute();
    }

    // The fields empty on the kept record, filled from the merged record
    // (decision 7); its unique values emptied first, the indexes being
    // immediate.
    const fill: Record<string, unknown> = {};
    for (const field of plan.filled) {
      for (const column of FIELD_COLUMNS[field]) {
        fill[column] = merged.whole[column];
      }
    }
    if ('jshshir' in fill || 'document_number' in fill) {
      await transaction
        .updateTable('students')
        .set({
          ...('jshshir' in fill ? { jshshir: null } : {}),
          ...('document_number' in fill ? { document_type: null, document_number: null } : {}),
        })
        .where('id', '=', merged.id)
        .execute();
    }
    if (Object.keys(fill).length > 0) {
      await transaction.updateTable('students').set(fill).where('id', '=', kept.id).execute();
    }

    // The chain: the merges into the merged record name the kept record now.
    const chained = await transaction
      .updateTable('student_merges')
      .set({ kept_id: kept.id, branch_id: finalBranch })
      .where('kept_id', '=', merged.id)
      .returning('id')
      .execute();
    chained.sort((a, b) => a.id.localeCompare(b.id));

    // Task 6.3 (review correction 2): the reasons of absence go to the kept
    // record, each staying in the branch of its date; two of one date in one
    // branch refuse the merge by their key.
    const reasons = await transaction
      .selectFrom('student_absence_reasons')
      .select(['id', 'branch_id'])
      .where('student_id', '=', merged.id)
      .orderBy('id')
      .forUpdate()
      .execute();
    if (reasons.length > 0) {
      try {
        await transaction
          .updateTable('student_absence_reasons')
          .set({ student_id: kept.id })
          .where(
            'id',
            'in',
            reasons.map((row) => row.id),
          )
          .execute();
      } catch (error) {
        const failure = error as { code?: unknown; constraint?: unknown };
        if (failure.code === '23505' && failure.constraint === 'student_absence_reasons_key') {
          throw new ApiException('student_merge_absence_reasons', 409);
        }
        throw error;
      }
    }

    // Task 8.5 (From 3.3d): the exemptions go to the kept record, each staying in the branch of
    // its lessons, with what names the student beside them; two that overlap refuse the merge by
    // the exclusion of their spans (`exemption_spans_no_overlap`, 0123).
    const exemptions = await transaction
      .selectFrom('exemptions')
      .select(['id', 'branch_id'])
      .where('student_id', '=', merged.id)
      .orderBy('id')
      .forUpdate()
      .execute();
    try {
      if (exemptions.length > 0) {
        await transaction
          .updateTable('exemptions')
          .set({ student_id: kept.id })
          .where('student_id', '=', merged.id)
          .execute();
      }
      await transaction
        .updateTable('exemption_clears')
        .set({ student_id: kept.id })
        .where('student_id', '=', merged.id)
        .execute();
      await transaction
        .updateTable('exemption_reopened_cells')
        .set({ student_id: kept.id })
        .where('student_id', '=', merged.id)
        .execute();
      await transaction
        .updateTable('exemption_move_offers')
        .set({ student_id: kept.id })
        .where('student_id', '=', merged.id)
        .execute();
    } catch (error) {
      const failure = error as { code?: unknown; constraint?: unknown };
      if (failure.code === '23P01' && failure.constraint === 'exemption_spans_no_overlap') {
        throw new ApiException('student_merge_exemption_overlap', 409);
      }
      throw error;
    }
    for (const branch of [...new Set(exemptions.map((row) => row.branch_id))].sort()) {
      await this.audit.record(transaction, {
        branchId: branch,
        actorId: access.accountId,
        assignmentId,
        action: 'exemption.merge',
        record: { type: 'student', id: kept.id },
        newValue: {
          mergedId: merged.id,
          exemptionIds: exemptions.filter((row) => row.branch_id === branch).map((row) => row.id),
        },
        requestId,
      });
    }

    const journal = await this.carryJournal(transaction, access, {
      keptId: kept.id,
      mergedId: merged.id,
      mergeId: mergeRow.id,
      entries: mergedEntries,
      choice: journalEntries,
    });

    // The merged record removed; its UIDs stay reserved, released (0033).
    // Task 8.6 carried the journal data above; a row the transaction could not
    // see (a branch outside it) still refuses the removal by its key, as do
    // the marks a forced delete keeps (0111, task 6.1b-2).
    try {
      await transaction.deleteFrom('students').where('id', '=', merged.id).execute();
    } catch (error) {
      const failure = error as { code?: unknown; constraint?: unknown };
      if (
        failure.code === '23503' &&
        (failure.constraint === 'journal_cells_student_fkey' ||
          failure.constraint === 'student_forced_cells' ||
          // Task 8.2: rating entries and comments are not carried either (From 2.4b-1).
          failure.constraint === 'journal_rating_entries_student_fkey' ||
          failure.constraint === 'journal_comments_student_fkey')
      ) {
        throw new ApiException('student_merge_has_cells', 409);
      }
      throw error;
    }

    const value = {
      mergeId: mergeRow.id,
      keptId: kept.id,
      mergedId: merged.id,
      keptUid: kept.uid,
      mergedUid: merged.uid,
      mergedUids: merged.uids,
      branchId: finalBranch,
      startsOn: plan.startsOn,
      later: plan.later,
      rows: {
        carried,
        cut: cuts,
        joined,
        left: Object.fromEntries(
          Object.entries(leftRows).map(([table, rows]) => [
            table,
            rows.map((row) => String(row.id ?? row.student_id)),
          ]),
        ),
      },
      relativesLinked: linked,
      absenceReasons: reasons.map((row) => row.id),
      journal,
      chained: chained.map((row) => row.id),
      filled: Object.fromEntries(
        plan.filled.map((field) => [field, textOf(merged.whole, FIELD_COLUMNS[field])]),
      ),
      leftValues: plan.differing,
    };
    const touched = new Set(
      [
        kept.branchId,
        merged.branchId,
        finalBranch,
        ...[...plan.classRows, ...plan.groupRows]
          .filter((one) => one.row.side === 'merged')
          .map((one) => one.row.branchId),
        ...plan.moves.filter((one) => one.row.side === 'merged').map((one) => one.row.branchId),
        ...reasons.map((row) => row.branch_id),
      ].map((one) => one.toLowerCase()),
    );
    // The personal values (the fields filled, the values left behind) only
    // in the kept record's branch, where the merged record's values are
    // readable (decision 5); every other branch gets ids, UIDs, dates and
    // rows only (`.claude/rules/database.md`, permission review must-fix 1).
    const withoutValues = Object.fromEntries(
      Object.entries(value).filter(([key]) => key !== 'filled' && key !== 'leftValues'),
    );
    for (const branch of [...touched].sort()) {
      await this.record(transaction, access, assignmentId, branch, kept.id, 'student.merged', {
        newValue: same(branch, finalBranch) ? value : withoutValues,
        reason,
        requestId,
      });
    }
  }

  /**
   * The journal side of a merge (task 8.6, decision 8 with correction 1;
   * From 3.3d: "the entries of the merged record are carried to the kept
   * record with its class and group rows; two records holding entries on
   * common days ... are refused or resolved, the merge listing them"), run
   * once the class and group rows are carried:
   *
   * - the merged record's entries on days the merge cut or left behind (the
   *   kept record is no member of their lesson now) are listed
   *   `student_merge_journal_cut` until voided with a reason;
   * - data of both records on one key (a lesson and work, a comment target, a
   *   rating exam) refuses the merge `student_merge_journal_overlap`;
   * - the cells with a value, the comments, the rating entries, the voids and
   *   the optional cells go to the kept record by `student_id` (each staying in
   *   the branch of its lesson); an empty cell of the kept record on the key of
   *   a carried value goes first (0128), and the merged record's delete takes
   *   its own empty cells (0109); the histories stay under the merged id;
   * - the cells and comments of the forced-delete stores name the kept record.
   */
  private async carryJournal(
    transaction: Transaction,
    access: Access,
    input: {
      keptId: string;
      mergedId: string;
      mergeId: string;
      entries: readonly MetEntry[];
      choice: JournalEntriesChoice | undefined;
    },
  ): Promise<Record<string, unknown>> {
    if (input.choice !== undefined) {
      // The transaction holds every branch: an id that is not an entry of the merged
      // record (another branch's, another student's, or unknown) is 404
      // (`.claude/rules/api.md`: the Super Admin's change still answers 404).
      const ids = [...new Set(input.choice.seen.map((one) => one.id.toLowerCase()))];
      const own = await sql<{ id: string }>`
        select id from journal_cells where id = any(${ids}::uuid[]) and student_id = ${input.mergedId}::uuid
        union all
        select id from journal_comments where id = any(${ids}::uuid[]) and student_id = ${input.mergedId}::uuid
        union all
        select id from journal_rating_entries
        where id = any(${ids}::uuid[]) and student_id = ${input.mergedId}::uuid
      `.execute(transaction);
      if (own.rows.length !== ids.length) throw notFound();
    }
    const cut = await entriesLeft(transaction, input.keptId, input.entries);
    if (cut.length > 0) {
      const details = cut.map((entry) => entryDetail(entry, 'student_merge_journal_cut', true));
      if (input.choice === undefined) {
        throw new ApiException('student_merge_journal_cut', 409, undefined, details);
      }
      const seen = new Map(input.choice.seen.map((one) => [one.id.toLowerCase(), one.version]));
      if (
        seen.size !== cut.length ||
        cut.some((entry) => seen.get(entry.id.toLowerCase()) !== entry.version)
      ) {
        throw new ApiException('student_merge_journal_cut', 409, undefined, [
          ...details,
          {
            path: 'journalEntries.seen',
            code: 'student_merge_journal_cut',
            message: 'The entries sent are not the list now.',
            changed: true,
          },
        ]);
      }
    } else if (input.choice !== undefined) {
      throw new ApiException('student_merge_journal_cut', 409, undefined, [
        {
          path: 'journalEntries.seen',
          code: 'student_merge_journal_cut',
          message: 'The entries sent are not the list now.',
          changed: true,
        },
      ]);
    }
    const voids = await voidEntries(transaction, {
      studentId: input.mergedId,
      source: { mergeId: input.mergeId },
      actorId: access.accountId,
      entries: cut.map((entry) => ({ entry, reason: input.choice?.reason ?? null })),
    });
    const overlap = await sql<{ lesson_id: string | null; rating_exam_id: string | null }>`
      select a.lesson_id, null::uuid as rating_exam_id
      from journal_cells a
      join journal_cells b on b.branch_id = a.branch_id and b.lesson_id = a.lesson_id
        and b.work_id is not distinct from a.work_id
      where a.student_id = ${input.mergedId}::uuid and b.student_id = ${input.keptId}::uuid
        and (a.mark is not null or a.score is not null)
        and (b.mark is not null or b.score is not null)
      union
      select a.lesson_id, a.rating_exam_id
      from journal_comments a
      join journal_comments b on b.branch_id = a.branch_id and b.target = a.target
        and b.lesson_id is not distinct from a.lesson_id
        and b.work_id is not distinct from a.work_id
        and b.rating_exam_id is not distinct from a.rating_exam_id
      where a.student_id = ${input.mergedId}::uuid and b.student_id = ${input.keptId}::uuid
      union
      select null, a.rating_exam_id
      from journal_rating_entries a
      join journal_rating_entries b on b.branch_id = a.branch_id
        and b.rating_exam_id = a.rating_exam_id
      where a.student_id = ${input.mergedId}::uuid and b.student_id = ${input.keptId}::uuid
    `.execute(transaction);
    if (overlap.rows.length > 0) {
      throw new ApiException(
        'student_merge_journal_overlap',
        409,
        undefined,
        overlap.rows.map((row) => ({
          path: '',
          code: 'student_merge_journal_overlap',
          message: 'Both records hold journal data on this key.',
          recordId: row.lesson_id ?? row.rating_exam_id ?? undefined,
        })),
      );
    }
    // The kept record's empty cells on the key of a value carried go first
    // (`journal_cells_delete`, 0128); their history lines stay.
    const swapped = await sql<{ id: string }>`
      delete from journal_cells b
      using journal_cells a
      where a.student_id = ${input.mergedId}::uuid and b.student_id = ${input.keptId}::uuid
        and b.branch_id = a.branch_id and b.lesson_id = a.lesson_id
        and b.work_id is not distinct from a.work_id
        and (a.mark is not null or a.score is not null or a.not_graded)
        and b.mark is null and b.score is null and not b.not_graded
      returning b.id
    `.execute(transaction);
    const cells = await transaction
      .updateTable('journal_cells')
      .set({ student_id: input.keptId })
      .where('student_id', '=', input.mergedId)
      .where((where) =>
        where.or([
          where('mark', 'is not', null),
          where('score', 'is not', null),
          // Task 8.7: a "not graded" cell is carried where the kept record has no cell of its key.
          where.and([
            where('not_graded', '=', true),
            where.not(
              where.exists(
                where
                  .selectFrom('journal_cells as kept')
                  .select('kept.id')
                  .where('kept.student_id', '=', input.keptId)
                  .whereRef('kept.branch_id', '=', 'journal_cells.branch_id')
                  .whereRef('kept.lesson_id', '=', 'journal_cells.lesson_id')
                  .where(sql<boolean>`kept.work_id is not distinct from journal_cells.work_id`),
              ),
            ),
          ]),
        ]),
      )
      .returning('id')
      .execute();
    const comments = await transaction
      .updateTable('journal_comments')
      .set({ student_id: input.keptId })
      .where('student_id', '=', input.mergedId)
      .returning('id')
      .execute();
    const ratingEntries = await transaction
      .updateTable('journal_rating_entries')
      .set({ student_id: input.keptId })
      .where('student_id', '=', input.mergedId)
      .returning('id')
      .execute();
    // Task 9.2a: the decisions on flagged results (0132), carried as the journal's rows; a
    // decision of both records on one quarter and subject refuses the merge.
    try {
      await transaction
        .updateTable('quarter_result_decisions')
        .set({ student_id: input.keptId })
        .where('student_id', '=', input.mergedId)
        .execute();
    } catch (error) {
      const failure = error as { code?: unknown; constraint?: unknown };
      if (failure.code === '23505' && failure.constraint === 'quarter_result_decisions_key') {
        throw new ApiException('student_merge_decision_overlap', 409);
      }
      throw error;
    }
    await transaction
      .updateTable('journal_voids')
      .set({ student_id: input.keptId })
      .where('student_id', '=', input.mergedId)
      .execute();
    await transaction
      .updateTable('journal_optional_cells')
      .set({ student_id: input.keptId })
      .where('student_id', '=', input.mergedId)
      .execute();
    const stores = await sql<{ changed: number }>`
      select forced_deletes_merge_carry(${input.mergeId}::uuid) as changed
    `.execute(transaction);
    return {
      cells: cells.map((row) => row.id),
      comments: comments.map((row) => row.id),
      ratingEntries: ratingEntries.map((row) => row.id),
      emptyCellsLeft: swapped.rows.map((row) => row.id),
      journalVoids: voids,
      forcedStores: stores.rows[0]?.changed ?? 0,
    };
  }

  private async record(
    transaction: Transaction,
    access: Access,
    assignmentId: string,
    branchId: string,
    studentId: string,
    action: AuditAction,
    entry: { newValue: unknown; reason: string; requestId: string },
  ): Promise<void> {
    await this.audit.record(transaction, {
      branchId,
      actorId: access.accountId,
      assignmentId,
      action,
      record: { type: 'student', id: studentId },
      newValue: asJson(entry.newValue),
      reason: entry.reason,
      requestId: entry.requestId,
    });
  }
}
