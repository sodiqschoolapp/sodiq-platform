import { Controller, Get, HttpCode, Patch, Post, Put } from '@nestjs/common';
import {
  planMasterCompareSchema,
  planMasterCreateSchema,
  planMasterItemCreateSchema,
  planMasterItemParamsSchema,
  planMasterItemSaveSchema,
  planMasterOrderSchema,
  planMasterParamsSchema,
  planMasterRenameSchema,
  planMasterRevisionSchema,
  planMasterSchema,
  planMastersQuerySchema,
  planMastersSchema,
  planMasterTakeSchema,
  planParallelQuerySchema,
  planParallelSchema,
  planParamsSchema,
  planMasterCompareQuerySchema,
  planSchema,
  type Plan,
  type PlanMaster,
  type PlanMasterCompare,
  type PlanMasterCreate,
  type PlanMasterItemCreate,
  type PlanMasterItemParams,
  type PlanMasterItemSave,
  type PlanMasterOrder,
  type PlanMasterParams,
  type PlanMasterRename,
  type PlanMasterRevision,
  type PlanMasters,
  type PlanMastersQuery,
  type PlanMasterTake,
  type PlanParallel,
  type PlanParallelQuery,
  type PlanParams,
  type PlanMasterCompareQuery,
} from '@sodiq/shared';
import { RequestId } from '../../http/request-id.js';
import { Returns, ValidBody, ValidParams, ValidQuery } from '../../http/schemas.js';
import { Requires } from '../access/access.decorators.js';
import { CurrentAccess, type Access } from '../access/permission.guard.js';
import { PlanMasterTakes } from './plan-master-takes.service.js';
import { PlanMastersService } from './plan-masters.service.js';

/**
 * Master plans (task 7.3, pull request #216, decision 2, Look first): the
 * area `plan_masters` for the masters themselves; the comparison, the take
 * and the keep of a plan's master and the parallel classes under `plans`.
 */
@Controller('plans')
export class PlanMastersController {
  constructor(
    private readonly masters: PlanMastersService,
    private readonly takes: PlanMasterTakes,
  ) {}

  @Get('masters')
  @Requires('plan_masters', 'view')
  @Returns(planMastersSchema)
  list(
    @CurrentAccess() access: Access,
    @ValidQuery(planMastersQuerySchema) query: PlanMastersQuery,
  ): Promise<PlanMasters> {
    return this.masters.list(access, query);
  }

  @Post('masters')
  @Requires('plan_masters', 'create')
  @Returns(planMasterSchema)
  create(
    @CurrentAccess() access: Access,
    @ValidBody(planMasterCreateSchema) input: PlanMasterCreate,
    @RequestId() requestId: string,
  ): Promise<PlanMaster> {
    return this.masters.create(access, input, requestId);
  }

  @Get('masters/:masterId')
  @Requires('plan_masters', 'view')
  @Returns(planMasterSchema)
  master(
    @CurrentAccess() access: Access,
    @ValidParams(planMasterParamsSchema) params: PlanMasterParams,
  ): Promise<PlanMaster> {
    return this.masters.master(access, params.masterId);
  }

  @Patch('masters/:masterId')
  @Requires('plan_masters', 'edit')
  @Returns(planMasterSchema)
  rename(
    @CurrentAccess() access: Access,
    @ValidParams(planMasterParamsSchema) params: PlanMasterParams,
    @ValidBody(planMasterRenameSchema) input: PlanMasterRename,
    @RequestId() requestId: string,
  ): Promise<PlanMaster> {
    return this.masters.rename(access, params.masterId, input, requestId);
  }

  @Post('masters/:masterId/archive')
  @HttpCode(200)
  @Requires('plan_masters', 'edit')
  @Returns(planMasterSchema)
  archive(
    @CurrentAccess() access: Access,
    @ValidParams(planMasterParamsSchema) params: PlanMasterParams,
    @ValidBody(planMasterRevisionSchema) input: PlanMasterRevision,
    @RequestId() requestId: string,
  ): Promise<PlanMaster> {
    return this.masters.archive(access, params.masterId, input, requestId);
  }

