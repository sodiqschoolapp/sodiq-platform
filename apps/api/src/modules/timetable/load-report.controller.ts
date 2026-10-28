import { Controller, Get, Post } from '@nestjs/common';
import {
  loadReportExportSchema,
  loadReportQuerySchema,
  loadReportSchema,
  type LoadReport,
  type LoadReportExport,
  type LoadReportQuery,
} from '@sodiq/shared';
import { RequestId } from '../../http/request-id.js';
import { Returns, ReturnsFile, ValidBody, ValidQuery } from '../../http/schemas.js';
import type { XlsxFile } from '../../http/xlsx.js';
import { Requires } from '../access/access.decorators.js';
import { CurrentAccess, type Access } from '../access/permission.guard.js';
import { LoadReports } from './load-report.service.js';

/**
 * The timetable load report (task 9.3b-2, pull request #260; `06`, Views and outputs; `08`,
 * Analytics), area `timetable_load` (decision 1, approved by the owner): management of the
 * branch. A read writes no audit entry; an export writes one.
 */
@Controller('timetable/reports')
export class LoadReportController {
  constructor(private readonly reports: LoadReports) {}

  @Get('load')
  @Requires('timetable_load', 'view')
  @Returns(loadReportSchema)
  load(
    @CurrentAccess() access: Access,
    @ValidQuery(loadReportQuerySchema) query: LoadReportQuery,
  ): Promise<LoadReport> {
    return this.reports.read(access, query);
  }

  @Post('load/export')
  @Requires('timetable_load', 'export')
  @ReturnsFile()
  export(
    @CurrentAccess() access: Access,
    @ValidBody(loadReportExportSchema) input: LoadReportExport,
    @RequestId() requestId: string,
  ): Promise<XlsxFile> {
    return this.reports.export(access, input, requestId);
  }
}
