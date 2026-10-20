import { Controller, Get, HttpCode, Patch, Post } from '@nestjs/common';
import {
  absenceEditSchema,
  absenceLessonsSchema,
  absenceListSchema,
  absenceParamsSchema,
  absenceRecordSchema,
  absenceSchema,
  absencesQuerySchema,
  attentionSchema,
  type Absence,
  type AbsenceEdit,
  type AbsenceLessons,
  type AbsenceList,
  type AbsenceParams,
  type AbsenceRecord,
  type AbsencesQuery,
  type Attention,
} from '@sodiq/shared';
import { RequestId } from '../../http/request-id.js';
import { Returns, ValidBody, ValidParams, ValidQuery } from '../../http/schemas.js';
import { Requires } from '../access/access.decorators.js';
import { CurrentAccess, type Access } from '../access/permission.guard.js';
import { TimetableAbsences } from './absences.service.js';

/**
 * Teacher absences and the home page's lists (task 5.7a-1, pull request
 * #185, decision 4): the area `timetable`, no role widened. The Super Admin
 * and the Academic Vice Principal enter (`create`), change and withdraw
 * (`edit`) absences (`edge/people-roles-accounts`: "The Academic Vice
 * Principal ... marks teacher absences"); the roles that view the timetable
 * read them (`view`). Every route works for the branch of the request.
 */
@Controller('timetable')
export class AbsencesController {
  constructor(private readonly absences: TimetableAbsences) {}

  @Get('absences')
  @Requires('timetable', 'view')
  @Returns(absenceListSchema)
  list(
    @CurrentAccess() access: Access,
    @ValidQuery(absencesQuerySchema) query: AbsencesQuery,
  ): Promise<AbsenceList> {
    return this.absences.list(access, query);
  }

  @Post('absences')
  @HttpCode(201)
  @Requires('timetable', 'create')
  @Returns(absenceSchema)
  create(
    @CurrentAccess() access: Access,
    @ValidBody(absenceRecordSchema) input: AbsenceRecord,
    @RequestId() requestId: string,
  ): Promise<Absence> {
    return this.absences.create(access, input, requestId);
  }

  @Patch('absences/:id')
  @Requires('timetable', 'edit')
  @Returns(absenceSchema)
  edit(
    @CurrentAccess() access: Access,
    @ValidParams(absenceParamsSchema) params: AbsenceParams,
    @ValidBody(absenceEditSchema) input: AbsenceEdit,
    @RequestId() requestId: string,
  ): Promise<Absence> {
    return this.absences.edit(access, params.id, input, requestId);
  }

  @Post('absences/:id/withdraw')
  @HttpCode(200)
  @Requires('timetable', 'edit')
  @Returns(absenceSchema)
  withdraw(
    @CurrentAccess() access: Access,
    @ValidParams(absenceParamsSchema) params: AbsenceParams,
    @RequestId() requestId: string,
  ): Promise<Absence> {
    return this.absences.withdraw(access, params.id, requestId);
  }

  /** "The list of own affected lessons" (`06`, Teachers who work in several branches, Absence). */
  @Get('absences/:id/lessons')
  @Requires('timetable', 'view')
  @Returns(absenceLessonsSchema)
  lessons(
    @CurrentAccess() access: Access,
    @ValidParams(absenceParamsSchema) params: AbsenceParams,
  ): Promise<AbsenceLessons> {
    return this.absences.lessons(access, params.id);
  }

  /** The home page's "needs a teacher" and "unresolved" lists (decision 9). */
  @Get('attention')
  @Requires('timetable', 'view')
  @Returns(attentionSchema)
  attention(@CurrentAccess() access: Access): Promise<Attention> {
    return this.absences.attention(access);
  }
}
