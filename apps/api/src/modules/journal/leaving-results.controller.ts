import { Controller, Get } from '@nestjs/common';
import {
  studentLeavingResultsSchema,
  studentParamsSchema,
  type StudentLeavingResults,
  type StudentParams,
} from '@sodiq/shared';
import { Returns, ValidParams } from '../../http/schemas.js';
import { Requires } from '../access/access.decorators.js';
import { CurrentAccess, type Access } from '../access/permission.guard.js';
import { LeavingResults } from './leaving-results.service.js';

/**
 * The results at leaving on a student's record (task 8.6, pull request #224;
 * `edge/calculation`, a result at leaving): the area `students` `view`, the
 * readers of the record (correction 4 of the plan review); each subject only
 * for a reader who reads its journal whole on the last day, decided in the
 * route (`leaving-results.service.ts`). Under the path of the student's record.
 */
@Controller('people')
export class LeavingResultsController {
  constructor(private readonly results: LeavingResults) {}

  @Get('students/:id/leaving-results')
  @Requires('students', 'view')
  @Returns(studentLeavingResultsSchema)
  read(
    @CurrentAccess() access: Access,
    @ValidParams(studentParamsSchema) params: StudentParams,
  ): Promise<StudentLeavingResults> {
    return this.results.read(access, params.id);
  }
}
