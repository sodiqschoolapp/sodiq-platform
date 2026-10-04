import { Global, Module } from '@nestjs/common';
import { Audit } from './audit.service.js';

// Global, like the database module: every module writes its changes to the log.
@Global()
@Module({
  providers: [Audit],
  exports: [Audit],
})
export class AuditModule {}
