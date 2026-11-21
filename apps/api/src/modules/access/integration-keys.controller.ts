import { Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import {
  integrationKeyChoicesSchema,
  integrationKeyCreatedSchema,
  integrationKeyEndDateSchema,
  integrationKeyListSchema,
  integrationKeyParamsSchema,
  integrationKeyPeopleSchema,
  integrationKeyRecordSchema,
  integrationKeySchema,
  type IntegrationKey,
  type IntegrationKeyChoices,
  type IntegrationKeyCreated,
  type IntegrationKeyEndDate,
  type IntegrationKeyList,
  type IntegrationKeyParams,
  type IntegrationKeyPeople,
  type IntegrationKeyRecord,
} from '@sodiq/shared';
import { RequestId } from '../../http/request-id.js';
import { Returns, ValidBody, ValidParams } from '../../http/schemas.js';
import { Requires } from './access.decorators.js';
import { IntegrationKeys } from './integration-keys.service.js';
import { CurrentAccess, type Access } from './permission.guard.js';

/**
 * The Integration keys page of the Super Admin (`02`, Integration keys; task
 * 10.9, pull request #368). School-wide work under the area
 * `integration_keys`, which the Super Admin alone holds. Nothing here accepts
 * a key: requests made with one are task 10.10.
 */
@Controller('integration-keys')
export class IntegrationKeysController {
  constructor(private readonly keys: IntegrationKeys) {}

  @Get()
  @Requires('integration_keys', 'view', { branch: 'none' })
  @Returns(integrationKeyListSchema)
  list(): Promise<IntegrationKeyList> {
    return this.keys.list();
  }

  /** The people who may be put on a key now, in every branch. */
  @Get('choices')
  @Requires('integration_keys', 'view', { branch: 'none' })
  @Returns(integrationKeyChoicesSchema)
  choices(): Promise<IntegrationKeyChoices> {
    return this.keys.choices();
  }

  /** Creates a key; the answer holds its secret this one time, and nothing reads it again. */
  @Post()
  @Requires('integration_keys', 'create', { branch: 'none' })
  @Returns(integrationKeyCreatedSchema)
  create(
    @CurrentAccess() access: Access,
    @ValidBody(integrationKeyRecordSchema) record: IntegrationKeyRecord,
    @RequestId() requestId: string,
  ): Promise<IntegrationKeyCreated> {
    return this.keys.create(access, record, requestId);
  }

  @Put(':id/people')
  @Requires('integration_keys', 'edit', { branch: 'none' })
  @Returns(integrationKeySchema)
  changePeople(
    @CurrentAccess() access: Access,
    @ValidParams(integrationKeyParamsSchema) params: IntegrationKeyParams,
    @ValidBody(integrationKeyPeopleSchema) body: IntegrationKeyPeople,
    @RequestId() requestId: string,
  ): Promise<IntegrationKey> {
    return this.keys.changePeople(access, params.id, body.staffRecordIds, requestId);
  }

  @Put(':id/end-date')
  @Requires('integration_keys', 'edit', { branch: 'none' })
  @Returns(integrationKeySchema)
  changeEnd(
    @CurrentAccess() access: Access,
    @ValidParams(integrationKeyParamsSchema) params: IntegrationKeyParams,
    @ValidBody(integrationKeyEndDateSchema) body: IntegrationKeyEndDate,
    @RequestId() requestId: string,
  ): Promise<IntegrationKey> {
    return this.keys.changeEnd(access, params.id, body.endsOn, requestId);
  }

  /** Revokes a key for good; a revoked key is answered unchanged. */
  @Post(':id/revoke')
  @HttpCode(200)
  @Requires('integration_keys', 'edit', { branch: 'none' })
  @Returns(integrationKeySchema)
  revoke(
    @CurrentAccess() access: Access,
    @ValidParams(integrationKeyParamsSchema) params: IntegrationKeyParams,
    @RequestId() requestId: string,
  ): Promise<IntegrationKey> {
    return this.keys.revoke(access, params.id, requestId);
  }
}
