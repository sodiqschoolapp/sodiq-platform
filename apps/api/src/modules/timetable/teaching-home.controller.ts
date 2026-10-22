import { Controller, Get } from '@nestjs/common';
import {
  teachingHomeQuerySchema,
  teachingHomeSchema,
  type TeachingHome,
  type TeachingHomeQuery,
} from '@sodiq/shared';
import { Returns, ValidQuery } from '../../http/schemas.js';
import { Requires } from '../access/access.decorators.js';
import { CurrentAccess, type Access } from '../access/permission.guard.js';
import { HOME_REQUIREMENT, TimetableViews } from './views.service.js';

/**
 * The home page of a person who teaches (task 5.9b, pull request #198): the
 * caller's own lessons and exams of the week, from every branch, under the
 * area of the views (decision 4). Own only: the query takes no field. A read
 * writes no audit entry (5.9a decision 12).
 */
@Controller('timetable/home')
export class TeachingHomeController {
  constructor(private readonly views: TimetableViews) {}

  @Get()
  @Requires(HOME_REQUIREMENT.area, HOME_REQUIREMENT.action)
  @Returns(teachingHomeSchema)
  home(
    // Strict and empty: a field naming a person is refused (spec review should-fix 4).
    @ValidQuery(teachingHomeQuerySchema) _query: TeachingHomeQuery,
    @CurrentAccess() access: Access,
  ): Promise<TeachingHome> {
    return this.views.home(access);
  }
}
