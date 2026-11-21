import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { PERMISSIONS } from '@sodiq/shared';
import { AssistantCalls } from './assistant-calls.js';
import { AssistantRoutes } from './assistant-routes.check.js';
import { ASSISTANT_ROUTE_LISTS, ASSISTANT_ROUTES } from './assistant-routes.js';
import { Assignments } from './assignments.service.js';
import { IntegrationKeyRequests } from './integration-key-requests.service.js';
import { IntegrationController } from './integration.controller.js';
import { IntegrationKeysController } from './integration-keys.controller.js';
import { IntegrationKeys } from './integration-keys.service.js';
import { KeyRoutesCheck } from './key-routes.check.js';
import { PERMISSION_TABLE } from './permission-table.token.js';

@Module({
  // Task 10.10: the start-up check of the routes open to keys reads every controller.
  imports: [DiscoveryModule],
  // Task 10.9: the Integration keys page of the Super Admin.
  controllers: [IntegrationKeysController, IntegrationController],
  providers: [
    Assignments,
    IntegrationKeys,
    IntegrationKeyRequests,
    KeyRoutesCheck,
    // Task 11.12: the mark of the assistant's reads and its lists, read by `PermissionGuard`.
    AssistantCalls,
    AssistantRoutes,
    { provide: ASSISTANT_ROUTE_LISTS, useValue: ASSISTANT_ROUTES },
    { provide: PERMISSION_TABLE, useValue: PERMISSIONS },
  ],
  exports: [Assignments, IntegrationKeyRequests, PERMISSION_TABLE, AssistantCalls, AssistantRoutes],
})
export class AccessModule {}
