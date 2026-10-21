import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import {
  forcedDeleteAnswerSchema,
  forcedDeleteListSchema,
  forcedDeleteParamsSchema,
  forcedDeleteRestoreBodySchema,
  type ForcedDeleteAnswer,
  type ForcedDeleteList,
  type ForcedDeleteParams,
  type ForcedDeleteRestoreBody,
} from '@sodiq/shared';
import { RequestId } from '../../http/request-id.js';
import { RequestKey, Returns, ValidBody, ValidParams } from '../../http/schemas.js';
import { Requires } from '../access/access.decorators.js';
import { CurrentAccess, type Access } from '../access/permission.guard.js';
import { ForcedDeleteStore } from './forced-deletes.service.js';

/**
 * The store of forced deletes (task 5.8b, pull request #195, decision 10):
 * the Super Admin lists the records of the branch and restores one within 30
 * days. Every route works for the branch of the request.
 */
@Controller('forced-deletes')
export class ForcedDeletesController {
  constructor(private readonly store: ForcedDeleteStore) {}

  @Get()
  @Requires('forced_deletes', 'view')
  @Returns(forcedDeleteListSchema)
  list(@CurrentAccess() access: Access): Promise<ForcedDeleteList> {
    return this.store.list(access);
  }

  /** The restore of a forced delete within its 30 days, every rule checked again, safe to repeat with its key. */
  @Post(':id/restore')
  @HttpCode(200)
  @Requires('forced_deletes', 'edit')
  @Returns(forcedDeleteAnswerSchema)
  restore(
    @CurrentAccess() access: Access,
    @ValidParams(forcedDeleteParamsSchema) params: ForcedDeleteParams,
    @RequestKey() key: string,
    // Nothing is sent; a field of its own is refused, never dropped.
    @ValidBody(forcedDeleteRestoreBodySchema) _body: ForcedDeleteRestoreBody,
    @RequestId() requestId: string,
  ): Promise<ForcedDeleteAnswer> {
    return this.store.restore(access, params.id, key, requestId);
  }
}
