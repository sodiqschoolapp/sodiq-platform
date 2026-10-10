import { Inject, Injectable } from '@nestjs/common';
import type {
  Clock,
  Department,
  DepartmentRecord,
  Division,
  DivisionList,
  DivisionRecord,
  Names,
} from '@sodiq/shared';
import { CLOCK } from '../../clock/clock.module.js';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import type { Access } from '../access/permission.guard.js';
import { Audit } from '../audit/audit.service.js';
import { changesOf, notFound, refusingDuplicates } from './setup-refusals.js';

interface NamedRow {
  name_uz: string;
  name_ru: string;
  name_en: string;
}

interface DepartmentRow extends NamedRow {
  id: string;
  division_id: string;
  archived_at: Date | null;
}

/** The field of the record each unique index of the names covers. */
const DIVISION_NAME_INDEXES: Readonly<Record<string, string>> = {
  divisions_active_name_uz_idx: 'names.uz',
  divisions_active_name_ru_idx: 'names.ru',
  divisions_active_name_en_idx: 'names.en',
};

const DEPARTMENT_NAME_INDEXES: Readonly<Record<string, string>> = {
  departments_active_name_uz_idx: 'names.uz',
  departments_active_name_ru_idx: 'names.ru',
  departments_active_name_en_idx: 'names.en',
};

const moment = (at: Date | null): string | null => (at === null ? null : at.toISOString());

const namesOf = (row: NamedRow): Names => ({ uz: row.name_uz, ru: row.name_ru, en: row.name_en });

const columnsOf = (names: Names): NamedRow => ({
  name_uz: names.uz,
  name_ru: names.ru,
  name_en: names.en,
});

const toDepartment = (row: DepartmentRow): Department => ({
  id: row.id,
  names: namesOf(row),
  archivedAt: moment(row.archived_at),
});

/** The departments, in the order of the list; of one division when its id is given. */
function departmentsIn(transaction: Transaction, divisionId?: string) {
  let query = transaction
    .selectFrom('departments')
    .select(['id', 'division_id', 'name_uz', 'name_ru', 'name_en', 'archived_at'])
    .orderBy('position')
    .orderBy('id');
  if (divisionId !== undefined) {
    query = query.where('division_id', '=', divisionId);
  }
  return query;
}

/** Academic (`03`): "It cannot be renamed or archived." */
const builtIn = (): ApiException => new ApiException('built_in', 409);

/** The record, or the division it is in, is archived: nothing changes until it is restored. */
const archivedRecord = (): ApiException => new ApiException('archived_record', 409);

/**
 * Divisions and departments (docs/spec/03-school-setup.md, Divisions: "One
 * list for the whole school"; "Academic is built in"; "Other divisions are
 * data. The Super Admin adds, renames and archives them"; Department: "A
 * department groups subjects and teachers"). School-wide records: no branch,
 * and every change is an audit entry of the whole school. Archived, never
 * deleted (`12`, No lost work): archiving a division takes its active
 * departments with it, and restoring it brings back exactly those (decided
 * by the owner, pull request #40, answer 4). The refusal while an active
 * staff member is in a division comes with the staff records (task 2.2).
 */
