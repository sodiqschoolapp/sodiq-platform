import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import {
  branchMoveAcceptSchema,
  branchMoveCancelSchema,
  branchMoveDeclineSchema,
  branchMoveGroupsQuerySchema,
  branchMoveGroupsSchema,
  branchMoveParamsSchema,
  branchMoveReleaseSchema,
  branchMoveTargetsSchema,
  incomingBranchMovesSchema,
  studentDetailSchema,
  studentParamsSchema,
  type BranchMoveAccept,
  type BranchMoveCancel,
  type BranchMoveDecline,
  type BranchMoveGroups,
  type BranchMoveGroupsQuery,
  type BranchMoveParams,
  type BranchMoveRelease,
  type BranchMoveTargets,
  type IncomingBranchMoves,
  type StudentDetail,
  type StudentParams,
} from '@sodiq/shared';
import { RequestId } from '../../http/request-id.js';
import { Returns, ValidBody, ValidParams, ValidQuery } from '../../http/schemas.js';
import { Requires } from '../access/access.decorators.js';
import { CurrentAccess, type Access } from '../access/permission.guard.js';
import { BranchMoves } from './branch-moves.service.js';

/**
 * The move of a student to another branch (`edge/students-classes-groups`,
 * "A student moves to another branch"; task 3.3c, pull request #97):
 * `branch_moves` `edit` for the Super Admin and the Academic Vice Principal,
 * `view` for them and the Principal (decision 8 as changed by correction 3).
 * The release and its cancel work for the sending branch, the incoming list,
 * the groups offered, the accept and the decline for the receiving one, each
 * the branch of the request.
 */
@Controller('people')
export class BranchMovesController {
  constructor(private readonly moves: BranchMoves) {}

  @Post('students/:id/branch-move')
  @HttpCode(200)
  @Requires('branch_moves', 'edit')
  @Returns(studentDetailSchema)
  release(
    @CurrentAccess() access: Access,
    @ValidParams(studentParamsSchema) params: StudentParams,
    @ValidBody(branchMoveReleaseSchema) input: BranchMoveRelease,
    @RequestId() requestId: string,
  ): Promise<StudentDetail> {
    return this.moves.release(access, params.id, input, requestId);
  }

  @Post('branch-moves/:id/cancel')
  @HttpCode(200)
  @Requires('branch_moves', 'edit')
  @Returns(studentDetailSchema)
  cancel(
    @CurrentAccess() access: Access,
    @ValidParams(branchMoveParamsSchema) params: BranchMoveParams,
    // An empty body: the release is named by the path.
    @ValidBody(branchMoveCancelSchema) _input: BranchMoveCancel,
    @RequestId() requestId: string,
  ): Promise<StudentDetail> {
    return this.moves.cancel(access, params.id, requestId);
  }

  @Get('branch-moves/targets')
  @Requires('branch_moves', 'edit')
  @Returns(branchMoveTargetsSchema)
  targets(@CurrentAccess() access: Access): Promise<BranchMoveTargets> {
    return this.moves.targets(access);
  }

  @Get('branch-moves/incoming')
  @Requires('branch_moves', 'view')
  @Returns(incomingBranchMovesSchema)
  incoming(@CurrentAccess() access: Access): Promise<IncomingBranchMoves> {
    return this.moves.incoming(access);
  }

  @Get('branch-moves/:id/groups')
  @Requires('branch_moves', 'view')
  @Returns(branchMoveGroupsSchema)
  groups(
    @CurrentAccess() access: Access,
    @ValidParams(branchMoveParamsSchema) params: BranchMoveParams,
    @ValidQuery(branchMoveGroupsQuerySchema) query: BranchMoveGroupsQuery,
  ): Promise<BranchMoveGroups> {
    return this.moves.groups(access, params.id, query.classId);
  }

  @Post('branch-moves/:id/accept')
  @HttpCode(200)
  @Requires('branch_moves', 'edit')
  @Returns(studentDetailSchema)
  accept(
    @CurrentAccess() access: Access,
    @ValidParams(branchMoveParamsSchema) params: BranchMoveParams,
    @ValidBody(branchMoveAcceptSchema) input: BranchMoveAccept,
    @RequestId() requestId: string,
  ): Promise<StudentDetail> {
    return this.moves.accept(access, params.id, input, requestId);
  }

  @Post('branch-moves/:id/decline')
  @HttpCode(200)
  @Requires('branch_moves', 'edit')
  @Returns(incomingBranchMovesSchema)
  decline(
    @CurrentAccess() access: Access,
    @ValidParams(branchMoveParamsSchema) params: BranchMoveParams,
    @ValidBody(branchMoveDeclineSchema) input: BranchMoveDecline,
    @RequestId() requestId: string,
  ): Promise<IncomingBranchMoves> {
    return this.moves.decline(access, params.id, input, requestId);
  }
}
