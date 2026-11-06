import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import {
  parentAccountSchema,
  parentClassParamsSchema,
  parentRelativeParamsSchema,
  parentResetSchema,
  parentSlipListSchema,
  parentSlipPrintSchema,
  parentsNeverUsedExportSchema,
  parentsNeverUsedSchema,
  printedParentSlipsSchema,
  type ParentAccount,
  type ParentClassParams,
  type ParentRelativeParams,
  type ParentReset,
  type ParentSlipList,
  type ParentSlipPrint,
  type ParentsNeverUsed,
  type ParentsNeverUsedExport,
  type PrintedParentSlips,
} from '@sodiq/shared';
import { RequestId } from '../../http/request-id.js';
import { Returns, ReturnsFile, ValidBody, ValidParams } from '../../http/schemas.js';
import type { XlsxFile } from '../../http/xlsx.js';
import { Requires } from '../access/access.decorators.js';
import { CurrentAccess, type Access } from '../access/permission.guard.js';
import { ParentAccounts } from './parent-accounts.service.js';

/**
 * The Parent accounts of relatives (task 11.1; `10`, Signing in; `edge/close-relatives`), under
 * `parent_accounts` (approved by the owner on 6 November 2026): the Super Admin and the
 * Academic Vice Principal, for the relatives linked to a student of the branch of the request.
 */
@Controller('people')
export class ParentAccountsController {
  constructor(private readonly parents: ParentAccounts) {}

  /** The relatives of a class with portal access on: to print, a valid slip, signed in. */
  @Get('classes/:classId/parent-slips')
  @Requires('parent_accounts', 'view')
  @Returns(parentSlipListSchema)
  slipList(
    @CurrentAccess() access: Access,
    @ValidParams(parentClassParamsSchema) params: ParentClassParams,
  ): Promise<ParentSlipList> {
    return this.parents.slipList(access, params.classId);
  }

  /** Prints the slips of a class; the passwords are answered once and stored nowhere. */
  @Post('classes/:classId/parent-slips')
  @HttpCode(200)
  @Requires('parent_accounts', 'create')
  @Returns(printedParentSlipsSchema)
  print(
    @CurrentAccess() access: Access,
    @ValidParams(parentClassParamsSchema) params: ParentClassParams,
    @ValidBody(parentSlipPrintSchema) request: ParentSlipPrint,
    @RequestId() requestId: string,
  ): Promise<PrintedParentSlips> {
    return this.parents.print(access, params.classId, request, requestId);
  }

  /** The reset of a parent's password: one slip, valid for 7 days. */
  @Post('parents/:relativeId/password-reset')
  @HttpCode(200)
  @Requires('parent_accounts', 'create')
  @Returns(printedParentSlipsSchema)
  reset(
    @CurrentAccess() access: Access,
    @ValidParams(parentRelativeParamsSchema) params: ParentRelativeParams,
    @ValidBody(parentResetSchema) request: ParentReset,
    @RequestId() requestId: string,
  ): Promise<PrintedParentSlips> {
    return this.parents.reset(access, params.relativeId, request, requestId);
  }

  /** The account part of the Parent page. */
  @Get('parents/:relativeId/account')
  @Requires('parent_accounts', 'view')
  @Returns(parentAccountSchema)
  account(
    @CurrentAccess() access: Access,
    @ValidParams(parentRelativeParamsSchema) params: ParentRelativeParams,
  ): Promise<ParentAccount> {
    return this.parents.account(access, params.relativeId);
  }

  /** The report of Parent accounts never used; each read is logged as an export. */
  @Get('parent-accounts/never-used')
  @Requires('parent_accounts', 'export')
  @Returns(parentsNeverUsedSchema)
  neverUsed(
    @CurrentAccess() access: Access,
    @RequestId() requestId: string,
  ): Promise<ParentsNeverUsed> {
    return this.parents.neverUsed(access, requestId);
  }

  /** The report in Excel. */
  @Post('parent-accounts/never-used/export')
  @Requires('parent_accounts', 'export')
  @ReturnsFile()
  neverUsedFile(
    @CurrentAccess() access: Access,
    @ValidBody(parentsNeverUsedExportSchema) request: ParentsNeverUsedExport,
    @RequestId() requestId: string,
  ): Promise<XlsxFile> {
    return this.parents.neverUsedFile(access, request, requestId);
  }
}
