import { Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import {
  automaticPlacementResultSchema,
  automaticPlacementSchema,
  groupMemberParamsSchema,
  groupMembersSchema,
  groupPlacementBoardSchema,
  groupPlacementQuerySchema,
  groupPlacementSchema,
  type AutomaticPlacement,
  type AutomaticPlacementResult,
  type GroupMemberParams,
  type GroupMembers as GroupMembersAnswer,
  type GroupPlacement,
  type GroupPlacementBoard,
  type GroupPlacementQuery,
  groupCreateSchema,
  groupDetailSchema,
  groupEditSchema,
  groupExportSchema,
  groupListSchema,
  groupParamsSchema,
  groupRestoreSchema,
  groupSlotCheckSchema,
  groupSlotQuerySchema,
  type GroupCreate,
  type GroupDetail,
  type GroupEdit,
  type GroupExport,
  type GroupList,
  type GroupParams,
  type GroupRestore,
  type GroupSlotCheck,
  type GroupSlotQuery,
} from '@sodiq/shared';
import { RequestId } from '../../http/request-id.js';
import { Returns, ReturnsFile, ValidBody, ValidParams, ValidQuery } from '../../http/schemas.js';
import type { XlsxFile } from '../../http/xlsx.js';
import { Requires } from '../access/access.decorators.js';
import { CurrentAccess, type Access } from '../access/permission.guard.js';
import { GroupMembers } from './group-members.service.js';
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
  constructor(
    private readonly groups: Groups,
    private readonly members: GroupMembers,
  ) {}

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

  /**
   * The bulk placement screen (task 3.2b, decision 14): the groups of one
   * subject and one grade or pair of grades, and the students not yet placed.
   * Under `edit`: a tool of the roles that place (decision 6). Declared
   * before `:id`, which would take it otherwise.
   */
  @Get('placement')
  @Requires('groups', 'edit')
  @Returns(groupPlacementBoardSchema)
  placementBoard(
    @CurrentAccess() access: Access,
    @ValidQuery(groupPlacementQuerySchema) query: GroupPlacementQuery,
  ): Promise<GroupPlacementBoard> {
    return this.members.board(access, query);
  }

  /** "Place automatically" (task 3.2b): the students not yet placed into the smallest suitable group. */
  @Post('placement/automatic')
  @Requires('groups', 'edit')
  @Returns(automaticPlacementResultSchema, 201)
  placeAutomatically(
    @CurrentAccess() access: Access,
    @ValidBody(automaticPlacementSchema) input: AutomaticPlacement,
    @RequestId() requestId: string,
  ): Promise<AutomaticPlacementResult> {
    return this.members.automatic(access, input, requestId);
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
    @ValidBody(groupRestoreSchema) input: GroupRestore,
    @RequestId() requestId: string,
  ): Promise<GroupDetail> {
    return this.groups.restore(access, params.id, input, requestId);
  }

  /** The Students tab of a group (task 3.2b); a Tutor reads the members of own classes (decision 4). */
  @Get(':id/members')
  @Requires('groups', 'view')
  @Returns(groupMembersSchema)
  groupMembers(
    @CurrentAccess() access: Access,
    @ValidParams(groupParamsSchema) params: GroupParams,
  ): Promise<GroupMembersAnswer> {
    return this.members.members(access, params.id);
  }

  /** "Put into a group" from a date, all or none (task 3.2b). */
  @Post(':id/members')
  @Requires('groups', 'edit')
  @Returns(groupMembersSchema, 201)
  place(
    @CurrentAccess() access: Access,
    @ValidParams(groupParamsSchema) params: GroupParams,
    @ValidBody(groupPlacementSchema) input: GroupPlacement,
    @RequestId() requestId: string,
  ): Promise<GroupMembersAnswer> {
    return this.members.place(access, params.id, input, requestId);
  }

  /** The withdraw of a planned group placement (task 3.2b). */
  @Post(':id/members/:memberId/withdraw')
  @HttpCode(200)
  @Requires('groups', 'edit')
  @Returns(groupMembersSchema)
  withdraw(
    @CurrentAccess() access: Access,
    @ValidParams(groupMemberParamsSchema) params: GroupMemberParams,
    @RequestId() requestId: string,
  ): Promise<GroupMembersAnswer> {
    return this.members.withdraw(access, params.id, params.memberId, requestId);
  }

  /** "Mark reviewed": the tag of an automatic placement goes (task 3.2b, decision 3). */
  @Post(':id/members/:memberId/reviewed')
  @HttpCode(200)
  @Requires('groups', 'edit')
  @Returns(groupMembersSchema)
  reviewed(
    @CurrentAccess() access: Access,
    @ValidParams(groupMemberParamsSchema) params: GroupMemberParams,
    @RequestId() requestId: string,
  ): Promise<GroupMembersAnswer> {
    return this.members.reviewed(access, params.id, params.memberId, requestId);
  }
}
