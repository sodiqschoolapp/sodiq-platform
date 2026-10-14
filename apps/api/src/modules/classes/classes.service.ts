import { Inject, Injectable } from '@nestjs/common';
import {
  academicYearName,
  academicYearStatusSchema,
  classDisplayName,
  classNameKey,
  instructionLanguageSchema,
  listName,
  roomStatusSchema,
  schoolDateOf,
  type ClassCreate,
  type ClassDetail,
  type ClassEdit,
  type ClassExport,
  type ClassExportColumn,
  type ClassList,
  type ClassRecord,
  type ClassTutor,
  type Clock,
  type ErrorCode,
  type SchoolClass,
} from '@sodiq/shared';
import { CLOCK } from '../../clock/clock.module.js';
import { Transactions, transactionMoment, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import type { XlsxFile } from '../../http/xlsx.js';
import { classesInScope, inClassScope } from '../access/class-scope.js';
import type { Access } from '../access/permission.guard.js';
import { Audit } from '../audit/audit.service.js';
import { exportList, oneCell, type ExportColumn } from '../audit/export-list.js';
import { changesOf, notFound, refusingConstraints } from '../setup/setup-refusals.js';
import { memberCountsOn, MEMBERSHIP_REFUSALS } from './class-membership-rows.js';
import { GROUP_SIDE_REFUSALS } from './group-rows.js';
import { followClassLanguage } from './group-side.js';
import {
  CLASS_EDIT_REFUSALS,
  CLASS_REFUSALS,
  toClassTutor,
  tutorEnded,
  tutorRowsIn,
  type TutorRow,
} from './class-tutor-rows.js';

const UNIQUE_VIOLATION = '23505';

/** The unique name of a class in a branch, year and grade (db/migrations/0042). */
const NAME_INDEX = 'classes_name_key';

interface ClassRow {
  id: string;
  academic_year_id: string;
  start_date: string;
  end_date: string;
  year_status: string;
  grade: number;
  name: string;
  language: string;
  main_room_id: string | null;
  room_name: string | null;
  room_status: string | null;
  max_size: number;
  archived_at: Date | null;
  version: number;
}

/**
 * A class outside the scope of every assignment that permits the route is
 * refused 403 (task 3.1c, decision 9 of pull request #90); the caller has
 * answered 404 for an unknown id or another branch's first.
 */
export function refuseOutsideClassScope(access: Access, classId: string): void {
  if (inClassScope(access.permitting, [classId]) === undefined) {
    throw new ApiException('permission_denied', 403);
  }
}

export function branchOf(access: Access): string {
  if (access.branchId === null) {
    throw new Error('A class belongs to the branch of the request.');
  }
  return access.branchId;
}

/** The time zone of the branch of the transaction's class, for the dates of its Tutors. */
export async function zoneOf(transaction: Transaction, branchId: string): Promise<string> {
  const branch = await transaction
    .selectFrom('branches')
    .select('time_zone')
    .where('id', '=', branchId)
    .executeTakeFirstOrThrow();
  return branch.time_zone;
}

function classesIn(transaction: Transaction) {
  return transaction
    .selectFrom('classes')
    .innerJoin('academic_years', 'academic_years.id', 'classes.academic_year_id')
    .leftJoin('rooms', 'rooms.id', 'classes.main_room_id')
    .select([
      'classes.id',
      'classes.academic_year_id',
      'academic_years.start_date',
      'academic_years.end_date',
      'academic_years.status as year_status',
      'classes.grade',
      'classes.name',
      'classes.language',
      'classes.main_room_id',
      'rooms.name as room_name',
      'rooms.status as room_status',
      'classes.max_size',
      'classes.archived_at',
      'classes.version',
    ]);
}

function toClass(
  row: ClassRow,
  inForce: { tutor: ClassTutor | null; acting: ClassTutor | null },
  students: number,
): SchoolClass {
  return {
    id: row.id,
    academicYearId: row.academic_year_id,
    yearName: academicYearName(row.start_date, row.end_date),
    // The checks of the tables keep the lists equal to the schemas'.
    yearStatus: academicYearStatusSchema.parse(row.year_status),
    grade: row.grade,
    name: row.name,
    language: instructionLanguageSchema.parse(row.language),
    mainRoom:
      row.main_room_id === null || row.room_name === null || row.room_status === null
        ? null
        : {
            id: row.main_room_id,
            name: row.room_name,
            status: roomStatusSchema.parse(row.room_status),
          },
    maxSize: row.max_size,
    students,
    tutor: inForce.tutor,
    acting: inForce.acting,
    archived: row.archived_at !== null,
    version: row.version,
  };
}

/** The fields a person types, as the audit entries record them. */
const fieldsOf = (row: ClassRow): ClassRecord => ({
  grade: row.grade,
  name: row.name,
  language: instructionLanguageSchema.parse(row.language),
  mainRoomId: row.main_room_id,
  maxSize: row.max_size,
});

/** The Tutor and the acting Tutor in force at `now` among the rows of one class. */
function inForceOf(rows: readonly ClassTutor[]): {
  tutor: ClassTutor | null;
  acting: ClassTutor | null;
} {
  const current = rows.filter((row) => row.state === 'current');
  return {
    tutor: current.find((row) => row.kind === 'tutor') ?? null,
    acting: current.find((row) => row.kind === 'acting') ?? null,
  };
}

/** The classes of the branch with their Tutors in force and their members today, by grade and name. */
async function readClasses(transaction: Transaction, branchId: string): Promise<SchoolClass[]> {
  const now = await transactionMoment(transaction);
  const zone = await zoneOf(transaction, branchId);
  const rows = await classesIn(transaction)
    .orderBy('academic_years.start_date', 'desc')
    .orderBy('classes.grade')
    .orderBy('classes.name_key')
    .orderBy('classes.id')
    .execute();
  const tutors = await tutorRowsIn(transaction)
    .where('class_tutors.valid_from', '<=', now)
    .where((builder) =>
      builder.or([
        builder('class_tutors.valid_until', 'is', null),
        builder('class_tutors.valid_until', '>', now),
      ]),
    )
    .execute();
  const members = await memberCountsOn(transaction, schoolDateOf(now, zone));
  return rows.map((row) =>
    toClass(
      row,
      inForceOf(
        tutors
          .filter((tutor) => tutor.class_id === row.id)
          .map((tutor) => toClassTutor(tutor, now, zone)),
      ),
      members.get(row.id) ?? 0,
    ),
  );
}

async function readClassRow(transaction: Transaction, id: string): Promise<ClassRow> {
  const row = await classesIn(transaction).where('classes.id', '=', id).executeTakeFirst();
  if (row === undefined) {
    throw notFound();
  }
  return row;
}
export async function readClassDetail(
  transaction: Transaction,
  branchId: string,
  id: string,
): Promise<ClassDetail> {
  const row = await readClassRow(transaction, id);
  const now = await transactionMoment(transaction);
  const zone = await zoneOf(transaction, branchId);
  const tutors = (
    await tutorRowsIn(transaction).where('class_tutors.class_id', '=', id).execute()
  ).map((tutor: TutorRow) => toClassTutor(tutor, now, zone));
  const today = schoolDateOf(now, zone);
  const members = await memberCountsOn(transaction, today);
  return { ...toClass(row, inForceOf(tutors), members.get(id) ?? 0), tutors, today };
}
/** The file's columns, the same words as the list's headers. */
const CLASS_EXPORT: Record<ClassExportColumn, ExportColumn<SchoolClass>> = {
  name: oneCell(
    (texts) => texts.classes.columns.name,
    (row) => classDisplayName(row.grade, row.name),
  ),
  year: oneCell(
    (texts) => texts.classes.columns.year,
    (row) => row.yearName,
  ),
  language: oneCell(
    (texts) => texts.classes.columns.language,
    (row, texts) => texts.instructionLanguages[row.language],
  ),
  tutor: oneCell(
    (texts) => texts.classes.columns.tutor,
    (row) => (row.tutor?.name == null ? null : listName(row.tutor.name)),
  ),
  mainRoom: oneCell(
    (texts) => texts.classes.columns.mainRoom,
    (row) => row.mainRoom?.name ?? null,
  ),
  students: oneCell(
    (texts) => texts.classes.columns.students,
    (row) => row.students,
  ),
  maxSize: oneCell(
    (texts) => texts.classes.columns.maxSize,
    (row) => row.maxSize,
  ),
  status: oneCell(
    (texts) => texts.classes.columns.status,
    (row, texts) => (row.archived ? texts.archived : texts.active),
  ),
};

/**
 * Classes (docs/spec/05-classes-groups-subjects.md, Class; task 3.1a, pull
 * request #88). A class of the branch belongs to a planned or current year
 * (decision 6), is unique by its folded name per year and grade among
 * archived classes too (decisions 3 and 4), and is archived, never deleted
 * (decision 10): the archive ends its Tutors in the same transaction. In a
 * closed year a class is history (decision 18).
 */
@Injectable()
export class Classes {
  constructor(
    private readonly transactions: Transactions,
    private readonly audit: Audit,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * The classes of the branch; a Tutor's own classes only (`02`, Tutor: "Own
   * class or classes"; task 3.1c, decision 1 of pull request #90).
   */
  list(access: Access): Promise<ClassList> {
    const scope = classesInScope(access.permitting);
    return this.transactions.run(access.branchIds, async (transaction) => ({
      classes: (await readClasses(transaction, branchOf(access))).filter(
        (one) => scope === 'all' || scope.has(one.id.toLowerCase()),
      ),
    }));
  }

  /** One class: an unknown id or another branch's is 404, a class outside the scope 403 (decision 9). */
  detail(access: Access, id: string): Promise<ClassDetail> {
    return this.transactions.run(access.branchIds, async (transaction) => {
      const found = await readClassDetail(transaction, branchOf(access), id);
      refuseOutsideClassScope(access, id);
      return found;
    });
  }

  /** The Excel file of the list, from the rows the list reads, in one transaction. */
  export(access: Access, request: ClassExport, requestId: string): Promise<XlsxFile> {
    return this.transactions.run(access.branchIds, async (transaction) => {
      const classes = await readClasses(transaction, branchOf(access));
      return exportList(transaction, this.audit, this.clock, access, requestId, {
        list: 'classes',
        action: 'class.export',
        request,
        rows: new Map(classes.map((one) => [one.id, one])),
        allowed: () => true,
        columns: CLASS_EXPORT,
      });
    });
  }

  create(access: Access, input: ClassCreate, requestId: string): Promise<ClassDetail> {
    const branchId = branchOf(access);
    return this.refusingName(access, input.academicYearId, input, CLASS_REFUSALS, () =>
      this.transactions.run(access.branchIds, async (transaction) => {
        await this.requireOpenYearFor(transaction, input.academicYearId);
        await this.requireRoom(transaction, input.mainRoomId);
        const row = await transaction
          .insertInto('classes')
          .values({
            branch_id: branchId,
            academic_year_id: input.academicYearId,
            grade: input.grade,
            name: input.name,
            language: input.language,
            main_room_id: input.mainRoomId,
            max_size: input.maxSize,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        const created = await readClassRow(transaction, row.id);
        await this.audit.record(transaction, {
          branchId,
          actorId: access.accountId,
          assignmentId: access.assignmentId,
          action: 'class.create',
          record: { type: 'class', id: row.id },
          newValue: { academicYearId: input.academicYearId, ...fieldsOf(created) },
          requestId,
        });
        return readClassDetail(transaction, branchId, row.id);
      }),
    );
  }

  /** Every field but the year. Nothing is written when nothing changed. */
  edit(access: Access, id: string, input: ClassEdit, requestId: string): Promise<ClassDetail> {
    const branchId = branchOf(access);
    return this.refusingName(
      access,
      null,
      { ...input, id },
      { ...MEMBERSHIP_REFUSALS, ...CLASS_EDIT_REFUSALS, ...GROUP_SIDE_REFUSALS },
      () =>
        this.transactions.run(access.branchIds, async (transaction) => {
          const before = await this.lockClass(transaction, id);
          if (before.archived_at !== null) {
            throw new ApiException('class_archived', 409);
          }
          if (before.version !== input.version) {
            throw new ApiException('class_changed', 409);
          }
          await this.requireOpenYear(transaction, before.academic_year_id);
          const record: ClassRecord = {
            grade: input.grade,
            name: input.name,
            language: input.language,
            mainRoomId: input.mainRoomId,
            maxSize: input.maxSize,
          };
          const changes = changesOf(fieldsOf(before), record);
          if (changes === null) {
            return readClassDetail(transaction, branchId, id);
          }
          if (record.mainRoomId !== before.main_room_id) {
            await this.requireRoom(transaction, record.mainRoomId);
          }
          // Task 3.2a, decision 8: the one-language groups of the class follow
          // its language; a group it makes mix languages needs the confirmation.
          const groups =
            record.language === before.language
              ? { moved: [], mixed: [] }
              : await followClassLanguage(
                  transaction,
                  id,
                  record.language,
                  input.confirmMixedGroups,
                );
          await transaction
            .updateTable('classes')
            .set({
              grade: record.grade,
              name: record.name,
              language: record.language,
              main_room_id: record.mainRoomId,
              max_size: record.maxSize,
            })
            .where('id', '=', id)
            .execute();
          await this.audit.record(transaction, {
            branchId,
            actorId: access.accountId,
            assignmentId: access.assignmentId,
            action: 'class.edit',
            record: { type: 'class', id },
            oldValue: changes.oldValue,
            newValue: changes.newValue,
            ...(groups.moved.length === 0 && groups.mixed.length === 0
              ? {}
              : { details: { groupsMoved: groups.moved, groupsMixed: groups.mixed } }),
            requestId,
          });
          return readClassDetail(transaction, branchId, id);
        }),
    );
  }

  /**
   * Archives the class (decision 10): its Tutor rows in force end at the
   * moment of the archive and the planned ones are withdrawn, `end_cause =
   * 'archive'`, named in the same audit entry. An archived class is answered
   * as it is.
   */
  archive(access: Access, id: string, requestId: string): Promise<ClassDetail> {
    const branchId = branchOf(access);
    return refusingConstraints(
      () =>
        this.transactions.run(access.branchIds, async (transaction) => {
          const before = await this.lockClass(transaction, id);
          if (before.archived_at !== null) {
            return readClassDetail(transaction, branchId, id);
          }
          await this.requireOpenYear(transaction, before.academic_year_id);
          const now = await transactionMoment(transaction);
          // Read in order and locked before the update (`returning` has no order).
          const live = await transaction
            .selectFrom('class_tutors')
            .select(['id', 'valid_from', 'valid_until'])
            .where('class_id', '=', id)
            .where((builder) =>
              builder.or([builder('valid_until', 'is', null), builder('valid_until', '>', now)]),
            )
            .whereRef('valid_until', 'is distinct from', 'valid_from')
            .orderBy('id')
            .forUpdate()
            .execute();
          const ended: { id: string; validUntil: string }[] = [];
          for (const row of live) {
            if (tutorEnded(row, now)) {
              continue;
            }
            const end = row.valid_from > now ? row.valid_from : now;
            await transaction
              .updateTable('class_tutors')
              .set({ valid_until: end, end_cause: 'archive', ended_by: access.accountId })
              .where('id', '=', row.id)
              .execute();
            ended.push({ id: row.id, validUntil: end.toISOString() });
          }
          await transaction
            .updateTable('classes')
            .set({ archived_at: now })
            .where('id', '=', id)
            .execute();
          await this.audit.record(transaction, {
            branchId,
            actorId: access.accountId,
            assignmentId: access.assignmentId,
            action: 'class.archive',
            record: { type: 'class', id },
            oldValue: { archived: false },
            newValue: { archived: true },
            ...(ended.length === 0 ? {} : { details: { tutorsEnded: ended } }),
            requestId,
          });
          return readClassDetail(transaction, branchId, id);
        }),
      { ...CLASS_REFUSALS, ...MEMBERSHIP_REFUSALS, ...GROUP_SIDE_REFUSALS },
    );
  }

  /** Restores the class; no Tutor comes back with it (decision 10). */
  restore(access: Access, id: string, requestId: string): Promise<ClassDetail> {
    const branchId = branchOf(access);
    return refusingConstraints(
      () =>
        this.transactions.run(access.branchIds, async (transaction) => {
          const before = await this.lockClass(transaction, id);
          if (before.archived_at === null) {
            return readClassDetail(transaction, branchId, id);
          }
          await this.requireOpenYear(transaction, before.academic_year_id);
          await transaction
            .updateTable('classes')
            .set({ archived_at: null })
            .where('id', '=', id)
            .execute();
          await this.audit.record(transaction, {
            branchId,
            actorId: access.accountId,
            assignmentId: access.assignmentId,
            action: 'class.restore',
            record: { type: 'class', id },
            oldValue: { archived: true },
            newValue: { archived: false },
            requestId,
          });
          return readClassDetail(transaction, branchId, id);
        }),
      CLASS_REFUSALS,
    );
  }

  /** The class locked for a change; 404 for another branch's class or an unknown id. */
  private async lockClass(transaction: Transaction, id: string): Promise<ClassRow> {
    const locked = await transaction
      .selectFrom('classes')
      .select('id')
      .where('id', '=', id)
      .forUpdate()
      .executeTakeFirst();
    if (locked === undefined) {
      throw notFound();
    }
    return readClassRow(transaction, id);
  }

  /**
   * The year of a new class: a planned or current year of the branch
   * (decision 6). Without one the branch has nothing to create a class in
   * (`class_needs_year`); a year of another branch or unknown is not found; a
   * closed one is history (decision 18). Locked FOR SHARE, then read.
   */
  private async requireOpenYearFor(transaction: Transaction, yearId: string): Promise<void> {
    const open = await transaction
      .selectFrom('academic_years')
      .select('id')
      .where('status', 'in', ['planned', 'current'])
      .executeTakeFirst();
    if (open === undefined) {
      throw new ApiException('class_needs_year', 409);
    }
    await this.requireOpenYear(transaction, yearId);
  }

  /** The year of a class, locked FOR SHARE first and read afterwards; closed: `class_year_closed`. */
  private async requireOpenYear(transaction: Transaction, yearId: string): Promise<void> {
    const locked = await transaction
      .selectFrom('academic_years')
      .select('id')
      .where('id', '=', yearId)
      .forShare()
      .executeTakeFirst();
    if (locked === undefined) {
      throw notFound();
    }
    const year = await transaction
      .selectFrom('academic_years')
      .select('status')
      .where('id', '=', yearId)
      .executeTakeFirstOrThrow();
    if (year.status === 'closed') {
      throw new ApiException('class_year_closed', 409);
    }
  }

  /**
   * The main classroom (decision 7): a room of the branch that is not closed,
   * locked FOR SHARE first and read afterwards, so a close at the same moment
   * waits or is waited for. Another branch's room or an unknown one is not
   * found.
   */
  private async requireRoom(transaction: Transaction, roomId: string | null): Promise<void> {
    if (roomId === null) {
      return;
    }
    const locked = await transaction
      .selectFrom('rooms')
      .select('id')
      .where('id', '=', roomId)
      .forShare()
      .executeTakeFirst();
    if (locked === undefined) {
      throw notFound();
    }
    const room = await transaction
      .selectFrom('rooms')
      .select('status')
      .where('id', '=', roomId)
      .executeTakeFirstOrThrow();
    if (room.status === 'closed') {
      throw new ApiException('room_closed', 409);
    }
  }

  /**
   * Runs a create or an edit: the refusals of the database become their
   * codes, and a taken name becomes 409 `already_exists` on `name`, naming
   * the class that holds it (archived or not), so the panel can offer its
   * restore (`edge/academic-year`: "adding one that exists offers restore").
   * The holder is read after the refused transaction, when it is committed.
   */
  private async refusingName<T>(
    access: Access,
    yearId: string | null,
    record: ClassRecord & { id?: string },
    refusals: Readonly<Record<string, ErrorCode>>,
    work: () => Promise<T>,
  ): Promise<T> {
    try {
      return await refusingConstraints(work, refusals);
    } catch (error) {
      const failure = error as { code?: unknown; constraint?: unknown };
      if (failure.code !== UNIQUE_VIOLATION || failure.constraint !== NAME_INDEX) {
        throw error;
      }
      const holder = await this.transactions.run(access.branchIds, async (transaction) => {
        const own = record.id;
        const year =
          own === undefined
            ? yearId
            : ((
                await transaction
                  .selectFrom('classes')
                  .select('academic_year_id')
                  .where('id', '=', own)
                  .executeTakeFirst()
              )?.academic_year_id ?? null);
        if (year === null) {
          return undefined;
        }
        return transaction
          .selectFrom('classes')
          .select('id')
          .where('academic_year_id', '=', year)
          .where('grade', '=', record.grade)
          .where('name_key', '=', classNameKey(record.name))
          .$if(own !== undefined, (query) => query.where('id', '<>', own ?? ''))
          .executeTakeFirst();
      });
      throw new ApiException('already_exists', 409, undefined, [
        {
          path: 'name',
          code: 'already_exists',
          message: 'A class of this name already exists in this grade and year.',
          ...(holder === undefined ? {} : { recordId: holder.id }),
        },
      ]);
    }
  }
}
