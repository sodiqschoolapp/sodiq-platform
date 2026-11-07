import { Controller, Get } from '@nestjs/common';
import {
  PLAN_FILE_TYPES,
  portalAttendanceWeekSchema,
  portalGradesQuerySchema,
  portalGradesSchema,
  type PortalAttendanceWeek,
  type PortalGrades,
  type PortalGradesQuery,
  portalChildParamsSchema,
  portalChildrenSchema,
  portalFileParamsSchema,
  portalHomeworkWeekSchema,
  portalRatingQuerySchema,
  portalRatingSchema,
  type PortalRating,
  type PortalRatingQuery,
  portalWeekQuerySchema,
  portalWeekSchema,
  type PortalChildParams,
  type PortalChildren,
  type PortalFileParams,
  type PortalHomeworkWeek,
  type PortalWeek,
  type PortalWeekQuery,
} from '@sodiq/shared';
import { Transactions } from '../../database/transactions.js';
import { Returns, ValidParams, ValidQuery } from '../../http/schemas.js';
import { ReturnsStoredFile, type StoredFile } from '../../http/stored-file.js';
import { PortalChild } from '../access/access.decorators.js';
import { CurrentSession } from '../auth/session.guard.js';
import type { ActiveSession } from '../auth/sessions.service.js';
import { RatingService } from '../results/rating.service.js';
import { PortalGradesService } from './portal-grades.service.js';
import { PortalHomeworkService } from './portal-homework.service.js';
import { portalChild, portalChildrenOf } from './portal-scope.js';
import { PortalTimetable } from './portal-timetable.service.js';

/**
 * The parent portal (task 11.2, pull request #294; `10`, What parents see): read only, for a
 * parent session alone (`@PortalChild()`), each route with the child scope checked on every
 * request (`portal-scope.ts`). The child is named in the path; the branch never is.
 */
@Controller('portal')
export class PortalController {
  constructor(
    private readonly transactions: Transactions,
    private readonly timetable: PortalTimetable,
    private readonly homework: PortalHomeworkService,
    private readonly grades: PortalGradesService,
    private readonly rating: RatingService,
  ) {}

  /** The child switcher: each linked student with portal access on, active, in any branch. */
  @Get('children')
  @PortalChild()
  @Returns(portalChildrenSchema)
  async children(@CurrentSession() session: ActiveSession): Promise<PortalChildren> {
    const children = await this.transactions.run([], (transaction) =>
      portalChildrenOf(transaction, session.accountId),
    );
    return portalChildrenSchema.parse({
      children: children.map((child) => ({
        id: child.id,
        firstName: child.firstName,
        lastName: child.lastName,
        className: child.className,
      })),
    });
  }

  @Get('children/:studentId/timetable')
  @PortalChild()
  @Returns(portalWeekSchema)
  week(
    @CurrentSession() session: ActiveSession,
    @ValidParams(portalChildParamsSchema) params: PortalChildParams,
    @ValidQuery(portalWeekQuerySchema) query: PortalWeekQuery,
  ): Promise<PortalWeek> {
    return this.timetable.week(session.accountId, params.studentId, query.date);
  }

  @Get('children/:studentId/homework')
  @PortalChild()
  @Returns(portalHomeworkWeekSchema)
  homeworkWeek(
    @CurrentSession() session: ActiveSession,
    @ValidParams(portalChildParamsSchema) params: PortalChildParams,
    @ValidQuery(portalWeekQuerySchema) query: PortalWeekQuery,
  ): Promise<PortalHomeworkWeek> {
    return this.homework.week(session.accountId, params.studentId, query.date);
  }

  /**
   * The Grades page (task 11.3, pull request #296): the figures of each subject in a quarter as
   * the staff results page gives them, the scores and the comments visible to parents.
   */
  @Get('children/:studentId/grades')
  @PortalChild()
  @Returns(portalGradesSchema)
  gradesOf(
    @CurrentSession() session: ActiveSession,
    @ValidParams(portalChildParamsSchema) params: PortalChildParams,
    @ValidQuery(portalGradesQuerySchema) query: PortalGradesQuery,
  ): Promise<PortalGrades> {
    return this.grades.grades(session.accountId, params.studentId, query.quarter);
  }

  /** The Attendance page (task 11.3): the marks of a week by day and lesson, exempt as exempt. */
  @Get('children/:studentId/attendance')
  @PortalChild()
  @Returns(portalAttendanceWeekSchema)
  attendanceWeek(
    @CurrentSession() session: ActiveSession,
    @ValidParams(portalChildParamsSchema) params: PortalChildParams,
    @ValidQuery(portalWeekQuerySchema) query: PortalWeekQuery,
  ): Promise<PortalAttendanceWeek> {
    return this.grades.attendance(session.accountId, params.studentId, query.date);
  }

  /**
   * The Rating page (task 11.6; `08`, Rating, "Own position"): the child's place in the class
   * across all subjects and the class average, in the child's present branch, without any other
   * student. The child scope first, on every request (404).
   */
  @Get('children/:studentId/rating')
  @PortalChild()
  @Returns(portalRatingSchema)
  async ratingOf(
    @CurrentSession() session: ActiveSession,
    @ValidParams(portalChildParamsSchema) params: PortalChildParams,
    @ValidQuery(portalRatingQuerySchema) query: PortalRatingQuery,
  ): Promise<PortalRating> {
    const child = await this.transactions.run([], (transaction) =>
      portalChild(transaction, session.accountId, params.studentId),
    );
    return this.rating.familyPosition(child, query.quarter);
  }

  /** A file of a homework the page lists for this child (decision 2, Look first); not an export. */
  @Get('children/:studentId/files/:fileId')
  @PortalChild()
  @ReturnsStoredFile(PLAN_FILE_TYPES)
  file(
    @CurrentSession() session: ActiveSession,
    @ValidParams(portalFileParamsSchema) params: PortalFileParams,
  ): Promise<StoredFile> {
    return this.homework.file(session.accountId, params.studentId, params.fileId);
  }
}
