import { Controller, Get } from '@nestjs/common';
import {
  relativeSearchSchema,
  searchQuerySchema,
  staffSearchSchema,
  studentSearchSchema,
  type RelativeSearch as RelativeSearchAnswer,
  type SearchQuery,
  type StaffSearch as StaffSearchAnswer,
  type StudentSearch as StudentSearchAnswer,
} from '@sodiq/shared';
import { Returns, ValidQuery } from '../../http/schemas.js';
import { Requires } from '../access/access.decorators.js';
import { CurrentAccess, type Access } from '../access/permission.guard.js';
import { RelativeSearch } from './relative-search.js';
import { StaffSearch } from './staff-search.js';
import { StudentSearch } from './student-search.js';

/**
 * Ctrl+K over students and staff (docs/spec/12-ux-standards.md, Search; task
 * 3.2d, pull request #94). Each route is guarded as the record route of its
 * kind (decision 3): no new area, the scope decided in the route. A search is
 * a read and writes no audit entry (decision 8). Both work for the branch of
 * the request.
 */
@Controller('search')
export class PeopleSearchController {
  constructor(
    private readonly students: StudentSearch,
    private readonly staff: StaffSearch,
    private readonly relatives: RelativeSearch,
  ) {}

  @Get('students')
  @Requires('students', 'view')
  @Returns(studentSearchSchema)
  findStudents(
    @CurrentAccess() access: Access,
    @ValidQuery(searchQuerySchema) query: SearchQuery,
  ): Promise<StudentSearchAnswer> {
    return this.students.find(access, query.q);
  }

  @Get('staff')
  @Requires('staff', 'view')
  @Returns(staffSearchSchema)
  findStaff(
    @CurrentAccess() access: Access,
    @ValidQuery(searchQuerySchema) query: SearchQuery,
  ): Promise<StaffSearchAnswer> {
    return this.staff.find(access, query.q);
  }

  /**
   * Relatives by name and main phone, for the readers of relatives (task
   * 3.5b, H33 of issue #105): the Super Admin, the Principal and the Academic
   * Vice Principal.
   */
  @Get('relatives')
  @Requires('relatives', 'view')
  @Returns(relativeSearchSchema)
  findRelatives(
    @CurrentAccess() access: Access,
    @ValidQuery(searchQuerySchema) query: SearchQuery,
  ): Promise<RelativeSearchAnswer> {
    return this.relatives.find(access, query.q);
  }
}
