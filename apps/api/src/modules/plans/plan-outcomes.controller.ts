import { Controller, HttpCode, Post } from '@nestjs/common';
import {
  planCarrySchema,
  planDropSchema,
  planMergeSchema,
  planOutcomeParamsSchema,
  planPlaceSchema,
  planSchema,
  type Plan,
  type PlanCarry,
  type PlanDrop,
  type PlanMerge,
  type PlanOutcomeParams,
  type PlanPlace,
} from '@sodiq/shared';
import { RequestId } from '../../http/request-id.js';
import { Returns, ValidBody, ValidParams } from '../../http/schemas.js';
import { Requires } from '../access/access.decorators.js';
import { CurrentAccess, type Access } from '../access/permission.guard.js';
import { PlanOutcomesService } from './plan-outcomes.service.js';

/**
 * The outcomes of "not covered" items and the "carried in" tray (task 9.2d, pull request #233).
 * Merge, carry and place are plan writes of the owner (`plans` `edit`); the drop is the
 * approver's (`plan_requests` `edit`, decision 3: the reach over the owner's requests).
 */
@Controller('plans')
export class PlanOutcomesController {
  constructor(private readonly outcomes: PlanOutcomesService) {}

  @Post('journals/:journalId/not-covered/:itemId/merge')
  @HttpCode(200)
  @Requires('plans', 'edit')
  @Returns(planSchema)
  merge(
    @CurrentAccess() access: Access,
    @ValidParams(planOutcomeParamsSchema) params: PlanOutcomeParams,
    @ValidBody(planMergeSchema) input: PlanMerge,
    @RequestId() requestId: string,
  ): Promise<Plan> {
    return this.outcomes.merge(access, params.journalId, params.itemId, input, requestId);
  }

  @Post('journals/:journalId/not-covered/:itemId/carry')
  @HttpCode(200)
  @Requires('plans', 'edit')
  @Returns(planSchema)
  carry(
    @CurrentAccess() access: Access,
    @ValidParams(planOutcomeParamsSchema) params: PlanOutcomeParams,
    @ValidBody(planCarrySchema) input: PlanCarry,
    @RequestId() requestId: string,
  ): Promise<Plan> {
    return this.outcomes.carry(access, params.journalId, params.itemId, input, requestId);
  }

  @Post('journals/:journalId/not-covered/:itemId/drop')
  @HttpCode(200)
  @Requires('plan_requests', 'edit')
  @Returns(planSchema)
  drop(
    @CurrentAccess() access: Access,
    @ValidParams(planOutcomeParamsSchema) params: PlanOutcomeParams,
    @ValidBody(planDropSchema) input: PlanDrop,
    @RequestId() requestId: string,
  ): Promise<Plan> {
    return this.outcomes.drop(access, params.journalId, params.itemId, input, requestId);
  }

  @Post('journals/:journalId/carried/:itemId/place')
  @HttpCode(200)
  @Requires('plans', 'edit')
  @Returns(planSchema)
  place(
    @CurrentAccess() access: Access,
    @ValidParams(planOutcomeParamsSchema) params: PlanOutcomeParams,
    @ValidBody(planPlaceSchema) input: PlanPlace,
    @RequestId() requestId: string,
  ): Promise<Plan> {
    return this.outcomes.place(access, params.journalId, params.itemId, input, requestId);
  }
}
