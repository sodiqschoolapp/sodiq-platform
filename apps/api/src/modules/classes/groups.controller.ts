import { Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import {
  groupCreateSchema,
  groupDetailSchema,
  groupEditSchema,
  groupExportSchema,
  groupListSchema,
  groupParamsSchema,
  groupSlotCheckSchema,
  groupSlotQuerySchema,
  type GroupCreate,
  type GroupDetail,
  type GroupEdit,
  type GroupExport,
  type GroupList,
  type GroupParams,
  type GroupSlotCheck,
  type GroupSlotQuery,
} from '@sodiq/shared';
import { RequestId } from '../../http/request-id.js';
import { Returns, ReturnsFile, ValidBody, ValidParams, ValidQuery } from '../../http/schemas.js';
import type { XlsxFile } from '../../http/xlsx.js';
import { Requires } from '../access/access.decorators.js';
import { CurrentAccess, type Access } from '../access/permission.guard.js';
import { Groups } from './groups.service.js';

/**
 * Groups and splits (docs/spec/05-classes-groups-subjects.md, Group; task
 * 3.2a, pull request #91). The area `groups` (decision 2): the Super Admin and
 * the Academic Vice Principal change groups; the readers of `02` view, each in
 * the scope the route decides (`group-scope.ts`). Every route works for the
 * branch of the request.
 */
@Controller('groups')
export class GroupsController {
  constructor(private readonly groups: Groups) {}

  @Get()
  @Requires('groups', 'view')
  @Returns(groupListSchema)
  list(@CurrentAccess() access: Access): Promise<GroupList> {
    return this.groups.list(access);
  }

  /**
   * The lesson slots two grades share, for the form before a save
   * (decision 9). Under `create`: the roles that create are the roles that
   * edit. Declared before `:id`, which would take it otherwise.
   */
  @Get('slot-check')
  @Requires('groups', 'create')
  @Returns(groupSlotCheckSchema)
  slotCheck(
    @CurrentAccess() access: Access,
    @ValidQuery(groupSlotQuerySchema) query: GroupSlotQuery,
  ): Promise<GroupSlotCheck> {
    return this.groups.slotCheck(access, query.classIds);
  }

  /** The Excel file of the list. */
  @Post('export')
  @Requires('groups', 'export')
  @ReturnsFile()
  export(
    @CurrentAccess() access: Access,
    @ValidBody(groupExportSchema) request: GroupExport,
    @RequestId() requestId: string,
  ): Promise<XlsxFile> {
    return this.groups.export(access, request, requestId);
  }

  @Post()
  @Requires('groups', 'create')
  @Returns(groupDetailSchema, 201)
  create(
    @CurrentAccess() access: Access,
    @ValidBody(groupCreateSchema) input: GroupCreate,
    @RequestId() requestId: string,
  ): Promise<GroupDetail> {
    return this.groups.create(access, input, requestId);
  }

  @Get(':id')
  @Requires('groups', 'view')
  @Returns(groupDetailSchema)
  detail(
    @CurrentAccess() access: Access,
    @ValidParams(groupParamsSchema) params: GroupParams,
  ): Promise<GroupDetail> {
    return this.groups.detail(access, params.id);
  }

  @Put(':id')
  @Requires('groups', 'edit')
  @Returns(groupDetailSchema)
  edit(
    @CurrentAccess() access: Access,
    @ValidParams(groupParamsSchema) params: GroupParams,
    @ValidBody(groupEditSchema) input: GroupEdit,
    @RequestId() requestId: string,
  ): Promise<GroupDetail> {
    return this.groups.edit(access, params.id, input, requestId);
  }

  @Post(':id/archive')
  @HttpCode(200)
  @Requires('groups', 'archive')
  @Returns(groupDetailSchema)
  archive(
    @CurrentAccess() access: Access,
    @ValidParams(groupParamsSchema) params: GroupParams,
    @RequestId() requestId: string,
  ): Promise<GroupDetail> {
    return this.groups.archive(access, params.id, requestId);
  }

  @Post(':id/restore')
  @HttpCode(200)
  @Requires('groups', 'archive')
  @Returns(groupDetailSchema)
  restore(
    @CurrentAccess() access: Access,
    @ValidParams(groupParamsSchema) params: GroupParams,
    @RequestId() requestId: string,
  ): Promise<GroupDetail> {
    return this.groups.restore(access, params.id, requestId);
  }
}
