import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import {
  forcedDeleteAnswerSchema,
  forcedDeleteBodySchema,
  lessonHistorySchema,
  lessonParamsSchema,
  type ForcedDeleteAnswer,
  type ForcedDeleteBody,
  type LessonHistory,
  type LessonParams,
} from '@sodiq/shared';
import { RequestId } from '../../http/request-id.js';
import { RequestKey, Returns, ValidBody, ValidParams } from '../../http/schemas.js';
import { Requires } from '../access/access.decorators.js';
import { CurrentAccess, type Access } from '../access/permission.guard.js';
import { LessonForcedDeletes, LessonHistoryReader } from './forced-deletes.service.js';

/**
 * The Super Admin's forced delete of a dated lesson and the history of a
 * lesson (task 5.8b, pull request #195): the forced delete in the new area
 * `forced_deletes` (decision 10), the history under `timetable` `view`. Every
 * route works for the branch of the request.
 */
@Controller('timetable')
export class LessonForcedDeletesController {
  constructor(
    private readonly forcedDeletes: LessonForcedDeletes,
    private readonly histories: LessonHistoryReader,
  ) {}

  /** The forced delete of one dated lesson with a typed reason, safe to repeat with its key. */
  @Post('lessons/:id/forced-delete')
  @HttpCode(200)
  @Requires('forced_deletes', 'edit')
  @Returns(forcedDeleteAnswerSchema)
  forceDelete(
    @CurrentAccess() access: Access,
    @ValidParams(lessonParamsSchema) params: LessonParams,
    @RequestKey() key: string,
    @ValidBody(forcedDeleteBodySchema) input: ForcedDeleteBody,
    @RequestId() requestId: string,
  ): Promise<ForcedDeleteAnswer> {
    return this.forcedDeletes.forceDelete(access, params.id, input, key, requestId);
  }

  /** Who changed the lesson's teacher, room, time or cancel, when, before and after. */
  @Get('lessons/:id/history')
  @Requires('timetable', 'view')
  @Returns(lessonHistorySchema)
  history(
    @CurrentAccess() access: Access,
    @ValidParams(lessonParamsSchema) params: LessonParams,
  ): Promise<LessonHistory> {
    return this.histories.history(access, params.id);
  }
}
