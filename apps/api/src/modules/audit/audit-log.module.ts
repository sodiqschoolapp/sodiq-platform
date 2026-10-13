import { Module } from '@nestjs/common';
import { AuditEntries } from './audit-entries.service.js';
import { AuditLogController, SignInHistoryController } from './audit-log.controller.js';
import { SignInHistoryReader } from './sign-in-history.service.js';

/**
 * The reading side of the audit log (task 2.6a): the Audit log page and the
 * own sign-in history. Apart from `AuditModule`, which every module writes
 * through and the first-account command loads without any route.
 */
@Module({
  controllers: [AuditLogController, SignInHistoryController],
  providers: [AuditEntries, SignInHistoryReader],
})
export class AuditLogModule {}
