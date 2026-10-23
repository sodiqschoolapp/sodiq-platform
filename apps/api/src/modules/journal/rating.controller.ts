import { Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import {
  journalRatingParamsSchema,
  journalRatingStudentParamsSchema,
  ratingDateSchema,
  ratingEntrySaveSchema,
  ratingExamSchema,
  ratingHistorySchema,
  ratingNotHeldSchema,
  type JournalRatingParams,
  type JournalRatingStudentParams,
  type RatingDate,
  type RatingEntrySave,
  type RatingExam,
  type RatingHistory,
} from '@sodiq/shared';
import type { z } from 'zod';
import { RequestId } from '../../http/request-id.js';
import { Returns, ValidBody, ValidParams } from '../../http/schemas.js';
import { Requires } from '../access/access.decorators.js';
import { CurrentAccess, type Access } from '../access/permission.guard.js';
import { RatingService } from './rating.service.js';

/**
 * The rating exam of a journal in a quarter (task 8.2, pull request #218;
 * `edge/calculation`, "The rating exam", "The exam is not held for one
 * group"). The guard decides role and branch; the route decides the reader:
 * the journal's teacher today types scores and "did not sit", the Academic
 * Vice Principal sets "exempt" and "not held", either sets the hand date, and
 * anyone else is refused `rating_exam_scope`. The rating exam is read with the
 * journal grid; the history with the grid's scope.
 */
@Controller('journal/journals')
export class RatingController {
  constructor(private readonly rating: RatingService) {}

  @Put(':journalId/rating/:quarterId/date')
  @Requires('journal', 'edit')
  @Returns(ratingExamSchema)
  date(
    @CurrentAccess() access: Access,
    @ValidParams(journalRatingParamsSchema) params: JournalRatingParams,
    @ValidBody(ratingDateSchema) input: RatingDate,
    @RequestId() requestId: string,
  ): Promise<RatingExam> {
    return this.rating.setDate(access, params.journalId, params.quarterId, input, requestId);
  }

  @Put(':journalId/rating/:quarterId/not-held')
  @Requires('journal', 'edit')
  @Returns(ratingExamSchema)
  notHeld(
    @CurrentAccess() access: Access,
    @ValidParams(journalRatingParamsSchema) params: JournalRatingParams,
    @ValidBody(ratingNotHeldSchema) input: z.output<typeof ratingNotHeldSchema>,
    @RequestId() requestId: string,
  ): Promise<RatingExam> {
    return this.rating.setNotHeld(access, params.journalId, params.quarterId, input, requestId);
  }

  @Post(':journalId/rating/:quarterId/entries')
  @HttpCode(200)
  @Requires('journal', 'edit')
  @Returns(ratingExamSchema)
  entry(
    @CurrentAccess() access: Access,
    @ValidParams(journalRatingParamsSchema) params: JournalRatingParams,
    @ValidBody(ratingEntrySaveSchema) input: RatingEntrySave,
    @RequestId() requestId: string,
  ): Promise<RatingExam> {
    return this.rating.saveEntry(access, params.journalId, params.quarterId, input, requestId);
  }

  @Get(':journalId/rating/:quarterId/students/:studentId/history')
  @Requires('journal', 'view')
  @Returns(ratingHistorySchema)
  history(
    @CurrentAccess() access: Access,
    @ValidParams(journalRatingStudentParamsSchema) params: JournalRatingStudentParams,
  ): Promise<RatingHistory> {
    return this.rating.history(access, params.journalId, params.quarterId, params.studentId);
  }
}
