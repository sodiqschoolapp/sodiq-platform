import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import {
  disciplineQuerySchema,
  disciplineSchema,
  lessonsTodayQuerySchema,
  lessonsTodaySchema,
  orphanAssignSchema,
  orphanAssignmentParamsSchema,
  orphanAssignmentSchema,
  orphanLessonsSchema,
  orphanParamsSchema,
  ownRemindersQuerySchema,
  remindersSchema,
  type Discipline,
  type DisciplineQuery,
  type LessonsToday,
  type LessonsTodayQuery,
  type OrphanAssign,
  type OrphanAssignment,
  type OrphanLessons,
  type OwnRemindersQuery,
  type Reminders,
} from '@sodiq/shared';
import type { z } from 'zod';
import { RequestId } from '../../http/request-id.js';
import { Returns, ReturnsNothing, ValidBody, ValidParams, ValidQuery } from '../../http/schemas.js';
import { Requires } from '../access/access.decorators.js';
import { CurrentAccess, type Access } from '../access/permission.guard.js';
import { LessonStatusService } from './lesson-status.service.js';

/**
 * The reminders of the teaching home, the counts per teacher and the orphan
 * lessons (task 8.7, pull request #225; `07`, Lesson status, Reminders; `08`,
 * Journal discipline; `edge/journal`, Locks). The scope is decided in the
 * service for every request: the reminders are the caller's own; the counts
 * the branch, own subjects or the Tutor subjects; the orphan lessons the
 * branch's. A read writes no audit entry.
 */
@Controller('journal')
export class LessonStatusController {
  constructor(private readonly status: LessonStatusService) {}

  /** `07`, Reminders: the panel of the teacher home page, the caller's own lessons (decision 13). */
  @Get('reminders')
  @Requires('journal', 'view')
  @Returns(remindersSchema)
  reminders(
    // Strict and empty: a field naming a person is refused.
    @ValidQuery(ownRemindersQuerySchema) _query: OwnRemindersQuery,
    @CurrentAccess() access: Access,
  ): Promise<Reminders> {
    return this.status.ownReminders(access);
  }

  /** Task 9.4b: `08`, Home pages by role, Academic Vice Principal, "Lessons today and their status". */
  @Get('lessons-today')
  @Requires('journal_discipline', 'view')
  @Returns(lessonsTodaySchema)
  lessonsToday(
    @ValidQuery(lessonsTodayQuerySchema) _query: LessonsTodayQuery,
    @CurrentAccess() access: Access,
  ): Promise<LessonsToday> {
    return this.status.today(access);
  }

  /** `07`, Lesson status: "Head Teachers and the Academic Vice Principal see the same counts per teacher". */
  @Get('discipline')
  @Requires('journal_discipline', 'view')
  @Returns(disciplineSchema)
  discipline(
    @ValidQuery(disciplineQuerySchema) query: DisciplineQuery,
    @CurrentAccess() access: Access,
  ): Promise<Discipline> {
    return this.status.discipline(access, query);
  }

  /** `edge/journal`: "They go to an 'orphan lessons' list." */
  @Get('orphans')
  @Requires('journal_orphans', 'view')
  @Returns(orphanLessonsSchema)
  orphans(@CurrentAccess() access: Access): Promise<OrphanLessons> {
    return this.status.orphans(access);
  }

  /** `edge/journal`: "The Academic Vice Principal assigns a teacher to complete them, with a reason." */
  @Post('orphans/:lessonId/assign')
  @HttpCode(200)
  @Requires('journal_orphans', 'edit')
  @Returns(orphanAssignmentSchema)
  assign(
    @CurrentAccess() access: Access,
    @ValidParams(orphanParamsSchema) params: z.infer<typeof orphanParamsSchema>,
    @ValidBody(orphanAssignSchema) input: OrphanAssign,
    @RequestId() requestId: string,
  ): Promise<OrphanAssignment> {
    return this.status.assign(access, params.lessonId, input, requestId);
  }

  @Post('orphans/assignments/:assignmentId/withdraw')
  @Requires('journal_orphans', 'edit')
  @ReturnsNothing()
  withdraw(
    @CurrentAccess() access: Access,
    @ValidParams(orphanAssignmentParamsSchema) params: z.infer<typeof orphanAssignmentParamsSchema>,
    @RequestId() requestId: string,
  ): Promise<void> {
    return this.status.withdraw(access, params.assignmentId, requestId);
  }
}
