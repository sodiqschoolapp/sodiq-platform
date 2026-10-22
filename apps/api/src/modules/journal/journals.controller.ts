import { Controller, Get } from '@nestjs/common';
import {
  journalGridQuerySchema,
  journalGridSchema,
  journalListQuerySchema,
  journalListSchema,
  journalParamsSchema,
  type JournalGrid,
  type JournalGridQuery,
  type JournalList,
  type JournalListQuery,
  type JournalParams,
} from '@sodiq/shared';
import { Returns, ValidParams, ValidQuery } from '../../http/schemas.js';
import { Requires } from '../access/access.decorators.js';
import { CurrentAccess, type Access } from '../access/permission.guard.js';
import { JournalGridReader } from './journal-grid.service.js';

/**
 * The Journals page and the journal grid, read only (task 6.2, pull request
 * #210; `07`, Opening a journal, Layout, Who can do what). The area `journal`
 * lets the nine roles in; the scope of each is decided in the route for every
 * request (`journal-scope.ts`): 404 for an unknown id or another branch's,
 * then 403 `journal_scope` outside it (decision 19). A read writes no audit
 * entry (decision 17).
 */
@Controller('journal/journals')
export class JournalsController {
  constructor(private readonly reader: JournalGridReader) {}

  @Get()
  @Requires('journal', 'view')
  @Returns(journalListSchema)
  list(
    @ValidQuery(journalListQuerySchema) query: JournalListQuery,
    @CurrentAccess() access: Access,
  ): Promise<JournalList> {
    return this.reader.list(access, query);
  }

  @Get(':journalId')
  @Requires('journal', 'view')
  @Returns(journalGridSchema)
  grid(
    @ValidParams(journalParamsSchema) params: JournalParams,
    @ValidQuery(journalGridQuerySchema) query: JournalGridQuery,
    @CurrentAccess() access: Access,
  ): Promise<JournalGrid> {
    return this.reader.grid(access, params.journalId, query);
  }
}
