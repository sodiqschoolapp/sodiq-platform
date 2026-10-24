import { Controller, Delete, Get, HttpCode, Patch, Post, Put } from '@nestjs/common';
import {
  EXEMPTION_FILE_TYPES,
  exemptionAbsencesSchema,
  exemptionBatchChangedSchema,
  exemptionBatchEndSchema,
  exemptionBatchParamsSchema,
  exemptionBatchVoidSchema,
  exemptionCreatedSchema,
  exemptionCreateSchema,
  exemptionDocumentQuerySchema,
  exemptionEditSchema,
  exemptionEndSchema,
  exemptionListSchema,
  exemptionMoveConfirmSchema,
  exemptionMoveOfferParamsSchema,
  exemptionMoveOffersSchema,
  exemptionParamsSchema,
  exemptionPreviewSchema,
  exemptionReasonSchema,
  exemptionSchema,
  exemptionsQuerySchema,
  exemptionVoidPreviewSchema,
  exemptionVoidSchema,
  exemptionsTodaySchema,
  type Exemption,
  type ExemptionAbsences,
  type ExemptionBatchChanged,
  type ExemptionBatchEnd,
  type ExemptionBatchParams,
  type ExemptionBatchVoid,
  type ExemptionCreate,
  type ExemptionCreated,
  type ExemptionDocumentQuery,
  type ExemptionEdit,
  type ExemptionEnd,
  type ExemptionList,
  type ExemptionMoveConfirm,
  type ExemptionMoveOfferParams,
  type ExemptionMoveOffers,
  type ExemptionParams,
  type ExemptionPreview,
  type ExemptionReason,
  type ExemptionsQuery,
  type ExemptionVoid,
  type ExemptionVoidPreview,
  type ExemptionsToday,
} from '@sodiq/shared';
import { EXEMPTION_FILE_ROUTE, type UploadedFile } from '../../http/file-routes.js';
import { RequestId } from '../../http/request-id.js';
import {
  RequestKey,
  Returns,
  ValidBody,
  ValidFile,
  ValidParams,
  ValidQuery,
} from '../../http/schemas.js';
import { ReturnsStoredFile, type StoredFile } from '../../http/stored-file.js';
import { Requires } from '../access/access.decorators.js';
import { CurrentAccess, type Access } from '../access/permission.guard.js';
import { Exemptions } from './exemptions.service.js';

/**
 * Exemptions (task 8.5, pull request #223): the area `exemptions` (decision 1,
 * Look first): the Super Admin and the Academic Vice Principal enter and change
 * them, the Principal reads. A preview is a step of its change, so the change's
 * permission. Every id of the path or the body is checked against the branch
 * of the request (404).
 */
@Controller('exemptions')
export class ExemptionsController {
  constructor(private readonly exemptions: Exemptions) {}

  @Get()
  @Requires('exemptions', 'view')
  @Returns(exemptionListSchema)
  list(
    @CurrentAccess() access: Access,
    @ValidQuery(exemptionsQuerySchema) query: ExemptionsQuery,
  ): Promise<ExemptionList> {
    return this.exemptions.list(access, query);
  }

  /** `edge/exemptions`, row 9: absences with a Tutor's reason and no exemption. */
  @Get('absences-without')
  @Requires('exemptions', 'view')
  @Returns(exemptionAbsencesSchema)
  absencesWithout(@CurrentAccess() access: Access): Promise<ExemptionAbsences> {
    return this.exemptions.absencesWithout(access);
  }

  /** The exemptions a branch move offers this branch (decision 3). */
  @Get('move-offers')
  @Requires('exemptions', 'view')
  @Returns(exemptionMoveOffersSchema)
  offers(@CurrentAccess() access: Access): Promise<ExemptionMoveOffers> {
    return this.exemptions.offers(access);
  }

  /** The detail of a waiting offer's reason; every opening is logged (`edge/exemptions`, row 10). */
  @Get('move-offers/:id/reason')
  @Requires('exemptions', 'view')
  @Returns(exemptionReasonSchema)
  offerReason(
    @CurrentAccess() access: Access,
    @ValidParams(exemptionMoveOfferParamsSchema) params: ExemptionMoveOfferParams,
    @RequestId() requestId: string,
  ): Promise<ExemptionReason> {
    return this.exemptions.offerReason(access, params.id, requestId);
  }

  @Post('move-offers/:id/confirm/preview')
  @HttpCode(200)
  @Requires('exemptions', 'edit')
  @Returns(exemptionPreviewSchema)
  confirmPreview(
    @CurrentAccess() access: Access,
    @ValidParams(exemptionMoveOfferParamsSchema) params: ExemptionMoveOfferParams,
  ): Promise<ExemptionPreview> {
    return this.exemptions.confirmPreview(access, params.id);
  }

