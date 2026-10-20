import { Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import {
  academicYearListSchema,
  academicYearRecordSchema,
  academicYearSchema,
  currentPeriodSchema,
  quartersPreviewSchema,
  quartersSaveSchema,
  setupIdParamsSchema,
  type AcademicYear,
  type AcademicYearList,
  type AcademicYearRecord,
  type CurrentPeriod,
  type QuartersPreview,
  type QuartersSave,
  type SetupIdParams,
} from '@sodiq/shared';
import { RequestId } from '../../http/request-id.js';
import { Returns, ValidBody, ValidParams } from '../../http/schemas.js';
import { Requires } from '../access/access.decorators.js';
import { CurrentAccess, type Access } from '../access/permission.guard.js';
import { AcademicYears } from './academic-years.service.js';
import { branchOf } from './branches.controller.js';

/**
 * Academic years and quarters (docs/spec/03-school-setup.md, Academic year,
 * owner: Super Admin; Quarters, owner: Academic Vice Principal; task 1.3), and
 * the year and quarter of the top bar. Every route acts on the branch of the
 * request: years belong to a branch (owner's answer 2).
 */
@Controller('setup')
export class AcademicYearsController {
  constructor(private readonly years: AcademicYears) {}

  @Get('academic-years')
  @Requires('academic_years', 'view')
  @Returns(academicYearListSchema)
  list(@CurrentAccess() access: Access): Promise<AcademicYearList> {
    return this.years.list(access);
  }

  @Post('academic-years')
  @Requires('academic_years', 'create')
  @Returns(academicYearSchema, 201)
  create(
    @CurrentAccess() access: Access,
    @ValidBody(academicYearRecordSchema) record: AcademicYearRecord,
    @RequestId() requestId: string,
  ): Promise<AcademicYear> {
    return this.years.create(access, branchOf(access), record, requestId);
  }

  @Put('academic-years/:id')
  @Requires('academic_years', 'edit')
  @Returns(academicYearSchema)
  edit(
    @CurrentAccess() access: Access,
    @ValidParams(setupIdParamsSchema) params: SetupIdParams,
    @ValidBody(academicYearRecordSchema) record: AcademicYearRecord,
    @RequestId() requestId: string,
  ): Promise<AcademicYear> {
    return this.years.edit(access, branchOf(access), params.id, record, requestId);
  }

  /** "Start year": the `edit` action (owner's answer 3 names view, create and edit only). */
  @Post('academic-years/:id/start')
  @HttpCode(200)
  @Requires('academic_years', 'edit')
  @Returns(academicYearSchema)
  start(
    @CurrentAccess() access: Access,
    @ValidParams(setupIdParamsSchema) params: SetupIdParams,
    @RequestId() requestId: string,
  ): Promise<AcademicYear> {
    return this.years.start(access, branchOf(access), params.id, requestId);
  }

  @Put('academic-years/:id/quarters')
  @Requires('quarters', 'edit')
  @Returns(academicYearSchema)
  saveQuarters(
    @CurrentAccess() access: Access,
    @ValidParams(setupIdParamsSchema) params: SetupIdParams,
    @ValidBody(quartersSaveSchema) record: QuartersSave,
    @RequestId() requestId: string,
  ): Promise<AcademicYear> {
    return this.years.saveQuarters(access, branchOf(access), params.id, record, requestId);
  }

  /**
   * Task 5.6b-5a (decision 10): what the save of the same body does to the
   * published timetable, and what refuses it, as lines; nothing is written.
   */
  @Post('academic-years/:id/quarters/preview')
  @HttpCode(200)
  @Requires('quarters', 'edit')
  @Returns(quartersPreviewSchema)
  previewQuarters(
    @CurrentAccess() access: Access,
    @ValidParams(setupIdParamsSchema) params: SetupIdParams,
    @ValidBody(quartersSaveSchema) record: QuartersSave,
    @RequestId() requestId: string,
  ): Promise<QuartersPreview> {
    return this.years.previewQuarters(access, branchOf(access), params.id, record, requestId);
  }

  /** The top bar of every role (`03`; `12`, Context; decision 8 of pull request #44). */
  @Get('current-period')
  @Requires('current_period', 'view')
  @Returns(currentPeriodSchema)
  currentPeriod(@CurrentAccess() access: Access): Promise<CurrentPeriod> {
    return this.years.currentPeriod(access, branchOf(access));
  }
}
