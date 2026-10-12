import { Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import {
  studentCheckResultSchema,
  studentCheckSchema,
  studentCreateSchema,
  studentDetailSchema,
  studentIdentitySchema,
  studentListSchema,
  studentParamsSchema,
  studentRecordSchema,
  studentUidCorrectionSchema,
  type StudentCheck,
  type StudentCheckResult,
  type StudentCreate,
  type StudentDetail,
  type StudentIdentity,
  type StudentList,
  type StudentParams,
  type StudentRecord,
  type StudentUidCorrection,
} from '@sodiq/shared';
import { RequestId } from '../../http/request-id.js';
import { Returns, ValidBody, ValidParams } from '../../http/schemas.js';
import { Requires } from '../access/access.decorators.js';
import { CurrentAccess, type Access } from '../access/permission.guard.js';
import { Students } from './students.service.js';

/**
 * Student records (docs/spec/04-people.md, Student record, UID sets; task
 * 2.4a, pull request #67). The area `students` (decision 2): the Super Admin
 * and the Academic Vice Principal create and edit; the roles of `02` that see
 * the student list view it; the record answers the groups of fields each
 * reader may see. Every route works for the branch of the request.
 */
@Controller('people')
export class StudentsController {
  constructor(private readonly students: Students) {}

  @Get('students')
  @Requires('students', 'view')
  @Returns(studentListSchema)
  list(@CurrentAccess() access: Access): Promise<StudentList> {
    return this.students.list(access);
  }

  @Post('students/check')
  @HttpCode(200)
  @Requires('students', 'create')
  @Returns(studentCheckResultSchema)
  check(
    @CurrentAccess() access: Access,
    @ValidBody(studentCheckSchema) input: StudentCheck,
  ): Promise<StudentCheckResult> {
    return this.students.check(access, input);
  }

  @Post('students')
  @Requires('students', 'create')
  @Returns(studentDetailSchema, 201)
  create(
    @CurrentAccess() access: Access,
    @ValidBody(studentCreateSchema) input: StudentCreate,
    @RequestId() requestId: string,
  ): Promise<StudentDetail> {
    return this.students.create(access, input, requestId);
  }

  @Get('students/:id')
  @Requires('students', 'view')
  @Returns(studentDetailSchema)
  detail(
    @CurrentAccess() access: Access,
    @ValidParams(studentParamsSchema) params: StudentParams,
  ): Promise<StudentDetail> {
    return this.students.detail(access, params.id);
  }

  @Put('students/:id')
  @Requires('students', 'edit')
  @Returns(studentDetailSchema)
  edit(
    @CurrentAccess() access: Access,
    @ValidParams(studentParamsSchema) params: StudentParams,
    @ValidBody(studentRecordSchema) record: StudentRecord,
    @RequestId() requestId: string,
  ): Promise<StudentDetail> {
    return this.students.edit(access, params.id, record, requestId);
  }

  @Put('students/:id/uid')
  @Requires('students', 'edit')
  @Returns(studentDetailSchema)
  correctUid(
    @CurrentAccess() access: Access,
    @ValidParams(studentParamsSchema) params: StudentParams,
    @ValidBody(studentUidCorrectionSchema) input: StudentUidCorrection,
    @RequestId() requestId: string,
  ): Promise<StudentDetail> {
    return this.students.correctUid(access, params.id, input, requestId);
  }

  @Post('students/:id/identity')
  @HttpCode(200)
  @Requires('students', 'view')
  @Returns(studentIdentitySchema)
  identity(
    @CurrentAccess() access: Access,
    @ValidParams(studentParamsSchema) params: StudentParams,
    @RequestId() requestId: string,
  ): Promise<StudentIdentity> {
    return this.students.identity(access, params.id, requestId);
  }
}