  @Post('move-offers/:id/confirm')
  @HttpCode(200)
  @Requires('exemptions', 'edit')
  @Returns(exemptionSchema)
  confirm(
    @CurrentAccess() access: Access,
    @ValidParams(exemptionMoveOfferParamsSchema) params: ExemptionMoveOfferParams,
    @ValidBody(exemptionMoveConfirmSchema) input: ExemptionMoveConfirm,
    @RequestId() requestId: string,
  ): Promise<Exemption> {
    return this.exemptions.confirm(access, params.id, input, requestId);
  }

  @Post('move-offers/:id/drop')
  @HttpCode(200)
  @Requires('exemptions', 'edit')
  @Returns(exemptionMoveOffersSchema)
  drop(
    @CurrentAccess() access: Access,
    @ValidParams(exemptionMoveOfferParamsSchema) params: ExemptionMoveOfferParams,
    @RequestId() requestId: string,
  ): Promise<ExemptionMoveOffers> {
    return this.exemptions.drop(access, params.id, requestId);
  }

  /** The late-entry preview of a new exemption (07, Problem cases): nothing is written. */
  @Post('preview')
  @HttpCode(200)
  @Requires('exemptions', 'create')
  @Returns(exemptionPreviewSchema)
  preview(
    @CurrentAccess() access: Access,
    @ValidBody(exemptionCreateSchema) input: ExemptionCreate,
  ): Promise<ExemptionPreview> {
    return this.exemptions.preview(access, input);
  }

  /** One exemption per student, as a batch; safe to repeat with its key. */
  @Post()
  @HttpCode(200)
  @Requires('exemptions', 'create')
  @Returns(exemptionCreatedSchema)
  create(
    @CurrentAccess() access: Access,
    @RequestKey() key: string,
    @ValidBody(exemptionCreateSchema) input: ExemptionCreate,
    @RequestId() requestId: string,
  ): Promise<ExemptionCreated> {
    return this.exemptions.create(access, input, key, requestId);
  }

  @Post('batches/:batchId/end/preview')
  @HttpCode(200)
  @Requires('exemptions', 'edit')
  @Returns(exemptionPreviewSchema)
  batchEndPreview(
    @CurrentAccess() access: Access,
    @ValidParams(exemptionBatchParamsSchema) params: ExemptionBatchParams,
    @ValidBody(exemptionBatchEndSchema) input: ExemptionBatchEnd,
  ): Promise<ExemptionPreview> {
    return this.exemptions.batchEndPreview(access, params.batchId, input);
  }

  @Post('batches/:batchId/end')
  @HttpCode(200)
  @Requires('exemptions', 'edit')
  @Returns(exemptionBatchChangedSchema)
  batchEnd(
    @CurrentAccess() access: Access,
    @ValidParams(exemptionBatchParamsSchema) params: ExemptionBatchParams,
    @ValidBody(exemptionBatchEndSchema) input: ExemptionBatchEnd,
    @RequestId() requestId: string,
  ): Promise<ExemptionBatchChanged> {
    return this.exemptions.batchEnd(access, params.batchId, input, requestId);
  }

  @Post('batches/:batchId/void/preview')
  @HttpCode(200)
  @Requires('exemptions', 'edit')
  @Returns(exemptionPreviewSchema)
  batchVoidPreview(
    @CurrentAccess() access: Access,
    @ValidParams(exemptionBatchParamsSchema) params: ExemptionBatchParams,
  ): Promise<ExemptionPreview> {
    return this.exemptions.batchVoidPreview(access, params.batchId);
  }

  @Post('batches/:batchId/void')
  @HttpCode(200)
  @Requires('exemptions', 'edit')
  @Returns(exemptionBatchChangedSchema)
  batchVoid(
    @CurrentAccess() access: Access,
    @ValidParams(exemptionBatchParamsSchema) params: ExemptionBatchParams,
    @ValidBody(exemptionBatchVoidSchema) input: ExemptionBatchVoid,
    @RequestId() requestId: string,
  ): Promise<ExemptionBatchChanged> {
    return this.exemptions.batchVoid(access, params.batchId, input, requestId);
  }

  @Get(':id')
  @Requires('exemptions', 'view')
  @Returns(exemptionSchema)
  one(
    @CurrentAccess() access: Access,
    @ValidParams(exemptionParamsSchema) params: ExemptionParams,
  ): Promise<Exemption> {
    return this.exemptions.one(access, params.id);
  }

  /** The detail of the reason; every opening is logged (`edge/exemptions`, row 10). */
  @Get(':id/reason')
  @Requires('exemptions', 'view')
  @Returns(exemptionReasonSchema)
  reason(
    @CurrentAccess() access: Access,
    @ValidParams(exemptionParamsSchema) params: ExemptionParams,
    @RequestId() requestId: string,
  ): Promise<ExemptionReason> {
    return this.exemptions.reason(access, params.id, requestId);
  }

