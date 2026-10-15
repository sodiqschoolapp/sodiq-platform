import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import {
  studentMergePreviewSchema,
  studentMergeQuerySchema,
  studentMergeResultSchema,
  studentMergeSchema,
  studentParamsSchema,
  type StudentMerge,
  type StudentMergePreview,
  type StudentMergeQuery,
  type StudentMergeResult,
  type StudentParams,
} from '@sodiq/shared';
import { RequestId } from '../../http/request-id.js';
import { Returns, ValidBody, ValidParams, ValidQuery } from '../../http/schemas.js';
import { Requires } from '../access/access.decorators.js';
import { CurrentAccess, type Access } from '../access/permission.guard.js';
import { StudentMerges } from './student-merges.service.js';

/**
 * The merge of two student records (`edge/students-classes-groups`, "The
 * Super Admin can merge two records; the older UID survives"; task 3.3d,
 * pull request #98): `student_merges` `edit`, the Super Admin alone
 * (decision 10). The record of the path is of the branch of the request; the
 * other is named by its UID, of any branch (decision 16).
 */
@Controller('people')
export class StudentMergesController {
  constructor(private readonly merges: StudentMerges) {}

  @Get('students/:id/merge')
  @Requires('student_merges', 'edit')
  @Returns(studentMergePreviewSchema)
  preview(
    @CurrentAccess() access: Access,
    @ValidParams(studentParamsSchema) params: StudentParams,
    @ValidQuery(studentMergeQuerySchema) query: StudentMergeQuery,
  ): Promise<StudentMergePreview> {
    return this.merges.preview(access, params.id, query.uid);
  }

  @Post('students/:id/merge')
  @HttpCode(200)
  @Requires('student_merges', 'edit')
  @Returns(studentMergeResultSchema)
  merge(
    @CurrentAccess() access: Access,
    @ValidParams(studentParamsSchema) params: StudentParams,
    @ValidBody(studentMergeSchema) input: StudentMerge,
    @RequestId() requestId: string,
  ): Promise<StudentMergeResult> {
    return this.merges.merge(access, params.id, input, requestId);
  }
}
