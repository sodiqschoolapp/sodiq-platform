import { Controller, Get } from '@nestjs/common';
import {
  studentAttendanceSchema,
  studentParamsSchema,
  studentResultLessonsQuerySchema,
  studentResultLessonsSchema,
  studentResultsQuerySchema,
  studentResultsSchema,
  studentResultTabsSchema,
  type StudentAttendance,
  type StudentParams,
  type StudentResultLessons,
  type StudentResultLessonsQuery,
  type StudentResults,
  type StudentResultsQuery,
  type StudentResultTabs,
} from '@sodiq/shared';
import { Returns, ValidParams, ValidQuery } from '../../http/schemas.js';
import { Requires } from '../access/access.decorators.js';
import { CurrentAccess, type Access } from '../access/permission.guard.js';
import { StudentResultsService } from './student-results.service.js';

/**
 * A student's Results and Attendance tabs and the lessons behind a figure
 * (task 9.1; `08`, Student results; `04`, Profile tabs). The area `students`
 * `view`, the readers of the record, as the result at leaving (8.6 decision
 * 14; decision 12); each subject only for a reader of the student's row of its
 * journal, decided in the route (`student-results.service.ts`, decision 4).
 */
@Controller('results')
export class StudentResultsController {
  constructor(private readonly results: StudentResultsService) {}

  @Get('students/:id/tabs')
  @Requires('students', 'view')
  @Returns(studentResultTabsSchema)
  tabs(
    @CurrentAccess() access: Access,
    @ValidParams(studentParamsSchema) params: StudentParams,
  ): Promise<StudentResultTabs> {
    return this.results.tabs(access, params.id);
  }

  @Get('students/:id/attendance')
  @Requires('students', 'view')
  @Returns(studentAttendanceSchema)
  attendance(
    @CurrentAccess() access: Access,
    @ValidParams(studentParamsSchema) params: StudentParams,
    @ValidQuery(studentResultsQuerySchema) query: StudentResultsQuery,
  ): Promise<StudentAttendance> {
    return this.results.attendance(access, params.id, query.yearId);
  }

  @Get('students/:id/lessons')
  @Requires('students', 'view')
  @Returns(studentResultLessonsSchema)
  lessons(
    @CurrentAccess() access: Access,
    @ValidParams(studentParamsSchema) params: StudentParams,
    @ValidQuery(studentResultLessonsQuerySchema) query: StudentResultLessonsQuery,
  ): Promise<StudentResultLessons> {
    return this.results.lessons(access, params.id, query.subjectId, query.quarterId);
  }

  @Get('students/:id')
  @Requires('students', 'view')
  @Returns(studentResultsSchema)
  read(
    @CurrentAccess() access: Access,
    @ValidParams(studentParamsSchema) params: StudentParams,
    @ValidQuery(studentResultsQuerySchema) query: StudentResultsQuery,
  ): Promise<StudentResults> {
    return this.results.results(access, params.id, query.yearId);
  }
}
