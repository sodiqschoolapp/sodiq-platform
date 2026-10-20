import { Controller, Get, HttpCode, Patch, Post } from '@nestjs/common';
import {
  assignmentEndSaveSchema,
  assignmentListSchema,
  assignmentSaveSchema,
  assignmentSchema,
  dayTemplateListSchema,
  dayTemplateQuerySchema,
  dayTemplateRecordSchema,
  dayTemplateRenameSchema,
  dayTemplateSchema,
  dayTemplateVersionSaveSchema,
  setupIdParamsSchema,
  slotLengthSaveSchema,
  slotTypeListSchema,
  slotTypeRecordSchema,
  slotTypeRenameSchema,
  slotTypeSchema,
  templateChangeSchema,
  templatePreviewSchema,
  templateTableQuerySchema,
  templateTableSchema,
  type Assignment,
  type AssignmentEndSave,
  type AssignmentList,
  type AssignmentSave,
  type DayTemplate,
  type DayTemplateList,
  type DayTemplateQuery,
  type DayTemplateRecord,
  type DayTemplateRename,
  type DayTemplateVersionSave,
  type SetupIdParams,
  type SlotLengthSave,
  type SlotType,
  type SlotTypeList,
  type SlotTypeRecord,
  type SlotTypeRename,
  type TemplateChange,
  type TemplatePreview,
  type TemplateTable,
  type TemplateTableQuery,
} from '@sodiq/shared';
import { RequestId } from '../../http/request-id.js';
import { Returns, ValidBody, ValidParams, ValidQuery } from '../../http/schemas.js';
import { Requires } from '../access/access.decorators.js';
import { CurrentAccess, type Access } from '../access/permission.guard.js';
import { branchOf } from './branches.controller.js';
import { DayTemplates } from './day-templates.service.js';

/**
 * Slot types, day templates and where they apply (docs/spec/03-school-setup.md,
 * Slot types and day templates: "belong to a branch and are set by that
 * branch's Academic Vice Principal"; task 1.5). Every route acts on the branch
 * of the request, in the area `day_templates` (owner's answer 14).
 */
@Controller('setup')
export class DayTemplatesController {
  constructor(private readonly templates: DayTemplates) {}

  @Get('slot-types')
  @Requires('day_templates', 'view')
  @Returns(slotTypeListSchema)
  listSlotTypes(@CurrentAccess() access: Access): Promise<SlotTypeList> {
    return this.templates.listSlotTypes(access, branchOf(access));
  }

  @Post('slot-types')
  @Requires('day_templates', 'create')
  @Returns(slotTypeSchema, 201)
  createSlotType(
    @CurrentAccess() access: Access,
    @ValidBody(slotTypeRecordSchema) record: SlotTypeRecord,
    @RequestId() requestId: string,
  ): Promise<SlotType> {
    return this.templates.createSlotType(access, branchOf(access), record, requestId);
  }

  @Patch('slot-types/:id')
  @Requires('day_templates', 'edit')
  @Returns(slotTypeSchema)
  renameSlotType(
    @CurrentAccess() access: Access,
    @ValidParams(setupIdParamsSchema) params: SetupIdParams,
    @ValidBody(slotTypeRenameSchema) record: SlotTypeRename,
    @RequestId() requestId: string,
  ): Promise<SlotType> {
    return this.templates.renameSlotType(access, branchOf(access), params.id, record, requestId);
  }

  @Post('slot-types/:id/lengths')
  @HttpCode(200)
  @Requires('day_templates', 'edit')
  @Returns(slotTypeSchema)
  changeSlotLength(
    @CurrentAccess() access: Access,
    @ValidParams(setupIdParamsSchema) params: SetupIdParams,
    @ValidBody(slotLengthSaveSchema) change: SlotLengthSave,
    @RequestId() requestId: string,
  ): Promise<SlotType> {
    return this.templates.changeSlotLength(access, branchOf(access), params.id, change, requestId);
  }

  @Post('slot-types/:id/archive')
  @HttpCode(200)
  @Requires('day_templates', 'archive')
  @Returns(slotTypeSchema)
  archiveSlotType(
    @CurrentAccess() access: Access,
    @ValidParams(setupIdParamsSchema) params: SetupIdParams,
    @RequestId() requestId: string,
  ): Promise<SlotType> {
    return this.templates.archiveSlotType(access, branchOf(access), params.id, requestId);
  }

  @Post('slot-types/:id/restore')
  @HttpCode(200)
  @Requires('day_templates', 'archive')
  @Returns(slotTypeSchema)
  restoreSlotType(
    @CurrentAccess() access: Access,
    @ValidParams(setupIdParamsSchema) params: SetupIdParams,
    @RequestId() requestId: string,
  ): Promise<SlotType> {
    return this.templates.restoreSlotType(access, branchOf(access), params.id, requestId);
  }

  @Get('day-templates')
  @Requires('day_templates', 'view')
  @Returns(dayTemplateListSchema)
  listTemplates(@CurrentAccess() access: Access): Promise<DayTemplateList> {
    return this.templates.listTemplates(access, branchOf(access));
  }

