import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import {
  correctionTeachersAnswerSchema,
  dayAnswerSchema,
  dayChangeAnswerSchema,
  dayQuerySchema,
  lessonCancelBodySchema,
  lessonCorrectionBodySchema,
  lessonMoveBodySchema,
  lessonParamsSchema,
  lessonRestoreBodySchema,
  lessonRoomBodySchema,
  type CorrectionTeachersAnswer,
  type DayAnswer,
  type DayChangeAnswer,
  type DayQuery,
  type LessonCancelBody,
  type LessonCorrectionBody,
  type LessonMoveBody,
  type LessonParams,
  type LessonRestoreBody,
  type LessonRoomBody,
} from '@sodiq/shared';
import { RequestId } from '../../http/request-id.js';
import { RequestKey, Returns, ValidBody, ValidParams, ValidQuery } from '../../http/schemas.js';
import { Requires } from '../access/access.decorators.js';
import { CurrentAccess, type Access } from '../access/permission.guard.js';
import { TimetableDayChanges } from './day-changes.service.js';

/**
 * One-day changes of the published timetable (task 5.6a-1, pull request
 * #160; the room change and the move of 5.6a-2, pull request #161; the
 * correction of a past lesson of 5.6a-4, pull request #163): the area `timetable`, no role widened (decision 2). The Super Admin
 * and the Academic Vice Principal cancel, restore, change the room, move and correct (`edit`); the Principal
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

  /**
   * The restore of a one-day cancel, every rule checked again, into another
   * room with a reason when given (task 5.6a-2), safe to repeat with its key.
   */
  @Post('lessons/:id/restore')
  @HttpCode(200)
  @Requires('timetable', 'edit')
  @Returns(dayChangeAnswerSchema)
  restore(
    @CurrentAccess() access: Access,
    @ValidParams(lessonParamsSchema) params: LessonParams,
    @RequestKey() key: string,
    @ValidBody(lessonRestoreBodySchema) input: LessonRestoreBody,
    @RequestId() requestId: string,
  ): Promise<DayChangeAnswer> {
    return this.dayChanges.restore(access, params.id, input, key, requestId);
  }

  /** A one-day room change with a reason (task 5.6a-2), safe to repeat with its key. */
  @Post('lessons/:id/room')
  @HttpCode(200)
  @Requires('timetable', 'edit')
  @Returns(dayChangeAnswerSchema)
  room(
    @CurrentAccess() access: Access,
    @ValidParams(lessonParamsSchema) params: LessonParams,
    @RequestKey() key: string,
    @ValidBody(lessonRoomBodySchema) input: LessonRoomBody,
    @RequestId() requestId: string,
  ): Promise<DayChangeAnswer> {
    return this.dayChanges.room(access, params.id, input, key, requestId);
  }

  /** A one-day move to a lesson slot of a date, with a reason (task 5.6a-2), safe to repeat with its key. */
  @Post('lessons/:id/move')
  @HttpCode(200)
  @Requires('timetable', 'edit')
  @Returns(dayChangeAnswerSchema)
  move(
    @CurrentAccess() access: Access,
    @ValidParams(lessonParamsSchema) params: LessonParams,
    @RequestKey() key: string,
    @ValidBody(lessonMoveBodySchema) input: LessonMoveBody,
    @RequestId() requestId: string,
  ): Promise<DayChangeAnswer> {
    return this.dayChanges.move(access, params.id, input, key, requestId);
  }

  /**
   * The correction of a past lesson, one at a time, with a reason (task
   * 5.6a-4), safe to repeat with its key.
   */
  @Post('lessons/:id/correction')
  @HttpCode(200)
  @Requires('timetable', 'edit')
  @Returns(dayChangeAnswerSchema)
  correct(
    @CurrentAccess() access: Access,
    @ValidParams(lessonParamsSchema) params: LessonParams,
    @RequestKey() key: string,
    @ValidBody(lessonCorrectionBodySchema) input: LessonCorrectionBody,
    @RequestId() requestId: string,
  ): Promise<DayChangeAnswer> {
    return this.dayChanges.correct(access, params.id, input, key, requestId);
  }

  /** The people who may be recorded as having taught a past lesson (task 5.6a-4, decision 4). */
  @Get('lessons/:id/correction-teachers')
  @Requires('timetable', 'edit')
  @Returns(correctionTeachersAnswerSchema)
  correctionTeachers(
    @CurrentAccess() access: Access,
    @ValidParams(lessonParamsSchema) params: LessonParams,
  ): Promise<CorrectionTeachersAnswer> {
    return this.dayChanges.correctionTeachers(access, params.id);
  }
}
