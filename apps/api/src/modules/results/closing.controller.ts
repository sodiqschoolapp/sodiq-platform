import { Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import {
  closingChecklistSchema,
  closingCloseInputSchema,
  closingClosedSchema,
  closingDecisionInputSchema,
  closingDecisionSchema,
  closingJournalDecisionInputSchema,
  closingJournalDecisionSchema,
  closingJournalParamsSchema,
  closingPeriodsEndedSchema,
  closingQuarterParamsSchema,
  closingQuerySchema,
  closingRemindedSchema,
  type ClosingChecklist,
  type ClosingClosed,
  type ClosingCloseInput,
  type ClosingDecisionAnswer,
  type ClosingDecisionInput,
  type ClosingJournalDecision,
  type ClosingJournalDecisionInput,
  type ClosingQuery,
} from '@sodiq/shared';
import { RequestId } from '../../http/request-id.js';
import { RequestKey, Returns, ValidBody, ValidParams, ValidQuery } from '../../http/schemas.js';
import { Requires } from '../access/access.decorators.js';
import { CurrentAccess, type Access } from '../access/permission.guard.js';
import { ClosingService } from './closing.service.js';

/**
 * The closing checklist of a quarter (task 9.2a, pull request #229; `07`,
 * Closing a quarter). The area `quarter_closing` (decision 2, Look first):
 * the Super Admin, the Principal and the Academic Vice Principal read it; the
 * Super Admin and the Academic Vice Principal decide flagged results, end the
 * open plan periods, send the reminders and close the quarter (task 9.2b).
 */
@Controller('results/closing')
export class ClosingController {
  constructor(private readonly closing: ClosingService) {}

  @Get()
  @Requires('quarter_closing', 'view')
  @Returns(closingChecklistSchema)
  checklist(
    @CurrentAccess() access: Access,
    @ValidQuery(closingQuerySchema) query: ClosingQuery,
  ): Promise<ClosingChecklist> {
    return this.closing.checklist(access, query);
  }

  @Put(':quarterId/decisions')
  @Requires('quarter_closing', 'edit')
  @Returns(closingDecisionSchema)
  decide(
    @CurrentAccess() access: Access,
    @ValidParams(closingQuarterParamsSchema) params: { quarterId: string },
    @ValidBody(closingDecisionInputSchema) input: ClosingDecisionInput,
    @RequestId() requestId: string,
  ): Promise<ClosingDecisionAnswer> {
    return this.closing.decide(access, params.quarterId, input, requestId);
  }

  /** `edge/calculation`: "Decisions can be made for a whole journal at once." */
  @Post(':quarterId/journals/:journalId/decisions')
  @HttpCode(200)
  @Requires('quarter_closing', 'edit')
  @Returns(closingJournalDecisionSchema)
  decideJournal(
    @CurrentAccess() access: Access,
    @ValidParams(closingJournalParamsSchema) params: { quarterId: string; journalId: string },
    @ValidBody(closingJournalDecisionInputSchema) input: ClosingJournalDecisionInput,
    @RequestId() requestId: string,
  ): Promise<ClosingJournalDecision> {
    return this.closing.decideJournal(access, params.quarterId, params.journalId, input, requestId);
  }

  /** `edge/lesson-plans`: "the Academic Vice Principal can end them all from the checklist". */
  @Post(':quarterId/plan-periods/end')
  @HttpCode(200)
  @Requires('quarter_closing', 'edit')
  @Returns(closingPeriodsEndedSchema)
  endPlanPeriods(
    @CurrentAccess() access: Access,
    @ValidParams(closingQuarterParamsSchema) params: { quarterId: string },
    @RequestId() requestId: string,
  ): Promise<{ ended: number }> {
    return this.closing.endPlanPeriods(access, params.quarterId, requestId);
  }

  /**
   * `07`, Closing a quarter: "a 'remind' button that sends the list to the
   * teachers concerned" (review decision 3): the spec asks this notice on request.
   */
  @Post(':quarterId/remind')
  @HttpCode(200)
  @Requires('quarter_closing', 'edit')
  @Returns(closingRemindedSchema)
  remind(
    @CurrentAccess() access: Access,
    @ValidParams(closingQuarterParamsSchema) params: { quarterId: string },
    @RequestKey() key: string,
  ): Promise<{ sent: number }> {
    return this.closing.remind(access, params.quarterId, key);
  }

  /**
   * `07`, Closing a quarter: "With no blocking item left, the quarter can be closed. Warnings
   * must be acknowledged"; "The whole branch is closed in one step" (task 9.2b). Repeat-safe:
   * `edge/developer-rules`, "Publish, close and every offline entry carry a key".
   */
  @Post(':quarterId/close')
  @HttpCode(200)
  @Requires('quarter_closing', 'edit')
  @Returns(closingClosedSchema)
  close(
    @CurrentAccess() access: Access,
    @ValidParams(closingQuarterParamsSchema) params: { quarterId: string },
    @ValidBody(closingCloseInputSchema) input: ClosingCloseInput,
    @RequestKey() key: string,
    @RequestId() requestId: string,
  ): Promise<ClosingClosed> {
    return this.closing.close(access, params.quarterId, input, key, requestId);
  }
}
