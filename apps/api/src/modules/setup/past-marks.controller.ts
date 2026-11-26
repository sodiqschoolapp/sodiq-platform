import { Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import {
  pastMarkConfirmBodySchema,
  pastMarkConfirmResultSchema,
  pastMarkPreviewBodySchema,
  pastMarkPreviewSchema,
  pastMarkTemplateQuerySchema,
  pastMarkUploadListSchema,
  pastMarkUploadParamsSchema,
  pastMarkUploadQuerySchema,
  pastMarkWithdrawBodySchema,
  type PastMarkConfirmBody,
  type PastMarkConfirmResult,
  type PastMarkPreview,
  type PastMarkPreviewBody,
  type PastMarkTemplateQuery,
  type PastMarkUploadList,
  type PastMarkUploadParams,
  type PastMarkUploadQuery,
  type PastMarkWithdrawBody,
} from '@sodiq/shared';
import { PAST_MARK_IMPORT_ROUTE, type UploadedFile } from '../../http/file-routes.js';
import { RequestId } from '../../http/request-id.js';
import {
  Returns,
  ReturnsFile,
  ValidBody,
  ValidFile,
  ValidParams,
  ValidQuery,
} from '../../http/schemas.js';
import type { XlsxFile } from '../../http/xlsx.js';
import { Requires } from '../access/access.decorators.js';
import { CurrentAccess, type Access } from '../access/permission.guard.js';
import { PastMarks } from './past-marks.service.js';

/**
 * The import of past marks from before go-live (task 11.26; `10`, Past marks from before
 * go-live): the Super Admin and the Academic Vice Principal of the branch (`past_marks`, approved
 * by the owner, stop-list item 5). Every route works for the branch of the request.
 */
@Controller('setup/past-marks')
export class PastMarksController {
  constructor(private readonly pastMarks: PastMarks) {}

  /** The system's template, in the language asked (`10`, The file). */
  @Get('import-template')
  @Requires('past_marks', 'view')
  @ReturnsFile()
  template(
    @ValidQuery(pastMarkTemplateQuerySchema) query: PastMarkTemplateQuery,
  ): Promise<XlsxFile> {
    return this.pastMarks.template(query.language);
  }

  /** The confirmed uploads of the branch, standing or withdrawn (`10`, The upload). */
  @Get('imports')
  @Requires('past_marks', 'view')
  @Returns(pastMarkUploadListSchema)
  list(@CurrentAccess() access: Access): Promise<PastMarkUploadList> {
    return this.pastMarks.list(access);
  }

  /** The upload of a filled template: the rows are kept and the first page of the preview answered. */
  @Put('imports')
  @Requires('past_marks', 'create')
  @Returns(pastMarkPreviewSchema)
  upload(
    @CurrentAccess() access: Access,
    @ValidQuery(pastMarkUploadQuerySchema) query: PastMarkUploadQuery,
    @ValidFile(PAST_MARK_IMPORT_ROUTE) file: UploadedFile | null,
    @RequestId() requestId: string,
  ): Promise<PastMarkPreview> {
    return this.pastMarks.upload(access, file, query.name, requestId);
  }

  /** A page of the preview of a kept upload; nothing is saved. */
  @Post('imports/:id/preview')
  @HttpCode(200)
  @Requires('past_marks', 'create')
  @Returns(pastMarkPreviewSchema)
  preview(
    @CurrentAccess() access: Access,
    @ValidParams(pastMarkUploadParamsSchema) params: PastMarkUploadParams,
    @ValidBody(pastMarkPreviewBodySchema) body: PastMarkPreviewBody,
  ): Promise<PastMarkPreview> {
    return this.pastMarks.preview(access, params.id, body.page);
  }

  /** Saves every row of a kept upload, or nothing. */
  @Post('imports/:id/confirm')
  @HttpCode(200)
  @Requires('past_marks', 'create')
  @Returns(pastMarkConfirmResultSchema)
  confirm(
    @CurrentAccess() access: Access,
    @ValidParams(pastMarkUploadParamsSchema) params: PastMarkUploadParams,
    @ValidBody(pastMarkConfirmBodySchema) _body: PastMarkConfirmBody,
    @RequestId() requestId: string,
  ): Promise<PastMarkConfirmResult> {
    return this.pastMarks.confirm(access, params.id, requestId);
  }

  /** Withdraws a whole upload with a reason; answers the list of uploads (`10`, Withdrawal). */
  @Post('imports/:id/withdraw')
  @HttpCode(200)
  @Requires('past_marks', 'archive')
  @Returns(pastMarkUploadListSchema)
  async withdraw(
    @CurrentAccess() access: Access,
    @ValidParams(pastMarkUploadParamsSchema) params: PastMarkUploadParams,
    @ValidBody(pastMarkWithdrawBodySchema) body: PastMarkWithdrawBody,
    @RequestId() requestId: string,
  ): Promise<PastMarkUploadList> {
    await this.pastMarks.withdraw(access, params.id, body.reason, requestId);
    return this.pastMarks.list(access);
  }
}
