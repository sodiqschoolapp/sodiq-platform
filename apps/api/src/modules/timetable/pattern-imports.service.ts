import { createHash, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  patternImportFileSchema,
  type Language,
  type PatternImportConfirmResult,
  type PatternImportFile,
  type PatternImportPreview,
  type PatternImportPreviewRow,
  type PatternImportProblem,
  type PatternImportWarning,
} from '@sodiq/shared';
import {
  checkedPlacements,
  checkTimetable,
  importedBlocks,
  importKeyOf,
  isTutorRow,
  type ImportedBlock,
  type ImportHeld,
  type ImportLesson,
  type PatternBlock,
} from '@sodiq/timetable-rules';
import { sql } from 'kysely';
import { transactionMoment, Transactions, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import type { UploadedFile } from '../../http/file-routes.js';
import { XlsxFile } from '../../http/xlsx.js';
import type { Access } from '../access/permission.guard.js';
import { Audit } from '../audit/audit.service.js';
import { branchOf } from '../classes/classes.service.js';
import { notFound, refusingGoneRoom } from '../setup/setup-refusals.js';
import { indexesOf } from './load-import-read.js';
import { recordsOf } from './load-imports.service.js';
import {
  parsePatternImportRow,
  patternFileRepeats,
  readPatternImportWorkbook,
} from './pattern-import-read.js';
import {
  PATTERN_TEMPLATE_ASCII_NAME,
  patternTemplateFileName,
  writePatternImportTemplate,
} from './pattern-import-template.js';
import { writeBlock } from './pattern-queries.js';
import { refusingPattern, TimetablePattern, type PatternState } from './pattern.service.js';
import { Timetable, type VersionRow } from './timetable.service.js';

const DEADLOCK = '40P01';
const SERIALIZATION_FAILURE = '40001';

/** The result of a run that is rolled back: thrown out of the transaction, caught outside. */
class RolledBack extends Error {
  constructor(readonly preview: PatternImportPreview) {
    super('The run is rolled back.');
  }
}

interface ImportRow {
  id: string;
  versionId: string;
  file: PatternImportFile;
  fileSha256: string;
  confirmedAt: string | null;
}

interface RunResult {
  preview: PatternImportPreview;
  state: PatternState;
  /** The file's blocks, when every row is clean. */
  blocks: ImportedBlock[];
}

/** The lessons of a draft's blocks, by entry id, sorted: what a confirm removes (plan decision 3). */
const lessonIdsOf = (blocks: readonly PatternBlock[]): string[] =>
  blocks.flatMap((block) => block.lessons.map((lesson) => lesson.id)).sort();

/**
 * The timetable import (task 5.14; `06`, Importing the load and the timetable). The routes are
 * `timetable` edit, for a draft of the branch of the request. A file is read and matched among
 * the branch's records of the draft as the load import matches (`recordsOf`, never creating one);
 * each row is matched to a row of the draft's load by class or group and subject and its teacher
 * checked; the lessons are grouped into the blocks and doubles the grid would build
 * (`importedBlocks`) and the whole file is checked by the rule engine as the conflict panel checks
 * a draft (`checkTimetable` over the file's blocks and the busy-elsewhere lessons): every blocked
 * rule a problem of its rows, warnings listed. The confirm, under the draft's edit lock, replaces
 * every placement of the draft by the file's, all or none, with one audit entry; the load is not
 * changed.
 */
@Injectable()
export class PatternImports {
  constructor(
    private readonly transactions: Transactions,
    private readonly audit: Audit,
    private readonly timetable: Timetable,
    private readonly pattern: TimetablePattern,
  ) {}

  /** The template of a draft, with the branch's records in the language chosen; logged (decision 9). */
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
      const read = await recordsOf(transaction, context, language);
      await this.audit.record(transaction, {
        branchId,
        actorId: access.accountId,
        assignmentId: access.assignmentId,
        action: 'pattern_import.template',
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
      patternTemplateFileName(language),
      PATTERN_TEMPLATE_ASCII_NAME,
      [],
      await writePatternImportTemplate(language, versionId.toLowerCase(), lists),
    );
  }

  /** Reads an upload into a draft, keeps it, and answers the preview. */
  async upload(
    access: Access,
    versionId: string,
    file: UploadedFile | null,
    requestId: string,
  ): Promise<PatternImportPreview> {
    if (file === null) {
      throw new ApiException('import_not_template', 422);
    }
    const branchId = branchOf(access);
    // The file is read before the draft is locked, so no hand write of the draft waits for it.
    const read = await readPatternImportWorkbook(file.bytes);
    const fileSha256 = createHash('sha256').update(file.bytes).digest('hex');
    const id = await this.transactions.run(access.branchIds, async (transaction) => {
      const version = await this.timetable.lockDraftRow(transaction, branchId, versionId);
      // A template of another draft is refused before anything is kept.
      if (read.versionId !== version.id) {
        throw new ApiException('pattern_import_other_draft', 422);
      }
      const moment = await transactionMoment(transaction);
      const inserted = await transaction
        .insertInto('pattern_imports')
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
        action: 'pattern_import.upload',
        record: { type: 'pattern_import', id: inserted.id },
        details: { versionId: version.id, fileSha256, rowCount: read.rows.length },
        requestId,
      });
      return inserted.id;
    });
    return this.preview(access, versionId, id);
  }

  /** The preview of a kept upload; changes nothing. */
  async preview(access: Access, versionId: string, id: string): Promise<PatternImportPreview> {
    const branchId = branchOf(access);
    try {
      return await this.transactions.run(access.branchIds, async (transaction) => {
        const version = await this.timetable.lockDraftRow(transaction, branchId, versionId);
        const record = await this.readImport(transaction, branchId, version.id, id, false);
        return (await this.run(transaction, version, record, access.accountId)).preview;
      });
    } catch (error) {
      if (conflicted(error)) {
        throw new ApiException('pattern_import_changed', 409);
      }
      throw error;
    }
  }

  /**
   * Replaces every placement of the draft by the file's in one transaction, or changes nothing:
   * `removes` must be the draft's lessons now, the ones the person confirmed removing.
   */
  async confirm(
    access: Access,
    versionId: string,
    id: string,
    removes: readonly string[],
    requestId: string,
  ): Promise<PatternImportConfirmResult> {
    const branchId = branchOf(access);
    try {
      return await refusingGoneRoom(() =>
        refusingPattern(() =>
          this.transactions.run(access.branchIds, async (transaction) => {
            // An unknown import, or one of another draft or branch, is 404 before the edit lock.
            await this.readImport(transaction, branchId, versionId, id, false);
            // The draft's edit lock, as every grid write (decision 11); it also holds the version
            // row, so two confirms into one draft run one after the other.
            const version = await this.timetable.lockDraft(
              transaction,
              access,
              versionId,
              requestId,
            );
            const record = await this.readImport(transaction, branchId, version.id, id, true);
            if (record.confirmedAt !== null) {
              throw new ApiException('pattern_import_already_confirmed', 409);
            }
            if ((await this.importedOn(transaction, record)) !== null) {
              throw new ApiException('import_already_done', 409);
            }
            const result = await this.run(transaction, version, record, access.accountId);
            const now = result.preview.removes;
            const confirmed = [...new Set(removes)].sort();
            if (
              confirmed.length !== now.length ||
              confirmed.some((one, index) => one !== now[index])
            ) {
              throw new ApiException('pattern_import_draft_changed', 409);
            }
            if (!result.preview.clean) {
              throw new RolledBack(result.preview);
            }
            const { state } = result;
            const { model } = state.pattern;
            const removed = state.blocks.map((block) => this.blockValue(state, block));
            if (state.blocks.length > 0) {
              await transaction
                .deleteFrom('pattern_blocks')
                .where(
                  'id',
                  'in',
                  state.blocks.map((block) => block.id),
                )
                .execute();
            }
            // Each pair of the file gets a stored id of its own.
            const pairIds = new Map<string, string>();
            const written = [];
            for (const { block, keys } of result.blocks) {
              let doublePairId: string | null = null;
              if (block.doublePairId !== null) {
                doublePairId = pairIds.get(block.doublePairId) ?? randomUUID();
                pairIds.set(block.doublePairId, doublePairId);
              }
              const placed = { ...block, doublePairId };
              const { block: stored, entries } = await writeBlock(
                transaction,
                version,
                model,
                placed,
              );
              written.push({
                id: stored.id,
                weekday: placed.weekday,
                slotPosition: placed.slotPosition,
                start: placed.start,
                end: placed.end,
                ...(doublePairId === null ? {} : { doublePairId }),
                lessons: placed.lessons.map((lesson, index) => ({
                  id: entries.find((entry) => entry.load_row_id === lesson.loadRowId)?.id ?? null,
                  loadRowId: lesson.loadRowId,
                  teacherId: model.rowOf(lesson.loadRowId).teacherId,
                  roomId: lesson.roomId,
                  rowNumber: keys[index] ?? null,
                })),
              });
            }
            // The deferred guards of 0058 now, so a refusal is mapped before the import is marked.
            await sql`set constraints all immediate`.execute(transaction);
            const moment = await transactionMoment(transaction);
            await transaction
              .updateTable('pattern_imports')
              .set({ confirmed_by: access.accountId, confirmed_at: moment })
              .where('id', '=', record.id)
              .execute();
            const placedCount = written.reduce((sum, one) => sum + one.lessons.length, 0);
            await this.audit.record(transaction, {
              branchId,
              actorId: access.accountId,
              assignmentId: access.assignmentId,
              action: 'pattern.import',
              record: { type: 'pattern_import', id: record.id },
              details: {
                versionId: version.id,
                fileSha256: record.fileSha256,
                removed,
                written,
              },
              requestId,
            });
            return {
              outcome: 'saved' as const,
              removed: now.length,
              placed: placedCount,
            };
          }),
        ),
      );
    } catch (error) {
      if (error instanceof RolledBack) {
        return { outcome: 'not_clean', preview: error.preview };
      }
      if (conflicted(error)) {
        throw new ApiException('pattern_import_changed', 409);
      }
      throw error;
    }
  }

  /** A removed block as the audit entry keeps it: its slot, pair, lessons and lock ids. */
  private blockValue(state: PatternState, block: PatternBlock) {
    const { model } = state.pattern;
    return {
      id: block.id,
      weekday: block.weekday,
      slotPosition: block.slotPosition,
      start: block.start,
      end: block.end,
      ...(block.doublePairId === null ? {} : { doublePairId: block.doublePairId }),
      lessons: block.lessons.map((lesson) => ({
        id: lesson.id,
        loadRowId: lesson.loadRowId,
        teacherId: model.rowOf(lesson.loadRowId).teacherId,
        roomId: lesson.roomId,
      })),
      locks: state.locks
        .filter((lock) => lock.kind === 'block' && lock.blockId === block.id)
        .map((lock) => lock.id),
    };
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
      .selectFrom('pattern_imports')
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
      file: patternImportFileSchema.parse(row.rows),
      fileSha256: row.file_sha256,
      confirmedAt: row.confirmed_at === null ? null : String(row.confirmed_at),
    };
  }

  /** The day the same file was confirmed into the draft, in the branch's time zone, if it was. */
  private async importedOn(transaction: Transaction, record: ImportRow): Promise<string | null> {
    const found = await transaction
      .selectFrom('pattern_imports')
      .innerJoin('branches', 'branches.id', 'pattern_imports.branch_id')
      .select(
        sql<string>`to_char(pattern_imports.confirmed_at at time zone branches.time_zone, 'YYYY-MM-DD')`.as(
          'day',
        ),
      )
      .where('pattern_imports.version_id', '=', record.versionId)
      .where('pattern_imports.file_sha256', '=', record.fileSha256)
      .where('pattern_imports.confirmed_at', 'is not', null)
      .executeTakeFirst();
    return found?.day ?? null;
  }

  /**
   * Reads, matches and checks every row of the file against the draft as it is now, with the
   * facts every grid write reads (`stateOf`, on `statusOn`). Writes nothing.
   */
  private async run(
    transaction: Transaction,
    version: VersionRow,
    record: ImportRow,
    accountId: string,
  ): Promise<RunResult> {
    if (record.file.versionId !== version.id) {
      throw new ApiException('pattern_import_other_draft', 422);
    }
    const context = await this.timetable.contextOf(transaction, version);
    const { records } = await recordsOf(transaction, context, record.file.language);
    const parsed = record.file.rows.map((row) => parsePatternImportRow(row, indexesOf(records)));
    const repeats = patternFileRepeats(parsed);
    const state = await this.pattern.stateOf(transaction, version, accountId);
    const { model } = state.pattern;
    const problems = new Map<number, PatternImportProblem[]>(
      parsed.map((row) => [row.rowNumber, [...row.problems]]),
    );
    const add = (rowNumber: number, problem: PatternImportProblem) => {
      problems.get(rowNumber)?.push(problem);
    };
    for (const [rowNumber, problem] of repeats) {
      add(rowNumber, problem);
    }
    const unitLabel = new Map(records.units.map((unit) => [unit.id, unit.labels[0] ?? unit.id]));
    const teacherLabel = new Map(
      records.teachers.map((one) => [
        one.id,
        one.labels[Math.max(0, ['uz', 'ru', 'en'].indexOf(record.file.language ?? 'uz'))] ??
          one.labels[0] ??
          one.id,
      ]),
    );
    const subjects = new Map(model.data.subjects.map((one) => [one.id, one]));
    const lessons: ImportLesson[] = [];
    const held: ImportHeld[] = [];
    for (const row of parsed) {
      if (row.unit === null || row.subject === null) continue;
      const unit = row.unit;
      const subjectId = row.subject.id;
      const loadRow = model.data.rows.find(
        (one) =>
          (unit.kind === 'class' ? one.classId === unit.id : one.groupId === unit.id) &&
          one.subjectId === subjectId,
      );
      if (loadRow === undefined) {
        add(row.rowNumber, { column: 'subject', code: 'pattern_import_no_load_row' });
        continue;
      }
      if (row.teacherGiven) {
        if (row.teacher !== null && row.teacher.id !== loadRow.teacherId) {
          add(row.rowNumber, {
            column: 'teacher',
            code: 'pattern_import_teacher_differs',
            teacher: teacherLabel.get(loadRow.teacherId) ?? loadRow.teacherId,
          });
        }
      } else {
        const subject = subjects.get(subjectId);
        const tutorRow =
          subject !== undefined &&
          isTutorRow({ kind: unit.kind }, { tutorSubject: subject.tutorSubject });
        if (!tutorRow) {
          add(row.rowNumber, { column: 'teacher', code: 'pattern_import_teacher_needed' });
        }
      }
      if (row.weekday === null || row.lessonNumber === null) continue;
      const at = { rowId: loadRow.id, weekday: row.weekday, lessonNumber: row.lessonNumber };
      if ((problems.get(row.rowNumber) ?? []).length > 0) {
        held.push(at);
      } else {
        lessons.push({
          key: row.rowNumber,
          ...at,
          ...(row.room === null ? {} : { roomId: row.room.id }),
        });
      }
    }
    const built = importedBlocks(model, lessons, held);
    for (const problem of built.problems) {
      if (problem.code === 'pattern_import_block_part') {
        add(problem.key, {
          column: 'unit',
          code: problem.code,
          units: problem.missingRowIds
            .map((rowId) => {
              const one = model.rowOf(rowId);
              const unitId = one.groupId ?? one.classId ?? '';
              return unitLabel.get(unitId) ?? unitId;
            })
            .sort((a, b) => a.localeCompare(b)),
        });
      } else {
        add(problem.key, { column: 'lessonNumber', code: problem.code });
      }
    }
    // The whole file as the conflict panel checks a draft: the file's blocks in place of the
    // draft's (which the confirm removes) and the busy-elsewhere lessons.
    const results = checkTimetable(
      checkedPlacements(
        model,
        built.blocks.map((one) => one.block),
      ),
      model.facts,
    );
    const warnings: PatternImportWarning[] = [];
    for (const result of results) {
      const keys = result.lessonIds.map(importKeyOf).filter((key): key is number => key !== null);
      const detail = result.detail === undefined ? {} : { detail: { ...result.detail } };
      if (result.severity === 'blocked') {
        for (const key of keys) {
          add(key, {
            column: null,
            code: result.rule,
            rows: keys.filter((other) => other !== key),
            ...detail,
          });
        }
      } else {
        warnings.push({
          rule: result.rule,
          weekday: result.day === '' ? null : Number(result.day),
          rows: keys,
          ...detail,
        });
      }
    }
    const previewRows: PatternImportPreviewRow[] = parsed.map((row) => ({
      rowNumber: row.rowNumber,
      cells: row.cells,
      problems: problems.get(row.rowNumber) ?? [],
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
        warnings,
        removes: lessonIdsOf(state.blocks),
        lessons: built.blocks.reduce((sum, one) => sum + one.block.lessons.length, 0),
        clean,
      },
      state,
      blocks: clean ? built.blocks : [],
    };
  }
}

/** A deadlock or a serialization failure: `pattern_import_changed`, nothing was saved, try again. */
function conflicted(error: unknown): boolean {
  const failure = error as { code?: unknown };
  return failure.code === DEADLOCK || failure.code === SERIALIZATION_FAILURE;
}
