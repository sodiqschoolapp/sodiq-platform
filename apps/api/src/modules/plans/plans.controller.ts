import { Controller, Delete, Get, Post, Put } from '@nestjs/common';
import {
  PLAN_FILE_TYPES,
  planFileParamsSchema,
  planFileSchema,
  planFileUploadQuerySchema,
  planCopySchema,
  planItemCreateSchema,
  planItemParamsSchema,
  planItemSaveSchema,
  planItemSchema,
  planLessonItemSchema,
  planLessonParamsSchema,
  planListQuerySchema,
  planListSchema,
  planParamsSchema,
  planQuerySchema,
  planSchema,
  planSeparateSchema,
  planShareSchema,
  type Plan,
  type PlanCopy,
  type PlanFile,
  type PlanFileParams,
  type PlanFileUploadQuery,
  type PlanItem,
  type PlanItemCreate,
  type PlanItemParams,
  type PlanItemSave,
  type PlanLessonItem,
  type PlanLessonParams,
  type PlanList,
  type PlanListQuery,
  type PlanParams,
  type PlanQuery,
  type PlanSeparate,
  type PlanShare,
} from '@sodiq/shared';
import { PLAN_FILE_ROUTE, type UploadedFile } from '../../http/file-routes.js';
import { RequestId } from '../../http/request-id.js';
import {
  Returns,
  ReturnsNothing,
  ValidBody,
  ValidFile,
  ValidParams,
  ValidQuery,
} from '../../http/schemas.js';
import { ReturnsStoredFile, type StoredFile } from '../../http/stored-file.js';
import { Requires } from '../access/access.decorators.js';
import { CurrentAccess, type Access } from '../access/permission.guard.js';
import { PlanFiles } from './plan-files.service.js';
import { PlanSharing } from './plan-sharing.service.js';
import { PlansService } from './plans.service.js';

/**
 * Lesson plans (task 7.1a, pull request #212, decision 2, Look first): the
 * area `plans`. The route decides the scope of every request
 * (`plan-scope.ts`): every plan of the branch for the Super Admin, the
 * Principal and the Academic Vice Principal, own subjects for the Head
 * Teachers, own plans and the subject and grade of the profile for the
 * Teacher, 403 `plan_scope` otherwise; only the owner writes.
 */
@Controller('plans')
export class PlansController {
  constructor(
    private readonly plans: PlansService,
    private readonly files: PlanFiles,
    private readonly sharing: PlanSharing,
  ) {}

  @Get()
  @Requires('plans', 'view')
  @Returns(planListSchema)
  list(
    @CurrentAccess() access: Access,
    @ValidQuery(planListQuerySchema) query: PlanListQuery,
  ): Promise<PlanList> {
    return this.plans.list(access, query);
  }

  @Get('journals/:journalId')
  @Requires('plans', 'view')
  @Returns(planSchema)
  plan(
    @CurrentAccess() access: Access,
    @ValidParams(planParamsSchema) params: PlanParams,
    @ValidQuery(planQuerySchema) query: PlanQuery,
  ): Promise<Plan> {
    return this.plans.plan(access, params.journalId, query);
  }

  /** Task 7.1b: the item of one lesson, for a reader of its plan or the lesson's substitute. */
  @Get('lessons/:lessonId')
  @Requires('plans', 'view')
  @Returns(planLessonItemSchema)
  lessonItem(
    @CurrentAccess() access: Access,
    @ValidParams(planLessonParamsSchema) params: PlanLessonParams,
  ): Promise<PlanLessonItem> {
    return this.plans.lessonItem(access, params.lessonId);
  }

  @Post('journals/:journalId/items')
  @Requires('plans', 'edit')
  @Returns(planItemSchema, 201)
  createItem(
    @CurrentAccess() access: Access,
    @ValidParams(planParamsSchema) params: PlanParams,
    @ValidBody(planItemCreateSchema) input: PlanItemCreate,
    @RequestId() requestId: string,
  ): Promise<PlanItem> {
    return this.plans.createItem(access, params.journalId, input, requestId);
  }

  /** Task 7.1c: another journal of the owner joins this journal's plan. */
  @Post('journals/:journalId/share')
  @Requires('plans', 'edit')
  @Returns(planSchema)
  share(
    @CurrentAccess() access: Access,
    @ValidParams(planParamsSchema) params: PlanParams,
    @ValidBody(planShareSchema) input: PlanShare,
    @RequestId() requestId: string,
  ): Promise<Plan> {
    return this.sharing.share(access, params.journalId, input, requestId);
  }

  /** Task 7.1c: the journal leaves its shared plan with a copy of the items. */
  @Post('journals/:journalId/separate')
  @Requires('plans', 'edit')
  @Returns(planSchema)
  separate(
    @CurrentAccess() access: Access,
    @ValidParams(planParamsSchema) params: PlanParams,
    @ValidBody(planSeparateSchema) input: PlanSeparate,
    @RequestId() requestId: string,
  ): Promise<Plan> {
    return this.sharing.separate(access, params.journalId, input, requestId);
  }

  /** Task 7.1c: the items of another plan copied into this empty plan. */
  @Post('journals/:journalId/copy')
  @Requires('plans', 'edit')
  @Returns(planSchema)
  copy(
    @CurrentAccess() access: Access,
    @ValidParams(planParamsSchema) params: PlanParams,
    @ValidBody(planCopySchema) input: PlanCopy,
    @RequestId() requestId: string,
  ): Promise<Plan> {
    return this.sharing.copy(access, params.journalId, input, requestId);
  }

  @Put('items/:itemId')
  @Requires('plans', 'edit')
  @Returns(planItemSchema)
  saveItem(
    @CurrentAccess() access: Access,
    @ValidParams(planItemParamsSchema) params: PlanItemParams,
    @ValidBody(planItemSaveSchema) input: PlanItemSave,
    @RequestId() requestId: string,
  ): Promise<PlanItem> {
    return this.plans.saveItem(access, params.itemId, input, requestId);
  }

  @Post('items/:itemId/clear')
  @Requires('plans', 'edit')
  @ReturnsNothing()
  clearItem(
    @CurrentAccess() access: Access,
    @ValidParams(planItemParamsSchema) params: PlanItemParams,
    @RequestId() requestId: string,
  ): Promise<void> {
    return this.plans.clearItem(access, params.itemId, requestId);
  }

  @Put('items/:itemId/files')
  @Requires('plans', 'edit')
  @Returns(planFileSchema)
  addFile(
    @CurrentAccess() access: Access,
    @ValidParams(planItemParamsSchema) params: PlanItemParams,
    @ValidQuery(planFileUploadQuerySchema) query: PlanFileUploadQuery,
    @ValidFile(PLAN_FILE_ROUTE) file: UploadedFile | null,
    @RequestId() requestId: string,
  ): Promise<PlanFile> {
    return this.files.add(access, params.itemId, query.name, file, requestId);
  }

  @Delete('files/:fileId')
  @Requires('plans', 'edit')
  @ReturnsNothing()
  removeFile(
    @CurrentAccess() access: Access,
    @ValidParams(planFileParamsSchema) params: PlanFileParams,
    @RequestId() requestId: string,
  ): Promise<void> {
    return this.files.remove(access, params.fileId, requestId);
  }

  @Get('files/:fileId')
  @Requires('plans', 'view')
  @ReturnsStoredFile(PLAN_FILE_TYPES)
  readFile(
    @CurrentAccess() access: Access,
    @ValidParams(planFileParamsSchema) params: PlanFileParams,
  ): Promise<StoredFile> {
    return this.files.read(access, params.fileId);
  }
}
