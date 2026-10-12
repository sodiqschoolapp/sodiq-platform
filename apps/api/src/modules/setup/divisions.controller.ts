import { Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import {
  departmentRecordSchema,
  departmentSchema,
  divisionExportSchema,
  divisionListSchema,
  divisionRecordSchema,
  divisionSchema,
  setupIdParamsSchema,
  type Department,
  type DepartmentRecord,
  type Division,
  type DivisionExport,
  type DivisionList,
  type DivisionRecord,
  type SetupIdParams,
} from '@sodiq/shared';
import { RequestId } from '../../http/request-id.js';
import { Returns, ReturnsFile, ValidBody, ValidParams } from '../../http/schemas.js';
import type { XlsxFile } from '../../http/xlsx.js';
import { Requires } from '../access/access.decorators.js';
import { CurrentAccess, type Access } from '../access/permission.guard.js';
import { Divisions } from './divisions.service.js';

/**
 * Divisions and departments (docs/spec/03-school-setup.md, Divisions: "One
 * list for the whole school"; task 1.2). The area `divisions` of the
 * permission table covers both rows of the table of `03`. A division has no
 * branch, so every change is school-wide work (`branch: 'none'`); the list is
 * read through the branch of the request, as every list the Principal and
 * the Academic Vice Principal see (decided in 1.1), and is the same whatever
 * branch is named.
 */
@Controller('setup')
export class DivisionsController {
  constructor(private readonly divisions: Divisions) {}

  @Get('divisions')
  @Requires('divisions', 'view')
  @Returns(divisionListSchema)
  list(@CurrentAccess() access: Access): Promise<DivisionList> {
    return this.divisions.list(access);
  }

  /**
   * The Excel file of the list (task 2.2c-1), made in the branch of the
   * request like the list, and logged there.
   */
  @Post('divisions/export')
  @Requires('divisions', 'export')
  @ReturnsFile()
  export(
    @CurrentAccess() access: Access,
    @ValidBody(divisionExportSchema) request: DivisionExport,
    @RequestId() requestId: string,
  ): Promise<XlsxFile> {
    return this.divisions.export(access, request, requestId);
  }

  @Post('divisions')
  @Requires('divisions', 'create', { branch: 'none' })
  @Returns(divisionSchema, 201)
  create(
    @CurrentAccess() access: Access,
    @ValidBody(divisionRecordSchema) record: DivisionRecord,
    @RequestId() requestId: string,
  ): Promise<Division> {
    return this.divisions.createDivision(access, record, requestId);
  }

  @Put('divisions/:id')
  @Requires('divisions', 'edit', { branch: 'none' })
  @Returns(divisionSchema)
  rename(
    @CurrentAccess() access: Access,
    @ValidParams(setupIdParamsSchema) params: SetupIdParams,
    @ValidBody(divisionRecordSchema) record: DivisionRecord,
    @RequestId() requestId: string,
  ): Promise<Division> {
    return this.divisions.renameDivision(access, params.id, record, requestId);
  }

  @Post('divisions/:id/archive')
  @HttpCode(200)
  @Requires('divisions', 'archive', { branch: 'none' })
  @Returns(divisionSchema)
  archive(
    @CurrentAccess() access: Access,
    @ValidParams(setupIdParamsSchema) params: SetupIdParams,
    @RequestId() requestId: string,
  ): Promise<Division> {
    return this.divisions.archiveDivision(access, params.id, requestId);
  }

  @Post('divisions/:id/restore')
  @HttpCode(200)
  @Requires('divisions', 'archive', { branch: 'none' })
  @Returns(divisionSchema)
  restore(
    @CurrentAccess() access: Access,
    @ValidParams(setupIdParamsSchema) params: SetupIdParams,
    @RequestId() requestId: string,
  ): Promise<Division> {
    return this.divisions.restoreDivision(access, params.id, requestId);
  }

  @Post('divisions/:id/departments')
  @Requires('divisions', 'create', { branch: 'none' })
  @Returns(departmentSchema, 201)
  createDepartment(
    @CurrentAccess() access: Access,
    @ValidParams(setupIdParamsSchema) params: SetupIdParams,
    @ValidBody(departmentRecordSchema) record: DepartmentRecord,
    @RequestId() requestId: string,
  ): Promise<Department> {
    return this.divisions.createDepartment(access, params.id, record, requestId);
  }

  @Put('departments/:id')
  @Requires('divisions', 'edit', { branch: 'none' })
  @Returns(departmentSchema)
  renameDepartment(
    @CurrentAccess() access: Access,
    @ValidParams(setupIdParamsSchema) params: SetupIdParams,
    @ValidBody(departmentRecordSchema) record: DepartmentRecord,
    @RequestId() requestId: string,
  ): Promise<Department> {
    return this.divisions.renameDepartment(access, params.id, record, requestId);
  }

  @Post('departments/:id/archive')
  @HttpCode(200)
  @Requires('divisions', 'archive', { branch: 'none' })
  @Returns(departmentSchema)
  archiveDepartment(
    @CurrentAccess() access: Access,
    @ValidParams(setupIdParamsSchema) params: SetupIdParams,
    @RequestId() requestId: string,
  ): Promise<Department> {
    return this.divisions.archiveDepartment(access, params.id, requestId);
  }

  @Post('departments/:id/restore')
  @HttpCode(200)
  @Requires('divisions', 'archive', { branch: 'none' })
  @Returns(departmentSchema)
  restoreDepartment(
    @CurrentAccess() access: Access,
    @ValidParams(setupIdParamsSchema) params: SetupIdParams,
    @RequestId() requestId: string,
  ): Promise<Department> {
    return this.divisions.restoreDepartment(access, params.id, requestId);
  }
}
