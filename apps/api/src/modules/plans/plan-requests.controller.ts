import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import {
  planEventDecidedSchema,
  planEventDecisionSchema,
  planParamsSchema,
  planPreparedDecisionSchema,
  planPreparedSendSchema,
  planRequestCreateSchema,
  planRequestDecisionSchema,
  planRequestParamsSchema,
  planRequestSchema,
  planRequestSendSchema,
  planRequestsQuerySchema,
  planRequestsSchema,
  type PlanEventDecided,
  type PlanEventDecision,
  type PlanParams,
  type PlanPreparedDecision,
  type PlanPreparedSend,
  type PlanRequest,
  type PlanRequestCreate,
  type PlanRequestDecision,
  type PlanRequestParams,
  type PlanRequests,
  type PlanRequestSend,
  type PlanRequestsQuery,
} from '@sodiq/shared';
import { RequestId } from '../../http/request-id.js';
import { Returns, ValidBody, ValidParams, ValidQuery } from '../../http/schemas.js';
import { Requires } from '../access/access.decorators.js';
import { CurrentAccess, type Access } from '../access/permission.guard.js';
import { PlanRequestsService } from './plan-requests.service.js';

/**
 * Plan edit requests (task 7.2, pull request #215, decision 1, Look first):
 * the area `plan_requests`. `create` is the plan's owner's (send, finish);
 * `edit` decides, routed by the posts in force (`plan-request-routing.ts`),
 * never the reader's own.
 */
@Controller('plans')
export class PlanRequestsController {
  constructor(private readonly requests: PlanRequestsService) {}

  @Get('requests')
  @Requires('plan_requests', 'view')
  @Returns(planRequestsSchema)
  list(
    @CurrentAccess() access: Access,
    @ValidQuery(planRequestsQuerySchema) query: PlanRequestsQuery,
  ): Promise<PlanRequests> {
    return this.requests.list(access, query);
  }

  /** `09`: "The teacher sends an edit request: which lessons, and the reason." */
  @Post('journals/:journalId/requests')
  @Requires('plan_requests', 'create')
  @Returns(planRequestSchema, 201)
  create(
    @CurrentAccess() access: Access,
    @ValidParams(planParamsSchema) params: PlanParams,
    @ValidBody(planRequestCreateSchema) input: PlanRequestCreate,
    @RequestId() requestId: string,
  ): Promise<PlanRequest> {
    return this.requests.create(access, params.journalId, input, requestId);
  }

  /** The request of the window's end, stored and sent by the owner. */
  @Post('journals/:journalId/requests/prepared')
  @HttpCode(200)
  @Requires('plan_requests', 'create')
  @Returns(planRequestSchema)
  sendPrepared(
    @CurrentAccess() access: Access,
    @ValidParams(planParamsSchema) params: PlanParams,
    @ValidBody(planPreparedSendSchema) input: PlanPreparedSend,
    @RequestId() requestId: string,
  ): Promise<PlanRequest> {
    return this.requests.sendPrepared(access, params.journalId, input, requestId);
  }

  /** The same request stored and decided by an approver ("can approve it without waiting"). */
  @Post('journals/:journalId/requests/prepared/decide')
  @HttpCode(200)
  @Requires('plan_requests', 'edit')
  @Returns(planRequestSchema)
  decidePrepared(
    @CurrentAccess() access: Access,
    @ValidParams(planParamsSchema) params: PlanParams,
    @ValidBody(planPreparedDecisionSchema) input: PlanPreparedDecision,
    @RequestId() requestId: string,
  ): Promise<PlanRequest> {
    return this.requests.decidePrepared(access, params.journalId, input, requestId);
  }

  /** "The teacher only sends it": a request the system prepared. */
  @Post('requests/:requestId/send')
  @HttpCode(200)
  @Requires('plan_requests', 'create')
  @Returns(planRequestSchema)
  send(
    @CurrentAccess() access: Access,
    @ValidParams(planRequestParamsSchema) params: PlanRequestParams,
    @ValidBody(planRequestSendSchema) input: PlanRequestSend,
    @RequestId() requestId: string,
  ): Promise<PlanRequest> {
    return this.requests.send(access, params.requestId, input, requestId);
  }

  /** Approve with a number of school days, or refuse with a reason. */
  @Post('requests/:requestId/decide')
  @HttpCode(200)
  @Requires('plan_requests', 'edit')
  @Returns(planRequestSchema)
  decide(
    @CurrentAccess() access: Access,
    @ValidParams(planRequestParamsSchema) params: PlanRequestParams,
    @ValidBody(planRequestDecisionSchema) input: PlanRequestDecision,
    @RequestId() requestId: string,
  ): Promise<PlanRequest> {
    return this.requests.decide(access, params.requestId, input, requestId);
  }

  /** `09`, Approving together: every waiting request of one event, by subject if chosen. */
  @Post('requests/decide-event')
  @HttpCode(200)
  @Requires('plan_requests', 'edit')
  @Returns(planEventDecidedSchema)
  decideEvent(
    @CurrentAccess() access: Access,
    @ValidBody(planEventDecisionSchema) input: PlanEventDecision,
    @RequestId() requestId: string,
  ): Promise<PlanEventDecided> {
    return this.requests.decideEvent(access, input, requestId);
  }

  /** `edge`: "The teacher can press \"finished\" to lock early." */
  @Post('requests/:requestId/finish')
  @HttpCode(200)
  @Requires('plan_requests', 'create')
  @Returns(planRequestSchema)
  finish(
    @CurrentAccess() access: Access,
    @ValidParams(planRequestParamsSchema) params: PlanRequestParams,
    @RequestId() requestId: string,
  ): Promise<PlanRequest> {
    return this.requests.finish(access, params.requestId, requestId);
  }
}
