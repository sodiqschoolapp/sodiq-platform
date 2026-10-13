import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import {
  auditEntryParamsSchema,
  auditEntrySchema,
  auditPageSchema,
  auditQuerySchema,
  signInHistoryQuerySchema,
  signInHistorySchema,
  type AuditEntryAnswer,
  type AuditEntryParams,
  type AuditPage,
  type AuditQuery,
  type SignInHistory,
  type SignInHistoryQuery,
} from '@sodiq/shared';
import { RequestId } from '../../http/request-id.js';
import { Returns, ValidParams, ValidQuery } from '../../http/schemas.js';
import { AnySignedIn, Requires } from '../access/access.decorators.js';
import { CurrentAccess, type Access } from '../access/permission.guard.js';
import { CurrentSession } from '../auth/session.guard.js';
import type { ActiveSession } from '../auth/sessions.service.js';
import { AuditEntries } from './audit-entries.service.js';
import { SignInHistoryReader } from './sign-in-history.service.js';

/**
 * The Audit log page (edge/people-roles-accounts, Personal data and the audit
 * log; task 2.6a, pull request #75). The area `audit_log` (decision 2): the
 * Super Admin, the Principal and the Academic Vice Principal, for the branch
 * of the request; which entries each reads is decided in the service.
 */
@Controller('audit')
export class AuditLogController {
  constructor(private readonly entries: AuditEntries) {}

  /** One page of entries; reading the log is not logged (decision 8). */
  @Get('entries')
  @Requires('audit_log', 'view')
  @Returns(auditPageSchema)
  list(
    @CurrentAccess() access: Access,
    @ValidQuery(auditQuerySchema) query: AuditQuery,
  ): Promise<AuditPage> {
    return this.entries.list(access, query);
  }

  /** The hidden values of one entry, with a logged show (decision 6). */
  @Post('entries/:id/show')
  @HttpCode(200)
  @Requires('audit_log', 'view')
  @Returns(auditEntrySchema)
  show(
    @CurrentAccess() access: Access,
    @ValidParams(auditEntryParamsSchema) params: AuditEntryParams,
    @RequestId() requestId: string,
  ): Promise<AuditEntryAnswer> {
    return this.entries.show(access, params.id, requestId);
  }
}

/** The own sign-in history, on the account page (decision 10). Own account only. */
@Controller('auth')
export class SignInHistoryController {
  constructor(private readonly history: SignInHistoryReader) {}

  @Get('sign-in-history')
  @AnySignedIn()
  @Returns(signInHistorySchema)
  read(
    @CurrentSession() session: ActiveSession,
    @ValidQuery(signInHistoryQuerySchema) query: SignInHistoryQuery,
  ): Promise<SignInHistory> {
    return this.history.read(session.accountId, query.before);
  }
}
