import { Controller, Get, Put } from '@nestjs/common';
import {
  absenceReasonParamsSchema,
  absenceReasonRecordSchema,
  absenceReasonSchema,
  studentAbsencesQuerySchema,
  studentAbsencesSchema,
  type AbsenceReason,
  type AbsenceReasonParams,
  type AbsenceReasonRecord,
  type StudentAbsences as StudentAbsencesAnswer,
  type StudentAbsencesQuery,
} from '@sodiq/shared';
import { RequestId } from '../../http/request-id.js';
import { Returns, ValidBody, ValidParams, ValidQuery } from '../../http/schemas.js';
import { Requires } from '../access/access.decorators.js';
import { CurrentAccess, type Access } from '../access/permission.guard.js';
import { StudentAbsences } from './student-absences.service.js';

/**
 * The reasons of a student's absence (task 6.3, pull request #211, decision
 * 6, Look first): the area `absence_reasons`. The route decides the class
 * for every request: every class of the branch for the Super Admin, the
 * Principal, the Academic Vice Principal, the Vice Principal for Spiritual
 * and Moral Education and the Head Tutor (view) and the first two of those
 * who write; the Tutor's own classes (rows in force now) otherwise, 403
 * `absence_scope`.
 */
@Controller('journal/student-absences')
export class StudentAbsencesController {
  constructor(private readonly absences: StudentAbsences) {}

  @Get()
  @Requires('absence_reasons', 'view')
  @Returns(studentAbsencesSchema)
  list(
    @CurrentAccess() access: Access,
    @ValidQuery(studentAbsencesQuerySchema) query: StudentAbsencesQuery,
  ): Promise<StudentAbsencesAnswer> {
    return this.absences.list(access, query);
  }

  @Put(':studentId/:date')
  @Requires('absence_reasons', 'edit')
  @Returns(absenceReasonSchema)
  set(
    @CurrentAccess() access: Access,
    @ValidParams(absenceReasonParamsSchema) params: AbsenceReasonParams,
    @ValidBody(absenceReasonRecordSchema) input: AbsenceReasonRecord,
    @RequestId() requestId: string,
  ): Promise<AbsenceReason> {
    return this.absences.set(access, params.studentId, params.date, input, requestId);
  }
}
