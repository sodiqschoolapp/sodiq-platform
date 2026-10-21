import { Controller, HttpCode, Post } from '@nestjs/common';
import {
  forcedDeleteAnswerSchema,
  forcedDeleteBodySchema,
  setupIdParamsSchema,
  type ForcedDeleteAnswer,
  type ForcedDeleteBody,
  type SetupIdParams,
} from '@sodiq/shared';
import { RequestId } from '../../http/request-id.js';
import { RequestKey, Returns, ValidBody, ValidParams } from '../../http/schemas.js';
import { Requires } from '../access/access.decorators.js';
import { CurrentAccess, type Access } from '../access/permission.guard.js';
import { PlaceForcedDeletes } from './place-forced-deletes.service.js';

/**
 * The Super Admin's forced delete of a building, floor or room that nothing
 * references (task 5.8c, pull request #196): the area `forced_deletes` of
 * 5.8b (decision 7). The restore is the store's (`POST
 * /api/forced-deletes/:id/restore`). Every route works for the branch of the
 * request and is safe to repeat with its key.
 */
@Controller('setup')
export class PlaceForcedDeletesController {
  constructor(private readonly places: PlaceForcedDeletes) {}

  @Post('buildings/:id/forced-delete')
  @HttpCode(200)
  @Requires('forced_deletes', 'edit')
  @Returns(forcedDeleteAnswerSchema)
  building(
    @CurrentAccess() access: Access,
    @ValidParams(setupIdParamsSchema) params: SetupIdParams,
    @RequestKey() key: string,
    @ValidBody(forcedDeleteBodySchema) input: ForcedDeleteBody,
    @RequestId() requestId: string,
  ): Promise<ForcedDeleteAnswer> {
    return this.places.forceDelete(access, 'building', params.id, input, key, requestId);
  }

  @Post('floors/:id/forced-delete')
  @HttpCode(200)
  @Requires('forced_deletes', 'edit')
  @Returns(forcedDeleteAnswerSchema)
  floor(
    @CurrentAccess() access: Access,
    @ValidParams(setupIdParamsSchema) params: SetupIdParams,
    @RequestKey() key: string,
    @ValidBody(forcedDeleteBodySchema) input: ForcedDeleteBody,
    @RequestId() requestId: string,
  ): Promise<ForcedDeleteAnswer> {
    return this.places.forceDelete(access, 'floor', params.id, input, key, requestId);
  }

  @Post('rooms/:id/forced-delete')
  @HttpCode(200)
  @Requires('forced_deletes', 'edit')
  @Returns(forcedDeleteAnswerSchema)
  room(
    @CurrentAccess() access: Access,
    @ValidParams(setupIdParamsSchema) params: SetupIdParams,
    @RequestKey() key: string,
    @ValidBody(forcedDeleteBodySchema) input: ForcedDeleteBody,
    @RequestId() requestId: string,
  ): Promise<ForcedDeleteAnswer> {
    return this.places.forceDelete(access, 'room', params.id, input, key, requestId);
  }
}
