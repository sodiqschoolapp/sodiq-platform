import { Controller, HttpCode, Post } from '@nestjs/common';
import {
  personalDataParamsSchema,
  relativeReportSchema,
  staffReportSchema,
  studentReportSchema,
  type PersonalDataParams,
  type RelativeReport,
  type StaffReport,
  type StudentReport,
} from '@sodiq/shared';
import { RequestId } from '../../http/request-id.js';
import { Returns, ValidParams } from '../../http/schemas.js';
import { Requires } from '../access/access.decorators.js';
import { CurrentAccess, type Access } from '../access/permission.guard.js';
import { PersonalData } from './personal-data.service.js';

/**
 * The personal data report per person (task 2.6b, pull request #76;
 * edge-cases/people-roles-accounts: "The Super Admin can produce a personal
 * data report per person"). The area `personal_data_report`, Super Admin only
 * (decision 3). `POST`, since each report produced is an export and writes an
 * audit entry; every route works for the branch of the request (decision 4).
 */
@Controller('people')
export class PersonalDataController {
  constructor(private readonly reports: PersonalData) {}

  @Post('students/:id/report')
  @HttpCode(200)
  @Requires('personal_data_report', 'export')
  @Returns(studentReportSchema)
  student(
    @CurrentAccess() access: Access,
    @ValidParams(personalDataParamsSchema) params: PersonalDataParams,
    @RequestId() requestId: string,
  ): Promise<StudentReport> {
    return this.reports.student(access, params.id, requestId);
  }

  @Post('staff/:id/report')
  @HttpCode(200)
  @Requires('personal_data_report', 'export')
  @Returns(staffReportSchema)
  staff(
    @CurrentAccess() access: Access,
    @ValidParams(personalDataParamsSchema) params: PersonalDataParams,
    @RequestId() requestId: string,
  ): Promise<StaffReport> {
    return this.reports.staff(access, params.id, requestId);
  }

  @Post('relatives/:id/report')
  @HttpCode(200)
  @Requires('personal_data_report', 'export')
  @Returns(relativeReportSchema)
  relative(
    @CurrentAccess() access: Access,
    @ValidParams(personalDataParamsSchema) params: PersonalDataParams,
    @RequestId() requestId: string,
  ): Promise<RelativeReport> {
    return this.reports.relative(access, params.id, requestId);
  }
}
