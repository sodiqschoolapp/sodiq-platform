import { Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import {
  loadImportConfirmResultSchema,
  loadImportParamsSchema,
  loadImportPreviewSchema,
  loadImportRunSchema,
  loadImportTemplateQuerySchema,
  timetableVersionParamsSchema,
  type LoadImportConfirmResult,
  type LoadImportParams,
  type LoadImportPreview,
  type LoadImportRun,
  type LoadImportTemplateQuery,
  type TimetableVersionParams,
} from '@sodiq/shared';
import { LOAD_IMPORT_ROUTE, type UploadedFile } from '../../http/file-routes.js';
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
import { LoadImports } from './load-imports.service.js';

/**
 * The teaching load import into a draft (task 5.13; `06`, Importing the load and the timetable):
 * under `timetable` edit, the roles that edit the load by hand (the Super Admin and the Academic
 * Vice Principal; approved by the owner on 15 November 2026), for the branch of the request.
 */
@Controller('timetable')
export class LoadImportsController {
  constructor(private readonly imports: LoadImports) {}

  /** The system's template of the draft, with the branch's records; logged (decision 10). */
  @Get('versions/:id/load/import-template')
  @Requires('timetable', 'edit')
  @ReturnsFile()
  template(
    @CurrentAccess() access: Access,
    @ValidParams(timetableVersionParamsSchema) params: TimetableVersionParams,
    @ValidQuery(loadImportTemplateQuerySchema) query: LoadImportTemplateQuery,
    @RequestId() requestId: string,
  ): Promise<XlsxFile> {
    return this.imports.template(access, params.id, query.language, requestId);
  }

  /** The upload of a filled template: the rows are kept and the preview answered. */
  @Put('versions/:id/load/imports')
  @Requires('timetable', 'edit')
  @Returns(loadImportPreviewSchema)
  upload(
    @CurrentAccess() access: Access,
    @ValidParams(timetableVersionParamsSchema) params: TimetableVersionParams,
    @ValidFile(LOAD_IMPORT_ROUTE) file: UploadedFile | null,
    @RequestId() requestId: string,
  ): Promise<LoadImportPreview> {
    return this.imports.upload(access, params.id, file, requestId);
  }

  /** The preview of a kept upload; nothing is saved. The body is empty: nothing to decide. */
  @Post('versions/:id/load/imports/:importId/preview')
  @HttpCode(200)
  @Requires('timetable', 'edit')
  @Returns(loadImportPreviewSchema)
  preview(
    @CurrentAccess() access: Access,
    @ValidParams(loadImportParamsSchema) params: LoadImportParams,
    @ValidBody(loadImportRunSchema) _run: LoadImportRun,
  ): Promise<LoadImportPreview> {
    return this.imports.preview(access, params.id, params.importId);
  }

  /** Adds every row of a kept upload to the draft's load, or nothing. */
  @Post('versions/:id/load/imports/:importId/confirm')
  @HttpCode(200)
  @Requires('timetable', 'edit')
  @Returns(loadImportConfirmResultSchema)
  confirm(
    @CurrentAccess() access: Access,
    @ValidParams(loadImportParamsSchema) params: LoadImportParams,
    @ValidBody(loadImportRunSchema) _run: LoadImportRun,
    @RequestId() requestId: string,
  ): Promise<LoadImportConfirmResult> {
    return this.imports.confirm(access, params.id, params.importId, requestId);
  }
}
