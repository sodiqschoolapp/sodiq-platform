import { Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import {
  studentCheckResultSchema,
  studentCheckSchema,
  studentCreateSchema,
  studentDetailSchema,
  studentExportSchema,
  studentIdentitySchema,
  studentListQuerySchema,
  studentListSchema,
  studentNoClassSchema,
  studentParamsSchema,
  studentRecordSchema,
  studentUidCorrectionSchema,
  studentImportConfirmResultSchema,
  studentImportDecisionsSchema,
  studentImportParamsSchema,
  studentImportPreviewSchema,
  studentImportTemplateQuerySchema,
  type StudentImportConfirmResult,
  type StudentImportDecisions,
  type StudentImportParams,
  type StudentImportPreview,
  type StudentImportTemplateQuery,
  type StudentCheck,
  type StudentCheckResult,
  type StudentCreate,
  type StudentDetail,
  type StudentExport,
  type StudentIdentity,
  type StudentList,
  type StudentListQuery,
  type StudentNoClass,
  type StudentParams,
  type StudentRecord,
  type StudentUidCorrection,
} from '@sodiq/shared';
import { STUDENT_IMPORT_ROUTE, type UploadedFile } from '../../http/file-routes.js';
import { RequestId } from '../../http/request-id.js';
import {
  Returns,
  ReturnsFile,
  ValidBody,
  ValidFile,
  ValidParams,
  ValidQuery,
} from '../../http/schemas.js';
import type { XlsxFile } from '../../http/xlsx.js';
import { Requires } from '../access/access.decorators.js';
import { CurrentAccess, type Access } from '../access/permission.guard.js';
import { StudentExports } from './student-exports.service.js';
import { StudentImports } from './student-imports.service.js';
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
  constructor(
    private readonly students: Students,
    private readonly exports: StudentExports,
    private readonly imports: StudentImports,
  ) {}

  /** `consent=missing`: the active students without consent, for the Financial readers (answer 23). */
  @Get('students')
  @Requires('students', 'view')
  @Returns(studentListSchema)
  list(
    @CurrentAccess() access: Access,
    @ValidQuery(studentListQuerySchema) query: StudentListQuery,
  ): Promise<StudentList> {
    return this.students.list(access, query);
  }

  /**
   * The "No class" counter of the Academic Vice Principal's home page (task
   * 2.4b-2). Declared before `students/:id`, which would take it otherwise.
   */
  @Get('students/no-class')
  @Requires('students', 'view')
  @Returns(studentNoClassSchema)
  noClass(@CurrentAccess() access: Access): Promise<StudentNoClass> {
    return this.students.noClass(access);
  }

  /**
   * The Excel file of the list (task 2.4b-2): the ids of the ticked or
   * matching rows, the columns shown and those of the groups chosen, the
   * search and filters for the audit entry.
   */
  @Post('students/export')
  @Requires('students', 'export')
  @ReturnsFile()
  export(
    @CurrentAccess() access: Access,
    @ValidBody(studentExportSchema) request: StudentExport,
    @RequestId() requestId: string,
  ): Promise<XlsxFile> {
    return this.exports.export(access, request, requestId);
  }

  /**
   * The system's template of the student import (task 9.4g; `04`, Student
   * record: Excel import), for the roles that create a student by hand. The
   * import routes come before `students/:id`, which would take them otherwise.
   */
  @Get('students/import-template')
  @Requires('students', 'create')
  @ReturnsFile()
  importTemplate(
    @ValidQuery(studentImportTemplateQuerySchema) query: StudentImportTemplateQuery,
  ): Promise<XlsxFile> {
    return this.imports.template(query.language);
  }

  /** The upload of a filled template: the rows are kept and the preview answered (task 9.4g). */
  @Put('students/imports')
  @Requires('students', 'create')
  @Returns(studentImportPreviewSchema)
  importUpload(
    @CurrentAccess() access: Access,
    @ValidFile(STUDENT_IMPORT_ROUTE) file: UploadedFile | null,
    @RequestId() requestId: string,
  ): Promise<StudentImportPreview> {
    return this.imports.upload(access, file, requestId);
  }

  /** The preview of a kept upload with the decisions so far; nothing is saved (task 9.4g). */
  @Post('students/imports/:id/preview')
  @HttpCode(200)
  @Requires('students', 'create')
  @Returns(studentImportPreviewSchema)
  importPreview(
    @CurrentAccess() access: Access,
    @ValidParams(studentImportParamsSchema) params: StudentImportParams,
    @ValidBody(studentImportDecisionsSchema) decisions: StudentImportDecisions,
    @RequestId() requestId: string,
  ): Promise<StudentImportPreview> {
    return this.imports.preview(access, params.id, decisions, requestId);
  }

  /** Saves every row of a kept upload, or nothing (task 9.4g). */
  @Post('students/imports/:id/confirm')
  @HttpCode(200)
  @Requires('students', 'create')
  @Returns(studentImportConfirmResultSchema)
  importConfirm(
    @CurrentAccess() access: Access,
    @ValidParams(studentImportParamsSchema) params: StudentImportParams,
    @ValidBody(studentImportDecisionsSchema) decisions: StudentImportDecisions,
    @RequestId() requestId: string,
  ): Promise<StudentImportConfirmResult> {
    return this.imports.confirm(access, params.id, decisions, requestId);
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
