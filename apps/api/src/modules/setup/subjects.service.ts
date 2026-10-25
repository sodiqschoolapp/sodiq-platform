import { Inject, Injectable } from '@nestjs/common';
import type {
  Clock,
  CopyQuarterWeightsRecord,
  DailyWeights,
  ErrorCode,
  GradeChanges,
  JournalType,
  Names,
  QuarterWeights,
  Subject,
  SubjectColour,
  SubjectExport,
  SubjectExportColumn,
  SubjectList,
  SubjectQuarterWeights,
  SubjectRecord,
} from '@sodiq/shared';
import { gradeRanges, schoolDateOf } from '@sodiq/shared';
import { sql } from 'kysely';
import { CLOCK } from '../../clock/clock.module.js';
import { Transactions, transactionMoment, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import type { XlsxFile } from '../../http/xlsx.js';
import type { Access } from '../access/permission.guard.js';
import { Audit } from '../audit/audit.service.js';
import {
  exportList,
  joined,
  nameIn,
  oneCell,
  readSchoolNames,
  type ExportColumn,
  type SchoolNames,
} from '../audit/export-list.js';
import { refuseGroupsOfSubject } from '../classes/group-side.js';
import {
  checkMoveStart,
  departmentChangeOf,
  departmentColumnsAfter,
  departmentInForce,
  lockDepartmentMoves,
  moveStartsOn,
  refuseMoveLoads,
  sameChange,
  todayOf,
  type DepartmentChange,
} from '../people/department-moves.js';
import { refuseTeachersOutside } from '../people/subject-teachers.js';
import { Notifications } from '../notifications/notifications.service.js';
import {
  compareGrades,
  quarterGrades,
  quarterRefOf,
  type QuarterGrades,
} from '../results/grade-changes.js';
import { weightsNoticeAccounts } from '../results/weights-notice.js';
import { switchKey, switchesOf, type QuarterSwitches } from './subject-switches.js';
import { dailyWeightsFit, quarterWeightsFit } from './subject-weights.js';
import { changesOf, notFound, refusingConstraints, refusingDuplicates } from './setup-refusals.js';

/** The field of the record each unique index of the names covers. */
const SUBJECT_NAME_INDEXES: Readonly<Record<string, string>> = {
  subjects_active_name_uz_idx: 'names.uz',
  subjects_active_name_ru_idx: 'names.ru',
  subjects_active_name_en_idx: 'names.en',
};

/**
 * The checks of db/migrations/0020 that answer a race past the service's own
 * checks: a department archived, or a quarter's year closed, at the same moment.
 */
const SUBJECT_REFUSALS: Readonly<Record<string, ErrorCode>> = {
  subjects_department_academic: 'department_not_academic',
  subjects_department_archived: 'department_archived',
  // Task 3.2a, decision 16 (db/migrations/0046): an active group of any branch needs it.
  subject_grade_groups: 'subject_grade_groups',
  subject_has_groups: 'subject_has_groups',
};

const SUBJECT_COLUMNS = [
  'id',
  'name_uz',
  'name_ru',
  'name_en',
  'department_id',
  'department_since',
  'department_before',
  'department_before_since',
  'grades',
  'colour',
  'journal_type',
  'rating_exam',
  'group_subject',
  'language_rule',
  'demanding',
  'archived_at',
  'weights_round',
  'rating_round',
] as const;

interface SubjectRow {
  id: string;
  name_uz: string;
  name_ru: string;
  name_en: string;
  department_id: string;
  /** The start date of the last department move (task 3.4c, decision 8). */
  department_since: Date | string | null;
  /** The department in force until `department_since` and its date (task 3.6b-3, decision 8). */
  department_before: string | null;
  department_before_since: Date | string | null;
  grades: number[];
  colour: string;
  journal_type: string;
  rating_exam: boolean;
  group_subject: boolean;
  language_rule: boolean;
  demanding: boolean;
  archived_at: Date | null;
  /** The round of being graded (db/migrations/0021, decision 14); a weight row of another round is not counted. */
  weights_round: number;
  /**
   * The round of the rating switch (db/migrations/0023, decision 19); a
   * quarterly row of another rating round is not counted.
   */
  rating_round: number;
}

interface WeightsRow {
  attendance: number;
  classwork: number;
  homework: number;
}

interface QuarterWeightsRow extends WeightsRow {
  rating_exam: number | null;
}

/** The school-wide fields as the audit log and the answer name them. */
// A type, not an interface: the audit log takes it as a JSON object.
type SubjectFields = {
  names: Names;
  departmentId: string;
  grades: number[];
  colour: SubjectColour;
  journalType: JournalType;
  ratingExam: boolean;
  groupSubject: boolean;
  languageRule: boolean;
  demanding: boolean;
};

const fieldsOf = (row: SubjectRow): SubjectFields => ({
  names: { uz: row.name_uz, ru: row.name_ru, en: row.name_en },
  departmentId: row.department_id,
  grades: row.grades,
  colour: row.colour as SubjectColour,
  journalType: row.journal_type as JournalType,
  ratingExam: row.rating_exam,
  groupSubject: row.group_subject,
  languageRule: row.language_rule,
  demanding: row.demanding,
});

const recordFields = (record: SubjectRecord): SubjectFields => ({
  names: record.names,
  departmentId: record.departmentId,
  grades: record.grades,
  colour: record.colour,
  journalType: record.journalType,
  ratingExam: record.ratingExam,
  groupSubject: record.groupSubject,
  languageRule: record.languageRule,
  demanding: record.demanding,
});

const columnsOf = (fields: SubjectFields) => ({
  name_uz: fields.names.uz,
  name_ru: fields.names.ru,
  name_en: fields.names.en,
  department_id: fields.departmentId,
  grades: fields.grades,
  colour: fields.colour,
  journal_type: fields.journalType,
  rating_exam: fields.ratingExam,
  group_subject: fields.groupSubject,
  language_rule: fields.languageRule,
  demanding: fields.demanding,
});

const dailyOf = (row: WeightsRow): DailyWeights => ({
  attendance: row.attendance,
  classwork: row.classwork,
  homework: row.homework,
});

const quarterOf = (row: QuarterWeightsRow): QuarterWeights => ({
  attendance: row.attendance,
  classwork: row.classwork,
  homework: row.homework,
  ratingExam: row.rating_exam,
});

/**
 * Decision 3: a quarterly distribution counts as set only when it has a
 * rating exam part exactly when the subject has a rating exam.
 */
const fits = (row: QuarterWeightsRow, ratingExam: boolean): boolean =>
  (row.rating_exam !== null) === ratingExam;

const refused = (code: ErrorCode): ApiException => new ApiException(code, 409);

/** What a write of one quarter did (task 9.1): nothing, a first setting, or a change of a stored one. */
type QuarterChange = 'unchanged' | 'first' | 'changed';

interface Written {
  readonly quarterId: string;
  readonly change: QuarterChange;
  /** The shown results before the write, read for a preview only. */
  readonly before: QuarterGrades | undefined;
}

interface GradesReader {
  readonly preview: boolean;
  readonly timeZone: string;
  readonly now: Date;
  read(quarterId: string): Promise<QuarterGrades | undefined>;
}

/** Ends a preview's transaction with its answer, so that the write it ran is rolled back. */
class PreviewDone extends Error {
  constructor(readonly preview: GradeChanges) {
    super('preview');
  }
}

/** Runs a write that ends in `PreviewDone` and answers the preview. */
async function previewOf(work: () => Promise<unknown>): Promise<GradeChanges> {
  try {
    await work();
  } catch (error) {
    if (error instanceof PreviewDone) return error.preview;
    throw error;
  }
  // The work above always throws, the preview or a refusal; TypeScript cannot see that.
  throw new ApiException('internal_error', 500);
}

/** A route bound to a branch always has one; the guard sets it. */
function branchOf(access: Access): string {
  if (access.branchId === null) {
    throw new Error('A subject route runs for the branch of the request.');
  }
  return access.branchId;
}

/**
 * The rounds an edit started, for its audit entry: `weightsRound` for a
 * subject made graded again (decision 14), `ratingRound` for a change of the
 * rating switch (decision 19). Nothing when neither moved.
 */
function roundDetails(
  row: SubjectRow,
  round: number,
  ratingRound: number,
  switchesFrom: number | null,
): { details?: Record<string, { from: number; to: number } | number> } {
  const details: Record<string, { from: number; to: number } | number> = {};
  if (round !== row.weights_round) {
    details.weightsRound = { from: row.weights_round, to: round };
  }
  if (ratingRound !== row.rating_round) {
    details.ratingRound = { from: row.rating_round, to: ratingRound };
  }
  // Task 8.2 (decision 16): the quarter the change of the switches takes effect from.
  if (switchesFrom !== null) {
    details.switchesFrom = switchesFrom;
  }
  return Object.keys(details).length === 0 ? {} : { details };
}

/**
 * Refuses a change of the switches from `switchesFrom` while a started quarter
 * it reaches holds scores of the subject (`subject_switch_scores`), or, for
 * the rating switch, a standing rating exam links journals there
 * (`subject_switch_exams`), in every branch (task 8.2, decisions 2 and 3,
 * review should-fix 1). `subject_switch_blocked` (0120) answers counts only.
 */
async function refuseSwitchChange(
  transaction: Transaction,
  subjectId: string,
  switchesFrom: number,
  change: { readonly typeChanges: boolean; readonly ratingChanges: boolean },
): Promise<void> {
  const moment = await transactionMoment(transaction);
  const { rows } = await sql<{ scores: number; exams: number }>`
    select scores, exams from subject_switch_blocked(
      ${subjectId}::uuid, ${switchesFrom}::smallint, ${moment.toISOString()}::timestamptz,
      ${change.typeChanges}, ${change.ratingChanges}
    )
  `.execute(transaction);
  const found = rows[0] ?? { scores: 0, exams: 0 };
  if (found.scores > 0) {
    throw new ApiException('subject_switch_scores', 409, undefined, [
      {
        path: 'switchesFrom',
        code: 'scores',
        message: 'Quarters with scores.',
        count: found.scores,
      },
    ]);
  }
  if (found.exams > 0) {
    throw new ApiException('subject_switch_exams', 409, undefined, [
      {
        path: 'ratingExam',
        code: 'exams',
        message: 'Quarters with a linked exam.',
        count: found.exams,
      },
    ]);
  }
}

/**
 * The current Super Admin assignment of the account, the only one that moves
 * a subject to another department (decision 17). Decided from every current
 * assignment, not from the one the guard named: edge cases, "Who can act",
 * "The server allows an action if any current assignment permits it".
 */
const superAdminOf = (access: Access): string | undefined =>
  access.assignments.find((assignment) => assignment.role === 'super_admin')?.id;

/**
 * Subjects and their weights (docs/spec/05-classes-groups-subjects.md, Subject
 * and "Grading weights on a subject"; task 2.1). The subject is school-wide
 * (owner's answer 3) and every change of it is an audit entry of the whole
 * school; the daily and quarterly distributions are per branch and their
 * entries carry the branch. Every write locks the subject row first, so an
 * edit, an archive and a weights write of one subject never interleave.
 * Archived, never deleted (decision 5: the archive is the "active switch").
 */
@Injectable()
export class Subjects {
  constructor(
    private readonly transactions: Transactions,
    private readonly audit: Audit,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly notifications: Notifications,
  ) {}

  /** Every subject, archived ones included and marked, with this branch's weights. */
  list(access: Access): Promise<SubjectList> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => ({
      subjects: await this.readList(transaction, branchId),
      mayMoveDepartment: superAdminOf(access) !== undefined,
    }));
  }

  /**
   * The Excel file of the list (task 2.2c-1): the school-wide subjects with
   * the daily distribution of the branch of the request, never another
   * branch's, read as the list reads them in one transaction.
   */
  export(access: Access, request: SubjectExport, requestId: string): Promise<XlsxFile> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const subjects = await this.readList(transaction, branchId);
      const names = await readSchoolNames(transaction);
      return exportList(transaction, this.audit, this.clock, access, requestId, {
        list: 'subjects',
        action: 'subject.export',
        request,
        rows: new Map(subjects.map((subject) => [subject.id, subject])),
        allowed: () => true,
        columns: subjectExportColumns(names),
      });
    });
  }

  private async readList(transaction: Transaction, branchId: string): Promise<Subject[]> {
    const rows = await transaction
      .selectFrom('subjects')
      .select(SUBJECT_COLUMNS)
      .orderBy('name_en')
      .orderBy('id')
      .execute();
    return this.withWeights(transaction, branchId, rows);
  }

  /**
   * A new subject; a graded one with this branch's daily distribution, in one
   * transaction (answer 6). The department is an active one of Academic.
   */
  create(access: Access, record: SubjectRecord, requestId: string): Promise<Subject> {
    const branchId = branchOf(access);
    return this.refusing(() =>
      this.transactions.run(access.branchIds, async (transaction) => {
        if (record.journalType === 'graded' && record.daily === null) {
          throw refused('daily_weights_required');
        }
        moveStartsOn(false, record.departmentStartsOn);
        await this.checkDepartment(transaction, record.departmentId);
        const fields = recordFields(record);
        const row = await transaction
          .insertInto('subjects')
          .values(columnsOf(fields))
          .returning('id')
          .executeTakeFirstOrThrow();
        await this.audit.record(transaction, {
          branchId: null,
          actorId: access.accountId,
          assignmentId: access.assignmentId,
          action: 'subject.create',
          record: { type: 'subject', id: row.id },
          newValue: fields,
          requestId,
        });
        if (record.daily !== null) {
          await this.writeDaily(transaction, access, branchId, row.id, 1, record.daily, requestId);
        }
        return this.readSubject(transaction, branchId, row.id);
      }),
    );
  }

  /**
   * Changes the school-wide fields. `daily` is taken only when the subject is
   * or becomes graded and this branch has no daily distribution yet, and is
   * then required (decision 15): an edit never writes back weights that the
   * branch already has, and a graded subject is never saved here without them.
   */
  edit(access: Access, id: string, record: SubjectRecord, requestId: string): Promise<Subject> {
    const branchId = branchOf(access);
    return this.refusing(() =>
      this.transactions.run(access.branchIds, async (transaction) => {
        // Task 3.4c, decision 6: a move takes the lock of department moves
        // before any row lock, decided from the department read without one;
        // the locked read must agree on what the edit asks of the department
        // (decision 9; task 3.6b-3, a move, a change of a plan or a cancel).
        // Only a Super Admin moves, so nobody else takes the lock (permission
        // review, nit 5).
        const mayMove = superAdminOf(access) !== undefined;
        const today = await todayOf(transaction, branchId);
        const unlockedRow = await transaction
          .selectFrom('subjects')
          .select([
            'department_id',
            'department_since',
            'department_before',
            'department_before_since',
          ])
          .where('id', '=', id)
          .executeTakeFirst();
        const unlocked: DepartmentChange =
          unlockedRow === undefined
            ? { kind: 'none', stray: false }
            : departmentChangeOf(
                unlockedRow,
                record.departmentId,
                record.departmentStartsOn,
                today,
              );
        const lockedForMove = mayMove && unlocked.kind !== 'none';
        if (lockedForMove) {
          await lockDepartmentMoves(transaction);
        }
        const row = await this.lockActive(transaction, id);
        const change = departmentChangeOf(
          row,
          record.departmentId,
          record.departmentStartsOn,
          today,
        );
        if (
          mayMove &&
          !sameChange({ row: unlockedRow, change: unlocked }, { row, change }, today)
        ) {
          throw refused('subject_changed');
        }
        const planned = departmentInForce(row, today).move;
        const before = fieldsOf(row);
        const after = recordFields(record);
        // The assignment the audit entry names: for a move, the Super Admin one.
        let assignmentId = access.assignmentId;
        let startsOn: string | null = null;
        if (change.kind === 'none') {
          // A start date is sent with a move only (task 3.4c, decision 2); the
          // planned one may come back with an edit that keeps the plan.
          moveStartsOn(false, change.stray ? record.departmentStartsOn : null);
        } else {
          // `edge/people-roles-accounts`: "A teacher moves to another department,
          // or a subject is moved, mid-year. Both changes ... are made by the
          // Super Admin." (Decision 17 of pull request #52.) A change or a
          // cancel of a planned move too (task 3.6b-3).
          const superAdmin = superAdminOf(access);
          if (superAdmin === undefined) {
            throw new ApiException('subject_move_super_admin', 403);
          }
          assignmentId = superAdmin;
          if (change.kind === 'move') {
            startsOn = moveStartsOn(true, record.departmentStartsOn);
            if (startsOn === null) {
              throw new Error('moveStartsOn gives a date for a move.');
            }
            await checkMoveStart(transaction, branchId, startsOn);
            await this.checkDepartment(transaction, after.departmentId);
          } else {
            // A cancel is a move back from today; its department is checked
            // by the database (`subjects_department_archived`, 0020).
            moveStartsOn(false, record.departmentStartsOn);
          }
          // Task 3.4c: the loads first, listed for reassignment (row 15),
          // then the profiles (task 2.2a).
          await refuseMoveLoads(transaction, branchId, {
            subjectId: id,
            departmentId: after.departmentId,
            startsOn: startsOn ?? today,
          });
        }
        // Task 2.2a, decision 13: a department move or a removed grade is
        // refused while a teacher who has not left has the subject outside them.
        const gradesRemoved = before.grades.some((grade) => !after.grades.includes(grade));
        if (after.departmentId !== before.departmentId || gradesRemoved) {
          await refuseTeachersOutside(
            transaction,
            { subjectId: id, grades: after.grades, departmentId: after.departmentId },
            this.clock.now(),
          );
        }
        // Task 3.2a, decision 16: a removed grade is refused while an active
        // group of that grade needs the subject, in any branch.
        if (gradesRemoved) {
          await refuseGroupsOfSubject(transaction, id, after.grades);
        }
        // Decision 14: a subject that becomes graded again starts a new round;
        // the weights of every branch from before no longer count.
        const round =
          before.journalType === 'attendance_only' && after.journalType === 'graded'
            ? row.weights_round + 1
            : row.weights_round;
        // Decision 19: a change of the rating switch starts a new rating round;
        // the quarterly distributions of every branch from before no longer
        // count. The daily distribution has no rating part and stays.
        const ratingRound =
          before.ratingExam === after.ratingExam ? row.rating_round : row.rating_round + 1;
        const daily = await this.currentDaily(transaction, branchId, id, round);
        if (record.daily !== null && daily !== undefined) {
          throw refused('daily_weights_set');
        }
        if (record.journalType === 'graded' && daily === undefined && record.daily === null) {
          throw refused('daily_weights_required');
        }
        // Task 8.2 (decisions 1 to 3 and 16): a change of the switches names the
        // quarter it takes effect from and is refused while a started quarter it
        // reaches holds scores, in any branch; the subject row is held FOR UPDATE
        // (`lock`), and every writer of a score holds it FOR SHARE first.
        const typeChanges = before.journalType !== after.journalType;
        const ratingChanges = before.ratingExam !== after.ratingExam;
        const switchesFrom = record.switchesFrom ?? null;
        if ((typeChanges || ratingChanges) !== (switchesFrom !== null)) {
          throw refused('subject_switches_from');
        }
        if (switchesFrom !== null) {
          await refuseSwitchChange(transaction, id, switchesFrom, {
            typeChanges,
            ratingChanges,
          });
        }
        const changes = changesOf({ ...before }, { ...after });
        if (changes !== null || change.kind !== 'none') {
          await transaction
            .updateTable('subjects')
            .set({
              ...columnsOf(after),
              weights_round: round,
              rating_round: ratingRound,
              ...(switchesFrom === null ? {} : { switches_from: switchesFrom }),
              // Task 3.6b-3: the department in force until the start date is
              // kept beside it, and a cancel gives it back.
              ...(change.kind === 'none'
                ? {}
                : {
                    ...departmentColumnsAfter(row, after.departmentId, startsOn, today),
                    department_id: after.departmentId,
                  }),
            })
            .where('id', '=', id)
            .execute();
          await this.audit.record(transaction, {
            branchId: null,
            actorId: access.accountId,
            assignmentId,
            action: 'subject.edit',
            record: { type: 'subject', id },
            // A change or a cancel of a planned move names the start date it had.
            oldValue:
              planned === null || change.kind === 'none'
                ? (changes?.oldValue ?? {})
                : { ...changes?.oldValue, departmentStartsOn: planned.startsOn },
            newValue: {
              ...changes?.newValue,
              ...(startsOn === null ? {} : { departmentStartsOn: startsOn }),
              ...(change.kind === 'cancel' ? { departmentMoveCancelled: true } : {}),
            },
            // A new round: the weights of every branch from before no longer count.
            ...roundDetails(row, round, ratingRound, switchesFrom),
            requestId,
          });
        }
        if (record.daily !== null) {
          await this.writeDaily(transaction, access, branchId, id, round, record.daily, requestId);
        }
        return this.readSubject(transaction, branchId, id);
      }),
    );
  }

  /** This branch's daily distribution of a graded subject, on its own route (decision 15). */
  setDaily(access: Access, id: string, weights: DailyWeights, requestId: string): Promise<Subject> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const row = await this.lockActive(transaction, id);
      if (row.journal_type !== 'graded') {
        throw refused('attendance_only_no_weights');
      }
      await this.writeDaily(
        transaction,
        access,
        branchId,
        id,
        row.weights_round,
        weights,
        requestId,
      );
      return this.readSubject(transaction, branchId, id);
    });
  }

  /** At the moment of the clock. An archived subject stays as it is. */
  archive(access: Access, id: string, requestId: string): Promise<Subject> {
    const branchId = branchOf(access);
    return this.refusing(() =>
      this.transactions.run(access.branchIds, async (transaction) => {
        const row = await this.lock(transaction, id);
        if (row.archived_at === null) {
          // Task 3.2a, decision 16: not while an active group of any branch has it.
          await refuseGroupsOfSubject(transaction, id, null);
          const now = this.clock.now();
          await transaction
            .updateTable('subjects')
            .set({ archived_at: now })
            .where('id', '=', id)
            .execute();
          await this.audit.record(transaction, {
            branchId: null,
            actorId: access.accountId,
            assignmentId: access.assignmentId,
            action: 'subject.archive',
            record: { type: 'subject', id },
            oldValue: { archivedAt: null },
            newValue: { archivedAt: now.toISOString() },
            requestId,
          });
        }
        return this.readSubject(transaction, branchId, id);
      }),
    );
  }

  /**
   * Brings back an archived subject. `already_exists` while an active subject
   * has one of its names; `department_archived` while its department is
   * archived (decision 9), with a code of its own (`subject_department_archived`): on a restore
   * there is no department to choose. An active subject stays as it is.
   */
  restore(access: Access, id: string, requestId: string): Promise<Subject> {
    const branchId = branchOf(access);
    return this.refusing(
      () =>
        this.transactions.run(access.branchIds, async (transaction) => {
          const row = await this.lock(transaction, id);
          if (row.archived_at !== null) {
            await this.checkDepartment(
              transaction,
              row.department_id,
              'subject_department_archived',
            );
            await transaction
              .updateTable('subjects')
              .set({ archived_at: null })
              .where('id', '=', id)
              .execute();
            await this.audit.record(transaction, {
              branchId: null,
              actorId: access.accountId,
              assignmentId: access.assignmentId,
              action: 'subject.restore',
              record: { type: 'subject', id },
              oldValue: { archivedAt: row.archived_at.toISOString() },
              newValue: { archivedAt: null },
              requestId,
            });
          }
          return this.readSubject(transaction, branchId, id);
        }),
      { ...SUBJECT_REFUSALS, subjects_department_archived: 'subject_department_archived' },
    );
  }

  /** The four quarters of a year of this branch with the subject's distributions. */
  quarterWeights(access: Access, id: string, yearId: string): Promise<SubjectQuarterWeights> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const subject = await transaction
        .selectFrom('subjects')
        .select(SUBJECT_COLUMNS)
        .where('id', '=', id)
        .executeTakeFirst();
      if (subject === undefined) {
        throw notFound();
      }
      return this.readQuarters(transaction, branchId, subject, yearId);
    });
  }

  /**
   * One quarter's distribution (`05`: "set for each quarter separately"). Its
   * shape follows the rating switch (decision 3); a quarter of a closed year
   * is refused (decision 12).
   */
  setQuarterWeights(
    access: Access,
    id: string,
    quarterId: string,
    weights: QuarterWeights,
    requestId: string,
  ): Promise<SubjectQuarterWeights> {
    return this.writeQuarterWeights(access, id, quarterId, weights, requestId, false);
  }

  /**
   * Task 9.1 (From 2.1 decision 4; `edge/calculation`, week 7: "Before saving,
   * the system shows how many grades will change in each journal"): the
   * write, rolled back, with the grades it alters. Refuses what it refuses.
   */
  previewQuarterWeights(
    access: Access,
    id: string,
    quarterId: string,
    weights: QuarterWeights,
    requestId: string,
  ): Promise<GradeChanges> {
    return previewOf(() =>
      this.writeQuarterWeights(access, id, quarterId, weights, requestId, true),
    );
  }

  private writeQuarterWeights(
    access: Access,
    id: string,
    quarterId: string,
    weights: QuarterWeights,
    requestId: string,
    preview: boolean,
  ): Promise<SubjectQuarterWeights> {
    const branchId = branchOf(access);
    return refusingConstraints(() =>
      this.transactions.run(access.branchIds, async (transaction) => {
        const subject = await this.lockGraded(transaction, id);
        const quarter = await transaction
          .selectFrom('quarters')
          .select(['id', 'academic_year_id'])
          .where('id', '=', quarterId)
          .executeTakeFirst();
        if (quarter === undefined) {
          throw notFound();
        }
        await this.lockOpenYear(transaction, quarter.academic_year_id);
        // Task 8.2 (correction 1): the shape and the rounds of the quarter's switches.
        const switches = await this.switchesIn(transaction, subject.id, quarterId);
        if ((weights.ratingExam !== null) !== switches.rating_exam) {
          throw refused('weights_shape_mismatch');
        }
        const grades = await this.gradesOf(transaction, branchId, subject.id, preview);
        const before = await grades.read(quarterId);
        const change = await this.writeQuarter(
          transaction,
          access,
          branchId,
          subject,
          switches,
          quarterId,
          weights,
          requestId,
        );
        await this.afterWrite(transaction, access, branchId, subject, grades, weights.reason, [
          { quarterId, change, before },
        ]);
        return this.readQuarters(transaction, branchId, subject, quarter.academic_year_id);
      }),
    );
  }

  /**
   * Copies quarter 1's distribution of a year to quarters 2 to 4 of that year,
   * over what they hold (answer 6, decision 16). All or nothing: a refusal
   * leaves every quarter as it was.
   */
  copyQuarterOne(
    access: Access,
    id: string,
    record: CopyQuarterWeightsRecord,
    requestId: string,
  ): Promise<SubjectQuarterWeights> {
    return this.writeCopy(access, id, record, requestId, false);
  }

  /** Task 9.1: the copy, rolled back, with the grades it alters in each quarter it writes. */
  previewCopy(
    access: Access,
    id: string,
    record: CopyQuarterWeightsRecord,
    requestId: string,
  ): Promise<GradeChanges> {
    return previewOf(() => this.writeCopy(access, id, record, requestId, true));
  }

  private writeCopy(
    access: Access,
    id: string,
    record: CopyQuarterWeightsRecord,
    requestId: string,
    preview: boolean,
  ): Promise<SubjectQuarterWeights> {
    const { yearId } = record;
    const branchId = branchOf(access);
    return refusingConstraints(() =>
      this.transactions.run(access.branchIds, async (transaction) => {
        const subject = await this.lockGraded(transaction, id);
        const year = await transaction
          .selectFrom('academic_years')
          .select('id')
          .where('id', '=', yearId)
          .executeTakeFirst();
        if (year === undefined) {
          throw notFound();
        }
        await this.lockOpenYear(transaction, yearId);
        const quarters = await transaction
          .selectFrom('quarters')
          .select(['id', 'number'])
          .where('academic_year_id', '=', yearId)
          .orderBy('number')
          .execute();
        const first = quarters.find((quarter) => quarter.number === 1);
        const switches = await switchesOf(
          transaction,
          [id],
          quarters.map((quarter) => quarter.id),
        );
        const firstSwitches =
          first === undefined ? undefined : switches.get(switchKey(id, first.id));
        const source =
          first === undefined || firstSwitches === undefined
            ? undefined
            : await transaction
                .selectFrom('subject_quarter_weights')
                .select(['attendance', 'classwork', 'homework', 'rating_exam'])
                .where('branch_id', '=', branchId)
                .where('subject_id', '=', id)
                .where('quarter_id', '=', first.id)
                .where('weights_round', '=', firstSwitches.weights_round)
                .where('rating_round', '=', firstSwitches.rating_round)
                .executeTakeFirst();
        if (
          source === undefined ||
          firstSwitches === undefined ||
          !fits(source, firstSwitches.rating_exam)
        ) {
          throw refused('quarter_one_not_set');
        }
        const grades = await this.gradesOf(transaction, branchId, subject.id, preview);
        const written: Written[] = [];
        for (const quarter of quarters) {
          if (quarter.number !== 1) {
            const own = switches.get(switchKey(id, quarter.id));
            // Task 8.2: a quarter whose switches differ from quarter 1's takes no copy.
            if (
              own === undefined ||
              !fits(source, own.rating_exam) ||
              own.journal_type !== 'graded'
            ) {
              throw refused('weights_shape_mismatch');
            }
            const before = await grades.read(quarter.id);
            const change = await this.writeQuarter(
              transaction,
              access,
              branchId,
              subject,
              own,
              quarter.id,
              { ...quarterOf(source), reason: record.reason },
              requestId,
            );
            written.push({ quarterId: quarter.id, change, before });
          }
        }
        await this.afterWrite(
          transaction,
          access,
          branchId,
          subject,
          grades,
          record.reason,
          written,
        );
        return this.readQuarters(transaction, branchId, subject, yearId);
      }),
    );
  }

  /** Name refusals in `details`, then the department refusals of the database. */
  private refusing<T>(
    work: () => Promise<T>,
    refusals: Readonly<Record<string, ErrorCode>> = SUBJECT_REFUSALS,
  ): Promise<T> {
    return refusingDuplicates(() => refusingConstraints(work, refusals), SUBJECT_NAME_INDEXES);
  }

  /**
   * The department of an active subject: an active department of the built-in
   * Academic division (decisions 6 and 9), read FOR SHARE so that an archive
   * of it at the same moment waits. An unknown id is `not_found`.
   */
  private async checkDepartment(
    transaction: Transaction,
    departmentId: string,
    archived: ErrorCode = 'department_archived',
  ): Promise<void> {
    const department = await transaction
      .selectFrom('departments')
      .innerJoin('divisions', 'divisions.id', 'departments.division_id')
      .select(['departments.archived_at', 'divisions.built_in'])
      .where('departments.id', '=', departmentId)
      .forShare('departments')
      .executeTakeFirst();
    if (department === undefined) {
      throw notFound();
    }
    if (!department.built_in) {
      throw refused('department_not_academic');
    }
    if (department.archived_at !== null) {
      throw refused(archived);
    }
  }

  /** The subject, locked for the change; `not_found` when there is none. */
  private async lock(transaction: Transaction, id: string): Promise<SubjectRow> {
    const row = await transaction
      .selectFrom('subjects')
      .select(SUBJECT_COLUMNS)
      .where('id', '=', id)
      .forUpdate()
      .executeTakeFirst();
    if (row === undefined) {
      throw notFound();
    }
    return row;
  }

  /** An active subject, locked; `subject_archived` for an archived one. */
  private async lockActive(transaction: Transaction, id: string): Promise<SubjectRow> {
    const row = await this.lock(transaction, id);
    if (row.archived_at !== null) {
      throw refused('subject_archived');
    }
    return row;
  }

  /**
   * The switches of the subject in a quarter (task 8.2): a quarter where it is
   * attendance only has no weights.
   */
  private async switchesIn(
    transaction: Transaction,
    subjectId: string,
    quarterId: string,
  ): Promise<QuarterSwitches> {
    const switches = (await switchesOf(transaction, [subjectId], [quarterId])).get(
      switchKey(subjectId, quarterId),
    );
    if (switches === undefined) {
      throw notFound();
    }
    if (switches.journal_type !== 'graded') {
      throw refused('attendance_only_no_weights');
    }
    return switches;
  }

  /** An active graded subject, locked: an attendance-only subject has no weights. */
  private async lockGraded(transaction: Transaction, id: string): Promise<SubjectRow> {
    const row = await this.lockActive(transaction, id);
    if (row.journal_type !== 'graded') {
      throw refused('attendance_only_no_weights');
    }
    return row;
  }

  /**
   * The year of a quarter, read FOR SHARE: a closed year changes nothing
   * (decision 12), and a close at the same moment waits for this write. The
   * trigger of 0020 keeps the same rule for every user.
   */
  private async lockOpenYear(transaction: Transaction, yearId: string): Promise<void> {
    const year = await transaction
      .selectFrom('academic_years')
      .select('status')
      .where('id', '=', yearId)
      .forShare()
      .executeTakeFirstOrThrow();
    if (year.status === 'closed') {
      throw refused('year_closed');
    }
  }

  /** This branch's daily distribution of the subject's round, or nothing. */
  private currentDaily(
    transaction: Transaction,
    branchId: string,
    subjectId: string,
    round: number,
  ): Promise<WeightsRow | undefined> {
    return transaction
      .selectFrom('subject_daily_weights')
      .select(['attendance', 'classwork', 'homework'])
      .where('branch_id', '=', branchId)
      .where('subject_id', '=', subjectId)
      .where('weights_round', '=', round)
      .forUpdate()
      .executeTakeFirst();
  }

  /**
   * Stores the daily distribution of the round and its audit entry with the
   * values before and after (`05`: "Each change is logged"); a row of an
   * earlier round counts as none before.
   */
  private async writeDaily(
    transaction: Transaction,
    access: Access,
    branchId: string,
    subjectId: string,
    round: number,
    weights: DailyWeights,
    requestId: string,
  ): Promise<void> {
    const stored = await transaction
      .selectFrom('subject_daily_weights')
      .select(['attendance', 'classwork', 'homework', 'weights_round'])
      .where('branch_id', '=', branchId)
      .where('subject_id', '=', subjectId)
      .forUpdate()
      .executeTakeFirst();
    const oldValue =
      stored === undefined || stored.weights_round !== round ? null : dailyOf(stored);
    if (oldValue !== null && JSON.stringify(oldValue) === JSON.stringify(dailyOf(weights))) {
      return;
    }
    const columns = { ...dailyOf(weights), weights_round: round };
    if (stored === undefined) {
      await transaction
        .insertInto('subject_daily_weights')
        .values({ branch_id: branchId, subject_id: subjectId, ...columns })
        .execute();
    } else {
      await transaction
        .updateTable('subject_daily_weights')
        .set(columns)
        .where('branch_id', '=', branchId)
        .where('subject_id', '=', subjectId)
        .execute();
    }
    await this.audit.record(transaction, {
      branchId,
      actorId: access.accountId,
      assignmentId: access.assignmentId,
      action: 'subject_daily_weights.set',
      record: { type: 'subject', id: subjectId },
      oldValue: { daily: oldValue },
      newValue: { daily: dailyOf(weights) },
      requestId,
    });
  }

  /** Stores one quarter's distribution and its audit entry with the values before and after. */
  private async writeQuarter(
    transaction: Transaction,
    access: Access,
    branchId: string,
    subject: SubjectRow,
    switches: QuarterSwitches,
    quarterId: string,
    weights: QuarterWeights,
    requestId: string,
  ): Promise<QuarterChange> {
    const subjectId = subject.id;
    // Task 8.2 (correction 1): the rounds of the quarter's switches.
    const round = switches.weights_round;
    const ratingRound = switches.rating_round;
    const before = await transaction
      .selectFrom('subject_quarter_weights')
      .select([
        'attendance',
        'classwork',
        'homework',
        'rating_exam',
        'weights_round',
        'rating_round',
      ])
      .where('branch_id', '=', branchId)
      .where('subject_id', '=', subjectId)
      .where('quarter_id', '=', quarterId)
      .forUpdate()
      .executeTakeFirst();
    // A row of an earlier round, or of an earlier rating round, counts as none before.
    const oldValue =
      before === undefined || before.weights_round !== round || before.rating_round !== ratingRound
        ? null
        : quarterOf(before);
    const newValue = quarterOf({
      attendance: weights.attendance,
      classwork: weights.classwork,
      homework: weights.homework,
      rating_exam: weights.ratingExam,
    });
    if (oldValue !== null && JSON.stringify(oldValue) === JSON.stringify(newValue)) {
      return 'unchanged';
    }
    const columns = {
      attendance: weights.attendance,
      classwork: weights.classwork,
      homework: weights.homework,
      rating_exam: weights.ratingExam,
      weights_round: round,
      rating_round: ratingRound,
    };
    if (before === undefined) {
      await transaction
        .insertInto('subject_quarter_weights')
        .values({ branch_id: branchId, subject_id: subjectId, quarter_id: quarterId, ...columns })
        .execute();
    } else {
      await transaction
        .updateTable('subject_quarter_weights')
        .set(columns)
        .where('branch_id', '=', branchId)
        .where('subject_id', '=', subjectId)
        .where('quarter_id', '=', quarterId)
        .execute();
    }
    await this.audit.record(transaction, {
      branchId,
      actorId: access.accountId,
      assignmentId: access.assignmentId,
      action: 'subject_quarter_weights.set',
      record: { type: 'subject', id: subjectId },
      oldValue: { weights: oldValue },
      newValue: { weights: newValue },
      details: { quarterId, ...(weights.reason === undefined ? {} : { reason: weights.reason }) },
      requestId,
    });
    return oldValue === null ? 'first' : 'changed';
  }

  /**
   * The shown results of the subject's journals in a quarter, read only for a
   * preview (task 9.1); the branch's time zone and the injected clock.
   */
  private async gradesOf(
    transaction: Transaction,
    branchId: string,
    subjectId: string,
    preview: boolean,
  ): Promise<GradesReader> {
    const branch = await transaction
      .selectFrom('branches')
      .select('time_zone')
      .where('id', '=', branchId)
      .executeTakeFirstOrThrow();
    const now = this.clock.now();
    return {
      preview,
      timeZone: branch.time_zone,
      now,
      read: async (quarterId) => {
        if (!preview) return undefined;
        const ref = await quarterRefOf(transaction, quarterId);
        return ref === undefined
          ? undefined
          : quarterGrades(transaction, {
              branchId,
              timeZone: branch.time_zone,
              now,
              quarter: ref,
              subjectIds: [subjectId],
            });
      },
    };
  }

  /**
   * After the writes of a weights change (task 9.1; `edge/calculation`, week 7):
   * a change of a stored distribution needs a reason (decision 5); its
   * quarter's teachers are told in this transaction (decision 11); a preview
   * ends here with the grades the change alters, rolled back. A first setting
   * and a save that changes nothing need no reason and tell nobody.
   */
  private async afterWrite(
    transaction: Transaction,
    access: Access,
    branchId: string,
    subject: SubjectRow,
    grades: GradesReader,
    reason: string | undefined,
    written: readonly Written[],
  ): Promise<void> {
    const reasonRequired = written.some((one) => one.change === 'changed');
    if (grades.preview) {
      const quarters = [];
      for (const one of written) {
        const after = await grades.read(one.quarterId);
        if (one.before !== undefined && after !== undefined) {
          quarters.push(compareGrades(one.before, after));
        }
      }
      throw new PreviewDone({ reasonRequired, quarters });
    }
    if (!reasonRequired) return;
    if (reason === undefined) throw refused('reason_required');
    const today = schoolDateOf(grades.now, grades.timeZone);
    // One notice per account for the change, naming every quarter of it the account
    // teaches in (decision 11: "each once"; spec review of the code, should-fix 3).
    const quartersOf = new Map<string, number[]>();
    for (const one of written) {
      if (one.change !== 'changed') continue;
      const quarter = await quarterRefOf(transaction, one.quarterId);
      if (quarter === undefined) continue;
      const accountIds = await weightsNoticeAccounts(transaction, {
        branchId,
        subjectId: subject.id,
        quarter,
        today,
      });
      for (const accountId of accountIds) {
        quartersOf.set(accountId, [...(quartersOf.get(accountId) ?? []), quarter.number]);
      }
    }
    const byQuarters = new Map<string, { quarters: number[]; accountIds: string[] }>();
    for (const [accountId, quarters] of quartersOf) {
      const key = quarters.join(',');
      const group = byQuarters.get(key) ?? { quarters, accountIds: [] };
      group.accountIds.push(accountId);
      byQuarters.set(key, group);
    }
    for (const group of byQuarters.values()) {
      await this.notifications.send(transaction, {
        kind: 'setup.quarter_weights_changed',
        data: {
          subject: { uz: subject.name_uz, ru: subject.name_ru, en: subject.name_en },
          quarters: group.quarters,
          date: today,
          reason,
        },
        branchId,
        accountIds: group.accountIds,
      });
    }
  }

  private async readSubject(
    transaction: Transaction,
    branchId: string,
    id: string,
  ): Promise<Subject> {
    const rows = await transaction
      .selectFrom('subjects')
      .select(SUBJECT_COLUMNS)
      .where('id', '=', id)
      .execute();
    const [subject] = await this.withWeights(transaction, branchId, rows);
    if (subject === undefined) {
      throw notFound();
    }
    return subject;
  }

  /**
   * The subjects with this branch's daily distribution and the count of
   * quarters of the branch's planned and current years without a fitting
   * quarterly distribution (decision 3).
   */
  private async withWeights(
    transaction: Transaction,
    branchId: string,
    rows: readonly SubjectRow[],
  ): Promise<Subject[]> {
    if (rows.length === 0) {
      return [];
    }
    const ids = rows.map((row) => row.id);
    const [daily, quarters, weights] = await Promise.all([
      transaction
        .selectFrom('subject_daily_weights')
        .select(['subject_id', 'attendance', 'classwork', 'homework', 'weights_round'])
        .where('branch_id', '=', branchId)
        .where('subject_id', 'in', ids)
        .execute(),
      transaction
        .selectFrom('quarters')
        .innerJoin('academic_years', 'academic_years.id', 'quarters.academic_year_id')
        .select('quarters.id')
        .where('quarters.branch_id', '=', branchId)
        .where('academic_years.status', 'in', ['planned', 'current'])
        .orderBy('quarters.id')
        .execute(),
      transaction
        .selectFrom('subject_quarter_weights')
        .innerJoin('quarters', 'quarters.id', 'subject_quarter_weights.quarter_id')
        .innerJoin('academic_years', 'academic_years.id', 'quarters.academic_year_id')
        .select([
          'subject_quarter_weights.subject_id',
          'subject_quarter_weights.quarter_id',
          'subject_quarter_weights.rating_exam',
          'subject_quarter_weights.weights_round',
          'subject_quarter_weights.rating_round',
        ])
        .where('subject_quarter_weights.branch_id', '=', branchId)
        .where('subject_quarter_weights.subject_id', 'in', ids)
        .where('academic_years.status', 'in', ['planned', 'current'])
        .execute(),
    ]);
    // Task 8.2: each quarter counts against the subject's switches there.
    const switches = await switchesOf(
      transaction,
      ids,
      quarters.map((quarter) => quarter.id),
    );
    // The department each subject shows: in force today in the branch time of
    // the request (task 3.6b-3, decision 5).
    const today = await todayOf(transaction, branchId);
    return rows.map((row) => {
      const graded = row.journal_type === 'graded';
      const shown = departmentInForce(row, today);
      const own = daily.find(
        (weights) => weights.subject_id === row.id && dailyWeightsFit(row, weights),
      );
      // The graded quarters of the subject, each against its own switches (task 8.2).
      const counted = quarters.filter(
        (quarter) => switches.get(switchKey(row.id, quarter.id))?.journal_type === 'graded',
      );
      const fitting = weights.filter((stored) => {
        const own = switches.get(switchKey(row.id, stored.quarter_id));
        return (
          stored.subject_id === row.id &&
          own?.journal_type === 'graded' &&
          counted.some((quarter) => quarter.id === stored.quarter_id) &&
          quarterWeightsFit(own, stored)
        );
      }).length;
      return {
        id: row.id,
        ...fieldsOf(row),
        departmentId: shown.departmentId ?? row.department_id,
        departmentSince: shown.since,
        departmentMove:
          shown.move === null || shown.move.departmentId === null
            ? null
            : { departmentId: shown.move.departmentId, startsOn: shown.move.startsOn },
        archivedAt: row.archived_at === null ? null : row.archived_at.toISOString(),
        daily: !graded || own === undefined ? null : dailyOf(own),
        quarterWeightsMissing: graded && counted.length > 0 ? counted.length - fitting : null,
        quarterCount: graded && counted.length > 0 ? counted.length : null,
      };
    });
  }

  private async readQuarters(
    transaction: Transaction,
    branchId: string,
    subject: SubjectRow,
    yearId: string,
  ): Promise<SubjectQuarterWeights> {
    const year = await transaction
      .selectFrom('academic_years')
      .select(['id', 'status'])
      .where('id', '=', yearId)
      .executeTakeFirst();
    if (year === undefined) {
      throw notFound();
    }
    const quarters = await transaction
      .selectFrom('quarters')
      .leftJoin('subject_quarter_weights', (join) =>
        join
          .onRef('subject_quarter_weights.quarter_id', '=', 'quarters.id')
          .on('subject_quarter_weights.subject_id', '=', subject.id)
          .on('subject_quarter_weights.branch_id', '=', branchId),
      )
      .select([
        'quarters.id',
        'quarters.number',
        'quarters.start_date',
        'quarters.end_date',
        'subject_quarter_weights.attendance',
        'subject_quarter_weights.classwork',
        'subject_quarter_weights.homework',
        'subject_quarter_weights.rating_exam',
        'subject_quarter_weights.weights_round',
        'subject_quarter_weights.rating_round',
      ])
      .where('quarters.academic_year_id', '=', yearId)
      .orderBy('quarters.number')
      .execute();
    // Task 8.2 (correction 1): a stored row counts in the rounds of its quarter's switches.
    const switches = await switchesOf(
      transaction,
      [subject.id],
      quarters.map((quarter) => quarter.id),
    );
    return {
      yearId: year.id,
      yearStatus: year.status as SubjectQuarterWeights['yearStatus'],
      quarters: quarters.map((quarter) => {
        const own = switches.get(switchKey(subject.id, quarter.id));
        const ratingExam = own?.rating_exam ?? subject.rating_exam;
        const stored =
          quarter.attendance === null ||
          quarter.classwork === null ||
          quarter.homework === null ||
          own === undefined ||
          quarter.weights_round !== own.weights_round ||
          quarter.rating_round !== own.rating_round
            ? null
            : {
                attendance: quarter.attendance,
                classwork: quarter.classwork,
                homework: quarter.homework,
                rating_exam: quarter.rating_exam,
              };
        return {
          quarterId: quarter.id,
          number: quarter.number,
          startDate: quarter.start_date,
          endDate: quarter.end_date,
          weights: stored === null ? null : quarterOf(stored),
          fits: stored !== null && fits(stored, ratingExam),
          graded: (own?.journal_type ?? subject.journal_type) === 'graded',
          ratingExam,
        };
      }),
    };
  }
}

