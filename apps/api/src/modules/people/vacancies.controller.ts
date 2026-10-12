import { Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import {
  vacancyDetailSchema,
  vacancyExportSchema,
  vacancyListSchema,
  vacancyParamsSchema,
  vacancyRecordSchema,
  type VacancyDetail,
  type VacancyExport,
  type VacancyList,
  type VacancyParams,
  type VacancyRecord,
} from '@sodiq/shared';
import { RequestId } from '../../http/request-id.js';
import {
  Returns,
  ReturnsFile,
  ReturnsNothing,
  ValidBody,
  ValidParams,
} from '../../http/schemas.js';
import type { XlsxFile } from '../../http/xlsx.js';
import { Requires } from '../access/access.decorators.js';
import { CurrentAccess, type Access } from '../access/permission.guard.js';
import { Vacancies } from './vacancies.service.js';

/**
 * Vacancies (docs/spec/04-people.md, Vacancy; task 2.2b, pull request #57).
 * The area `vacancies` (decision 1): the Academic Vice Principal and the
 * Super Admin create, edit, close, reopen and delete; the Principal views.
 * Every route works for the branch of the request, the one branch of a
 * vacancy.
 */
@Controller('people')
export class VacanciesController {
  constructor(private readonly vacancies: Vacancies) {}

  @Get('vacancies')
  @Requires('vacancies', 'view')
  @Returns(vacancyListSchema)
  list(@CurrentAccess() access: Access): Promise<VacancyList> {
    return this.vacancies.list(access);
  }

  /** The Excel file of the Vacancies list (task 2.2c-1; decision 6). */
  @Post('vacancies/export')
  @Requires('vacancies', 'export')
  @ReturnsFile()
  export(
    @CurrentAccess() access: Access,
    @ValidBody(vacancyExportSchema) request: VacancyExport,
    @RequestId() requestId: string,
  ): Promise<XlsxFile> {
    return this.vacancies.export(access, request, requestId);
  }

  @Get('vacancies/:id')
  @Requires('vacancies', 'view')
  @Returns(vacancyDetailSchema)
  detail(
    @CurrentAccess() access: Access,
    @ValidParams(vacancyParamsSchema) params: VacancyParams,
  ): Promise<VacancyDetail> {
    return this.vacancies.detail(access, params.id);
  }

  @Post('vacancies')
  @Requires('vacancies', 'create')
  @Returns(vacancyDetailSchema, 201)
  create(
    @CurrentAccess() access: Access,
    @ValidBody(vacancyRecordSchema) record: VacancyRecord,
    @RequestId() requestId: string,
  ): Promise<VacancyDetail> {
    return this.vacancies.create(access, record, requestId);
  }

  @Put('vacancies/:id')
  @Requires('vacancies', 'edit')
  @Returns(vacancyDetailSchema)
  edit(
    @CurrentAccess() access: Access,
    @ValidParams(vacancyParamsSchema) params: VacancyParams,
    @ValidBody(vacancyRecordSchema) record: VacancyRecord,
    @RequestId() requestId: string,
  ): Promise<VacancyDetail> {
    return this.vacancies.edit(access, params.id, record, requestId);
  }

  @Post('vacancies/:id/close')
  @HttpCode(200)
  @Requires('vacancies', 'archive')
  @Returns(vacancyDetailSchema)
  close(
    @CurrentAccess() access: Access,
    @ValidParams(vacancyParamsSchema) params: VacancyParams,
    @RequestId() requestId: string,
  ): Promise<VacancyDetail> {
    return this.vacancies.setStatus(access, params.id, 'closed', requestId);
  }

  @Post('vacancies/:id/reopen')
  @HttpCode(200)
  @Requires('vacancies', 'archive')
  @Returns(vacancyDetailSchema)
  reopen(
    @CurrentAccess() access: Access,
    @ValidParams(vacancyParamsSchema) params: VacancyParams,
    @RequestId() requestId: string,
  ): Promise<VacancyDetail> {
    return this.vacancies.setStatus(access, params.id, 'open', requestId);
  }

  @Post('vacancies/:id/delete')
  @ReturnsNothing()
  @Requires('vacancies', 'archive')
  delete(
    @CurrentAccess() access: Access,
    @ValidParams(vacancyParamsSchema) params: VacancyParams,
    @RequestId() requestId: string,
  ): Promise<void> {
    return this.vacancies.delete(access, params.id, requestId);
  }
}
