import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import {
  accountAccessSchema,
  firstPasswordSlipSchema,
  lockSchema,
  neverUsedListSchema,
  resetEntriesQuerySchema,
  resetEntriesSchema,
  staffParamsSchema,
  type AccountAccess as AccountAccessAnswer,
  type FirstPasswordSlip,
  type Lock,
  type NeverUsedList,
  type ResetEntries as ResetEntriesAnswer,
  type ResetEntriesQuery,
  type StaffParams,
} from '@sodiq/shared';
import { RequestId } from '../../http/request-id.js';
import { Returns, ValidBody, ValidParams, ValidQuery } from '../../http/schemas.js';
import { Requires } from '../access/access.decorators.js';
import { CurrentAccess, type Access } from '../access/permission.guard.js';
import { AccountAccess } from './account-access.service.js';
import { ResetEntries } from './reset-entries.service.js';

/**
 * The sign-in access of a staff record's account (task 2.3c-1, pull request
 * #65). The area `account_access` (decision 2): the Super Admin and the
 * Academic Vice Principal view and change it, the Principal views. The server
 * keeps the Academic Vice Principal to the Teachers, Tutors, Head Teachers and
 * the Head Tutor of the branch, and the second-step reset to the Super Admin
 * (decisions 3 and 4). Every route works for the branch of the request.
 */
@Controller('people')
export class AccountAccessController {
  constructor(
    private readonly accountAccess: AccountAccess,
    private readonly resetEntries: ResetEntries,
  ) {}

  @Get('staff/:id/account/access')
  @Requires('account_access', 'view')
  @Returns(accountAccessSchema)
  read(
    @CurrentAccess() access: Access,
    @ValidParams(staffParamsSchema) params: StaffParams,
  ): Promise<AccountAccessAnswer> {
    return this.accountAccess.read(access, params.id);
  }

  @Post('staff/:id/account/lock')
  @HttpCode(200)
  @Requires('account_access', 'edit')
  @Returns(accountAccessSchema)
  lock(
    @CurrentAccess() access: Access,
    @ValidParams(staffParamsSchema) params: StaffParams,
    @ValidBody(lockSchema) body: Lock,
    @RequestId() requestId: string,
  ): Promise<AccountAccessAnswer> {
    return this.accountAccess.lock(access, params.id, body.reason, requestId);
  }

  @Post('staff/:id/account/unlock')
  @HttpCode(200)
  @Requires('account_access', 'edit')
  @Returns(accountAccessSchema)
  unlock(
    @CurrentAccess() access: Access,
    @ValidParams(staffParamsSchema) params: StaffParams,
    @RequestId() requestId: string,
  ): Promise<AccountAccessAnswer> {
    return this.accountAccess.unlock(access, params.id, requestId);
  }

  /** The answer holds the one-time password, once: it is stored nowhere. */
  @Post('staff/:id/account/password-reset')
  @HttpCode(200)
  @Requires('account_access', 'edit')
  @Returns(firstPasswordSlipSchema)
  resetPassword(
    @CurrentAccess() access: Access,
    @ValidParams(staffParamsSchema) params: StaffParams,
    @RequestId() requestId: string,
  ): Promise<FirstPasswordSlip> {
    return this.accountAccess.resetPassword(access, params.id, requestId);
  }

  /** The Super Admin alone, decided from every current assignment; always with a password reset. */
  @Post('staff/:id/account/second-step-reset')
  @HttpCode(200)
  @Requires('account_access', 'edit')
  @Returns(firstPasswordSlipSchema)
  resetSecondStep(
    @CurrentAccess() access: Access,
    @ValidParams(staffParamsSchema) params: StaffParams,
    @RequestId() requestId: string,
  ): Promise<FirstPasswordSlip> {
    return this.accountAccess.resetSecondStep(access, params.id, requestId);
  }

  /** Accounts never used (Accounts and sign-in: "A report lists accounts never used"). */
  @Get('accounts/never-used')
  @Requires('account_access', 'view')
  @Returns(neverUsedListSchema)
  neverUsed(@CurrentAccess() access: Access): Promise<NeverUsedList> {
    return this.accountAccess.neverUsed(access);
  }

  /**
   * Entries made within 48 hours of a password reset (task 6.1c, pull request
   * #209; Accounts and sign-in: "A report lists entries made within 48 hours
   * of a reset"): the readers of "Accounts never used" (decision 5).
   */
  @Get('accounts/reset-entries')
  @Requires('account_access', 'view')
  @Returns(resetEntriesSchema)
  resetEntriesReport(
    @CurrentAccess() access: Access,
    @ValidQuery(resetEntriesQuerySchema) query: ResetEntriesQuery,
  ): Promise<ResetEntriesAnswer> {
    return this.resetEntries.read(access, query);
  }
}
