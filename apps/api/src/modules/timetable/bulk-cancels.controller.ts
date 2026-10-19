import { Controller, HttpCode, Post } from '@nestjs/common';
import {
  bulkCancelAnswerSchema,
  bulkCancelBodySchema,
  bulkCancelCheckAnswerSchema,
  bulkCancelCheckBodySchema,
  type BulkCancelAnswer,
  type BulkCancelBody,
  type BulkCancelCheckAnswer,
  type BulkCancelCheckBody,
} from '@sodiq/shared';
import { RequestId } from '../../http/request-id.js';
import { RequestKey, Returns, ValidBody } from '../../http/schemas.js';
import { Requires } from '../access/access.decorators.js';
import { CurrentAccess, type Access } from '../access/permission.guard.js';
import { TimetableBulkCancels } from './bulk-cancels.service.js';

/**
 * The bulk cancel of the published timetable (task 5.6a-3, pull request
 * #162): the area `timetable`, no role widened. The Super Admin and the
 * Academic Vice Principal check and save it (`edit`), for the branch of the
 * request.
 */
@Controller('timetable/bulk-cancels')
export class BulkCancelsController {
  constructor(private readonly bulkCancels: TimetableBulkCancels) {}

  /** What a bulk cancel would do: the lessons, the shared blocks and the doubles; writes nothing. */
  @Post('check')
  @HttpCode(200)
  @Requires('timetable', 'edit')
  @Returns(bulkCancelCheckAnswerSchema)
  check(
    @CurrentAccess() access: Access,
    @ValidBody(bulkCancelCheckBodySchema) input: BulkCancelCheckBody,
  ): Promise<BulkCancelCheckAnswer> {
    return this.bulkCancels.check(access, input);
  }

  /** The bulk cancel with its reason and a choice for each shared block, safe to repeat with its key. */
  @Post()
  @HttpCode(200)
  @Requires('timetable', 'edit')
  @Returns(bulkCancelAnswerSchema)
  save(
    @CurrentAccess() access: Access,
    @RequestKey() key: string,
    @ValidBody(bulkCancelBodySchema) input: BulkCancelBody,
    @RequestId() requestId: string,
  ): Promise<BulkCancelAnswer> {
    return this.bulkCancels.save(access, input, key, requestId);
  }
}