/**
 * The columns of the subjects file: the daily distribution as three number
 * columns, empty for an attendance-only subject or one not set; the quarters
 * not set as a number, empty when there is nothing to count.
 */
function subjectExportColumns(
  names: SchoolNames,
): Record<SubjectExportColumn, ExportColumn<Subject>> {
  return {
    name: oneCell(
      (texts) => texts.subjects.columns.name,
      (row, _texts, language) => row.names[language],
    ),
    department: oneCell(
      (texts) => texts.subjects.columns.department,
      (row, _texts, language) => nameIn(names.departments, row.departmentId, language),
    ),
    grades: oneCell(
      (texts) => texts.subjects.columns.grades,
      (row) => gradeRanges(row.grades),
    ),
    journalType: oneCell(
      (texts) => texts.subjects.columns.journalType,
      (row, texts) => texts.journalTypes[row.journalType],
    ),
    ratingExam: oneCell(
      (texts) => texts.subjects.columns.ratingExam,
      (row, texts) => (row.ratingExam ? texts.yes : texts.no),
    ),
    daily: {
      headings: (texts) =>
        [texts.weightParts.attendance, texts.weightParts.classwork, texts.weightParts.homework].map(
          (part) => `${texts.subjects.columns.daily}: ${part}`,
        ),
      cells: (row) =>
        row.daily === null
          ? [null, null, null]
          : [row.daily.attendance, row.daily.classwork, row.daily.homework],
    },
    quarterly: oneCell(
      (texts) => texts.subjects.columns.quarterly,
      (row) => row.quarterWeightsMissing,
    ),
    switches: oneCell(
      (texts) => texts.subjects.columns.switches,
      (row, texts) =>
        joined(
          [
            row.groupSubject ? texts.switches.groupSubject : null,
            row.languageRule ? texts.switches.languageRule : null,
            row.demanding ? texts.switches.demanding : null,
          ].filter((text): text is string => text !== null),
        ),
    ),
    status: oneCell(
      (texts) => texts.subjects.columns.status,
      (row, texts) => (row.archivedAt === null ? texts.active : texts.archived),
    ),
  };
}
