import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import {
  dayAnswerSchema,
  dayChangeAnswerSchema,
  dayQuerySchema,
  lessonCancelBodySchema,
  lessonParamsSchema,
  lessonRestoreBodySchema,
  type DayAnswer,
  type DayChangeAnswer,
  type DayQuery,
  type LessonCancelBody,
  type LessonParams,
  type LessonRestoreBody,
} from '@sodiq/shared';
import { RequestId } from '../../http/request-id.js';
import { RequestKey, Returns, ValidBody, ValidParams, ValidQuery } from '../../http/schemas.js';
import { Requires } from '../access/access.decorators.js';
import { CurrentAccess, type Access } from '../access/permission.guard.js';
import { TimetableDayChanges } from './day-changes.service.js';

/**
 * One-day changes of the published timetable (task 5.6a-1, pull request
 * #160): the area `timetable`, no role widened (decision 2). The Super Admin
 * and the Academic Vice Principal cancel and restore (`edit`); the Principal
 * views the day (`view`). Every route works for the branch of the request.
 */
@Controller('timetable')
export class DayChangesController {
  constructor(private readonly dayChanges: TimetableDayChanges) {}

  @Get('day')
  @Requires('timetable', 'view')
  @Returns(dayAnswerSchema)
  day(
    @CurrentAccess() access: Access,
    @ValidQuery(dayQuerySchema) query: DayQuery,
  ): Promise<DayAnswer> {
    return this.dayChanges.day(access, query);
  }

  /** A one-day cancel of one lesson with a reason, safe to repeat with its key. */
  @Post('lessons/:id/cancel')
  @HttpCode(200)
  @Requires('timetable', 'edit')
  @Returns(dayChangeAnswerSchema)
  cancel(
    @CurrentAccess() access: Access,
    @ValidParams(lessonParamsSchema) params: LessonParams,
    @RequestKey() key: string,
    @ValidBody(lessonCancelBodySchema) input: LessonCancelBody,
    @RequestId() requestId: string,
  ): Promise<DayChangeAnswer> {
    return this.dayChanges.cancel(access, params.id, input, key, requestId);
  }

  /** The restore of a one-day cancel, every rule checked again, safe to repeat with its key. */
  @Post('lessons/:id/restore')
  @HttpCode(200)
  @Requires('timetable', 'edit')
  @Returns(dayChangeAnswerSchema)
  restore(
    @CurrentAccess() access: Access,
    @ValidParams(lessonParamsSchema) params: LessonParams,
    @RequestKey() key: string,
    @ValidBody(lessonRestoreBodySchema) _input: LessonRestoreBody,
    @RequestId() requestId: string,
  ): Promise<DayChangeAnswer> {
    return this.dayChanges.restore(access, params.id, key, requestId);
  }
}
