import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import {
  journalExportListSchema,
  journalExportParamsSchema,
  journalExportRequestedSchema,
  journalExportSchema,
  journalParamsSchema,
  type JournalExport,
  type JournalExportList,
  type JournalExportParams,
  type JournalExportRequested,
  type JournalParams,
} from '@sodiq/shared';
import type { PdfFile } from '../../http/pdf.js';
import { RequestId } from '../../http/request-id.js';
import { RequestKey, Returns, ReturnsFile, ValidBody, ValidParams } from '../../http/schemas.js';
import type { XlsxFile } from '../../http/xlsx.js';
import { Requires } from '../access/access.decorators.js';
import { CurrentAccess, type Access } from '../access/permission.guard.js';
import { JournalExports } from './journal-exports.service.js';

/**
 * The exports of journals (task 8.9, pull request #227; `07`, last
 * paragraph; `edge/system-behaviour`, the large export). The area `journal`
 * `export` lets the nine readers in (decision 1); the route decides the scope:
 * a journal as the grid reads it, the branch export for a whole-branch reader
 * (decision 3), checked again at download (decision 4).
 */
@Controller('journal')
export class JournalExportsController {
  constructor(private readonly exports: JournalExports) {}

  @Post('journals/:journalId/export')
  @Requires('journal', 'export')
  @ReturnsFile({ pdf: true })
  exportJournal(
    @CurrentAccess() access: Access,
    @ValidParams(journalParamsSchema) params: JournalParams,
    @ValidBody(journalExportSchema) input: JournalExport,
    @RequestId() requestId: string,
  ): Promise<XlsxFile | PdfFile> {
    return this.exports.exportJournal(access, params.journalId, input, requestId);
  }

  @Get('exports')
  @Requires('journal', 'export')
  @Returns(journalExportListSchema)
  list(@CurrentAccess() access: Access): Promise<JournalExportList> {
    return this.exports.list(access);
  }

  @Post('exports')
  @HttpCode(200)
  @Requires('journal', 'export')
  @Returns(journalExportRequestedSchema)
  requestBranch(
    @CurrentAccess() access: Access,
    @ValidBody(journalExportSchema) input: JournalExport,
    @RequestKey() key: string,
    @RequestId() requestId: string,
  ): Promise<JournalExportRequested> {
    return this.exports.requestBranch(access, input, key, requestId);
  }

  @Get('exports/:exportId/file')
  @Requires('journal', 'export')
  @ReturnsFile({ pdf: true })
  download(
    @CurrentAccess() access: Access,
    @ValidParams(journalExportParamsSchema) params: JournalExportParams,
    @RequestId() requestId: string,
  ): Promise<XlsxFile | PdfFile> {
    return this.exports.download(access, params.exportId, requestId);
  }
}
