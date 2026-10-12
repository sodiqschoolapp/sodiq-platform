import { Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import {
  staffBranchesSchema,
  staffCheckResultSchema,
  staffCheckSchema,
  staffDetailSchema,
  staffExportSchema,
  staffIdentitySchema,
  staffListSchema,
  staffParamsSchema,
  staffRecordSchema,
  staffStatusAnswerSchema,
  staffStatusChangeSchema,
  staffTeachingSchema,
  type StaffBranches,
  type StaffCheck,
  type StaffCheckResult,
  type StaffDetail,
  type StaffExport,
  type StaffIdentity,
  type StaffList,
  type StaffParams,
  type StaffRecord,
  type StaffStatusAnswer,
  type StaffStatusChange,
  type StaffTeaching,
} from '@sodiq/shared';
import { RequestId } from '../../http/request-id.js';
import { Returns, ReturnsFile, ValidBody, ValidParams } from '../../http/schemas.js';
import type { XlsxFile } from '../../http/xlsx.js';
import { Requires } from '../access/access.decorators.js';
import { CurrentAccess, type Access } from '../access/permission.guard.js';
import { Staff } from './staff.service.js';

/**
 * Staff records (docs/spec/04-people.md, Teacher and staff record; task 2.2a,
 * pull request #53). The areas `staff` and `staff_teaching` (decision 2):
 * the Super Admin creates and changes a record; the Academic Vice Principal
 * changes name, phone and email and the teaching profile; the Principal
 * views. Every route works for the branch of the request: a record is seen
 * only in the branches its person is linked to (owner's answer 2).
 */
@Controller('people')
export class StaffController {
  constructor(private readonly staff: Staff) {}

  @Get('staff')
  @Requires('staff', 'view')
  @Returns(staffListSchema)
  list(@CurrentAccess() access: Access): Promise<StaffList> {
    return this.staff.list(access);
  }

  /**
   * The Excel file of the list (task 2.2c-1): the ids of the ticked or matching
   * rows, the columns shown, the search and filters for the audit entry.
   */
  @Post('staff/export')
  @Requires('staff', 'export')
  @ReturnsFile()
  export(
    @CurrentAccess() access: Access,
    @ValidBody(staffExportSchema) request: StaffExport,
    @RequestId() requestId: string,
  ): Promise<XlsxFile> {
    return this.staff.export(access, request, requestId);
  }

  @Get('staff/:id')
  @Requires('staff', 'view')
  @Returns(staffDetailSchema)
  detail(
    @CurrentAccess() access: Access,
    @ValidParams(staffParamsSchema) params: StaffParams,
  ): Promise<StaffDetail> {
    return this.staff.detail(access, params.id);
  }

  @Post('staff/check')
  @HttpCode(200)
  @Requires('staff', 'create')
  @Returns(staffCheckResultSchema)
  check(
    @CurrentAccess() access: Access,
    @ValidBody(staffCheckSchema) input: StaffCheck,
  ): Promise<StaffCheckResult> {
    return this.staff.check(access, input);
  }

  @Post('staff')
  @Requires('staff', 'create')
  @Returns(staffDetailSchema, 201)
  create(
    @CurrentAccess() access: Access,
    @ValidBody(staffRecordSchema) record: StaffRecord,
    @RequestId() requestId: string,
  ): Promise<StaffDetail> {
    return this.staff.create(access, record, requestId);
  }

  @Put('staff/:id')
  @Requires('staff', 'edit')
  @Returns(staffDetailSchema)
  edit(
    @CurrentAccess() access: Access,
    @ValidParams(staffParamsSchema) params: StaffParams,
    @ValidBody(staffRecordSchema) record: StaffRecord,
    @RequestId() requestId: string,
  ): Promise<StaffDetail> {
    return this.staff.edit(access, params.id, record, requestId);
  }

  @Put('staff/:id/teaching')
  @Requires('staff_teaching', 'edit')
  @Returns(staffDetailSchema)
  teaching(
    @CurrentAccess() access: Access,
    @ValidParams(staffParamsSchema) params: StaffParams,
    @ValidBody(staffTeachingSchema) teaching: StaffTeaching,
    @RequestId() requestId: string,
  ): Promise<StaffDetail> {
    return this.staff.teaching(access, params.id, teaching, requestId);
  }

  @Put('staff/:id/branches')
  @Requires('staff', 'edit')
  @Returns(staffDetailSchema)
  branches(
    @CurrentAccess() access: Access,
    @ValidParams(staffParamsSchema) params: StaffParams,
    @ValidBody(staffBranchesSchema) branches: StaffBranches,
    @RequestId() requestId: string,
  ): Promise<StaffDetail> {
    return this.staff.setBranches(access, params.id, branches, requestId);
  }

  @Post('staff/:id/status')
  @HttpCode(200)
  @Requires('staff', 'edit')
  @Returns(staffStatusAnswerSchema)
  status(
    @CurrentAccess() access: Access,
    @ValidParams(staffParamsSchema) params: StaffParams,
    @ValidBody(staffStatusChangeSchema) change: StaffStatusChange,
    @RequestId() requestId: string,
  ): Promise<StaffStatusAnswer> {
    return this.staff.setStatus(access, params.id, change, requestId);
  }

  @Post('staff/:id/identity')
  @HttpCode(200)
  @Requires('staff', 'view')
  @Returns(staffIdentitySchema)
  identity(
    @CurrentAccess() access: Access,
    @ValidParams(staffParamsSchema) params: StaffParams,
    @RequestId() requestId: string,
  ): Promise<StaffIdentity> {
    return this.staff.identity(access, params.id, requestId);
  }
}
