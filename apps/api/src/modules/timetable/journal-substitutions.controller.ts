import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import {
  absenceJournalParamsSchema,
  absenceJournalSubstituteBodySchema,
  absenceParamsSchema,
  journalSubstituteAnswerSchema,
  journalSubstitutesAnswerSchema,
  vacancyJournalParamsSchema,
  vacancyJournalSubstituteBodySchema,
  vacancyJournalSubstitutesQuerySchema,
  vacancyParamsSchema,
  type AbsenceJournalParams,
  type AbsenceJournalSubstituteBody,
  type AbsenceParams,
  type JournalSubstituteAnswer,
  type JournalSubstitutesAnswer,
  type VacancyJournalParams,
  type VacancyJournalSubstituteBody,
  type VacancyJournalSubstitutesQuery,
  type VacancyParams,
} from '@sodiq/shared';
import { RequestId } from '../../http/request-id.js';
import { RequestKey, Returns, ValidBody, ValidParams, ValidQuery } from '../../http/schemas.js';
import { Requires } from '../access/access.decorators.js';
import { CurrentAccess, type Access } from '../access/permission.guard.js';
import { TimetableJournalSubstitutions } from './journal-substitutions.service.js';

/**
 * The substitution per journal from an absence or a vacancy (task 5.7b-2,
 * pull request #192): the area `timetable`, no role widened (decision 9).
 * The Super Admin and the Academic Vice Principal read the suggestions and
 * save (`edit`), as for the substitution of one lesson. Every route works
 * for the branch of the request.
 */
@Controller('timetable')
export class JournalSubstitutionsController {
  constructor(private readonly journals: TimetableJournalSubstitutions) {}

  /** The suggested substitutes for the journal's lessons of the absence (decision 11). */
  @Get('absences/:id/journals/:journalId/substitutes')
  @Requires('timetable', 'edit')
  @Returns(journalSubstitutesAnswerSchema)
  absenceSubstitutes(
    @CurrentAccess() access: Access,
    @ValidParams(absenceJournalParamsSchema) params: AbsenceJournalParams,
  ): Promise<JournalSubstitutesAnswer> {
    return this.journals.absenceSubstitutes(access, params.id, params.journalId);
  }

  /** One substitute for the journal's lessons of the absence, each date checked, safe to repeat with its key. */
  @Post('absences/:id/journal-substitute')
  @HttpCode(200)
  @Requires('timetable', 'edit')
  @Returns(journalSubstituteAnswerSchema)
  absenceSubstitute(
    @CurrentAccess() access: Access,
    @ValidParams(absenceParamsSchema) params: AbsenceParams,
    @RequestKey() key: string,
    @ValidBody(absenceJournalSubstituteBodySchema) input: AbsenceJournalSubstituteBody,
    @RequestId() requestId: string,
  ): Promise<JournalSubstituteAnswer> {
    return this.journals.absenceSubstitute(access, params.id, input, key, requestId);
  }

  /** The suggested substitutes for a vacancy's journal over a period, its acting teacher marked (decision 7). */
  @Get('vacancies/:id/journals/:journalId/substitutes')
  @Requires('timetable', 'edit')
  @Returns(journalSubstitutesAnswerSchema)
  vacancySubstitutes(
    @CurrentAccess() access: Access,
    @ValidParams(vacancyJournalParamsSchema) params: VacancyJournalParams,
    @ValidQuery(vacancyJournalSubstitutesQuerySchema) query: VacancyJournalSubstitutesQuery,
  ): Promise<JournalSubstitutesAnswer> {
    return this.journals.vacancySubstitutes(access, params.id, params.journalId, query);
  }

  /** One substitute for a vacancy's journal over a period, each date checked, safe to repeat with its key. */
  @Post('vacancies/:id/journal-substitute')
  @HttpCode(200)
  @Requires('timetable', 'edit')
  @Returns(journalSubstituteAnswerSchema)
  vacancySubstitute(
    @CurrentAccess() access: Access,
    @ValidParams(vacancyParamsSchema) params: VacancyParams,
    @RequestKey() key: string,
    @ValidBody(vacancyJournalSubstituteBodySchema) input: VacancyJournalSubstituteBody,
    @RequestId() requestId: string,
  ): Promise<JournalSubstituteAnswer> {
    return this.journals.vacancySubstitute(access, params.id, input, key, requestId);
  }
}