  @Post('masters/:masterId/restore')
  @HttpCode(200)
  @Requires('plan_masters', 'edit')
  @Returns(planMasterSchema)
  restore(
    @CurrentAccess() access: Access,
    @ValidParams(planMasterParamsSchema) params: PlanMasterParams,
    @ValidBody(planMasterRevisionSchema) input: PlanMasterRevision,
    @RequestId() requestId: string,
  ): Promise<PlanMaster> {
    return this.masters.restore(access, params.masterId, input, requestId);
  }

  @Post('masters/:masterId/items')
  @HttpCode(200)
  @Requires('plan_masters', 'edit')
  @Returns(planMasterSchema)
  createItem(
    @CurrentAccess() access: Access,
    @ValidParams(planMasterParamsSchema) params: PlanMasterParams,
    @ValidBody(planMasterItemCreateSchema) input: PlanMasterItemCreate,
    @RequestId() requestId: string,
  ): Promise<PlanMaster> {
    return this.masters.createItem(access, params.masterId, input, requestId);
  }

  @Put('masters/:masterId/items/:itemId')
  @Requires('plan_masters', 'edit')
  @Returns(planMasterSchema)
  saveItem(
    @CurrentAccess() access: Access,
    @ValidParams(planMasterItemParamsSchema) params: PlanMasterItemParams,
    @ValidBody(planMasterItemSaveSchema) input: PlanMasterItemSave,
    @RequestId() requestId: string,
  ): Promise<PlanMaster> {
    return this.masters.saveItem(access, params.masterId, params.itemId, input, requestId);
  }

  @Post('masters/:masterId/items/:itemId/remove')
  @HttpCode(200)
  @Requires('plan_masters', 'edit')
  @Returns(planMasterSchema)
  removeItem(
    @CurrentAccess() access: Access,
    @ValidParams(planMasterItemParamsSchema) params: PlanMasterItemParams,
    @ValidBody(planMasterRevisionSchema) input: PlanMasterRevision,
    @RequestId() requestId: string,
  ): Promise<PlanMaster> {
    return this.masters.removeItem(access, params.masterId, params.itemId, input, requestId);
  }

  @Put('masters/:masterId/order')
  @Requires('plan_masters', 'edit')
  @Returns(planMasterSchema)
  order(
    @CurrentAccess() access: Access,
    @ValidParams(planMasterParamsSchema) params: PlanMasterParams,
    @ValidBody(planMasterOrderSchema) input: PlanMasterOrder,
    @RequestId() requestId: string,
  ): Promise<PlanMaster> {
    return this.masters.order(access, params.masterId, input, requestId);
  }

  /** The "master updated" comparison of a plan (decision 5). */
  @Get('journals/:journalId/master-compare')
  @Requires('plans', 'view')
  @Returns(planMasterCompareSchema)
  compare(
    @CurrentAccess() access: Access,
    @ValidParams(planParamsSchema) params: PlanParams,
    @ValidQuery(planMasterCompareQuerySchema) query: PlanMasterCompareQuery,
  ): Promise<PlanMasterCompare> {
    return this.takes.compare(access, params.journalId, query.quarterId);
  }

  /** Takes the master's changes (decision 6). */
  @Post('journals/:journalId/master-take')
  @HttpCode(200)
  @Requires('plans', 'edit')
  @Returns(planSchema)
  take(
    @CurrentAccess() access: Access,
    @ValidParams(planParamsSchema) params: PlanParams,
    @ValidBody(planMasterTakeSchema) input: PlanMasterTake,
    @RequestId() requestId: string,
  ): Promise<Plan> {
    return this.takes.take(access, params.journalId, input, requestId);
  }

  /** Keeps the plan as it is after a master change (decision 6). */
  @Post('journals/:journalId/master-keep')
  @HttpCode(200)
  @Requires('plans', 'edit')
  @Returns(planSchema)
  keep(
    @CurrentAccess() access: Access,
    @ValidParams(planParamsSchema) params: PlanParams,
    @ValidBody(planMasterTakeSchema) input: PlanMasterTake,
    @RequestId() requestId: string,
  ): Promise<Plan> {
    return this.takes.keep(access, params.journalId, input, requestId);
  }

  /** The parallel classes of a grade (decision 13). */
  @Get('parallel')
  @Requires('plans', 'view')
  @Returns(planParallelSchema)
  parallel(
    @CurrentAccess() access: Access,
    @ValidQuery(planParallelQuerySchema) query: PlanParallelQuery,
  ): Promise<PlanParallel> {
    return this.takes.parallel(access, query);
  }
}
