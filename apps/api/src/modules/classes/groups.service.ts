import { Inject, Injectable } from '@nestjs/common';
import {
  classDisplayName,
  classNameKey,
  type Clock,
  type ErrorCode,
  type GroupCreate,
  type GroupDetail,
  type GroupEdit,
  type GroupExport,
  type GroupExportColumn,
  type GroupList,
  type GroupRecord,
  type GroupSlotCheck,
  type InstructionLanguage,
  type SchoolGroup,
} from '@sodiq/shared';
import { CLOCK } from '../../clock/clock.module.js';
import { Transactions, transactionMoment, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import type { XlsxFile } from '../../http/xlsx.js';
import { inGroupScope } from '../access/group-scope.js';
import type { Access } from '../access/permission.guard.js';
import { Audit } from '../audit/audit.service.js';
import { exportList, oneCell, type ExportColumn } from '../audit/export-list.js';
import { changesOf, notFound, refusingConstraints } from '../setup/setup-refusals.js';
import { branchOf } from './classes.service.js';
import {
  classesOfGroups,
  GROUP_REFUSALS,
  gradesOf,
  readGroupDetail,
  readGroupRow,
  readGroups,
  sharedLanguageOf,
  slotsOf,
  type GroupClassRow,
  type GroupRow,
} from './group-rows.js';

const UNIQUE_VIOLATION = '23505';

/** The unique name of a group in a branch and year (db/migrations/0046). */
const NAME_INDEX = 'groups_name_key';

/** The file's columns, the same words as the list's headers. */
const GROUP_EXPORT: Record<GroupExportColumn, ExportColumn<SchoolGroup>> = {
  name: oneCell(
    (texts) => texts.groups.columns.name,
    (row) => row.name,
  ),
  subject: oneCell(
    (texts) => texts.groups.columns.subject,
    (row, _texts, language) => row.subject.names[language],
  ),
  classes: oneCell(
    (texts) => texts.groups.columns.classes,
    (row) => row.classes.map((one) => classDisplayName(one.grade, one.name)).join(', '),
  ),
  language: oneCell(
    (texts) => texts.groups.columns.language,
    (row, texts) => texts.instructionLanguages[row.language],
  ),
  maxSize: oneCell(
    (texts) => texts.groups.columns.maxSize,
    (row) => row.maxSize,
  ),
  status: oneCell(
    (texts) => texts.groups.columns.status,
    (row, texts) => (row.archived ? texts.archived : texts.active),
  ),
};

/** The fields a person types, as the audit entries record them. */
const fieldsOf = (row: GroupRow, classes: readonly GroupClassRow[]) => ({
  classIds: classes.map((one) => one.id).sort(),
  name: row.name,
  language: row.language,
  maxSize: row.max_size,
});

/** A group outside the scope of every assignment that permits the route is 403 (decisions 2 and 11). */
function refuseOutsideGroupScope(access: Access, group: SchoolGroup): void {
  const key = { subjectId: group.subject.id, classIds: group.classes.map((one) => one.id) };
  if (inGroupScope(access.permitting, key) === undefined) {
    throw new ApiException('permission_denied', 403);
  }
}

/**
 * Groups and splits (docs/spec/05-classes-groups-subjects.md, Group; task
 * 3.2a, pull request #91). A group of the branch belongs to a planned or
 * current year and a subject, both fixed (decision 5); it draws from one class
 * (a split) or several of one grade or two (decision 3); its name is unique
 * by its folded form per year among archived groups too (decision 6); its
 * language is the classes' when they share one, else chosen, with a confirmed
 * warning for a subject under the language rule (decision 8). It is archived,
 * never deleted (decision 10). The database keeps every rule (0046); the
 * service checks them first for an answer of its own.
 *
 * Lock order (correction 1 of the review of #91): the class rows FOR SHARE in
 * the order of their id, then the group row, then the writes; a class edit
 * takes its class FOR UPDATE before it touches a group, so the two never
 * wait for each other in opposite orders.
 */
@Injectable()
export class Groups {
  constructor(
    private readonly transactions: Transactions,
    private readonly audit: Audit,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** The groups of the branch in the reader's scope. */
  list(access: Access): Promise<GroupList> {
    return this.transactions.run(access.branchIds, async (transaction) => ({
      groups: (await readGroups(transaction)).filter(
        (group) =>
          inGroupScope(access.permitting, {
            subjectId: group.subject.id,
            classIds: group.classes.map((one) => one.id),
          }) !== undefined,
      ),
    }));
  }

  /** One group: an unknown id or another branch's is 404, a group outside the scope 403. */
  detail(access: Access, id: string): Promise<GroupDetail> {
    return this.transactions.run(access.branchIds, async (transaction) => {
      const found = await readGroupDetail(transaction, branchOf(access), id);
      refuseOutsideGroupScope(access, found);
      return found;
    });
  }

  /** The shared slots of the classes chosen, before a save (decision 9). */
  slotCheck(access: Access, classIds: readonly string[]): Promise<GroupSlotCheck> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const classes = await this.readClasses(transaction, classIds);
      const years = await transaction
        .selectFrom('academic_years')
        .select('start_date')
        .where('id', 'in', [...new Set(classes.map((one) => one.academic_year_id))])
        .orderBy('start_date')
        .execute();
      const [year] = years;
      if (years.length !== 1 || year === undefined) {
        throw new ApiException('group_class_year', 409);
      }
      return { slots: await slotsOf(transaction, branchId, year.start_date, gradesOf(classes)) };
    });
  }

  /** The Excel file of the list, from the rows the list reads, in one transaction. */
  export(access: Access, request: GroupExport, requestId: string): Promise<XlsxFile> {
    return this.transactions.run(access.branchIds, async (transaction) => {
      const groups = await readGroups(transaction);
      return exportList(transaction, this.audit, this.clock, access, requestId, {
        list: 'groups',
        action: 'group.export',
        request,
        rows: new Map(groups.map((one) => [one.id, one])),
        allowed: () => true,
        columns: GROUP_EXPORT,
      });
    });
  }

  create(access: Access, input: GroupCreate, requestId: string): Promise<GroupDetail> {
    const branchId = branchOf(access);
    return this.refusingName(access, input.academicYearId, input.name, null, () =>
      this.transactions.run(access.branchIds, async (transaction) => {
        const classes = await this.lockClasses(transaction, input.classIds);
        await this.requireOpenYearFor(transaction, input.academicYearId);
        const subject = await this.readSubject(transaction, input.subjectId);
        const language = this.checkRules(input, classes, input.academicYearId, subject);
        const row = await transaction
          .insertInto('groups')
          .values({
            branch_id: branchId,
            academic_year_id: input.academicYearId,
            subject_id: input.subjectId,
            name: input.name,
            language,
            max_size: input.maxSize,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        await this.writeClasses(transaction, branchId, row.id, [], input.classIds);
        const created = await readGroupRow(transaction, row.id);
        await this.audit.record(transaction, {
          branchId,
          actorId: access.accountId,
          assignmentId: access.assignmentId,
          action: 'group.create',
          record: { type: 'group', id: row.id },
          newValue: {
            academicYearId: input.academicYearId,
            subjectId: input.subjectId,
            ...fieldsOf(created, classes),
            ...(sharedLanguageOf(classes) === null
              ? { confirmMixedLanguage: input.confirmMixedLanguage }
              : {}),
          },
          requestId,
        });
        return readGroupDetail(transaction, branchId, row.id);
      }),
    );
  }

  /** The classes, name, language and maximum size. Nothing is written when nothing changed. */
  edit(access: Access, id: string, input: GroupEdit, requestId: string): Promise<GroupDetail> {
    const branchId = branchOf(access);
    return this.refusingName(access, null, input.name, id, () =>
      this.transactions.run(access.branchIds, async (transaction) => {
        const seen = await this.classIdsOf(transaction, id);
        const classes = await this.lockClasses(transaction, input.classIds, seen);
        const before = await this.lockGroup(transaction, id);
        if (before.archived_at !== null) {
          throw new ApiException('group_archived', 409);
        }
        if (before.version !== input.version) {
          throw new ApiException('group_changed', 409);
        }
        await this.requireOpenYear(transaction, before.academic_year_id);
        const oldClasses = (await classesOfGroups(transaction, [id])).get(id) ?? [];
        const language = this.checkRules(input, classes, before.academic_year_id, {
          archived: before.subject_archived_at !== null,
          grades: before.subject_grades,
          languageRule: before.language_rule,
        });
        const record = {
          classIds: [...input.classIds].map((one) => one.toLowerCase()).sort(),
          name: input.name,
          language,
          maxSize: input.maxSize,
        };
        const changes = changesOf(fieldsOf(before, oldClasses), record);
        if (changes === null) {
          return readGroupDetail(transaction, branchId, id);
        }
        // Every edit updates the row, so the version moves also when only the classes change.
        await transaction
          .updateTable('groups')
          .set({ name: record.name, language: record.language, max_size: record.maxSize })
          .where('id', '=', id)
          .execute();
        await this.writeClasses(
          transaction,
          branchId,
          id,
          oldClasses.map((one) => one.id),
          record.classIds,
        );
        await this.audit.record(transaction, {
          branchId,
          actorId: access.accountId,
          assignmentId: access.assignmentId,
          action: 'group.edit',
          record: { type: 'group', id },
          oldValue: changes.oldValue,
          newValue: {
            ...changes.newValue,
            ...(sharedLanguageOf(classes) === null
              ? { confirmMixedLanguage: input.confirmMixedLanguage }
              : {}),
          },
          requestId,
        });
        return readGroupDetail(transaction, branchId, id);
      }),
    );
  }

  /** Archives the group (decision 10); an archived group is answered as it is. */
  archive(access: Access, id: string, requestId: string): Promise<GroupDetail> {
    return this.setArchived(access, id, true, requestId);
  }

  /** Restores the group; every rule is checked again (decision 10). */
  restore(access: Access, id: string, requestId: string): Promise<GroupDetail> {
    return this.setArchived(access, id, false, requestId);
  }

  private setArchived(
    access: Access,
    id: string,
    archived: boolean,
    requestId: string,
  ): Promise<GroupDetail> {
    const branchId = branchOf(access);
    return refusingConstraints(
      () =>
        this.transactions.run(access.branchIds, async (transaction) => {
          const seen = await this.classIdsOf(transaction, id);
          const classes = await this.lockClasses(transaction, seen);
          const before = await this.lockGroup(transaction, id);
          if ((before.archived_at !== null) === archived) {
            return readGroupDetail(transaction, branchId, id);
          }
          await this.requireOpenYear(transaction, before.academic_year_id);
          if (!archived) {
            this.checkRules(
              { classIds: seen, language: null, confirmMixedLanguage: true },
              classes,
              before.academic_year_id,
              {
                archived: before.subject_archived_at !== null,
                grades: before.subject_grades,
                languageRule: before.language_rule,
              },
              before.language,
            );
          }
          await transaction
            .updateTable('groups')
            .set({ archived_at: archived ? await transactionMoment(transaction) : null })
            .where('id', '=', id)
            .execute();
          await this.audit.record(transaction, {
            branchId,
            actorId: access.accountId,
            assignmentId: access.assignmentId,
            action: archived ? 'group.archive' : 'group.restore',
            record: { type: 'group', id },
            oldValue: { archived: !archived },
            newValue: { archived },
            requestId,
          });
          return readGroupDetail(transaction, branchId, id);
        }),
      GROUP_REFUSALS,
    );
  }

  /**
   * The rules the database keeps (0046), checked first for an answer of its
   * own, and the language the group takes (decision 8). `kept` is the stored
   * language of a restore, which chooses nothing.
   */
  private checkRules(
    input: Pick<GroupRecord, 'classIds' | 'language' | 'confirmMixedLanguage'>,
    classes: readonly GroupClassRow[],
    yearId: string,
    subject: { archived: boolean; grades: readonly number[]; languageRule: boolean },
    kept?: string,
  ): InstructionLanguage {
    if (subject.archived) {
      throw new ApiException('group_subject_archived', 409);
    }
    if (classes.some((one) => one.archived_at !== null || one.academic_year_id !== yearId)) {
      throw new ApiException('group_class_year', 409);
    }
    const grades = gradesOf(classes);
    if (grades.length > 2) {
      throw new ApiException('group_grades', 409);
    }
    if (grades.some((grade) => !subject.grades.includes(grade))) {
      throw new ApiException('group_subject_grade', 409);
    }
    const shared = sharedLanguageOf(classes);
    if (shared !== null) {
      const chosen = input.language ?? kept ?? shared;
      if (chosen !== shared) {
        throw new ApiException('group_language', 409);
      }
      return shared;
    }
    const chosen = input.language ?? (kept === 'uz' || kept === 'ru' ? kept : null);
    if (chosen === null) {
      throw new ApiException('group_language_needed', 422);
    }
    if (subject.languageRule && !input.confirmMixedLanguage) {
      throw new ApiException('group_mixed_language', 409);
    }
    return chosen;
  }

  /** The class ids of a group as stored, read without a lock (the locks follow in their order). */
  private async classIdsOf(transaction: Transaction, id: string): Promise<string[]> {
    const rows = await transaction
      .selectFrom('group_classes')
      .select('class_id')
      .where('group_id', '=', id)
      .execute();
    return rows.map((row) => row.class_id);
  }

  /**
   * The classes named, and those of `also` (the classes a group holds now),
   * locked FOR SHARE in the order of their id before any write (correction
   * 1), then read. A class of another branch or an unknown one is 404.
   */
  private async lockClasses(
    transaction: Transaction,
    classIds: readonly string[],
    also: readonly string[] = [],
  ): Promise<GroupClassRow[]> {
    const named = [...new Set(classIds.map((one) => one.toLowerCase()))];
    const all = [...new Set([...named, ...also.map((one) => one.toLowerCase())])].sort();
    if (all.length > 0) {
      const locked = await transaction
        .selectFrom('classes')
        .select('id')
        .where('id', 'in', all)
        .orderBy('id')
        .forShare()
        .execute();
      if (locked.length !== all.length) {
        throw notFound();
      }
    }
    return this.readClasses(transaction, named);
  }

  /** The classes named, read after their locks; 404 when one is not of the branch. */
  private async readClasses(
    transaction: Transaction,
    classIds: readonly string[],
  ): Promise<GroupClassRow[]> {
    const named = [...new Set(classIds.map((one) => one.toLowerCase()))];
    if (named.length === 0) {
      return [];
    }
    const rows = await transaction
      .selectFrom('classes')
      .select(['id', 'grade', 'name', 'language', 'archived_at', 'academic_year_id'])
      .where('id', 'in', named)
      .orderBy('grade')
      .orderBy('name_key')
      .execute();
    if (rows.length !== named.length) {
      throw notFound();
    }
    return rows;
  }

  /** The group locked for a change, after its classes; 404 for another branch's group or an unknown id. */
  private async lockGroup(transaction: Transaction, id: string): Promise<GroupRow> {
    const locked = await transaction
      .selectFrom('groups')
      .select('id')
      .where('id', '=', id)
      .forUpdate()
      .executeTakeFirst();
    if (locked === undefined) {
      throw notFound();
    }
    return readGroupRow(transaction, id);
  }

  /** The links of a group set to `next`: the removed ones deleted, the new ones inserted. */
  private async writeClasses(
    transaction: Transaction,
    branchId: string,
    groupId: string,
    current: readonly string[],
    next: readonly string[],
  ): Promise<void> {
    const now = new Set(current.map((one) => one.toLowerCase()));
    const wanted = new Set(next.map((one) => one.toLowerCase()));
    const removed = [...now].filter((one) => !wanted.has(one)).sort();
    const added = [...wanted].filter((one) => !now.has(one)).sort();
    if (removed.length > 0) {
      await transaction
        .deleteFrom('group_classes')
        .where('group_id', '=', groupId)
        .where('class_id', 'in', removed)
        .execute();
    }
    for (const classId of added) {
      await transaction
        .insertInto('group_classes')
        .values({ group_id: groupId, class_id: classId, branch_id: branchId })
        .execute();
    }
  }

  /** The subject of a new group: unknown is 404; read for the rules. The guard locks it at the commit. */
  private async readSubject(
    transaction: Transaction,
    subjectId: string,
  ): Promise<{ archived: boolean; grades: number[]; languageRule: boolean }> {
    const subject = await transaction
      .selectFrom('subjects')
      .select(['archived_at', 'grades', 'language_rule'])
      .where('id', '=', subjectId)
      .executeTakeFirst();
    if (subject === undefined) {
      throw notFound();
    }
    return {
      archived: subject.archived_at !== null,
      grades: subject.grades,
      languageRule: subject.language_rule,
    };
  }

  /**
   * The year of a new group: a planned or current year of the branch
   * (decision 5). Without one: `group_needs_year`; another branch's or
   * unknown: 404; closed: `group_year_closed`.
   */
  private async requireOpenYearFor(transaction: Transaction, yearId: string): Promise<void> {
    const open = await transaction
      .selectFrom('academic_years')
      .select('id')
      .where('status', 'in', ['planned', 'current'])
      .executeTakeFirst();
    if (open === undefined) {
      throw new ApiException('group_needs_year', 409);
    }
    await this.requireOpenYear(transaction, yearId);
  }

  /** The year of a group, locked FOR SHARE first and read afterwards; closed: `group_year_closed`. */
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
      throw new ApiException('group_year_closed', 409);
    }
  }

  /**
   * Runs a create or an edit: the refusals of the database become their
   * codes, and a taken name becomes 409 `already_exists` on `name`, naming the
   * group that holds it (archived or not), so the panel can offer its restore.
   * The holder is read after the refused transaction, when it is committed.
   */
  private async refusingName<T>(
    access: Access,
    yearId: string | null,
    name: string,
    ownId: string | null,
    work: () => Promise<T>,
  ): Promise<T> {
    const refusals: Readonly<Record<string, ErrorCode>> = GROUP_REFUSALS;
    try {
      return await refusingConstraints(work, refusals);
    } catch (error) {
      const failure = error as { code?: unknown; constraint?: unknown };
      if (failure.code !== UNIQUE_VIOLATION || failure.constraint !== NAME_INDEX) {
        throw error;
      }
      const holder = await this.transactions.run(access.branchIds, async (transaction) => {
        const year =
          ownId === null
            ? yearId
            : ((
                await transaction
                  .selectFrom('groups')
                  .select('academic_year_id')
                  .where('id', '=', ownId)
                  .executeTakeFirst()
              )?.academic_year_id ?? null);
        if (year === null) {
          return undefined;
        }
        return transaction
          .selectFrom('groups')
          .select('id')
          .where('academic_year_id', '=', year)
          .where('name_key', '=', classNameKey(name))
          .$if(ownId !== null, (query) => query.where('id', '<>', ownId ?? ''))
          .executeTakeFirst();
      });
      throw new ApiException('already_exists', 409, undefined, [
        {
          path: 'name',
          code: 'already_exists',
          message: 'A group of this name already exists in this year.',
          ...(holder === undefined ? {} : { recordId: holder.id }),
        },
      ]);
    }
  }
}