  /** The document; every opening is logged (`edge/exemptions`, row 10). */
  @Get(':id/document')
  @Requires('exemptions', 'view')
  @ReturnsStoredFile(EXEMPTION_FILE_TYPES)
  document(
    @CurrentAccess() access: Access,
    @ValidParams(exemptionParamsSchema) params: ExemptionParams,
    @RequestId() requestId: string,
  ): Promise<StoredFile> {
    return this.exemptions.document(access, params.id, requestId);
  }

  @Put(':id/document')
  @Requires('exemptions', 'edit')
  @Returns(exemptionSchema)
  putDocument(
    @CurrentAccess() access: Access,
    @ValidParams(exemptionParamsSchema) params: ExemptionParams,
    @ValidQuery(exemptionDocumentQuerySchema) query: ExemptionDocumentQuery,
    @ValidFile(EXEMPTION_FILE_ROUTE) file: UploadedFile | null,
    @RequestId() requestId: string,
  ): Promise<Exemption> {
    return this.exemptions.putDocument(access, params.id, query.name, file, requestId);
  }

  @Delete(':id/document')
  @Requires('exemptions', 'edit')
  @Returns(exemptionSchema)
  removeDocument(
    @CurrentAccess() access: Access,
    @ValidParams(exemptionParamsSchema) params: ExemptionParams,
    @RequestId() requestId: string,
  ): Promise<Exemption> {
    return this.exemptions.removeDocument(access, params.id, requestId);
  }

  /** `edge/exemptions`, row 4: every field before the start date. */
  @Post(':id/edit/preview')
  @HttpCode(200)
  @Requires('exemptions', 'edit')
  @Returns(exemptionPreviewSchema)
  editPreview(
    @CurrentAccess() access: Access,
    @ValidParams(exemptionParamsSchema) params: ExemptionParams,
    @ValidBody(exemptionEditSchema) input: ExemptionEdit,
  ): Promise<ExemptionPreview> {
    return this.exemptions.editPreview(access, params.id, input);
  }

  @Patch(':id')
  @Requires('exemptions', 'edit')
  @Returns(exemptionSchema)
  edit(
    @CurrentAccess() access: Access,
    @ValidParams(exemptionParamsSchema) params: ExemptionParams,
    @ValidBody(exemptionEditSchema) input: ExemptionEdit,
    @RequestId() requestId: string,
  ): Promise<Exemption> {
    return this.exemptions.edit(access, params.id, input, requestId);
  }

  @Post(':id/end/preview')
  @HttpCode(200)
  @Requires('exemptions', 'edit')
  @Returns(exemptionPreviewSchema)
  endPreview(
    @CurrentAccess() access: Access,
    @ValidParams(exemptionParamsSchema) params: ExemptionParams,
    @ValidBody(exemptionEndSchema) input: ExemptionEnd,
  ): Promise<ExemptionPreview> {
    return this.exemptions.endPreview(access, params.id, input);
  }

  @Post(':id/end')
  @HttpCode(200)
  @Requires('exemptions', 'edit')
  @Returns(exemptionSchema)
  end(
    @CurrentAccess() access: Access,
    @ValidParams(exemptionParamsSchema) params: ExemptionParams,
    @ValidBody(exemptionEndSchema) input: ExemptionEnd,
    @RequestId() requestId: string,
  ): Promise<Exemption> {
    return this.exemptions.end(access, params.id, input, requestId);
  }

  @Post(':id/void/preview')
  @HttpCode(200)
  @Requires('exemptions', 'edit')
  @Returns(exemptionPreviewSchema)
  voidPreview(
    @CurrentAccess() access: Access,
    @ValidParams(exemptionParamsSchema) params: ExemptionParams,
    @ValidBody(exemptionVoidPreviewSchema) input: ExemptionVoidPreview,
  ): Promise<ExemptionPreview> {
    return this.exemptions.voidPreview(access, params.id, input.version);
  }

  @Post(':id/void')
  @HttpCode(200)
  @Requires('exemptions', 'edit')
  @Returns(exemptionSchema)
  void(
    @CurrentAccess() access: Access,
    @ValidParams(exemptionParamsSchema) params: ExemptionParams,
    @ValidBody(exemptionVoidSchema) input: ExemptionVoid,
    @RequestId() requestId: string,
  ): Promise<Exemption> {
    return this.exemptions.void(access, params.id, input, requestId);
  }
}

/**
 * The teaching home's exemption cards (task 8.5): a reader of journals, scoped in the
 * route to own classes and own lessons today.
 */
@Controller('journal/exemptions-today')
export class ExemptionsTodayController {
  constructor(private readonly exemptions: Exemptions) {}

  @Get()
  @Requires('journal', 'view')
  @Returns(exemptionsTodaySchema)
  today(@CurrentAccess() access: Access): Promise<ExemptionsToday> {
    return this.exemptions.today(access);
  }
}
