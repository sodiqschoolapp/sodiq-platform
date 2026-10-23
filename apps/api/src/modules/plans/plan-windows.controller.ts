import { Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import {
  planWindowExtendSchema,
  planWindowParamsSchema,
  planWindowSaveSchema,
  planWindowsQuerySchema,
  planWindowsSchema,
  type PlanWindowExtend,
  type PlanWindowParams,
  type PlanWindows,
  type PlanWindowSave,
  type PlanWindowsQuery,
} from '@sodiq/shared';
import { RequestId } from '../../http/request-id.js';
import { Returns, ValidBody, ValidParams, ValidQuery } from '../../http/schemas.js';
import { Requires } from '../access/access.decorators.js';
import { CurrentAccess, type Access } from '../access/permission.guard.js';
import { PlanWindowsService } from './plan-windows.service.js';

/**
 * The plan window (task 7.2, pull request #215, decision 1, Look first): the
 * area `plan_windows`. Every reader of plans sees the windows; the Academic
 * Vice Principal (and the Super Admin) opens, moves and extends them.
 */
@Controller('plans/windows')
export class PlanWindowsController {
  constructor(private readonly windows: PlanWindowsService) {}

  @Get()
  @Requires('plan_windows', 'view')
  @Returns(planWindowsSchema)
  list(
    @CurrentAccess() access: Access,
    @ValidQuery(planWindowsQuerySchema) query: PlanWindowsQuery,
  ): Promise<PlanWindows> {
    return this.windows.list(access, query);
  }

  /** Opens the window of a quarter, or moves its dates. */
  @Put(':quarterId')
  @Requires('plan_windows', 'create')
  @Returns(planWindowsSchema)
  save(
    @CurrentAccess() access: Access,
    @ValidParams(planWindowParamsSchema) params: PlanWindowParams,
    @ValidBody(planWindowSaveSchema) input: PlanWindowSave,
    @RequestId() requestId: string,
  ): Promise<PlanWindows> {
    return this.windows.save(access, params.quarterId, input, requestId);
  }

  /** Extends the window for one teacher. */
  @Post(':quarterId/extensions')
  @HttpCode(200)
  @Requires('plan_windows', 'edit')
  @Returns(planWindowsSchema)
  extend(
    @CurrentAccess() access: Access,
    @ValidParams(planWindowParamsSchema) params: PlanWindowParams,
    @ValidBody(planWindowExtendSchema) input: PlanWindowExtend,
    @RequestId() requestId: string,
  ): Promise<PlanWindows> {
    return this.windows.extend(access, params.quarterId, input, requestId);
  }
}
