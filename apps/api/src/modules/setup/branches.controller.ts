import { Controller, Get, Post, Put } from '@nestjs/common';
import { branchRecordSchema, branchSchema, type Branch, type BranchRecord } from '@sodiq/shared';
import { RequestId } from '../../http/request-id.js';
import { Returns, ValidBody } from '../../http/schemas.js';
import { Requires } from '../access/access.decorators.js';
import { CurrentAccess, type Access } from '../access/permission.guard.js';
import { Branches } from './branches.service.js';

/** The branch of the request, which a route bound to a branch always has. */
function branchOf(access: Access): string {
  if (access.branchId === null) {
    throw new Error('The route is bound to the branch of the request.');
  }
  return access.branchId;
}

/**
 * The record of a branch (docs/spec/03-school-setup.md, Branch; task 1.1).
 * Creating one is school-wide work: the branch does not exist yet, so no
 * header names it. Reading and editing act on the branch of the request.
 */
@Controller('setup')
export class BranchesController {
  constructor(private readonly branches: Branches) {}

  @Post('branches')
  @Requires('branches', 'create', { branch: 'none' })
  @Returns(branchSchema, 201)
  create(
    @CurrentAccess() access: Access,
    @ValidBody(branchRecordSchema) record: BranchRecord,
    @RequestId() requestId: string,
  ): Promise<Branch> {
    return this.branches.create(access, record, requestId);
  }

  @Get('branch')
  @Requires('branches', 'view')
  @Returns(branchSchema)
  read(@CurrentAccess() access: Access): Promise<Branch> {
    return this.branches.read(access, branchOf(access));
  }

  @Put('branch')
  @Requires('branches', 'edit')
  @Returns(branchSchema)
  edit(
    @CurrentAccess() access: Access,
    @ValidBody(branchRecordSchema) record: BranchRecord,
    @RequestId() requestId: string,
  ): Promise<Branch> {
    return this.branches.edit(access, branchOf(access), record, requestId);
  }
}
