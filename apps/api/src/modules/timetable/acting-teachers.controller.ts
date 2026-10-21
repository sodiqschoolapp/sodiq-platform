import { Controller, HttpCode, Post } from '@nestjs/common';
import {
  actingTeacherBodySchema,
  actingTeacherCheckSchema,
  actingTeacherEndSchema,
  actingTeacherParamsSchema,
  actingTeacherSchema,
  type ActingTeacher,
  type ActingTeacherBody,
  type ActingTeacherCheck,
  type ActingTeacherEnd,
  type ActingTeacherParams,
} from '@sodiq/shared';
import { RequestId } from '../../http/request-id.js';
import { RequestKey, Returns, ValidBody, ValidParams } from '../../http/schemas.js';
import { Requires } from '../access/access.decorators.js';
import { CurrentAccess, type Access } from '../access/permission.guard.js';
import { ActingTeachers } from './acting-teachers.service.js';

/**
 * The acting teacher of a vacancy's journal (task 5.7a-3c, pull request #190,
 * decision 7): the area `timetable`, `edit`, as the fill; no role widened.
 * Every route works for the branch of the request.
 */
@Controller('timetable/acting-teachers')
export class ActingTeachersController {
  constructor(private readonly acting: ActingTeachers) {}

  /** Names an acting teacher for a period, safe to repeat with its key. */
  @Post()
  @HttpCode(201)
  @Requires('timetable', 'edit')
  @Returns(actingTeacherSchema)
  name(
    @CurrentAccess() access: Access,
    @RequestKey() key: string,
    @ValidBody(actingTeacherBodySchema) input: ActingTeacherBody,
    @RequestId() requestId: string,
  ): Promise<ActingTeacher> {
    return this.acting.name(access, input, key, requestId);
  }

  /** What a naming would meet, nothing written. */
  @Post('check')
  @HttpCode(200)
  @Requires('timetable', 'edit')
  @Returns(actingTeacherCheckSchema)
  check(
    @CurrentAccess() access: Access,
    @ValidBody(actingTeacherBodySchema) input: ActingTeacherBody,
  ): Promise<ActingTeacherCheck> {
    return this.acting.check(access, input);
  }

  /** Ends a period on a day, or withdraws a planned one; safe to repeat with its key. */
  @Post(':id/end')
  @HttpCode(200)
  @Requires('timetable', 'edit')
  @Returns(actingTeacherSchema)
  end(
    @CurrentAccess() access: Access,
    @RequestKey() key: string,
    @ValidParams(actingTeacherParamsSchema) params: ActingTeacherParams,
    @ValidBody(actingTeacherEndSchema) input: ActingTeacherEnd,
    @RequestId() requestId: string,
  ): Promise<ActingTeacher> {
    return this.acting.end(access, params.id, input, key, requestId);
  }
}
