import { Inject, Injectable } from '@nestjs/common';
import type {
  Clock,
  DailyWeights,
  ErrorCode,
  JournalType,
  Names,
  QuarterWeights,
  Subject,
  SubjectColour,
  SubjectList,
  SubjectQuarterWeights,
  SubjectRecord,
} from '@sodiq/shared';
import { CLOCK } from '../../clock/clock.module.js';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import type { Access } from '../access/permission.guard.js';
import { Audit } from '../audit/audit.service.js';
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
};

const SUBJECT_COLUMNS = [
  'id',
  'name_uz',
  'name_ru',
  'name_en',
  'department_id',
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
): { details?: Record<string, { from: number; to: number }> } {
  const details: Record<string, { from: number; to: number }> = {};
  if (round !== row.weights_round) {
    details.weightsRound = { from: row.weights_round, to: round };
  }
  if (ratingRound !== row.rating_round) {
    details.ratingRound = { from: row.rating_round, to: ratingRound };
  }
  return Object.keys(details).length === 0 ? {} : { details };
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
  ) {}

  /** Every subject, archived ones included and marked, with this branch's weights. */
  list(access: Access): Promise<SubjectList> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const rows = await transaction
        .selectFrom('subjects')
        .select(SUBJECT_COLUMNS)
        .orderBy('name_en')
        .orderBy('id')
        .execute();
      return {
        subjects: await this.withWeights(transaction, branchId, rows),
        mayMoveDepartment: superAdminOf(access) !== undefined,
      };
    });
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
        const row = await this.lockActive(transaction, id);
        const before = fieldsOf(row);
        const after = recordFields(record);
        // The assignment the audit entry names: for a move, the Super Admin one.
        let assignmentId = access.assignmentId;
        if (after.departmentId !== before.departmentId) {
          // `edge/people-roles-accounts`: "A teacher moves to another department,
          // or a subject is moved, mid-year. Both changes ... are made by the
          // Super Admin." (Decision 17 of pull request #52.)
          const superAdmin = superAdminOf(access);
          if (superAdmin === undefined) {
            throw new ApiException('subject_move_super_admin', 403);
          }
          assignmentId = superAdmin;
          await this.checkDepartment(transaction, after.departmentId);
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
        const changes = changesOf({ ...before }, { ...after });
        if (changes !== null) {
          await transaction
            .updateTable('subjects')
            .set({ ...columnsOf(after), weights_round: round, rating_round: ratingRound })
            .where('id', '=', id)
            .execute();
          await this.audit.record(transaction, {
            branchId: null,
            actorId: access.accountId,
            assignmentId,
            action: 'subject.edit',
            record: { type: 'subject', id },
            oldValue: changes.oldValue,
            newValue: changes.newValue,
            // A new round: the weights of every branch from before no longer count.
            ...roundDetails(row, round, ratingRound),
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
    return this.transactions.run(access.branchIds, async (transaction) => {
      const row = await this.lock(transaction, id);
      if (row.archived_at === null) {
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
    });
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
        if ((weights.ratingExam !== null) !== subject.rating_exam) {
          throw refused('weights_shape_mismatch');
        }
        await this.writeQuarter(
          transaction,
          access,
          branchId,
          subject,
          quarterId,
          weights,
          requestId,
        );
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
    yearId: string,
    requestId: string,
  ): Promise<SubjectQuarterWeights> {
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
        const source =
          first === undefined
            ? undefined
            : await transaction
                .selectFrom('subject_quarter_weights')
                .select(['attendance', 'classwork', 'homework', 'rating_exam'])
                .where('branch_id', '=', branchId)
                .where('subject_id', '=', id)
                .where('quarter_id', '=', first.id)
                .where('weights_round', '=', subject.weights_round)
                .where('rating_round', '=', subject.rating_round)
                .executeTakeFirst();
        if (source === undefined || !fits(source, subject.rating_exam)) {
          throw refused('quarter_one_not_set');
        }
        for (const quarter of quarters) {
          if (quarter.number !== 1) {
            await this.writeQuarter(
              transaction,
              access,
              branchId,
              subject,
              quarter.id,
              quarterOf(source),
              requestId,
            );
          }
        }
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
    quarterId: string,
    weights: QuarterWeights,
    requestId: string,
  ): Promise<void> {
    const subjectId = subject.id;
    const round = subject.weights_round;
    const ratingRound = subject.rating_round;
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
      return;
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
      details: { quarterId },
      requestId,
    });
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
        .execute(),
      transaction
        .selectFrom('subject_quarter_weights')
        .innerJoin('quarters', 'quarters.id', 'subject_quarter_weights.quarter_id')
        .innerJoin('academic_years', 'academic_years.id', 'quarters.academic_year_id')
        .select([
          'subject_quarter_weights.subject_id',
          'subject_quarter_weights.rating_exam',
          'subject_quarter_weights.weights_round',
          'subject_quarter_weights.rating_round',
        ])
        .where('subject_quarter_weights.branch_id', '=', branchId)
        .where('subject_quarter_weights.subject_id', 'in', ids)
        .where('academic_years.status', 'in', ['planned', 'current'])
        .execute(),
    ]);
    return rows.map((row) => {
      const graded = row.journal_type === 'graded';
      const own = daily.find(
        (weights) => weights.subject_id === row.id && weights.weights_round === row.weights_round,
      );
      const fitting = weights.filter(
        (stored) =>
          stored.subject_id === row.id &&
          stored.weights_round === row.weights_round &&
          stored.rating_round === row.rating_round &&
          (stored.rating_exam !== null) === row.rating_exam,
      ).length;
      return {
        id: row.id,
        ...fieldsOf(row),
        archivedAt: row.archived_at === null ? null : row.archived_at.toISOString(),
        daily: !graded || own === undefined ? null : dailyOf(own),
        quarterWeightsMissing: graded && quarters.length > 0 ? quarters.length - fitting : null,
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
          .on('subject_quarter_weights.branch_id', '=', branchId)
          .on('subject_quarter_weights.weights_round', '=', subject.weights_round)
          .on('subject_quarter_weights.rating_round', '=', subject.rating_round),
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
      ])
      .where('quarters.academic_year_id', '=', yearId)
      .orderBy('quarters.number')
      .execute();
    return {
      yearId: year.id,
      yearStatus: year.status as SubjectQuarterWeights['yearStatus'],
      quarters: quarters.map((quarter) => {
        const stored =
          quarter.attendance === null || quarter.classwork === null || quarter.homework === null
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
          fits: stored !== null && fits(stored, subject.rating_exam),
        };
      }),
    };
  }
}
