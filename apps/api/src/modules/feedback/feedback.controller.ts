import { Controller, Post } from '@nestjs/common';
import { feedbackReportSchema, type FeedbackReport } from '@sodiq/shared';
import { RequestId } from '../../http/request-id.js';
import { ReturnsNothing, ValidBody } from '../../http/schemas.js';
import { AnySignedIn } from '../access/access.decorators.js';
import { CurrentSession } from '../auth/session.guard.js';
import type { ActiveSession } from '../auth/sessions.service.js';
import { FeedbackReports } from './feedback-reports.service.js';

/**
 * docs/spec/14-quality-plan.md, Whole system, Monitoring: the feedback button
 * of every page. Sending a report is a change to the own account (edge cases,
 * "Who can act"; docs/spec-changes.md, 6 October 2026), so every signed-in
 * account may send one, the Principal included. The button exists inside the
 * layout only, which needs a complete session: no step of sign-in may be owed.
 */
@Controller('feedback')
export class FeedbackController {
  constructor(private readonly reports: FeedbackReports) {}

  @Post()
  @AnySignedIn()
  @ReturnsNothing()
  async send(
    @CurrentSession() session: ActiveSession,
    @ValidBody(feedbackReportSchema) body: FeedbackReport,
    @RequestId() requestId: string,
  ): Promise<void> {
    await this.reports.record(session, body, requestId);
  }
}
