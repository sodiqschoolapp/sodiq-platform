import { Global, Module } from '@nestjs/common';
import { Audit } from './audit.service.js';
import { ForcedDeleteStore } from './forced-deletes.service.js';

// Global, like the database module: every module writes its changes to the log,
// and a kind of record registers its restore with the store of forced deletes
// (task 5.8b).
@Global()
@Module({
  providers: [Audit, ForcedDeleteStore],
  exports: [Audit, ForcedDeleteStore],
})
export class AuditModule {}
