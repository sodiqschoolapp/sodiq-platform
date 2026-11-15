import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  LANGUAGES,
  LOAD_IMPORT_WORDS,
  classDisplayName,
  listName,
  loadImportFileSchema,
  type Language,
  type LoadImportColumn,
  type LoadImportConfirmResult,
  type LoadImportFile,
  type LoadImportPreview,
  type LoadImportPreviewRow,
  type LoadImportProblem,
  type LoadImportWarning,
} from '@sodiq/shared';
import { missingBlockGroups, refusingProblems, type LoadProblem } from '@sodiq/timetable-rules';
import { sql } from 'kysely';
import { transactionMoment, Transactions, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import type { UploadedFile } from '../../http/file-routes.js';
import { XlsxFile } from '../../http/xlsx.js';
import type { Access } from '../access/permission.guard.js';
import { Audit } from '../audit/audit.service.js';
import { branchOf } from '../classes/classes.service.js';
import { notFound, refusingConstraints } from '../setup/setup-refusals.js';
import { blockRowOf, readBlockGroups } from './load-blocks.js';
import {
  LOAD_REFUSALS,
  LoadFacts,
  readClassFacts,
  readSubjectFacts,
  readTeacherFacts,
  type StoredLoadRow,
  type VersionContext,
} from './load-facts.js';
import {
  indexesOf,
  loadFileRepeats,
  parseLoadImportRow,
  readLoadImportWorkbook,
  type ImportRecords,
  type ImportUnit,
  type ParsedLoadRow,
} from './load-import-read.js';
import {
  LOAD_TEMPLATE_ASCII_NAME,
  loadTemplateFileName,
  writeLoadImportTemplate,
  type LoadTemplateLists,
} from './load-import-template.js';
import {
  Timetable,
  ROW_COLUMNS,
  lockSubjects,
  loadRowFieldsOf,
  newRowTeacher,
  type VersionRow,
} from './timetable.service.js';

const DEADLOCK = '40P01';
const SERIALIZATION_FAILURE = '40001';

/** The column of the file a rule of a load row is told on. */
const PROBLEM_COLUMNS: Readonly<Record<LoadProblem, LoadImportColumn>> = {
  load_unit_year: 'unit',
  load_unit_archived: 'unit',
  load_group_subject: 'subject',
  load_subject_archived: 'subject',
  load_subject_grade: 'subject',
  load_group_no_shared_slot: 'unit',
  load_split_and_whole: 'unit',
  load_mixed_not_split: 'mixedBlock',
  load_no_tutor: 'teacher',
  load_tutor_row_teacher: 'teacher',
  load_teacher_branch: 'teacher',
  load_teacher_status: 'teacher',
  load_teacher_subject: 'teacher',
  load_teacher_grade: 'teacher',
  load_teacher_language: 'teacher',
  load_block_mixed: 'mixedBlock',
  load_block_lessons: 'lessonsPerWeek',
  load_block_teacher: 'teacher',
  load_room_closed: 'room',
  load_group_gaps: 'unit',
};

/** The result of a run that is rolled back: thrown out of the transaction, caught outside. */
class RolledBack extends Error {
  constructor(readonly preview: LoadImportPreview) {
    super('The run is rolled back.');
  }
}

interface ImportRow {
  id: string;
  versionId: string;
  file: LoadImportFile;
  fileSha256: string;
  confirmedAt: string | null;
}

interface RunResult {
  preview: LoadImportPreview;
  /** The rows to write, in the order of the file, each with its placeholder id. */
  rows: StoredLoadRow[];
}

/** The id a row of the file stands under while the rules are checked; no stored row has one. */
const placeholderOf = (rowNumber: number): string =>
  `00000000-0000-0000-0000-${rowNumber.toString(16).padStart(12, '0')}`;

/**
 * The teaching load import (task 5.13; `06`, Importing the load and the timetable). The routes
 * are `timetable` edit, for a draft of the branch of the request. A file is read, matched among
 * the branch's records of the draft (never creating one), and every rule of a load row typed by
 * hand is checked through the one engine (`LoadFacts`, `loadRowProblems`) with the draft's rows
 * and every row of the file as the version's rows, so the block rules see the load as it will be;
 * a block given in part (`missingBlockGroups`, decision 2) and a repeat are problems too. The
 * confirm writes every row or none, under the draft's edit lock, with one audit entry.
 */
@Injectable()
export class LoadImports {
  constructor(
    private readonly transactions: Transactions,
    private readonly audit: Audit,
    private readonly timetable: Timetable,
  ) {}

  /** The template of a draft, with the branch's records in the language chosen; logged (decision 10). */
  async template(
    access: Access,
    versionId: string,
    language: Language,
    requestId: string,
  ): Promise<XlsxFile> {
    const branchId = branchOf(access);
    const lists = await this.transactions.run(access.branchIds, async (transaction) => {
      const version = await this.timetable.lockDraftRow(transaction, branchId, versionId);
      const context = await this.timetable.contextOf(transaction, version);
      const read = await this.recordsOf(transaction, context, language);
      await this.audit.record(transaction, {
        branchId,
        actorId: access.accountId,
        assignmentId: access.assignmentId,
        action: 'load_import.template',
        record: { type: 'timetable_version', id: versionId },
        details: {
          language,
          units: read.lists.units.length,
          teachers: read.lists.teachers.length,
        },
        requestId,
      });
      return read.lists;
    });
    return new XlsxFile(
      loadTemplateFileName(language),
      LOAD_TEMPLATE_ASCII_NAME,
      [],
      await writeLoadImportTemplate(language, versionId.toLowerCase(), lists),
    );
  }

  /** Reads an upload into a draft, keeps it, and answers the preview. */
  async upload(
    access: Access,
    versionId: string,
    file: UploadedFile | null,
    requestId: string,
  ): Promise<LoadImportPreview> {
    if (file === null) {
      throw new ApiException('import_not_template', 422);
    }
    const branchId = branchOf(access);
    const read = await readLoadImportWorkbook(file.bytes);
    const fileSha256 = createHash('sha256').update(file.bytes).digest('hex');
    const id = await this.transactions.run(access.branchIds, async (transaction) => {
      const version = await this.timetable.lockDraftRow(transaction, branchId, versionId);
      const moment = await transactionMoment(transaction);
      const inserted = await transaction
        .insertInto('load_imports')
        .values({
          branch_id: branchId,
          version_id: version.id,
          file_sha256: fileSha256,
          rows: JSON.stringify(read),
          row_count: read.rows.length,
          uploaded_by: access.accountId,
          uploaded_at: moment,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await this.audit.record(transaction, {
        branchId,
        actorId: access.accountId,
        assignmentId: access.assignmentId,
        action: 'load_import.upload',
        record: { type: 'load_import', id: inserted.id },
        details: { versionId: version.id, fileSha256, rowCount: read.rows.length },
        requestId,
      });
      return inserted.id;
    });
    return this.preview(access, versionId, id);
  }

  /** The preview of a kept upload; changes nothing. */
  async preview(access: Access, versionId: string, id: string): Promise<LoadImportPreview> {
    const branchId = branchOf(access);
    try {
      return await this.transactions.run(access.branchIds, async (transaction) => {
        const version = await this.timetable.lockDraftRow(transaction, branchId, versionId);
        const record = await this.readImport(transaction, branchId, version.id, id, false);
        return (await this.run(transaction, version, record)).preview;
      });
    } catch (error) {
      if (conflicted(error)) {
        throw new ApiException('load_import_changed', 409);
      }
      throw error;
    }
  }

  /** Adds every row to the draft's load in one transaction, or nothing. */
  async confirm(
    access: Access,
    versionId: string,
    id: string,
    requestId: string,
  ): Promise<LoadImportConfirmResult> {
    const branchId = branchOf(access);
    try {
      return await refusingConstraints(
        () =>
          this.transactions.run(access.branchIds, async (transaction) => {
            // The draft's edit lock, as every hand load write (decision 8); it also holds the
            // version row, so two confirms into one draft run one after the other.
            const version = await this.timetable.lockDraft(
              transaction,
              access,
              versionId,
              requestId,
            );
            const record = await this.readImport(transaction, branchId, version.id, id, true);
            if (record.confirmedAt !== null) {
              throw new ApiException('load_import_already_confirmed', 409);
            }
            if ((await this.importedOn(transaction, record)) !== null) {
              throw new ApiException('import_already_done', 409);
            }
            const result = await this.run(transaction, version, record);
            if (!result.preview.clean) {
              throw new RolledBack(result.preview);
            }
            const written: StoredLoadRow[] = [];
            for (const row of result.rows) {
              written.push(
                await transaction
                  .insertInto('teaching_load_rows')
                  .values({
                    branch_id: branchId,
                    version_id: version.id,
                    class_id: row.class_id,
                    group_id: row.group_id,
                    subject_id: row.subject_id,
                    teacher_id: row.teacher_id,
                    lessons_per_week: row.lessons_per_week,
                    room_id: row.room_id,
                    room_type: row.room_type,
                    double_lessons: row.double_lessons,
                    mixed_block: row.mixed_block,
                    short_reason: row.short_reason ?? null,
                  })
                  .returning(ROW_COLUMNS)
                  .executeTakeFirstOrThrow(),
              );
            }
            // The deferred rules of 0056 now, so a refusal is mapped before the import is marked.
            await sql`set constraints all immediate`.execute(transaction);
            const moment = await transactionMoment(transaction);
            await transaction
              .updateTable('load_imports')
              .set({ confirmed_by: access.accountId, confirmed_at: moment })
              .where('id', '=', record.id)
              .execute();
            await this.audit.record(transaction, {
              branchId,
              actorId: access.accountId,
              assignmentId: access.assignmentId,
              action: 'teaching_load.import',
              record: { type: 'load_import', id: record.id },
              details: {
                versionId: version.id,
                fileSha256: record.fileSha256,
                created: written.length,
                rows: written.map((row) => ({ id: row.id, ...loadRowFieldsOf(row) })),
              },
              requestId,
            });
            return {
              outcome: 'saved' as const,
              created: written.length,
              rowIds: written.map((row) => row.id),
            };
          }),
        LOAD_REFUSALS,
      );
    } catch (error) {
      if (error instanceof RolledBack) {
        return { outcome: 'not_clean', preview: error.preview };
      }
      if (conflicted(error)) {
        throw new ApiException('load_import_changed', 409);
      }
      throw error;
    }
  }

  /** The import of the draft of the branch of the request; another one is not found. */
  private async readImport(
    transaction: Transaction,
    branchId: string,
    versionId: string,
    id: string,
    lock: boolean,
  ): Promise<ImportRow> {
    let query = transaction
      .selectFrom('load_imports')
      .select(['id', 'version_id', 'rows', 'file_sha256', 'confirmed_at'])
      .where('id', '=', id)
      .where('branch_id', '=', branchId)
      .where('version_id', '=', versionId);
    if (lock) {
      query = query.forUpdate();
    }
    const row = await query.executeTakeFirst();
    if (row === undefined) {
      throw notFound();
    }
    return {
      id: row.id,
      versionId: row.version_id,
      file: loadImportFileSchema.parse(row.rows),
      fileSha256: row.file_sha256,
      confirmedAt: row.confirmed_at === null ? null : String(row.confirmed_at),
    };
  }

  /** The day the same file was confirmed into the draft, in the branch's time zone, if it was. */
  private async importedOn(transaction: Transaction, record: ImportRow): Promise<string | null> {
    const found = await transaction
      .selectFrom('load_imports')
      .innerJoin('branches', 'branches.id', 'load_imports.branch_id')
      .select(
        sql<string>`to_char(load_imports.confirmed_at at time zone branches.time_zone, 'YYYY-MM-DD')`.as(
          'day',
        ),
      )
      .where('load_imports.version_id', '=', record.versionId)
      .where('load_imports.file_sha256', '=', record.fileSha256)
      .where('load_imports.confirmed_at', 'is not', null)
      .executeTakeFirst();
    return found?.day ?? null;
  }

  /**
   * The branch's records of the draft a file is matched against, and the lists of the template:
   * the classes and groups of the draft's year, the school's subjects (by their name in the
   * template's language, the dropdown's; every language for a file that names none), the
   * branch's teachers and vacancies, the branch's rooms. "In service" is read on `statusOn`
   * (review finding 1); the lists hold only records in service, the matching every record, so a
   * pasted value out of service is told the hand reason.
   */
  private async recordsOf(
    transaction: Transaction,
    context: VersionContext,
    language: Language | null,
  ): Promise<{ records: ImportRecords; lists: LoadTemplateLists }> {
    const [classes, groups, groupClasses, subjects, rooms] = await Promise.all([
      transaction
        .selectFrom('classes')
        .select(['id', 'grade', 'name', 'archived_at'])
        .where('branch_id', '=', context.branchId)
        .where('academic_year_id', '=', context.yearId)
        .orderBy('grade')
        .orderBy('name')
        .execute(),
      transaction
        .selectFrom('groups')
        .select(['id', 'name', 'archived_at'])
        .where('branch_id', '=', context.branchId)
        .where('academic_year_id', '=', context.yearId)
        .orderBy('name')
        .execute(),
      transaction
        .selectFrom('group_classes')
        .innerJoin('groups', 'groups.id', 'group_classes.group_id')
        .innerJoin('classes', 'classes.id', 'group_classes.class_id')
        .select(['group_classes.group_id', 'classes.grade', 'classes.name'])
        .where('groups.branch_id', '=', context.branchId)
        .where('groups.academic_year_id', '=', context.yearId)
        .orderBy('classes.grade')
        .orderBy('classes.name')
        .execute(),
      transaction
        .selectFrom('subjects')
        .select(['id', 'name_uz', 'name_ru', 'name_en', 'archived_at'])
        .orderBy('name_en')
        .execute(),
      transaction
        .selectFrom('rooms')
        .select(['id', 'name', 'status'])
        .where('branch_id', '=', context.branchId)
        .orderBy('name')
        .execute(),
    ]);
    const teachers = await readTeacherFacts(transaction, context, 'branch');
    const staffIds = await transaction
      .selectFrom('staff')
      .select(['id', 'staff_id', 'first_name', 'last_name', 'vacancy_name', 'kind'])
      .where('id', 'in', [...teachers.keys(), '00000000-0000-0000-0000-000000000000'])
      .execute();
    const nameIn = (row: { name_uz: string; name_ru: string; name_en: string }, at: Language) =>
      at === 'uz' ? row.name_uz : at === 'ru' ? row.name_ru : row.name_en;
    const units: ImportUnit[] = [
      ...classes.map((row) => ({
        id: row.id,
        kind: 'class' as const,
        labels: [classDisplayName(row.grade, row.name)],
        live: row.archived_at === null,
      })),
      ...groups.map((row) => ({
        id: row.id,
        kind: 'group' as const,
        labels: [row.name],
        live: row.archived_at === null,
      })),
    ];
    const teacherRecords = staffIds
      .map((row) => {
        const facts = teachers.get(row.id);
        const labels =
          row.kind === 'vacancy'
            ? LANGUAGES.map((at) => `${row.vacancy_name ?? ''} (${LOAD_IMPORT_WORDS[at].vacancy})`)
            : [
                `${listName({ firstName: row.first_name ?? '', lastName: row.last_name ?? '' })} (${row.staff_id ?? ''})`,
              ];
        return {
          id: row.id,
          kind: row.kind,
          labels,
          live: facts !== undefined && facts.inBranch && !facts.out,
        };
      })
      .sort((a, b) => (a.labels[0] ?? '').localeCompare(b.labels[0] ?? ''));
    const shownIn: Language = language ?? 'uz';
    const vacancyAt = LANGUAGES.indexOf(shownIn);
    const records: ImportRecords = {
      units,
      subjects: subjects.map((row) => ({
        id: row.id,
        labels:
          language === null ? LANGUAGES.map((at) => nameIn(row, at)) : [nameIn(row, language)],
        live: row.archived_at === null,
      })),
      teachers: teacherRecords,
      rooms: rooms.map((row) => ({
        id: row.id,
        labels: [row.name],
        live: row.status !== 'closed',
      })),
    };
    const liveGroups = groups.filter((row) => row.archived_at === null);
    const lists: LoadTemplateLists = {
      units: units.filter((unit) => unit.live).map((unit) => unit.labels[0] ?? ''),
      groupClasses: liveGroups.map((row) => [
        row.name,
        groupClasses
          .filter((one) => one.group_id === row.id)
          .map((one) => classDisplayName(one.grade, one.name))
          .join(', '),
      ]),
      subjects: subjects
        .filter((row) => row.archived_at === null)
        .map((row) => nameIn(row, shownIn))
        .sort((a, b) => a.localeCompare(b)),
      teachers: [
        ...teacherRecords.filter((one) => one.live && one.kind !== 'vacancy'),
        ...teacherRecords.filter((one) => one.live && one.kind === 'vacancy'),
      ].map((one) => (one.kind === 'vacancy' ? one.labels[vacancyAt] : one.labels[0]) ?? ''),
      rooms: rooms.filter((row) => row.status !== 'closed').map((row) => row.name),
    };
    return { records, lists };
  }

  /**
   * Reads, matches and checks every row of the file against the draft as it is now. Takes the
   * locks of the hand create for every row: the subjects `for key share` (`lockSubjects`) and
   * every teacher and vacancy `for key share`, in the order of their ids, before their facts are
   * read (review finding 8). Writes nothing.
   */
  private async run(
    transaction: Transaction,
    version: VersionRow,
    record: ImportRow,
  ): Promise<RunResult> {
    if (record.file.versionId !== version.id) {
      throw new ApiException('load_import_other_draft', 422);
    }
    const context = await this.timetable.contextOf(transaction, version);
    const { records } = await this.recordsOf(transaction, context, record.file.language);
    const indexes = indexesOf(records);
    const parsed = record.file.rows.map((row) => parseLoadImportRow(row, indexes));
    const repeats = loadFileRepeats(parsed);
    const matched = parsed.filter(
      (row): row is ParsedLoadRow & { record: NonNullable<ParsedLoadRow['record']> } =>
        row.record !== null,
    );
    await lockSubjects(
      transaction,
      matched.map((row) => row.record.subjectId),
    );
    const classIds = matched.flatMap((row) =>
      row.record.unitKind === 'class' ? [row.record.unitId] : [],
    );
    const [classFacts, subjectFacts] = await Promise.all([
      readClassFacts(transaction, context, classIds),
      readSubjectFacts(
        transaction,
        matched.map((row) => row.record.subjectId),
      ),
    ]);
    const draftRows = await this.timetable.rowsOf(transaction, version.id);
    const problems = new Map<number, LoadImportProblem[]>(
      parsed.map((row) => [row.rowNumber, [...row.problems]]),
    );
    const add = (rowNumber: number, problem: LoadImportProblem) => {
      problems.get(rowNumber)?.push(problem);
    };
    for (const [rowNumber, problem] of repeats) {
      add(rowNumber, problem);
    }
    const candidates: { rowNumber: number; row: StoredLoadRow }[] = [];
    for (const row of matched) {
      const subject = subjectFacts.get(row.record.subjectId);
      const unit = row.record.unitKind === 'class' ? classFacts.get(row.record.unitId) : undefined;
      let teacherId = row.record.teacherId;
      if (subject !== undefined && unit !== undefined) {
        const chosen = newRowTeacher(unit.unit, subject, row.record.teacherId);
        if ('problem' in chosen) {
          add(row.rowNumber, { column: 'teacher', code: chosen.problem });
          continue;
        }
        teacherId = chosen.teacherId;
      } else if (teacherId === null) {
        add(row.rowNumber, { column: 'teacher', code: 'load_teacher_needed' });
        continue;
      }
      if (teacherId === null) continue;
      // The hand rule `load_row_exists`: the draft already holds the class and subject, or the group.
      const holder = draftRows.find((one) =>
        row.record.unitKind === 'class'
          ? one.class_id === row.record.unitId && one.subject_id === row.record.subjectId
          : one.group_id === row.record.unitId,
      );
      if (holder !== undefined) {
        add(row.rowNumber, { column: 'unit', code: 'load_row_exists' });
      }
      candidates.push({
        rowNumber: row.rowNumber,
        row: {
          id: placeholderOf(row.rowNumber),
          class_id: row.record.unitKind === 'class' ? row.record.unitId : null,
          group_id: row.record.unitKind === 'group' ? row.record.unitId : null,
          subject_id: row.record.subjectId,
          teacher_id: teacherId,
          lessons_per_week: row.record.lessonsPerWeek,
          room_id: row.record.roomId,
          room_type: row.record.roomType,
          double_lessons: row.record.doubleLessons,
          mixed_block: row.record.mixedBlock,
          short_reason: row.record.shortReason,
        },
      });
    }
    // The teachers and vacancies `for key share`, sorted, before `LoadFacts` reads their status.
    const teacherIds = [...new Set(candidates.map((one) => one.row.teacher_id))].sort();
    if (teacherIds.length > 0) {
      await transaction
        .selectFrom('staff')
        .select('id')
        .where('id', 'in', teacherIds)
        .orderBy('id')
        .forKeyShare()
        .execute();
    }
    const fileRows = candidates.map((one) => one.row);
    const versionRows = [...draftRows, ...fileRows];
    const warnings = new Map<number, LoadImportWarning[]>();
    if (fileRows.length > 0) {
      const facts = await LoadFacts.of(transaction, context, fileRows, {
        versionRows,
        unplaced: true,
      });
      for (const { rowNumber, row } of candidates) {
        const found = facts.problemsOf(row);
        for (const code of refusingProblems(found)) {
          add(rowNumber, { column: PROBLEM_COLUMNS[code], code });
        }
        const unplaced = facts.blockFactsOf(row).unplaced;
        if (found.includes('load_group_gaps') && unplaced > 0) {
          warnings.set(rowNumber, [{ code: 'load_group_gaps', count: unplaced }]);
        }
      }
      // Decision 2: every in-service group of the block has a row in the draft or the file.
      const subjectIds = [
        ...new Set(fileRows.filter((row) => row.group_id !== null).map((row) => row.subject_id)),
      ];
      if (subjectIds.length > 0) {
        const live = await transaction
          .selectFrom('groups')
          .select(['id', 'name'])
          .where('branch_id', '=', context.branchId)
          .where('academic_year_id', '=', context.yearId)
          .where('subject_id', 'in', subjectIds)
          .where('archived_at', 'is', null)
          .execute();
        const liveGroups = await readBlockGroups(
          transaction,
          live.map((one) => one.id),
        );
        const names = new Map(live.map((one) => [one.id, one.name]));
        const missing = missingBlockGroups(
          versionRows.map(blockRowOf),
          [...liveGroups.values()],
          facts.groups,
        );
        for (const { rowNumber, row } of candidates) {
          const parts = missing.get(row.id) ?? [];
          if (parts.length > 0) {
            add(rowNumber, {
              column: 'unit',
              code: 'load_import_block_part',
              groups: parts.map((id) => names.get(id) ?? id).sort((a, b) => a.localeCompare(b)),
            });
          }
        }
      }
    }
    const previewRows: LoadImportPreviewRow[] = parsed.map((row) => ({
      rowNumber: row.rowNumber,
      cells: row.cells,
      problems: problems.get(row.rowNumber) ?? [],
      warnings: warnings.get(row.rowNumber) ?? [],
    }));
    const clean = previewRows.every((row) => row.problems.length === 0);
    return {
      preview: {
        importId: record.id,
        versionId: version.id,
        alreadyImportedOn: await this.importedOn(transaction, record),
        rows: [
          ...previewRows.filter((row) => row.problems.length > 0),
          ...previewRows.filter((row) => row.problems.length === 0),
        ],
        rowsInDraft: draftRows.length,
        clean,
      },
      rows: fileRows,
    };
  }
}

/** A deadlock or a serialization failure: `load_import_changed`, nothing was saved, try again. */
function conflicted(error: unknown): boolean {
  const failure = error as { code?: unknown };
  return failure.code === DEADLOCK || failure.code === SERIALIZATION_FAILURE;
}
