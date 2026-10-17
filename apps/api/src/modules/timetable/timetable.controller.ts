import { Controller, Delete, Get, HttpCode, Patch, Post, Put } from '@nestjs/common';
import {
  draftReadinessSchema,
  loadRowEditSchema,
  loadRowParamsSchema,
  loadRowRecordSchema,
  loadRowSchema,
  loadSchema,
  loadTeachersQuerySchema,
  loadTeachersSchema,
  loadTotalsSchema,
  pinParamsSchema,
  pinRecordSchema,
  preferenceWeightsBodySchema,
  rulesConfirmBodySchema,
  timetableVersionCreateSchema,
  timetableVersionEditSchema,
  timetableVersionListSchema,
  timetableVersionParamsSchema,
  timetableVersionSchema,
  type DraftReadiness,
  type Load,
  type LoadRow,
  type LoadRowEdit,
  type LoadRowParams,
  type LoadRowRecord,
  type LoadTeachers,
  type LoadTeachersQuery,
  type LoadTotals,
  type PinRecord,
  type PreferenceWeightsBody,
  type RulesConfirmBody,
  type TimetableVersion,
  type TimetableVersionCreate,
  type TimetableVersionEdit,
  type TimetableVersionList,
  type TimetableVersionParams,
} from '@sodiq/shared';
import { RequestId } from '../../http/request-id.js';
import { Returns, ReturnsNothing, ValidBody, ValidParams, ValidQuery } from '../../http/schemas.js';
import { Requires } from '../access/access.decorators.js';
import { CurrentAccess, type Access } from '../access/permission.guard.js';
import { Timetable } from './timetable.service.js';

/**
 * Draft timetable versions and their teaching load (task 3.4a, pull request
 * #99). The area `timetable` (decision 4): the Super Admin and the Academic
 * Vice Principal change drafts and their rows, the Principal views. Every
 * route works for the branch of the request.
 */
@Controller('timetable')
export class TimetableController {
  constructor(private readonly timetable: Timetable) {}

  @Get('versions')
  @Requires('timetable', 'view')
  @Returns(timetableVersionListSchema)
  list(@CurrentAccess() access: Access): Promise<TimetableVersionList> {
    return this.timetable.list(access);
  }

  @Post('versions')
  @Requires('timetable', 'create')
  @Returns(timetableVersionSchema, 201)
  createVersion(
    @CurrentAccess() access: Access,
    @ValidBody(timetableVersionCreateSchema) input: TimetableVersionCreate,
    @RequestId() requestId: string,
  ): Promise<TimetableVersion> {
    return this.timetable.createVersion(access, input, requestId);
  }

  @Patch('versions/:id')
  @Requires('timetable', 'edit')
  @Returns(timetableVersionSchema)
  editVersion(
    @CurrentAccess() access: Access,
    @ValidParams(timetableVersionParamsSchema) params: TimetableVersionParams,
    @ValidBody(timetableVersionEditSchema) input: TimetableVersionEdit,
    @RequestId() requestId: string,
  ): Promise<TimetableVersion> {
    return this.timetable.editVersion(access, params.id, input, requestId);
  }

  @Get('versions/:id/load')
  @Requires('timetable', 'view')
  @Returns(loadSchema)
  load(
    @CurrentAccess() access: Access,
    @ValidParams(timetableVersionParamsSchema) params: TimetableVersionParams,
  ): Promise<Load> {
    return this.timetable.load(access, params.id);
  }

  /** The weekly totals of a version (task 3.4b, decisions 5 to 8): shown, never refusing. */
  @Get('versions/:id/totals')
  @Requires('timetable', 'view')
  @Returns(loadTotalsSchema)
  totals(
    @CurrentAccess() access: Access,
    @ValidParams(timetableVersionParamsSchema) params: TimetableVersionParams,
  ): Promise<LoadTotals> {
    return this.timetable.totals(access, params.id);
  }

  /**
   * The readiness of steps 1 to 5 of the draft builder (tasks 5.3a, pull
   * request #127, and 5.3b-1): computed on each read, never refusing.
   */
  @Get('versions/:id/readiness')
  @Requires('timetable', 'view')
  @Returns(draftReadinessSchema)
  readiness(
    @CurrentAccess() access: Access,
    @ValidParams(timetableVersionParamsSchema) params: TimetableVersionParams,
  ): Promise<DraftReadiness> {
    return this.timetable.readiness(access, params.id);
  }

  /** Step 1: the table of templates in force stored as confirmed (decisions 3 and 12). */
  @Post('versions/:id/templates/confirm')
  @HttpCode(200)
  @Requires('timetable', 'edit')
  @Returns(draftReadinessSchema)
  confirmTemplates(
    @CurrentAccess() access: Access,
    @ValidParams(timetableVersionParamsSchema) params: TimetableVersionParams,
    @RequestId() requestId: string,
  ): Promise<DraftReadiness> {
    return this.timetable.confirmTemplates(access, params.id, requestId);
  }

