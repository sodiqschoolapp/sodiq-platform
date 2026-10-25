import { Controller, Get } from '@nestjs/common';
import {
  journalSupportQuerySchema,
  journalSupportSchema,
  type JournalSupport,
  type JournalSupportQuery,
} from '@sodiq/shared';
import { RequestId } from '../../http/request-id.js';
import { Returns, ValidQuery } from '../../http/schemas.js';
import { Requires } from '../access/access.decorators.js';
import { CurrentAccess, type Access } from '../access/permission.guard.js';
import { SupportView } from './support-view.service.js';

/**
 * The support view of one student, journal and date (task 8.9, pull request
 * #227, decision 2; `edge/journal`, "My grade disappeared"): the Super Admin
 * and the Academic Vice Principal (`journal_support`), who read every journal
 * of the branch whole.
 */
@Controller('journal/support')
export class SupportViewController {
  constructor(private readonly support: SupportView) {}

  @Get()
  @Requires('journal_support', 'view')
  @Returns(journalSupportSchema)
  read(
    @CurrentAccess() access: Access,
    @ValidQuery(journalSupportQuerySchema) query: JournalSupportQuery,
    @RequestId() requestId: string,
  ): Promise<JournalSupport> {
    return this.support.read(access, query, requestId);
  }
}
