import { Controller, HttpCode, Post } from '@nestjs/common';
import {
  studentCancelLeavingSchema,
  studentCancelReturnSchema,
  studentDeleteSchema,
  studentDetailSchema,
  studentLeavingSchema,
  studentParamsSchema,
  studentRestoreSchema,
  studentReturnSchema,
  studentUndoLeavingSchema,
  type StudentCancelLeaving,
  type StudentCancelReturn,
  type StudentDelete,
  type StudentDetail,
  type StudentLeaving,
  type StudentParams,
  type StudentRestore,
  type StudentReturn,
  type StudentUndoLeaving,
} from '@sodiq/shared';
import { RequestId } from '../../http/request-id.js';
import { Returns, ReturnsNothing, ValidBody, ValidParams } from '../../http/schemas.js';
import { Requires } from '../access/access.decorators.js';
import { CurrentAccess, type Access } from '../access/permission.guard.js';
import { StudentStatuses } from './student-statuses.service.js';

/**
 * Leaving, return and delete of a student (docs/spec/04-people.md,
 * Movements; edge/students-classes-groups; task 2.4b-1, pull request #68).
 * `students` `archive`: the Super Admin and the Academic Vice Principal
 * (decision 2); the restore of a graduated student under
 * `student_graduates` `edit`, the Super Admin. Each for the branch of the
 * request; each answers the student as the record route does.
 */
@Controller('people')
export class StudentStatusesController {
  constructor(private readonly statuses: StudentStatuses) {}

  @Post('students/:id/leaving')
  @HttpCode(200)
  @Requires('students', 'archive')
  @Returns(studentDetailSchema)
  leave(
    @CurrentAccess() access: Access,
    @ValidParams(studentParamsSchema) params: StudentParams,
    @ValidBody(studentLeavingSchema) input: StudentLeaving,
    @RequestId() requestId: string,
  ): Promise<StudentDetail> {
    return this.statuses.leave(access, params.id, input, requestId);
  }

  @Post('students/:id/leaving/cancel')
  @HttpCode(200)
  @Requires('students', 'archive')
  @Returns(studentDetailSchema)
  cancelLeaving(
    @CurrentAccess() access: Access,
    @ValidParams(studentParamsSchema) params: StudentParams,
    @ValidBody(studentCancelLeavingSchema) input: StudentCancelLeaving,
    @RequestId() requestId: string,
  ): Promise<StudentDetail> {
    return this.statuses.cancelLeaving(access, params.id, input, requestId);
  }

  @Post('students/:id/leaving/undo')
  @HttpCode(200)
  @Requires('students', 'archive')
  @Returns(studentDetailSchema)
  undoLeaving(
    @CurrentAccess() access: Access,
    @ValidParams(studentParamsSchema) params: StudentParams,
    @ValidBody(studentUndoLeavingSchema) input: StudentUndoLeaving,
    @RequestId() requestId: string,
  ): Promise<StudentDetail> {
    return this.statuses.undoLeaving(access, params.id, input, requestId);
  }

  @Post('students/:id/return')
  @HttpCode(200)
  @Requires('students', 'archive')
  @Returns(studentDetailSchema)
  returnStudent(
    @CurrentAccess() access: Access,
    @ValidParams(studentParamsSchema) params: StudentParams,
    @ValidBody(studentReturnSchema) input: StudentReturn,
    @RequestId() requestId: string,
  ): Promise<StudentDetail> {
    return this.statuses.returnStudent(access, params.id, input, requestId);
  }

  @Post('students/:id/return/cancel')
  @HttpCode(200)
  @Requires('students', 'archive')
  @Returns(studentDetailSchema)
  cancelReturn(
    @CurrentAccess() access: Access,
    @ValidParams(studentParamsSchema) params: StudentParams,
    @ValidBody(studentCancelReturnSchema) input: StudentCancelReturn,
    @RequestId() requestId: string,
  ): Promise<StudentDetail> {
    return this.statuses.cancelReturn(access, params.id, input, requestId);
  }

  @Post('students/:id/restore')
  @HttpCode(200)
  @Requires('student_graduates', 'edit')
  @Returns(studentDetailSchema)
  restore(
    @CurrentAccess() access: Access,
    @ValidParams(studentParamsSchema) params: StudentParams,
    @ValidBody(studentRestoreSchema) input: StudentRestore,
    @RequestId() requestId: string,
  ): Promise<StudentDetail> {
    return this.statuses.restore(access, params.id, input, requestId);
  }

  @Post('students/:id/delete')
  @Requires('students', 'archive')
  @ReturnsNothing()
  delete(
    @CurrentAccess() access: Access,
    @ValidParams(studentParamsSchema) params: StudentParams,
    @ValidBody(studentDeleteSchema) input: StudentDelete,
    @RequestId() requestId: string,
  ): Promise<void> {
    return this.statuses.delete(access, params.id, input, requestId);
  }
}
