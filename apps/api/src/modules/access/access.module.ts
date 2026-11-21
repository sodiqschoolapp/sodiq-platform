import { Module } from '@nestjs/common';
import { PERMISSIONS } from '@sodiq/shared';
import { Assignments } from './assignments.service.js';
import { IntegrationKeysController } from './integration-keys.controller.js';
import { IntegrationKeys } from './integration-keys.service.js';
import { PERMISSION_TABLE } from './permission-table.token.js';

@Module({
  // Task 10.9: the Integration keys page of the Super Admin.
  controllers: [IntegrationKeysController],
  providers: [Assignments, IntegrationKeys, { provide: PERMISSION_TABLE, useValue: PERMISSIONS }],
  exports: [Assignments, PERMISSION_TABLE],
})
export class AccessModule {}