  @Get('day-templates/:id')
  @Requires('day_templates', 'view')
  @Returns(dayTemplateSchema)
  template(
    @CurrentAccess() access: Access,
    @ValidParams(setupIdParamsSchema) params: SetupIdParams,
    @ValidQuery(dayTemplateQuerySchema) query: DayTemplateQuery,
  ): Promise<DayTemplate> {
    return this.templates.template(access, branchOf(access), params.id, query.date);
  }

  @Post('day-templates')
  @Requires('day_templates', 'create')
  @Returns(dayTemplateSchema, 201)
  createTemplate(
    @CurrentAccess() access: Access,
    @ValidBody(dayTemplateRecordSchema) record: DayTemplateRecord,
    @RequestId() requestId: string,
  ): Promise<DayTemplate> {
    return this.templates.createTemplate(access, branchOf(access), record, requestId);
  }

  @Patch('day-templates/:id')
  @Requires('day_templates', 'edit')
  @Returns(dayTemplateSchema)
  renameTemplate(
    @CurrentAccess() access: Access,
    @ValidParams(setupIdParamsSchema) params: SetupIdParams,
    @ValidBody(dayTemplateRenameSchema) record: DayTemplateRename,
    @RequestId() requestId: string,
  ): Promise<DayTemplate> {
    return this.templates.renameTemplate(access, branchOf(access), params.id, record, requestId);
  }

  @Post('day-templates/:id/versions')
  @HttpCode(200)
  @Requires('day_templates', 'edit')
  @Returns(dayTemplateSchema)
  addTemplateVersion(
    @CurrentAccess() access: Access,
    @ValidParams(setupIdParamsSchema) params: SetupIdParams,
    @ValidBody(dayTemplateVersionSaveSchema) record: DayTemplateVersionSave,
    @RequestId() requestId: string,
  ): Promise<DayTemplate> {
    return this.templates.addTemplateVersion(
      access,
      branchOf(access),
      params.id,
      record,
      requestId,
    );
  }

  @Post('day-templates/:id/archive')
  @HttpCode(200)
  @Requires('day_templates', 'archive')
  @Returns(dayTemplateSchema)
  archiveTemplate(
    @CurrentAccess() access: Access,
    @ValidParams(setupIdParamsSchema) params: SetupIdParams,
    @RequestId() requestId: string,
  ): Promise<DayTemplate> {
    return this.templates.archiveTemplate(access, branchOf(access), params.id, requestId);
  }

  @Post('day-templates/:id/restore')
  @HttpCode(200)
  @Requires('day_templates', 'archive')
  @Returns(dayTemplateSchema)
  restoreTemplate(
    @CurrentAccess() access: Access,
    @ValidParams(setupIdParamsSchema) params: SetupIdParams,
    @RequestId() requestId: string,
  ): Promise<DayTemplate> {
    return this.templates.restoreTemplate(access, branchOf(access), params.id, requestId);
  }

  @Get('day-template-assignments')
  @Requires('day_templates', 'view')
  @Returns(assignmentListSchema)
  listAssignments(@CurrentAccess() access: Access): Promise<AssignmentList> {
    return this.templates.listAssignments(access, branchOf(access));
  }

  @Post('day-template-assignments')
  @Requires('day_templates', 'edit')
  @Returns(assignmentSchema, 201)
  assign(
    @CurrentAccess() access: Access,
    @ValidBody(assignmentSaveSchema) record: AssignmentSave,
    @RequestId() requestId: string,
  ): Promise<Assignment> {
    return this.templates.assign(access, branchOf(access), record, requestId);
  }

  /** Ends a setting from a date (decision 8: never the default). */
  @Post('day-template-assignments/:id/end')
  @HttpCode(200)
  @Requires('day_templates', 'edit')
  @Returns(assignmentSchema)
  end(
    @CurrentAccess() access: Access,
    @ValidParams(setupIdParamsSchema) params: SetupIdParams,
    @ValidBody(assignmentEndSaveSchema) change: AssignmentEndSave,
    @RequestId() requestId: string,
  ): Promise<Assignment> {
    return this.templates.end(access, branchOf(access), params.id, change, requestId);
  }

  /** The resulting template for every working weekday and grade on a date (answer 13). */
  @Get('day-template-table')
  @Requires('day_templates', 'view')
  @Returns(templateTableSchema)
  table(
    @CurrentAccess() access: Access,
    @ValidQuery(templateTableQuerySchema) query: TemplateTableQuery,
  ): Promise<TemplateTable> {
    return this.templates.table(access, branchOf(access), query.date);
  }

  /** The table before and after a change, written nowhere (decision 13: the permission of the save). */
  @Post('day-template-table/preview')
  @HttpCode(200)
  @Requires('day_templates', 'edit')
  @Returns(templatePreviewSchema)
  preview(
    @CurrentAccess() access: Access,
    @ValidBody(templateChangeSchema) change: TemplateChange,
    @RequestId() requestId: string,
  ): Promise<TemplatePreview> {
    return this.templates.preview(access, branchOf(access), change, requestId);
  }
}