@Injectable()
export class Divisions {
  constructor(
    private readonly transactions: Transactions,
    private readonly audit: Audit,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private async readDivision(transaction: Transaction, id: string): Promise<Division> {
    const row = await transaction
      .selectFrom('divisions')
      .select(['id', 'name_uz', 'name_ru', 'name_en', 'built_in', 'archived_at'])
      .where('id', '=', id)
      .executeTakeFirst();
    if (row === undefined) {
      throw notFound();
    }
    const departments = await departmentsIn(transaction, id).execute();
    return {
      id: row.id,
      names: namesOf(row),
      builtIn: row.built_in,
      archivedAt: moment(row.archived_at),
      departments: departments.map(toDepartment),
    };
  }

  private async readDepartment(transaction: Transaction, id: string): Promise<Department> {
    const row = await departmentsIn(transaction).where('id', '=', id).executeTakeFirst();
    if (row === undefined) {
      throw notFound();
    }
    return toDepartment(row);
  }

  /** Every division with its departments, archived ones included and marked; in the order of `03`. */
  list(access: Access): Promise<DivisionList> {
    return this.transactions.run(access.branchIds, async (transaction) => {
      const divisions = await transaction
        .selectFrom('divisions')
        .select(['id', 'name_uz', 'name_ru', 'name_en', 'built_in', 'archived_at'])
        .orderBy('position')
        .orderBy('id')
        .execute();
      const departments = await departmentsIn(transaction).execute();
      return {
        divisions: divisions.map((division) => ({
          id: division.id,
          names: namesOf(division),
          builtIn: division.built_in,
          archivedAt: moment(division.archived_at),
          departments: departments
            .filter((department) => department.division_id === division.id)
            .map(toDepartment),
        })),
      };
    });
  }

  /**
   * A new division after the last one. The rows are read for update so that
   * two divisions added at the same moment do not take one position.
   */
  createDivision(access: Access, record: DivisionRecord, requestId: string): Promise<Division> {
    return refusingDuplicates(
      () =>
        this.transactions.run([], async (transaction) => {
          const positions = await transaction
            .selectFrom('divisions')
            .select('position')
            .forUpdate()
            .execute();
          const position = Math.max(0, ...positions.map((row) => row.position)) + 1;
          const row = await transaction
            .insertInto('divisions')
            .values({ ...columnsOf(record.names), position })
            .returning('id')
            .executeTakeFirstOrThrow();
          await this.audit.record(transaction, {
            branchId: null,
            actorId: access.accountId,
            assignmentId: access.assignmentId,
            action: 'division.create',
            record: { type: 'division', id: row.id },
            newValue: { names: record.names },
            requestId,
          });
          return this.readDivision(transaction, row.id);
        }),
      DIVISION_NAME_INDEXES,
    );
  }

  /** Academic is refused with `built_in`; an archived division with `archived_record`. */
  renameDivision(
    access: Access,
    id: string,
    record: DivisionRecord,
    requestId: string,
  ): Promise<Division> {
    return refusingDuplicates(
      () =>
        this.transactions.run([], async (transaction) => {
          const row = await transaction
            .selectFrom('divisions')
            .select(['name_uz', 'name_ru', 'name_en', 'built_in', 'archived_at'])
            .where('id', '=', id)
            .forUpdate()
            .executeTakeFirst();
          if (row === undefined) {
            throw notFound();
          }
          if (row.built_in) {
            throw builtIn();
          }
          if (row.archived_at !== null) {
            throw archivedRecord();
          }
          const changes = changesOf({ names: namesOf(row) }, { names: record.names });
          if (changes !== null) {
            await transaction
              .updateTable('divisions')
              .set(columnsOf(record.names))
              .where('id', '=', id)
              .execute();
            await this.audit.record(transaction, {
              branchId: null,
              actorId: access.accountId,
              assignmentId: access.assignmentId,
              action: 'division.edit',
              record: { type: 'division', id },
              oldValue: changes.oldValue,
              newValue: changes.newValue,
              requestId,
            });
          }
          return this.readDivision(transaction, id);
        }),
      DIVISION_NAME_INDEXES,
    );
  }

  /**
   * Archives the division and its active departments at the moment of the
   * clock. Academic is refused with `built_in`. An archived division stays as
   * it is. The refusal while an active staff member is in it: task 2.2.
   */
  archiveDivision(access: Access, id: string, requestId: string): Promise<Division> {
    return this.transactions.run([], async (transaction) => {
      const row = await transaction
        .selectFrom('divisions')
        .select(['built_in', 'archived_at'])
        .where('id', '=', id)
        .forUpdate()
        .executeTakeFirst();
      if (row === undefined) {
        throw notFound();
      }
      if (row.built_in) {
        throw builtIn();
      }
      if (row.archived_at === null) {
        const departments = await transaction
          .selectFrom('departments')
          .select('id')
          .where('division_id', '=', id)
          .where('archived_at', 'is', null)
          .orderBy('position')
          .orderBy('id')
          .forUpdate()
          .execute();
        const now = this.clock.now();
        await transaction
          .updateTable('divisions')
          .set({ archived_at: now })
          .where('id', '=', id)
          .execute();
        if (departments.length > 0) {
          await transaction
            .updateTable('departments')
            .set({ archived_at: now })
            .where(
              'id',
              'in',
              departments.map((department) => department.id),
            )
            .execute();
        }
        await this.audit.record(transaction, {
          branchId: null,
          actorId: access.accountId,
          assignmentId: access.assignmentId,
          action: 'division.archive',
          record: { type: 'division', id },
          oldValue: { archivedAt: null },
          newValue: { archivedAt: now.toISOString() },
          details: { departmentIds: departments.map((department) => department.id) },
          requestId,
        });
      }
      return this.readDivision(transaction, id);
    });
  }

  /**
   * Brings back an archived division and exactly the departments archived
   * with it (at the same moment). `already_exists` while an active division
   * has one of its names. An active division stays as it is.
   */
  restoreDivision(access: Access, id: string, requestId: string): Promise<Division> {
    return refusingDuplicates(
      () =>
        this.transactions.run([], async (transaction) => {
          const row = await transaction
            .selectFrom('divisions')
            .select(['archived_at'])
            .where('id', '=', id)
            .forUpdate()
            .executeTakeFirst();
          if (row === undefined) {
            throw notFound();
          }
          if (row.archived_at !== null) {
            const archivedAt = row.archived_at;
            await transaction
              .updateTable('divisions')
              .set({ archived_at: null })
              .where('id', '=', id)
              .execute();
            const restored = await transaction
              .updateTable('departments')
              .set({ archived_at: null })
              .where('division_id', '=', id)
              .where('archived_at', '=', archivedAt)
              .returning('id')
              .execute();
            await this.audit.record(transaction, {
              branchId: null,
              actorId: access.accountId,
              assignmentId: access.assignmentId,
              action: 'division.restore',
              record: { type: 'division', id },
              oldValue: { archivedAt: archivedAt.toISOString() },
              newValue: { archivedAt: null },
              details: { departmentIds: restored.map((department) => department.id) },
              requestId,
            });
          }
          return this.readDivision(transaction, id);
        }),
      DIVISION_NAME_INDEXES,
    );
  }

  /**
   * A department after the last one of an active division; an archived
   * division is refused with `archived_record`. The division row is locked,
   * so two departments added at the same moment do not take one position.
   */
  createDepartment(
    access: Access,
    divisionId: string,
    record: DepartmentRecord,
    requestId: string,
  ): Promise<Department> {
    return refusingDuplicates(
      () =>
        this.transactions.run([], async (transaction) => {
          const division = await transaction
            .selectFrom('divisions')
            .select(['archived_at'])
            .where('id', '=', divisionId)
            .forUpdate()
            .executeTakeFirst();
          if (division === undefined) {
            throw notFound();
          }
          if (division.archived_at !== null) {
            throw archivedRecord();
          }
          const last = await transaction
            .selectFrom('departments')
            .select((builder) => builder.fn.max('position').as('position'))
            .where('division_id', '=', divisionId)
            .executeTakeFirstOrThrow();
          const position = Number(last.position ?? 0) + 1;
          const row = await transaction
            .insertInto('departments')
            .values({ division_id: divisionId, ...columnsOf(record.names), position })
            .returning('id')
            .executeTakeFirstOrThrow();
          await this.audit.record(transaction, {
            branchId: null,
            actorId: access.accountId,
            assignmentId: access.assignmentId,
            action: 'department.create',
            record: { type: 'department', id: row.id },
            newValue: { names: record.names, divisionId },
            requestId,
          });
          return this.readDepartment(transaction, row.id);
        }),
      DEPARTMENT_NAME_INDEXES,
    );
  }

  /** `archived_record` when the department or its division is archived. */
  renameDepartment(
    access: Access,
    id: string,
    record: DepartmentRecord,
    requestId: string,
  ): Promise<Department> {
    return refusingDuplicates(
      () =>
        this.transactions.run([], async (transaction) => {
          const row = await this.lockDepartment(transaction, id);
          if (row.archived_at !== null || row.division_archived_at !== null) {
            throw archivedRecord();
          }
          const changes = changesOf({ names: namesOf(row) }, { names: record.names });
          if (changes !== null) {
            await transaction
              .updateTable('departments')
              .set(columnsOf(record.names))
              .where('id', '=', id)
              .execute();
            await this.audit.record(transaction, {
              branchId: null,
              actorId: access.accountId,
              assignmentId: access.assignmentId,
              action: 'department.edit',
              record: { type: 'department', id },
              oldValue: changes.oldValue,
              newValue: changes.newValue,
              requestId,
            });
          }
          return this.readDepartment(transaction, id);
        }),
      DEPARTMENT_NAME_INDEXES,
    );
  }

  /** At the moment of the clock. An archived department stays as it is. */
  archiveDepartment(access: Access, id: string, requestId: string): Promise<Department> {
    return this.transactions.run([], async (transaction) => {
      const row = await this.lockDepartment(transaction, id);
      if (row.archived_at === null) {
        const now = this.clock.now();
        await transaction
          .updateTable('departments')
          .set({ archived_at: now })
          .where('id', '=', id)
          .execute();
        await this.audit.record(transaction, {
          branchId: null,
          actorId: access.accountId,
          assignmentId: access.assignmentId,
          action: 'department.archive',
          record: { type: 'department', id },
          oldValue: { archivedAt: null },
          newValue: { archivedAt: now.toISOString() },
          requestId,
        });
      }
      return this.readDepartment(transaction, id);
    });
  }

  /**
   * Brings back an archived department. Refused (`archived_record`) while its
   * division is archived: the division is restored first, which brings the
   * departments archived with it. `already_exists` while an active department
   * of the division has one of its names.
   */
  restoreDepartment(access: Access, id: string, requestId: string): Promise<Department> {
    return refusingDuplicates(
      () =>
        this.transactions.run([], async (transaction) => {
          const row = await this.lockDepartment(transaction, id);
          if (row.archived_at !== null) {
            if (row.division_archived_at !== null) {
              throw archivedRecord();
            }
            await transaction
              .updateTable('departments')
              .set({ archived_at: null })
              .where('id', '=', id)
              .execute();
            await this.audit.record(transaction, {
              branchId: null,
              actorId: access.accountId,
              assignmentId: access.assignmentId,
              action: 'department.restore',
              record: { type: 'department', id },
              oldValue: { archivedAt: row.archived_at.toISOString() },
              newValue: { archivedAt: null },
              requestId,
            });
          }
          return this.readDepartment(transaction, id);
        }),
      DEPARTMENT_NAME_INDEXES,
    );
  }

  /** The department with the state of its division, both locked for the change. */
  private async lockDepartment(transaction: Transaction, id: string) {
    const row = await transaction
      .selectFrom('departments')
      .innerJoin('divisions', 'divisions.id', 'departments.division_id')
      .select([
        'departments.name_uz',
        'departments.name_ru',
        'departments.name_en',
        'departments.archived_at',
        'divisions.archived_at as division_archived_at',
      ])
      .where('departments.id', '=', id)
      .forUpdate()
      .executeTakeFirst();
    if (row === undefined) {
      throw notFound();
    }
    return row;
  }
}
