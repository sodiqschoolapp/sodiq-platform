import { Controller, Get, Post } from '@nestjs/common';
import {
  earlyWarningHandledSchema,
  earlyWarningHandleSchema,
  earlyWarningListSchema,
  earlyWarningQuerySchema,
  type EarlyWarningHandle,
  type EarlyWarningHandled,
  type EarlyWarningList,
  type EarlyWarningQuery,
} from '@sodiq/shared';
import { RequestId } from '../../http/request-id.js';
import { Returns, ValidBody, ValidQuery } from '../../http/schemas.js';
import { Requires } from '../access/access.decorators.js';
import { CurrentAccess, type Access } from '../access/permission.guard.js';
import { EarlyWarningService } from './early-warning.service.js';

/**
 * The early-warning list (task 9.4a, pull request #235; `08`, Early-warning list), area
 * `early_warning` (plan decision 1, Look first). The guard lets the readers of `08` in; the
 * entries and reasons each reads, and who may mark one handled, are decided in the route
 * (`early-warning.service.ts`). A read writes no audit entry; marking handled writes one.
 */
@Controller('results/early-warning')
export class EarlyWarningController {
  constructor(private readonly earlyWarning: EarlyWarningService) {}

  @Get()
  @Requires('early_warning', 'view')
  @Returns(earlyWarningListSchema)
  list(
    @CurrentAccess() access: Access,
    @ValidQuery(earlyWarningQuerySchema) query: EarlyWarningQuery,
  ): Promise<EarlyWarningList> {
    return this.earlyWarning.list(access, query);
  }

  /** A staff-only note and the mark "handled" on one reason of an entry (`08`, Handled). */
  @Post('handled')
  @Requires('early_warning', 'edit')
  @Returns(earlyWarningHandledSchema)
  handle(
    @CurrentAccess() access: Access,
    @ValidBody(earlyWarningHandleSchema) input: EarlyWarningHandle,
    @RequestId() requestId: string,
  ): Promise<EarlyWarningHandled> {
    return this.earlyWarning.handle(access, input, requestId);
  }
}
