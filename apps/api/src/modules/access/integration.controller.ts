import { Controller, Get } from '@nestjs/common';
import { integrationKeyActingPeopleSchema, type IntegrationKeyActingPeople } from '@sodiq/shared';
import { Returns } from '../../http/schemas.js';
import { CurrentIntegrationKey } from '../auth/session.guard.js';
import { KeyOnly } from './access.decorators.js';
import type { FoundKey } from './integration-key-requests.service.js';
import { IntegrationKeyRequests } from './integration-key-requests.service.js';

/**
 * The routes of a department platform's key itself (task 10.10, pull request #369): answered
 * only to a request made with the key, never to a session.
 */
@Controller('integration')
export class IntegrationController {
  constructor(private readonly keyRequests: IntegrationKeyRequests) {}

  /**
   * The people on the key now (build plan 10.10: "a route that lists the key's people with
   * their staff IDs and names"; decision 2, Look first): for each, the staff ID to send in
   * `X-Acting-Staff-Id`, whether a request may act for them now, and the branches to send
   * in `X-Branch-Id`.
   */
  @Get('people')
  @KeyOnly()
  @Returns(integrationKeyActingPeopleSchema)
  people(@CurrentIntegrationKey() key: FoundKey): Promise<IntegrationKeyActingPeople> {
    return this.keyRequests.people(key);
  }
}
