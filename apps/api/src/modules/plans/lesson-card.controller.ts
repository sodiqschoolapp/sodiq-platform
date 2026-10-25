import { Controller, Get, Put } from '@nestjs/common';
import {
  homeworkGivenAnswerSchema,
  homeworkGivenSchema,
  journalLessonParamsSchema,
  lessonCardSchema,
  lessonDeliveryAnswerSchema,
  lessonDeliverySchema,
  type HomeworkGiven,
  type HomeworkGivenAnswer,
  type JournalLessonParams,
  type LessonCard,
  type LessonDelivery,
  type LessonDeliveryAnswer,
} from '@sodiq/shared';
import { RequestId } from '../../http/request-id.js';
import { Returns, ValidBody, ValidParams } from '../../http/schemas.js';
import { Requires } from '../access/access.decorators.js';
import { CurrentAccess, type Access } from '../access/permission.guard.js';
import { PlanDelivery } from './plan-delivery.service.js';

/**
 * The lesson card of the journal and its marks (task 8.8, pull request #226;
 * `09`, In the journal: "Clicking it opens the lesson card"; `edge/lesson-plans`,
 * "A substitute supervises the class"). Under the journal's area: the Tutor
 * reads topic and homework through the journal; the scope is decided in the
 * service for every request.
 */
@Controller('journal/lessons')
export class LessonCardController {
  constructor(private readonly delivery: PlanDelivery) {}

  @Get(':lessonId/card')
  @Requires('journal', 'view')
  @Returns(lessonCardSchema)
  card(
    @CurrentAccess() access: Access,
    @ValidParams(journalLessonParamsSchema) params: JournalLessonParams,
  ): Promise<LessonCard> {
    return this.delivery.card(access, params.lessonId);
  }

  /** "Topic not delivered", set or undone. */
  @Put(':lessonId/delivery')
  @Requires('journal', 'edit')
  @Returns(lessonDeliveryAnswerSchema)
  setDelivery(
    @CurrentAccess() access: Access,
    @ValidParams(journalLessonParamsSchema) params: JournalLessonParams,
    @ValidBody(lessonDeliverySchema) input: LessonDelivery,
    @RequestId() requestId: string,
  ): Promise<LessonDeliveryAnswer> {
    return this.delivery.setDelivery(access, params.lessonId, input, requestId);
  }

  /** "Not given" on some or all of the item's homeworks, or its undo. */
  @Put(':lessonId/homework-given')
  @Requires('journal', 'edit')
  @Returns(homeworkGivenAnswerSchema)
  setHomework(
    @CurrentAccess() access: Access,
    @ValidParams(journalLessonParamsSchema) params: JournalLessonParams,
    @ValidBody(homeworkGivenSchema) input: HomeworkGiven,
    @RequestId() requestId: string,
  ): Promise<HomeworkGivenAnswer> {
    return this.delivery.setHomework(access, params.lessonId, input, requestId);
  }
}
