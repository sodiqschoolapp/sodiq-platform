import { Module } from '@nestjs/common';
import { PERMISSIONS } from '@sodiq/shared';
import { Assignments } from './assignments.service.js';
import { PERMISSION_TABLE } from './permission-table.token.js';

@Module({
  providers: [Assignments, { provide: PERMISSION_TABLE, useValue: PERMISSIONS }],
  exports: [Assignments, PERMISSION_TABLE],
})
export class AccessModule {}
