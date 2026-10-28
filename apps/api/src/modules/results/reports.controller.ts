import { Controller, Get, Post } from '@nestjs/common';
import {
  attendanceReportExportSchema,
  attendanceReportQuerySchema,
  attendanceReportSchema,
  resultsReportChoicesQuerySchema,
  resultsReportChoicesSchema,
  resultsReportExportSchema,
  resultsTableQuerySchema,
  resultsTableSchema,
  subjectMasteryQuerySchema,
  subjectMasterySchema,
  type AttendanceReport,
  type AttendanceReportExport,
  type AttendanceReportQuery,
  type ResultsReportChoices,
  type ResultsReportChoicesQuery,
  type ResultsReportExport,
  type ResultsTable,
  type ResultsTableQuery,
  type SubjectMastery,
  type SubjectMasteryQuery,
} from '@sodiq/shared';
import { RequestId } from '../../http/request-id.js';
import { Returns, ReturnsFile, ValidBody, ValidQuery } from '../../http/schemas.js';
import type { XlsxFile } from '../../http/xlsx.js';
import { Requires } from '../access/access.decorators.js';
import { CurrentAccess, type Access } from '../access/permission.guard.js';
import { ResultsReportsService } from './reports.service.js';

/**
 * The reports of `08`, Analytics in Release 1, over the journal (task 9.3b-2, pull request #260):
 * the attendance report (area `attendance_report`), the results table and subject mastery (area
 * `results_reports`), decision 1, approved by the owner. The guard lets the roles of the area in;
 * which classes, subjects and journals each reads is decided in the route (`reports.service.ts`).
 * A read writes no audit entry; an export writes one.
 */
@Controller('results/reports')
export class ResultsReportsController {
  constructor(private readonly reports: ResultsReportsService) {}

  @Get('attendance')
  @Requires('attendance_report', 'view')
  @Returns(attendanceReportSchema)
  attendance(
    @CurrentAccess() access: Access,
    @ValidQuery(attendanceReportQuerySchema) query: AttendanceReportQuery,
  ): Promise<AttendanceReport> {
    return this.reports.attendance(access, query);
  }

  @Post('attendance/export')
  @Requires('attendance_report', 'export')
  @ReturnsFile()
  attendanceExport(
    @CurrentAccess() access: Access,
    @ValidBody(attendanceReportExportSchema) input: AttendanceReportExport,
    @RequestId() requestId: string,
  ): Promise<XlsxFile> {
    return this.reports.attendanceExport(access, input, requestId);
  }

  @Get('choices')
  @Requires('results_reports', 'view')
  @Returns(resultsReportChoicesSchema)
  choices(
    @CurrentAccess() access: Access,
    @ValidQuery(resultsReportChoicesQuerySchema) query: ResultsReportChoicesQuery,
  ): Promise<ResultsReportChoices> {
    return this.reports.choices(access, query);
  }

  @Get('results-table')
  @Requires('results_reports', 'view')
  @Returns(resultsTableSchema)
  table(
    @CurrentAccess() access: Access,
    @ValidQuery(resultsTableQuerySchema) query: ResultsTableQuery,
  ): Promise<ResultsTable> {
    return this.reports.table(access, query);
  }

  @Get('subject-mastery')
  @Requires('results_reports', 'view')
  @Returns(subjectMasterySchema)
  mastery(
    @CurrentAccess() access: Access,
    @ValidQuery(subjectMasteryQuerySchema) query: SubjectMasteryQuery,
  ): Promise<SubjectMastery> {
    return this.reports.mastery(access, query);
  }

  /** The results table or subject mastery as Excel, with the reader's own rows and the stamp. */
  @Post('export')
  @Requires('results_reports', 'export')
  @ReturnsFile()
  export(
    @CurrentAccess() access: Access,
    @ValidBody(resultsReportExportSchema) input: ResultsReportExport,
    @RequestId() requestId: string,
  ): Promise<XlsxFile> {
    return this.reports.export(access, input, requestId);
  }
}
