import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import {
  dayChangeAnswerSchema,
  lessonParamsSchema,
  lessonSubstituteBodySchema,
  substitutesAnswerSchema,
  substitutionWithdrawBodySchema,
  type DayChangeAnswer,
  type LessonParams,
  type LessonSubstituteBody,
  type SubstitutesAnswer,
  type SubstitutionWithdrawBody,
} from '@sodiq/shared';
import { RequestId } from '../../http/request-id.js';
import { RequestKey, Returns, ValidBody, ValidParams } from '../../http/schemas.js';
import { Requires } from '../access/access.decorators.js';
import { CurrentAccess, type Access } from '../access/permission.guard.js';
import { TimetableSubstitutions } from './substitutions.service.js';

/**
 * The substitution of a lesson (task 5.7b-1, pull request #191): the area
 * `timetable`, no role widened (decision 9). The Super Admin and the Academic
 * Vice Principal read the suggestions, substitute and withdraw (`edit`), as
 * for every one-day change. Every route works for the branch of the request.
 */
@Controller('timetable')
export class SubstitutionsController {
  constructor(private readonly substitutions: TimetableSubstitutions) {}

  /** The suggested substitutes of a lesson (decision 3). */
  @Get('lessons/:id/substitutes')
  @Requires('timetable', 'edit')
  @Returns(substitutesAnswerSchema)
  substitutes(
    @CurrentAccess() access: Access,
    @ValidParams(lessonParamsSchema) params: LessonParams,
  ): Promise<SubstitutesAnswer> {
    return this.substitutions.substitutes(access, params.id);
  }

  /** A substitution of one lesson (both halves of a double), with a reason, safe to repeat with its key. */
  @Post('lessons/:id/substitute')
  @HttpCode(200)
  @Requires('timetable', 'edit')
  @Returns(dayChangeAnswerSchema)
  substitute(
    @CurrentAccess() access: Access,
    @ValidParams(lessonParamsSchema) params: LessonParams,
    @RequestKey() key: string,
    @ValidBody(lessonSubstituteBodySchema) input: LessonSubstituteBody,
    @RequestId() requestId: string,
  ): Promise<DayChangeAnswer> {
    return this.substitutions.substitute(access, params.id, input, key, requestId);
  }

  /** The withdrawal of a substitution in force, with a reason, safe to repeat with its key. */
  @Post('lessons/:id/substitution/withdraw')
  @HttpCode(200)
  @Requires('timetable', 'edit')
  @Returns(dayChangeAnswerSchema)
  withdraw(
    @CurrentAccess() access: Access,
    @ValidParams(lessonParamsSchema) params: LessonParams,
    @RequestKey() key: string,
    @ValidBody(substitutionWithdrawBodySchema) input: SubstitutionWithdrawBody,
    @RequestId() requestId: string,
  ): Promise<DayChangeAnswer> {
    return this.substitutions.withdraw(access, params.id, input, key, requestId);
  }
}
