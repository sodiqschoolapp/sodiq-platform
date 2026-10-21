import { Controller, HttpCode, Post } from '@nestjs/common';
import {
  vacancyFillBodySchema,
  vacancyFillCheckBodySchema,
  vacancyFillCheckSchema,
  vacancyFillSchema,
  type VacancyFill,
  type VacancyFillBody,
  type VacancyFillCheck,
  type VacancyFillCheckBody,
} from '@sodiq/shared';
import { RequestId } from '../../http/request-id.js';
import { RequestKey, Returns, ValidBody } from '../../http/schemas.js';
import { Requires } from '../access/access.decorators.js';
import { CurrentAccess, type Access } from '../access/permission.guard.js';
import { VacancyFills } from './vacancy-fills.service.js';

/**
 * Filling a vacancy (task 5.7a-3a, pull request #188, decision 9): the area
 * `timetable`, `edit`, the publish's permission, since the fill publishes a
 * version; no role widened. The check of a fill is a step of it, so the same
 * permission; it takes the rows in its body, as the exam check. Every route
 * works for the branch of the request.
 */
@Controller('timetable/vacancy-fills')
export class VacancyFillsController {
  constructor(private readonly fills: VacancyFills) {}

  /** A fill, safe to repeat with its key. */
  @Post()
  @HttpCode(201)
  @Requires('timetable', 'edit')
  @Returns(vacancyFillSchema)
  fill(
    @CurrentAccess() access: Access,
    @RequestKey() key: string,
    @ValidBody(vacancyFillBodySchema) input: VacancyFillBody,
    @RequestId() requestId: string,
  ): Promise<VacancyFill> {
    return this.fills.fill(access, input, key, requestId);
  }

  /** What a fill would do, nothing written. */
  @Post('check')
  @HttpCode(200)
  @Requires('timetable', 'edit')
  @Returns(vacancyFillCheckSchema)
  check(
    @CurrentAccess() access: Access,
    @ValidBody(vacancyFillCheckBodySchema) input: VacancyFillCheckBody,
    @RequestId() requestId: string,
  ): Promise<VacancyFillCheck> {
    return this.fills.check(access, input, requestId);
  }
}
