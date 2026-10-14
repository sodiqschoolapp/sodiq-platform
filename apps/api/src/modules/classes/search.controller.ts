import { Controller, Get } from '@nestjs/common';
import {
  classSearchSchema,
  groupSearchSchema,
  searchQuerySchema,
  type ClassSearch,
  type GroupSearch,
  type SearchQuery,
} from '@sodiq/shared';
import { Returns, ValidQuery } from '../../http/schemas.js';
import { Requires } from '../access/access.decorators.js';
import { CurrentAccess, type Access } from '../access/permission.guard.js';
import { RecordSearch } from './record-search.js';

/**
 * Ctrl+K over classes and groups (docs/spec/12-ux-standards.md, Search; task
 * 3.2d, pull request #94). Each route is guarded as the list and record
 * routes of its kind (decision 3); the guard fills a Tutor's classes for both
 * areas (`CLASS_SCOPED_AREAS`). A search writes no audit entry (decision 8).
 */
@Controller('search')
export class ClassesSearchController {
  constructor(private readonly search: RecordSearch) {}

  @Get('classes')
  @Requires('classes', 'view')
  @Returns(classSearchSchema)
  findClasses(
    @CurrentAccess() access: Access,
    @ValidQuery(searchQuerySchema) query: SearchQuery,
  ): Promise<ClassSearch> {
    return this.search.classes(access, query.q);
  }

  @Get('groups')
  @Requires('groups', 'view')
  @Returns(groupSearchSchema)
  findGroups(
    @CurrentAccess() access: Access,
    @ValidQuery(searchQuerySchema) query: SearchQuery,
  ): Promise<GroupSearch> {
    return this.search.groups(access, query.q);
  }
}
