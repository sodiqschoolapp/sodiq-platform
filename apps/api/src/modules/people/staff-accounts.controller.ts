import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import {
  accountCreateSchema,
  firstPasswordSlipSchema,
  loginSuggestionSchema,
  roleEndSchema,
  roleGiveSchema,
  roleParamsSchema,
  staffAccountSchema,
  staffParamsSchema,
  superAdminSummarySchema,
  type AccountCreate,
  type FirstPasswordSlip,
  type LoginSuggestion,
  type RoleEnd,
  type RoleGive,
  type RoleParams,
  type StaffAccount,
  type StaffParams,
  type SuperAdminSummary,
} from '@sodiq/shared';
import { RequestId } from '../../http/request-id.js';
import { Returns, ValidBody, ValidParams } from '../../http/schemas.js';
import { Requires } from '../access/access.decorators.js';
import { CurrentAccess, type Access } from '../access/permission.guard.js';
import { StaffAccounts } from './staff-accounts.service.js';

/**
 * The account section of a staff record (task 2.3a, pull request #62). The
 * area `accounts` (decision 4): the Super Admin views, creates the account
 * (`create`) and gives and ends roles (`edit`); the Principal views. Every
 * route of a record works for the branch of the request.
 */
@Controller()
export class StaffAccountsController {
  constructor(private readonly staffAccounts: StaffAccounts) {}

  @Get('people/staff/:id/account')
  @Requires('accounts', 'view')
  @Returns(staffAccountSchema)
  read(
    @CurrentAccess() access: Access,
    @ValidParams(staffParamsSchema) params: StaffParams,
  ): Promise<StaffAccount> {
    return this.staffAccounts.read(access, params.id);
  }

  @Get('people/staff/:id/account/suggestion')
  @Requires('accounts', 'create')
  @Returns(loginSuggestionSchema)
  suggestion(
    @CurrentAccess() access: Access,
    @ValidParams(staffParamsSchema) params: StaffParams,
  ): Promise<LoginSuggestion> {
    return this.staffAccounts.suggest(access, params.id);
  }

  /** The answer holds the first password, once: it is stored nowhere. */
  @Post('people/staff/:id/account')
  @Requires('accounts', 'create')
  @Returns(firstPasswordSlipSchema, 201)
  create(
    @CurrentAccess() access: Access,
    @ValidParams(staffParamsSchema) params: StaffParams,
    @ValidBody(accountCreateSchema) body: AccountCreate,
    @RequestId() requestId: string,
  ): Promise<FirstPasswordSlip> {
    return this.staffAccounts.create(access, params.id, body.login, requestId);
  }

  @Post('people/staff/:id/roles')
  @Requires('accounts', 'edit')
  @Returns(staffAccountSchema, 201)
  give(
    @CurrentAccess() access: Access,
    @ValidParams(staffParamsSchema) params: StaffParams,
    @ValidBody(roleGiveSchema) give: RoleGive,
    @RequestId() requestId: string,
  ): Promise<StaffAccount> {
    return this.staffAccounts.give(access, params.id, give, requestId);
  }

  @Post('people/staff/:id/roles/:assignmentId/end')
  @HttpCode(200)
  @Requires('accounts', 'edit')
  @Returns(staffAccountSchema)
  end(
    @CurrentAccess() access: Access,
    @ValidParams(roleParamsSchema) params: RoleParams,
    @ValidBody(roleEndSchema) end: RoleEnd,
    @RequestId() requestId: string,
  ): Promise<StaffAccount> {
    return this.staffAccounts.end(access, params.id, params.assignmentId, end, requestId);
  }

  /** For the banner while fewer than two Super Admins exist; `create` is the Super Admin's alone. */
  @Get('access/super-admins')
  @Requires('accounts', 'create', { branch: 'none' })
  @Returns(superAdminSummarySchema)
  superAdmins(): Promise<SuperAdminSummary> {
    return this.staffAccounts.superAdmins();
  }
}
