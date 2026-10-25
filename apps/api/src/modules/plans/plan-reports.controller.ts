import { Controller, Get, Post, Put } from '@nestjs/common';
import {
  planCompletenessSchema,
  planExportSchema,
  planMinimumSaveSchema,
  planMinimumsSchema,
  planParamsSchema,
  planProgressSchema,
  planReportExportSchema,
  planReportQuerySchema,
  planRequestsReportSchema,
  type PlanCompleteness,
  type PlanExport,
  type PlanMinimumSave,
  type PlanMinimums,
  type PlanParams,
  type PlanProgress,
  type PlanReportExport,
  type PlanReportQuery,
  type PlanRequestsReport,
} from '@sodiq/shared';
import type { PdfFile } from '../../http/pdf.js';
import { RequestId } from '../../http/request-id.js';
import { Returns, ReturnsFile, ValidBody, ValidParams, ValidQuery } from '../../http/schemas.js';
import type { XlsxFile } from '../../http/xlsx.js';
import { Requires } from '../access/access.decorators.js';
import { CurrentAccess, type Access } from '../access/permission.guard.js';
import { PlanExports } from './plan-exports.service.js';
import { PlanMinimumsService } from './plan-minimums.js';
import { PlanReportsService } from './plan-reports.service.js';

/**
 * The plan reports and their export (task 8.8, pull request #226; `09`,
 * Reports), area `plan_reports` (decision 1): the branch for the whole-branch
 * roles, own subjects for the Head Teachers. A read writes no audit entry; an
 * export writes one.
 */
@Controller('plans/reports')
export class PlanReportsController {
  constructor(
    private readonly reports: PlanReportsService,
    private readonly exports: PlanExports,
  ) {}

  @Get('completeness')
  @Requires('plan_reports', 'view')
  @Returns(planCompletenessSchema)
  completeness(
    @CurrentAccess() access: Access,
    @ValidQuery(planReportQuerySchema) query: PlanReportQuery,
  ): Promise<PlanCompleteness> {
    return this.reports.completeness(access, query);
  }

  @Get('progress')
  @Requires('plan_reports', 'view')
  @Returns(planProgressSchema)
  progress(
    @CurrentAccess() access: Access,
    @ValidQuery(planReportQuerySchema) query: PlanReportQuery,
  ): Promise<PlanProgress> {
    return this.reports.progress(access, query);
  }

  @Get('requests')
  @Requires('plan_reports', 'view')
  @Returns(planRequestsReportSchema)
  requests(
    @CurrentAccess() access: Access,
    @ValidQuery(planReportQuerySchema) query: PlanReportQuery,
  ): Promise<PlanRequestsReport> {
    return this.reports.requests(access, query);
  }

  /** Decision 17: a report in Excel. */
  @Post('export')
  @Requires('plan_reports', 'export')
  @ReturnsFile()
  export(
    @CurrentAccess() access: Access,
    @ValidBody(planReportExportSchema) input: PlanReportExport,
    @RequestId() requestId: string,
  ): Promise<XlsxFile> {
    return this.exports.exportReport(access, input, requestId);
  }
}

/** The minimum works of subjects (decision 11), set by the `plan_windows` edit roles. */
@Controller('plans/minimums')
export class PlanMinimumsController {
  constructor(private readonly minimums: PlanMinimumsService) {}

  @Get()
  @Requires('plan_windows', 'view')
  @Returns(planMinimumsSchema)
  list(@CurrentAccess() access: Access): Promise<PlanMinimums> {
    return this.minimums.list(access);
  }

  @Put()
  @Requires('plan_windows', 'edit')
  @Returns(planMinimumsSchema)
  save(
    @CurrentAccess() access: Access,
    @ValidBody(planMinimumSaveSchema) input: PlanMinimumSave,
    @RequestId() requestId: string,
  ): Promise<PlanMinimums> {
    return this.minimums.save(access, input, requestId);
  }
}

/** `edge/lesson-plans`: "Plans export to PDF and Excel with their marks" (decision 2). */
@Controller('plans/journals')
export class PlanExportController {
  constructor(private readonly exports: PlanExports) {}

  @Post(':journalId/export')
  @Requires('plans', 'export')
  @ReturnsFile({ pdf: true })
  export(
    @CurrentAccess() access: Access,
    @ValidParams(planParamsSchema) params: PlanParams,
    @ValidBody(planExportSchema) input: PlanExport,
    @RequestId() requestId: string,
  ): Promise<XlsxFile | PdfFile> {
    return this.exports.exportPlan(access, params.journalId, input, requestId);
  }
}
