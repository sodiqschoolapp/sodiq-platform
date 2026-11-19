import { Controller, Delete, Get, HttpCode, Post } from '@nestjs/common';
import {
  feedbackReportEntrySchema,
  feedbackReportListSchema,
  feedbackReportParamsSchema,
  type FeedbackReportEntry,
  type FeedbackReportList,
  type FeedbackReportParams,
} from '@sodiq/shared';
import { RequestId } from '../../http/request-id.js';
import { Returns, ValidParams } from '../../http/schemas.js';
import { Requires } from '../access/access.decorators.js';
import { CurrentAccess, type Access } from '../access/permission.guard.js';
import { FeedbackList } from './feedback-list.service.js';

/**
 * The Feedback reports page of the Super Admin (pull request #361; owner, 19 November 2026):
 * the reports of the whole school, and the mark that one was handled. School-wide work, under
 * the area `monitoring`, which the Super Admin alone holds.
 */
@Controller('feedback-reports')
export class FeedbackReportsController {
  constructor(private readonly reports: FeedbackList) {}

  @Get()
  @Requires('monitoring', 'view', { branch: 'none' })
  @Returns(feedbackReportListSchema)
  list(@CurrentAccess() access: Access): Promise<FeedbackReportList> {
    return this.reports.list(access);
  }

  /** Marks a report handled; a report already handled is answered unchanged. */
  @Post(':id/handled')
  @HttpCode(200)
  @Requires('monitoring', 'edit', { branch: 'none' })
  @Returns(feedbackReportEntrySchema)
  handled(
    @CurrentAccess() access: Access,
    @ValidParams(feedbackReportParamsSchema) params: FeedbackReportParams,
    @RequestId() requestId: string,
  ): Promise<FeedbackReportEntry> {
    return this.reports.mark(access, params.id, true, requestId);
  }

  /** Marks a report new again; a new report is answered unchanged. */
  @Delete(':id/handled')
  @Requires('monitoring', 'edit', { branch: 'none' })
  @Returns(feedbackReportEntrySchema)
  reopened(
    @CurrentAccess() access: Access,
    @ValidParams(feedbackReportParamsSchema) params: FeedbackReportParams,
    @RequestId() requestId: string,
  ): Promise<FeedbackReportEntry> {
    return this.reports.mark(access, params.id, false, requestId);
  }
}
