import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  fillText,
  isLanguage,
  JOURNAL_EXPORT_ASCII_NAMES,
  JOURNAL_EXPORT_STALE_MS,
  JOURNAL_EXPORT_TEXTS,
  JOURNAL_EXPORTS_LISTED,
  type Clock,
  type JournalExport,
  type JournalExportItem,
  type JournalExportList,
  type JournalExportRequested,
  type JournalGrid,
  type Language,
  type PermissionTable,
} from '@sodiq/shared';
import { z } from 'zod';
import { CLOCK } from '../../clock/clock.module.js';
import { RequestKeys } from '../../database/request-keys.js';
import { Transactions, transactionMoment, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import { PDF_MEDIA_TYPE, PDF_RENDERER, PdfFile, type PdfRenderer } from '../../http/pdf.js';
import { writeSheets, XLSX_MEDIA_TYPE, XlsxFile } from '../../http/xlsx.js';
import { defineJob } from '../../jobs/job-definition.js';
import { Jobs } from '../../jobs/jobs.service.js';
import { currentAssignments, type CurrentAssignment } from '../access/current-assignments.js';
import { permitting } from '../access/permission-check.js';
import { PERMISSION_TABLE } from '../access/permission-table.token.js';
import type { Access } from '../access/permission.guard.js';
import { Audit } from '../audit/audit.service.js';
import { branchOf } from '../classes/classes.service.js';
import { PHOTO_STORE, type PhotoStore } from '../people/photo-store.js';
import { notFound, refusingConstraints } from '../setup/setup-refusals.js';
import { printHtml } from '../timetable/views-file.js';
import {
  journalHtml,
  journalSheet,
  sheetNameOf,
  stampOf,
  type JournalFileInput,
} from './journal-export.js';
import { JournalGridReader } from './journal-grid.service.js';
import { WHOLE_ROLES } from './journal-scope.js';

/**
 * The exports of journals (task 8.9, pull request #227; `07`, last paragraph;
 * `edge/system-behaviour`, "A whole branch's journals are exported to PDF
 * during lessons"):
 *
 * - one journal, for a month or a quarter, as Excel or PDF, from the
 *   reader's own grid answer (decision 1): read in one transaction, the file
 *   written outside it, one audit entry before the file is sent, as the
 *   plan's export (8.8);
 * - the whole branch for a whole-branch reader (decision 3), as a background
 *   job, one queued per person in a branch (decision 6), read from one
 *   snapshot (decision 11), behind a link that works for 24 hours from the
 *   moment it is ready, with access checked again at download (decision 4).
 */

/** The job of a branch export: the export's id only. */
export const branchExportJob = defineJob({
  name: 'journal.branch_export',
  data: z.strictObject({ exportId: z.uuid() }),
  // Decision 6: a failed export is marked failed and asked for again, never tried again by the
  // queue; a run past 15 minutes is given up, and its row turns stale at 20.
  options: { retryLimit: 0, expireInSeconds: 900 },
  transaction: 'none',
});

/** The render of a branch's PDF may take this long, inside the job's 15 minutes. */
const BRANCH_PDF_LIMIT_MS = 10 * 60 * 1000;

const exportScope = () => new ApiException('journal_export_scope', 403);

/** The whole-branch readers among the assignments (decision 3). */
const wholeReaders = (assignments: readonly CurrentAssignment[]) =>
  assignments.filter((one) => WHOLE_ROLES.includes(one.role));

/** A month `YYYY-MM` holds a day of the quarter. */
const monthInQuarter = (month: string, quarter: { startDate: string; endDate: string }) =>
  month >= quarter.startDate.slice(0, 7) && month <= quarter.endDate.slice(0, 7);

interface ExportRow {
  id: string;
  quarter_id: string;
  quarter_number: number;
  month: string | null;
  format: string;
  status: string;
  failure: string | null;
  requested_at: Date;
  as_of: Date | null;
  expires_at: Date | null;
  journals: number | null;
  rows: number | null;
  file_key: string | null;
  account_id: string;
  language: string;
}

/** Whether a queued export is past its time (decision 6), from its stored moment and the clock. */
const staleAt = (row: { status: string; requested_at: Date }, now: Date) =>
  row.status === 'queued' && now.getTime() - row.requested_at.getTime() >= JOURNAL_EXPORT_STALE_MS;

function itemOf(row: ExportRow, now: Date): JournalExportItem {
  const stale = staleAt(row, now);
  const expired =
    row.status === 'ready' && row.expires_at !== null && now.getTime() >= row.expires_at.getTime();
  return {
    id: row.id,
    quarter: { id: row.quarter_id, number: row.quarter_number },
    month: row.month === null ? null : row.month.slice(0, 7),
    format: row.format === 'pdf' ? 'pdf' : 'xlsx',
    status: stale
      ? 'failed'
      : expired
        ? 'expired'
        : row.status === 'ready'
          ? 'ready'
          : row.status === 'failed'
            ? 'failed'
            : 'queued',
    failure: stale ? 'journal_export_stale' : row.failure,
    requestedAt: row.requested_at.toISOString(),
    asOf: row.as_of?.toISOString() ?? null,
    expiresAt: row.expires_at?.toISOString() ?? null,
    journals: row.journals,
    rows: row.rows,
  };
}

/** A file name without spaces, as the plan's files are named. */
const fileBase = (parts: readonly string[]) => parts.join('-').replace(/\s+/g, '-');

@Injectable()
export class JournalExports {
  private readonly logger = new Logger('JournalExports');

  constructor(
    private readonly transactions: Transactions,
    private readonly grids: JournalGridReader,
    private readonly audit: Audit,
    private readonly jobs: Jobs,
    private readonly requestKeys: RequestKeys,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(PDF_RENDERER) private readonly pdf: PdfRenderer,
    @Inject(PHOTO_STORE) private readonly store: PhotoStore,
    @Inject(PERMISSION_TABLE) private readonly table: PermissionTable,
  ) {}

  private async placeOf(transaction: Transaction, accountId: string, branchId: string) {
    const account = await transaction
      .selectFrom('accounts')
      .select('language')
      .where('id', '=', accountId)
      .executeTakeFirstOrThrow();
    const branch = await transaction
      .selectFrom('branches')
      .select('time_zone')
      .where('id', '=', branchId)
      .executeTakeFirstOrThrow();
    const language: Language = isLanguage(account.language) ? account.language : 'uz';
    return { language, timeZone: branch.time_zone };
  }

  /** The quarter of the request in the branch, dated, with the month checked against it. */
  private async quarterOf(
    transaction: Transaction,
    branchId: string,
    input: JournalExport,
  ): Promise<{ id: string; number: number; yearId: string; startDate: string; endDate: string }> {
    const quarter = await transaction
      .selectFrom('quarters')
      .select(['id', 'number', 'academic_year_id', 'start_date', 'end_date'])
      .where('id', '=', input.quarterId)
      .where('branch_id', '=', branchId)
      .executeTakeFirst();
    if (quarter === undefined) throw notFound();
    if (quarter.start_date === null || quarter.end_date === null) {
      throw new ApiException('journal_no_quarter', 409);
    }
    const dates = { startDate: String(quarter.start_date), endDate: String(quarter.end_date) };
    if (input.month !== undefined && !monthInQuarter(input.month, dates)) {
      throw new ApiException('journal_month_outside', 400);
    }
    return { id: quarter.id, number: quarter.number, yearId: quarter.academic_year_id, ...dates };
  }

  /** One journal as Excel or PDF, from the reader's grid (decision 1). */
  async exportJournal(
    access: Access,
    journalId: string,
    input: JournalExport,
    requestId: string,
  ): Promise<XlsxFile | PdfFile> {
    const branchId = branchOf(access);
    const read = await this.transactions.run(access.branchIds, async (transaction) => {
      const grid = await this.grids.gridIn(transaction, access, branchId, journalId, {
        quarterId: input.quarterId,
      });
      // "Teachers export their own journals": a substitute's or an orphan lesson's reading
      // exports nothing (decision 1).
      if (grid.shape === 'lessons') throw exportScope();
      if (input.month !== undefined && !monthInQuarter(input.month, grid.quarter)) {
        throw new ApiException('journal_month_outside', 400);
      }
      return {
        grid,
        asOf: await transactionMoment(transaction),
        ...(await this.placeOf(transaction, access.accountId, branchId)),
      };
    });
    const texts = JOURNAL_EXPORT_TEXTS[read.language];
    const file: JournalFileInput = {
      grid: read.grid,
      month: input.month ?? null,
      language: read.language,
      timeZone: read.timeZone,
      asOf: read.asOf,
    };
    const name = `${read.grid.journal.unit.name} ${read.grid.journal.subject.names[read.language]}`;
    const written = journalSheet(file, texts, sheetNameOf(name, new Set()));
    const content =
      input.format === 'pdf'
        ? await this.pdf.render(this.pdfOf([file], texts, read.language, name))
        : await writeSheets([written.sheet]);
    await this.transactions.run(access.branchIds, (transaction) =>
      this.audit.record(transaction, {
        branchId,
        actorId: access.accountId,
        assignmentId: access.assignmentId,
        action: 'journal.export',
        record: { type: 'journal', id: read.grid.journal.id },
        details: {
          quarterId: read.grid.quarter.id,
          month: input.month ?? null,
          format: input.format,
          shape: read.grid.shape,
          asOf: read.asOf.toISOString(),
          rows: written.rows,
        },
        requestId,
      }),
    );
    const base = fileBase([
      texts.fileName,
      read.grid.journal.unit.name,
      String(read.grid.quarter.number),
      ...(input.month === undefined ? [] : [input.month]),
    ]);
    const ascii = fileBase([
      JOURNAL_EXPORT_ASCII_NAMES.journal,
      String(read.grid.quarter.number),
      ...(input.month === undefined ? [] : [input.month]),
    ]);
    return input.format === 'pdf'
      ? new PdfFile(`${base}.pdf`, `${ascii}.pdf`, content)
      : new XlsxFile(`${base}.xlsx`, `${ascii}.xlsx`, ['journal'], content);
  }

  private pdfOf(
    files: readonly JournalFileInput[],
    texts: (typeof JOURNAL_EXPORT_TEXTS)['en'],
    language: Language,
    title: string,
  ): string {
    const first = files[0];
    const stamp = first === undefined ? '' : stampOf(first, texts);
    return printHtml({
      language,
      title: `${texts.title} · ${title}`,
      landscape: true,
      stamp: [stamp],
      bottomLeft: stamp,
      page: texts.page,
      body: files.map((file, index) => journalHtml(file, texts, index === 0)).join(''),
    });
  }

  // -------------------------------------------------------------------------
  // The branch export.

  private async rowOf(transaction: Transaction, exportId: string): Promise<ExportRow | undefined> {
    const row = await transaction
      .selectFrom('journal_exports')
      .innerJoin('quarters', 'quarters.id', 'journal_exports.quarter_id')
      .select([
        'journal_exports.id',
        'journal_exports.quarter_id',
        'quarters.number as quarter_number',
        'journal_exports.month',
        'journal_exports.format',
        'journal_exports.status',
        'journal_exports.failure',
        'journal_exports.requested_at',
        'journal_exports.as_of',
        'journal_exports.expires_at',
        'journal_exports.journals',
        'journal_exports.rows',
        'journal_exports.file_key',
        'journal_exports.account_id',
        'journal_exports.language',
      ])
      .where('journal_exports.id', '=', exportId)
      .executeTakeFirst();
    return row === undefined ? undefined : exportRow(row);
  }

  /** Asks for the export of the whole branch (decisions 3 and 6), repeat-safe by its key. */
  async requestBranch(
    access: Access,
    input: JournalExport,
    key: string,
    requestId: string,
  ): Promise<JournalExportRequested> {
    const branchId = branchOf(access);
    const reader = wholeReaders(access.permitting)[0];
    if (reader === undefined) throw exportScope();
    return this.transactions.run(access.branchIds, async (transaction) => {
      const quarter = await this.quarterOf(transaction, branchId, input);
      const once = await this.requestKeys.runOnce(
        transaction,
        { key, scope: 'journal.branch_export', accountId: access.accountId, input: { ...input } },
        async () => {
          const now = await transactionMoment(transaction);
          const open = await transaction
            .selectFrom('journal_exports')
            .select(['id', 'status', 'requested_at'])
            .where('account_id', '=', access.accountId)
            .where('branch_id', '=', branchId)
            .where('status', '=', 'queued')
            .forUpdate()
            .executeTakeFirst();
          if (open !== undefined) {
            if (!staleAt(open, now)) throw new ApiException('journal_export_running', 409);
            // Decision 6: a queued export past its time is marked failed by the next request.
            await transaction
              .updateTable('journal_exports')
              .set({ status: 'failed', failure: 'journal_export_stale' })
              .where('id', '=', open.id)
              .execute();
          }
          const { language } = await this.placeOf(transaction, access.accountId, branchId);
          const inserted = await refusingConstraints(
            () =>
              transaction
                .insertInto('journal_exports')
                .values({
                  branch_id: branchId,
                  account_id: access.accountId,
                  assignment_id: reader.id,
                  quarter_id: quarter.id,
                  month: input.month === undefined ? null : `${input.month}-01`,
                  format: input.format,
                  language,
                  // The trigger writes the transaction's moment over it.
                  requested_at: now,
                })
                .returning('id')
                .executeTakeFirstOrThrow(),
            { journal_exports_queued_key: 'journal_export_running' },
          );
          await this.audit.record(transaction, {
            branchId,
            actorId: access.accountId,
            assignmentId: reader.id,
            action: 'journal.branch_export',
            record: { type: 'journal_export', id: inserted.id },
            details: {
              quarterId: quarter.id,
              month: input.month ?? null,
              format: input.format,
            },
            requestId,
          });
          await this.jobs.enqueue(transaction, branchExportJob, {
            branchIds: [branchId],
            data: { exportId: inserted.id },
          });
          return { exportId: inserted.id };
        },
      );
      const row = await this.rowOf(transaction, once.result.exportId);
      if (row === undefined) throw notFound();
      return { export: itemOf(row, await transactionMoment(transaction)) };
    });
  }

  /** The person's own branch exports, newest first (decision 12). */
  list(access: Access): Promise<JournalExportList> {
    return this.transactions.run(access.branchIds, async (transaction) => {
      const now = await transactionMoment(transaction);
      const ids = await transaction
        .selectFrom('journal_exports')
        .select('id')
        .where('account_id', '=', access.accountId)
        .where('branch_id', '=', branchOf(access))
        .orderBy('requested_at', 'desc')
        .orderBy('id', 'desc')
        .limit(JOURNAL_EXPORTS_LISTED)
        .execute();
      const rows: ExportRow[] = [];
      for (const { id } of ids) {
        const row = await this.rowOf(transaction, id);
        if (row !== undefined) rows.push(row);
      }
      return {
        canExportBranch: wholeReaders(access.permitting).length > 0,
        exports: rows.map((row) => itemOf(row, now)),
      };
    });
  }

  /**
   * The file of a branch export: the person's own, ready and not expired, and
   * access checked again with the assignments of this request (decision 4).
   * The audit entry is committed first; the store is read with no
   * transaction open (`photo-store.ts`).
   */
  async download(access: Access, exportId: string, requestId: string): Promise<XlsxFile | PdfFile> {
    const branchId = branchOf(access);
    const found = await this.transactions.run(access.branchIds, async (transaction) => {
      const row = await this.rowOf(transaction, exportId);
      if (row?.account_id.toLowerCase() !== access.accountId.toLowerCase()) throw notFound();
      const reader = wholeReaders(access.permitting)[0];
      if (reader === undefined) throw exportScope();
      const now = await transactionMoment(transaction);
      const item = itemOf(row, now);
      if (item.status === 'queued') throw new ApiException('journal_export_not_ready', 409);
      if (item.status === 'failed') throw new ApiException('journal_export_failed', 409);
      if (item.status === 'expired' || row.file_key === null) {
        throw new ApiException('journal_export_expired', 410);
      }
      await this.audit.record(transaction, {
        branchId,
        actorId: access.accountId,
        assignmentId: reader.id,
        action: 'journal.branch_export_download',
        record: { type: 'journal_export', id: row.id },
        details: { journals: row.journals, rows: row.rows, format: item.format },
        requestId,
      });
      return { row, item, key: row.file_key };
    });
    const content = await this.store.get(found.key);
    const language: Language = isLanguage(found.row.language) ? found.row.language : 'uz';
    const texts = JOURNAL_EXPORT_TEXTS[language];
    const base = fileBase([
      texts.branchFileName,
      String(found.item.quarter.number),
      ...(found.item.month === null ? [] : [found.item.month]),
    ]);
    const ascii = fileBase([
      JOURNAL_EXPORT_ASCII_NAMES.branch,
      String(found.item.quarter.number),
      ...(found.item.month === null ? [] : [found.item.month]),
    ]);
    return found.item.format === 'pdf'
      ? new PdfFile(`${base}.pdf`, `${ascii}.pdf`, content)
      : new XlsxFile(`${base}.xlsx`, `${ascii}.xlsx`, ['journals'], content);
  }

  /**
   * The job (decisions 6 and 11). Decides from the stored row: anything but a
   * queued row in time does nothing. The requester's access is read again
   * from the current assignments; the journals are read in one snapshot; the
   * file is written and put to the store with no transaction open; the row
   * becomes ready only while it is still queued.
   */
  async runBranchExport(
    data: { exportId: string },
    job: { branchIds: readonly string[] },
  ): Promise<void> {
    const start = await this.transactions.run(job.branchIds, async (transaction) => {
      const row = await transaction
        .selectFrom('journal_exports')
        .selectAll()
        .where('id', '=', data.exportId)
        .executeTakeFirst();
      const now = await transactionMoment(transaction);
      if (row === undefined || row.status !== 'queued' || staleAt(row, now)) return null;
      const assignments = await currentAssignments(transaction, row.account_id, now);
      const requirement = (action: 'view' | 'export') =>
        permitting(
          { area: 'journal', action, branch: 'request' },
          assignments,
          row.branch_id,
          this.table,
        );
      const viewers = wholeReaders(requirement('view'));
      const exporters = wholeReaders(requirement('export'));
      const first = viewers[0];
      if (first === undefined || exporters.length === 0) {
        await this.fail(transaction, row.id, 'journal_export_scope');
        return null;
      }
      const access: Access = {
        accountId: row.account_id,
        assignmentId: first.id,
        role: first.role,
        branchId: row.branch_id,
        branchIds: [row.branch_id],
        assignments,
        permitting: viewers,
      };
      const quarter = await transaction
        .selectFrom('quarters')
        .select('academic_year_id')
        .where('id', '=', row.quarter_id)
        .executeTakeFirstOrThrow();
      return {
        row,
        access,
        yearId: quarter.academic_year_id,
        ...(await this.placeOf(transaction, row.account_id, row.branch_id)),
      };
    });
    if (start === null) return;
    const { row, access } = start;
    const month = row.month === null ? null : String(row.month).slice(0, 7);
    try {
      // One snapshot for every journal (decision 11: "taken from one consistent moment").
      const read = await this.transactions.run(
        job.branchIds,
        async (transaction) => {
          const journals = await this.grids.readableIn(
            transaction,
            access,
            row.branch_id,
            start.yearId,
          );
          const grids: JournalGrid[] = [];
          for (const journal of journals) {
            grids.push(
              await this.grids.gridIn(transaction, access, row.branch_id, journal.id, {
                quarterId: row.quarter_id,
              }),
            );
          }
          return { grids, asOf: await transactionMoment(transaction) };
        },
        { snapshot: true },
      );
      const texts = JOURNAL_EXPORT_TEXTS[start.language];
      const files: JournalFileInput[] = read.grids.map((grid) => ({
        grid,
        month,
        language: start.language,
        timeZone: start.timeZone,
        asOf: read.asOf,
      }));
      const taken = new Set<string>();
      const sheets = files.map((file) =>
        journalSheet(
          file,
          texts,
          sheetNameOf(
            `${file.grid.journal.unit.name} ${file.grid.journal.subject.names[start.language]}`,
            taken,
          ),
        ),
      );
      const rows = sheets.reduce((sum, one) => sum + one.rows, 0);
      const quarterNumber = read.grids[0]?.quarter.number;
      const title = [
        ...(quarterNumber === undefined
          ? []
          : [fillText(texts.quarter, { number: String(quarterNumber) })]),
        ...(month === null ? [] : [fillText(texts.month, { month })]),
      ].join(' · ');
      const content =
        row.format === 'pdf'
          ? await this.pdf.render(this.pdfOf(files, texts, start.language, title), {
              limitMs: BRANCH_PDF_LIMIT_MS,
            })
          : await writeSheets(sheets.map((one) => one.sheet));
      const fileKey = `exports/${row.id}/${randomUUID()}`;
      await this.store.put(
        fileKey,
        content,
        row.format === 'pdf' ? PDF_MEDIA_TYPE : XLSX_MEDIA_TYPE,
      );
      await this.transactions.run(job.branchIds, async (transaction) => {
        const done = await transaction
          .updateTable('journal_exports')
          .set({
            status: 'ready',
            as_of: read.asOf,
            file_key: fileKey,
            journals: files.length,
            rows,
          })
          .where('id', '=', row.id)
          .where('status', '=', 'queued')
          .executeTakeFirst();
        if (done.numUpdatedRows === 0n) return;
        await this.audit.record(transaction, {
          branchId: row.branch_id,
          actorId: row.account_id,
          assignmentId: row.assignment_id,
          action: 'journal.branch_export_ready',
          record: { type: 'journal_export', id: row.id },
          details: {
            quarterId: row.quarter_id,
            month,
            format: row.format,
            asOf: read.asOf.toISOString(),
            journals: files.length,
            rows,
          },
        });
      });
    } catch (error) {
      this.logger.error(
        `journal.branch_export ${row.id}: ${error instanceof Error ? error.message : 'failed'}`,
      );
      await this.transactions.run(job.branchIds, (transaction) =>
        this.fail(transaction, row.id, 'journal_export_failed'),
      );
    }
  }

  private async fail(transaction: Transaction, exportId: string, failure: string): Promise<void> {
    await transaction
      .updateTable('journal_exports')
      .set({ status: 'failed', failure })
      .where('id', '=', exportId)
      .where('status', '=', 'queued')
      .execute();
  }
}

function exportRow(row: ExportRow): ExportRow {
  return row;
}
