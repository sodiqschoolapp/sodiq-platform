import { Controller, Get } from '@nestjs/common';
import {
  branchSummaryQuerySchema,
  branchSummarySchema,
  type BranchSummary,
  type BranchSummaryQuery,
} from '@sodiq/shared';
import { Returns, ValidQuery } from '../../http/schemas.js';
import { Requires } from '../access/access.decorators.js';
import { CurrentAccess, type Access } from '../access/permission.guard.js';
import { BranchSummaryService } from './branch-summary.service.js';

/**
 * The branch summary of the home page (task 9.4b; `08`, Home pages by role, Principal and Super
 * Admin), area `branch_summary` (plan decision 1, Look first). The branch of the request; counts
 * and means only. A read writes no audit entry.
 */
@Controller('results/branch-summary')
export class BranchSummaryController {
  constructor(private readonly summary: BranchSummaryService) {}

  @Get()
  @Requires('branch_summary', 'view')
  @Returns(branchSummarySchema)
  read(
    @ValidQuery(branchSummaryQuerySchema) query: BranchSummaryQuery,
    @CurrentAccess() access: Access,
  ): Promise<BranchSummary> {
    return this.summary.read(access, query);
  }
}
