import { Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import {
  patternImportConfirmResultSchema,
  patternImportConfirmSchema,
  patternImportParamsSchema,
  patternImportPreviewRunSchema,
  patternImportPreviewSchema,
  patternImportTemplateQuerySchema,
  timetableVersionParamsSchema,
  type PatternImportConfirm,
  type PatternImportConfirmResult,
  type PatternImportParams,
  type PatternImportPreview,
  type PatternImportPreviewRun,
  type PatternImportTemplateQuery,
  type TimetableVersionParams,
} from '@sodiq/shared';
import { PATTERN_IMPORT_ROUTE, type UploadedFile } from '../../http/file-routes.js';
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
import { PatternImports } from './pattern-imports.service.js';

/**
 * The timetable import into a draft (task 5.14; `06`, Importing the load and the timetable):
 * under `timetable` edit, the roles that edit the grid by hand (the Super Admin and the Academic
 * Vice Principal; approved by the owner on 15 November 2026), for the branch of the request.
 */
@Controller('timetable')
export class PatternImportsController {
  constructor(private readonly imports: PatternImports) {}

  /** The system's template of the draft, with the branch's records; logged (decision 9). */
  @Get('versions/:id/pattern/import-template')
  @Requires('timetable', 'edit')
  @ReturnsFile()
  template(
    @CurrentAccess() access: Access,
    @ValidParams(timetableVersionParamsSchema) params: TimetableVersionParams,
    @ValidQuery(patternImportTemplateQuerySchema) query: PatternImportTemplateQuery,
    @RequestId() requestId: string,
  ): Promise<XlsxFile> {
    return this.imports.template(access, params.id, query.language, requestId);
  }

  /** The upload of a filled template: the rows are kept and the preview answered. */
  @Put('versions/:id/pattern/imports')
  @Requires('timetable', 'edit')
  @Returns(patternImportPreviewSchema)
  upload(
    @CurrentAccess() access: Access,
    @ValidParams(timetableVersionParamsSchema) params: TimetableVersionParams,
    @ValidFile(PATTERN_IMPORT_ROUTE) file: UploadedFile | null,
    @RequestId() requestId: string,
  ): Promise<PatternImportPreview> {
    return this.imports.upload(access, params.id, file, requestId);
  }

  /** The preview of a kept upload; nothing is saved. The body is empty: nothing to decide. */
  @Post('versions/:id/pattern/imports/:importId/preview')
  @HttpCode(200)
  @Requires('timetable', 'edit')
  @Returns(patternImportPreviewSchema)
  preview(
    @ValidBody(patternImportPreviewRunSchema) _run: PatternImportPreviewRun,
    @CurrentAccess() access: Access,
    @ValidParams(patternImportParamsSchema) params: PatternImportParams,
  ): Promise<PatternImportPreview> {
    return this.imports.preview(access, params.id, params.importId);
  }

  /** Replaces every placement of the draft by the file's, or nothing (decision 3). */
  @Post('versions/:id/pattern/imports/:importId/confirm')
  @HttpCode(200)
  @Requires('timetable', 'edit')
  @Returns(patternImportConfirmResultSchema)
  confirm(
    @CurrentAccess() access: Access,
    @ValidParams(patternImportParamsSchema) params: PatternImportParams,
    @ValidBody(patternImportConfirmSchema) body: PatternImportConfirm,
    @RequestId() requestId: string,
  ): Promise<PatternImportConfirmResult> {
    return this.imports.confirm(access, params.id, params.importId, body.removes, requestId);
  }
}
