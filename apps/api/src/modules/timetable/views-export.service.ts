import { Inject, Injectable } from '@nestjs/common';
import {
  isLanguage,
  VIEW_EXPORT_ASCII_NAMES,
  VIEW_EXPORT_TEXTS,
  type Clock,
  type Language,
  type TimetableView,
  type ViewExportRequest,
} from '@sodiq/shared';
import { CLOCK } from '../../clock/clock.module.js';
import { Transactions } from '../../database/transactions.js';
import { PDF_RENDERER, PdfFile, type PdfRenderer } from '../../http/pdf.js';
import { writeWorkbook, XlsxFile } from '../../http/xlsx.js';
import type { Access } from '../access/permission.guard.js';
import { Audit } from '../audit/audit.service.js';
import { branchOf } from '../classes/classes.service.js';
import { fileNameOf, viewHtml, viewSheet } from './views-file.js';
import { TimetableViews } from './views.service.js';

/** The column keys of the Excel file, in their order (the `X-Export-Columns` header). */
const SHEET_COLUMNS = [
  'date',
  'weekday',
  'lessonNumber',
  'start',
  'end',
  'unit',
  'subject',
  'teacher',
  'room',
  'kind',
  'mark',
  'version',
  'validFrom',
] as const;

/** A moment in a branch's time zone as `DD.MM.YYYY HH:MM` (decision 8; `edge/00-definitions`, Branch time). */
export function momentText(moment: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(moment);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((one) => one.type === type)?.value ?? '';
  return `${part('day')}.${part('month')}.${part('year')} ${part('hour')}:${part('minute')}`;
}

/**
 * Print, PDF and Excel of a timetable view (task 5.9c-1, pull request #199;
 * `06`, Views and outputs: "Print, PDF and Excel for one class, one teacher,
 * one room or the whole school"), in three steps (decision 14):
 *
 * 1. the view is read in one transaction by the 5.9a code, with its scope
 *    and its refusals (403 `timetable_view_scope`, 404), so the file holds
 *    what the page shows and nothing more ("Exports follow the role");
 * 2. the file is written, and a PDF rendered, outside any transaction, so no
 *    pooled connection waits on Chromium;
 * 3. one audit entry `timetable_view.export` is written in a transaction of
 *    its own before the file is sent; a refusal or a failed render writes
 *    none and sends nothing (`02`, Rules: "Every ... export is written to an
 *    audit log").
 */
@Injectable()
export class TimetableViewExports {
  constructor(
    private readonly transactions: Transactions,
    private readonly views: TimetableViews,
    private readonly audit: Audit,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(PDF_RENDERER) private readonly pdf: PdfRenderer,
  ) {}

  async export(
    access: Access,
    request: ViewExportRequest,
    requestId: string,
  ): Promise<XlsxFile | PdfFile> {
    const branchId = branchOf(access);
    const read = await this.transactions.run(access.branchIds, async (transaction) => {
      const view = await this.viewOf(transaction, access, request);
      const account = await transaction
        .selectFrom('accounts')
        .select('language')
        .where('id', '=', access.accountId)
        .executeTakeFirstOrThrow();
      const branch = await transaction
        .selectFrom('branches')
        .select('time_zone')
        .where('id', '=', branchId)
        .executeTakeFirstOrThrow();
      const language: Language = isLanguage(account.language) ? account.language : 'uz';
      return { view, language, timeZone: branch.time_zone };
    });
    const { view, language } = read;
    const moment = this.clock.now();
    const stamp = { asOf: momentText(moment, read.timeZone) };
    const texts = VIEW_EXPORT_TEXTS[language];
    const ascii = VIEW_EXPORT_ASCII_NAMES[view.kind];
    const file =
      request.format === 'pdf'
        ? await this.pdfOf(view, language, stamp)
        : await this.xlsxOf(view, language, stamp);
    await this.transactions.run(access.branchIds, (transaction) =>
      this.audit.record(transaction, {
        branchId,
        actorId: access.accountId,
        assignmentId: access.assignmentId,
        action: 'timetable_view.export',
        details: {
          kind: request.kind,
          viewOf: view.subject?.id ?? null,
          date: request.date,
          span: request.span,
          format: request.format,
          asOf: moment.toISOString(),
          lessons: view.lessons.length,
          exams: view.exams.length,
          busy: view.busy.length,
          fromPatternDays: view.days.filter((day) => day.fromPattern).length,
        },
        requestId,
      }),
    );
    const names = fileNameOf(view, texts, ascii, request.format);
    return file.kind === 'pdf'
      ? new PdfFile(names.fileName, names.asciiName, file.content)
      : new XlsxFile(names.fileName, names.asciiName, SHEET_COLUMNS, file.content);
  }

  private viewOf(
    transaction: Parameters<TimetableViews['branchIn']>[0],
    access: Access,
    request: ViewExportRequest,
  ): Promise<TimetableView> {
    const query = { date: request.date, span: request.span };
    switch (request.kind) {
      case 'branch':
        return this.views.branchIn(transaction, access, query);
      case 'class':
        return this.views.classIn(transaction, access, { ...query, classId: request.classId });
      case 'teacher':
        return this.views.teacherIn(transaction, access, { ...query, staffId: request.staffId });
      case 'room':
        return this.views.roomIn(transaction, access, { ...query, roomId: request.roomId });
    }
  }

  private async pdfOf(
    view: TimetableView,
    language: Language,
    stamp: { asOf: string },
  ): Promise<{ kind: 'pdf'; content: Buffer }> {
    const html = viewHtml(view, VIEW_EXPORT_TEXTS[language], language, stamp);
    return { kind: 'pdf', content: await this.pdf.render(html) };
  }

  private async xlsxOf(
    view: TimetableView,
    language: Language,
    stamp: { asOf: string },
  ): Promise<{ kind: 'xlsx'; content: Buffer }> {
    const sheet = viewSheet(view, VIEW_EXPORT_TEXTS[language], language, stamp);
    return { kind: 'xlsx', content: await writeWorkbook(sheet) };
  }
}