  /** Step 5: the weights of the preferences (task 5.3b-1, decisions 3 and 7). */
  @Put('versions/:id/preferences')
  @Requires('timetable', 'edit')
  @Returns(draftReadinessSchema)
  saveWeights(
    @CurrentAccess() access: Access,
    @ValidParams(timetableVersionParamsSchema) params: TimetableVersionParams,
    @ValidBody(preferenceWeightsBodySchema) body: PreferenceWeightsBody,
    @RequestId() requestId: string,
  ): Promise<DraftReadiness> {
    return this.timetable.saveWeights(access, params.id, body, requestId);
  }

  /**
   * Step 5 confirmed: the weights and the pins the person sees (task 5.3b-1,
   * decisions 2 and 9; task 5.3b-2, decision 7).
   */
  @Post('versions/:id/rules/confirm')
  @HttpCode(200)
  @Requires('timetable', 'edit')
  @Returns(draftReadinessSchema)
  confirmRules(
    @CurrentAccess() access: Access,
    @ValidParams(timetableVersionParamsSchema) params: TimetableVersionParams,
    @ValidBody(rulesConfirmBodySchema) body: RulesConfirmBody,
    @RequestId() requestId: string,
  ): Promise<DraftReadiness> {
    return this.timetable.confirmRules(access, params.id, body, requestId);
  }

  /** Step 5: a pinned lesson added (task 5.3b-2, decisions 3 to 6); answers the readiness. */
  @Post('versions/:id/pins')
  @HttpCode(200)
  @Requires('timetable', 'edit')
  @Returns(draftReadinessSchema)
  createPin(
    @CurrentAccess() access: Access,
    @ValidParams(timetableVersionParamsSchema) params: TimetableVersionParams,
    @ValidBody(pinRecordSchema) body: PinRecord,
    @RequestId() requestId: string,
  ): Promise<DraftReadiness> {
    return this.timetable.createPin(access, params.id, body, requestId);
  }

  /** Step 5: a pinned lesson removed (task 5.3b-2, decision 6), under `edit`; answers the readiness. */
  @Delete('versions/:id/pins/:pinId')
  @Requires('timetable', 'edit')
  @Returns(draftReadinessSchema)
  deletePin(
    @CurrentAccess() access: Access,
    @ValidParams(pinParamsSchema) params: { id: string; pinId: string },
    @RequestId() requestId: string,
  ): Promise<DraftReadiness> {
    return this.timetable.deletePin(access, params.id, params.pinId, requestId);
  }

  /** The teachers and vacancies a row may take (decision 2), by the rules of the create. */
  @Get('versions/:id/load/teachers')
  @Requires('timetable', 'view')
  @Returns(loadTeachersSchema)
  teachers(
    @CurrentAccess() access: Access,
    @ValidParams(timetableVersionParamsSchema) params: TimetableVersionParams,
    @ValidQuery(loadTeachersQuerySchema) query: LoadTeachersQuery,
  ): Promise<LoadTeachers> {
    return this.timetable.teachers(access, params.id, query);
  }

  @Post('versions/:id/load')
  @Requires('timetable', 'create')
  @Returns(loadRowSchema, 201)
  createRow(
    @CurrentAccess() access: Access,
    @ValidParams(timetableVersionParamsSchema) params: TimetableVersionParams,
    @ValidBody(loadRowRecordSchema) input: LoadRowRecord,
    @RequestId() requestId: string,
  ): Promise<LoadRow> {
    return this.timetable.createRow(access, params.id, input, requestId);
  }

  @Patch('versions/:id/load/:rowId')
  @Requires('timetable', 'edit')
  @Returns(loadRowSchema)
  editRow(
    @CurrentAccess() access: Access,
    @ValidParams(loadRowParamsSchema) params: LoadRowParams,
    @ValidBody(loadRowEditSchema) input: LoadRowEdit,
    @RequestId() requestId: string,
  ): Promise<LoadRow> {
    return this.timetable.editRow(access, params.id, params.rowId, input, requestId);
  }

  /** Decision 6: a draft's row is deleted, under `archive`. */
  @Delete('versions/:id/load/:rowId')
  @Requires('timetable', 'archive')
  @ReturnsNothing()
  deleteRow(
    @CurrentAccess() access: Access,
    @ValidParams(loadRowParamsSchema) params: LoadRowParams,
    @RequestId() requestId: string,
  ): Promise<void> {
    return this.timetable.deleteRow(access, params.id, params.rowId, requestId);
  }
}
