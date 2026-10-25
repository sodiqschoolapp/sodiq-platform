import { Controller, Delete, HttpCode, Post, Put } from '@nestjs/common';
import {
  journalLessonParamsSchema,
  notGradedAnswerSchema,
  notGradedSchema,
  type NotGraded,
  type NotGradedAnswer,
  journalWorkParamsSchema,
  scoresSaveSchema,
  scoresSavedSchema,
  workAddSchema,
  workCarrySchema,
  workNotHeldSchema,
  workSavedSchema,
  workTotalSchema,
  type JournalLessonParams,
  type JournalWorkParams,
  type ScoresSave,
  type ScoresSaved,
  type WorkAdd,
  type WorkCarry,
  type WorkSaved,
} from '@sodiq/shared';
import type { z } from 'zod';
import { RequestId } from '../../http/request-id.js';
import { RequestKey, Returns, ReturnsNothing, ValidBody, ValidParams } from '../../http/schemas.js';
import { Requires } from '../access/access.decorators.js';
import { CurrentAccess, type Access } from '../access/permission.guard.js';
import { SaveRefusals } from './save-refusals.js';
import { WorksService } from './works.service.js';

/**
 * Classwork and homework of a lesson (task 8.1, pull request #217; `07`,
 * Entering data, The total, Who can do what). The table lets in the roles of
 * `journal` `edit`, as attendance entry (decision 14); the route decides the
 * lesson for every request (`WorksService`): 404 for an unknown lesson or
 * another branch's, then 403 `journal_entry_scope`, then the lesson's state,
 * then 409 `lesson_attendance_only`.
 */
@Controller('journal/lessons')
export class WorksController {
  constructor(
    private readonly works: WorksService,
    private readonly refusals: SaveRefusals,
  ) {}

  @Post(':lessonId/works')
  @HttpCode(200)
  @Requires('journal', 'edit')
  @Returns(workSavedSchema)
  add(
    @CurrentAccess() access: Access,
    @ValidParams(journalLessonParamsSchema) params: JournalLessonParams,
    @ValidBody(workAddSchema) input: WorkAdd,
    @RequestId() requestId: string,
  ): Promise<WorkSaved> {
    return this.works.add(access, params.lessonId, input, requestId);
  }

  @Delete(':lessonId/works/:workId')
  @Requires('journal', 'edit')
  @ReturnsNothing()
  remove(
    @CurrentAccess() access: Access,
    @ValidParams(journalWorkParamsSchema) params: JournalWorkParams,
    @RequestId() requestId: string,
  ): Promise<void> {
    return this.works.remove(access, params.lessonId, params.workId, requestId);
  }

  @Put(':lessonId/works/total')
  @Requires('journal', 'edit')
  @Returns(workSavedSchema)
  total(
    @CurrentAccess() access: Access,
    @ValidParams(journalLessonParamsSchema) params: JournalLessonParams,
    @ValidBody(workTotalSchema) input: z.output<typeof workTotalSchema>,
    @RequestId() requestId: string,
  ): Promise<WorkSaved> {
    return this.works.setTotal(access, params.lessonId, input, requestId);
  }

  @Put(':lessonId/works/not-held')
  @Requires('journal', 'edit')
  @Returns(workSavedSchema)
  notHeld(
    @CurrentAccess() access: Access,
    @ValidParams(journalLessonParamsSchema) params: JournalLessonParams,
    @ValidBody(workNotHeldSchema) input: z.output<typeof workNotHeldSchema>,
    @RequestId() requestId: string,
  ): Promise<WorkSaved> {
    return this.works.setNotHeld(access, params.lessonId, input, requestId);
  }

  @Post(':lessonId/works/carry')
  @HttpCode(200)
  @Requires('journal', 'edit')
  @Returns(workSavedSchema)
  carry(
    @CurrentAccess() access: Access,
    @ValidParams(journalLessonParamsSchema) params: JournalLessonParams,
    @ValidBody(workCarrySchema) input: WorkCarry,
    @RequestId() requestId: string,
  ): Promise<WorkSaved> {
    return this.works.carry(access, params.lessonId, input, requestId);
  }

  @Post(':lessonId/scores')
  @HttpCode(200)
  @Requires('journal', 'edit')
  @Returns(scoresSavedSchema)
  scores(
    @CurrentAccess() access: Access,
    @ValidParams(journalLessonParamsSchema) params: JournalLessonParams,
    @ValidBody(scoresSaveSchema) input: ScoresSave,
    @RequestKey() key: string,
    @RequestId() requestId: string,
  ): Promise<ScoresSaved> {
    // Task 8.9 (decision 7): a refused save is recorded for the support view.
    return this.refusals.recorded(
      access,
      {
        kind: 'score',
        lessonId: params.lessonId,
        cells: input.saves.map((save) => ({
          studentId: save.studentId,
          ...('workId' in save.column
            ? { workId: save.column.workId }
            : { planWorkId: save.column.planWorkId }),
          value: save.score,
          version: save.version,
        })),
      },
      requestId,
      () => this.works.saveScores(access, params.lessonId, input, key, requestId),
    );
  }

  /**
   * Task 8.7 (`07`, Lesson status): "the teacher can set those cells to 'not graded' in
   * one click, which completes the lesson and leaves them out of the average".
   */
  @Post(':lessonId/not-graded')
  @HttpCode(200)
  @Requires('journal', 'edit')
  @Returns(notGradedAnswerSchema)
  notGraded(
    @CurrentAccess() access: Access,
    @ValidParams(journalLessonParamsSchema) params: JournalLessonParams,
    @ValidBody(notGradedSchema) input: NotGraded,
    @RequestId() requestId: string,
  ): Promise<NotGradedAnswer> {
    return this.works.notGraded(access, params.lessonId, input, requestId);
  }
}
