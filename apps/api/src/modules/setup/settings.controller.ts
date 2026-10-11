import { Controller, Get, Put } from '@nestjs/common';
import {
  attendanceValuesListSchema,
  attendanceValuesRecordSchema,
  branchSettingsSchema,
  earlyWarningRecordSchema,
  editDaysRecordSchema,
  quarterAttendanceValuesSchema,
  setupChecklistSchema,
  setupIdParamsSchema,
  type AttendanceValuesList,
  type AttendanceValuesRecord,
  type BranchSettings,
  type EarlyWarningRecord,
  type EditDaysRecord,
  type QuarterAttendanceValues,
  type SetupChecklist,
  type SetupIdParams,
} from '@sodiq/shared';
import { RequestId } from '../../http/request-id.js';
import { Returns, ValidBody, ValidParams } from '../../http/schemas.js';
import { Requires } from '../access/access.decorators.js';
import { CurrentAccess, type Access } from '../access/permission.guard.js';
import { branchOf } from './branches.controller.js';
import { Settings } from './settings.service.js';

/**
 * The settings of the branch of the request and its setup checklist (task
 * 1.6), in the area `settings` (the owner's answers 23 and 24): the Super Admin
 * and the Academic Vice Principal view and edit, the Principal views.
 */
@Controller('setup')
export class SettingsController {
  constructor(private readonly settings: Settings) {}

  @Get('settings')
  @Requires('settings', 'view')
  @Returns(branchSettingsSchema)
  read(@CurrentAccess() access: Access): Promise<BranchSettings> {
    return this.settings.read(access, branchOf(access));
  }

  @Put('settings/edit-days')
  @Requires('settings', 'edit')
  @Returns(branchSettingsSchema)
  setEditDays(
    @CurrentAccess() access: Access,
    @ValidBody(editDaysRecordSchema) record: EditDaysRecord,
    @RequestId() requestId: string,
  ): Promise<BranchSettings> {
    return this.settings.setEditDays(access, branchOf(access), record, requestId);
  }

  @Put('settings/early-warning')
  @Requires('settings', 'edit')
  @Returns(branchSettingsSchema)
  setEarlyWarning(
    @CurrentAccess() access: Access,
    @ValidBody(earlyWarningRecordSchema) record: EarlyWarningRecord,
    @RequestId() requestId: string,
  ): Promise<BranchSettings> {
    return this.settings.setEarlyWarning(access, branchOf(access), record, requestId);
  }

  @Get('attendance-values')
  @Requires('settings', 'view')
  @Returns(attendanceValuesListSchema)
  listAttendanceValues(@CurrentAccess() access: Access): Promise<AttendanceValuesList> {
    return this.settings.listAttendanceValues(access, branchOf(access));
  }

  @Put('quarters/:id/attendance-values')
  @Requires('settings', 'edit')
  @Returns(quarterAttendanceValuesSchema)
  setAttendanceValues(
    @CurrentAccess() access: Access,
    @ValidParams(setupIdParamsSchema) params: SetupIdParams,
    @ValidBody(attendanceValuesRecordSchema) record: AttendanceValuesRecord,
    @RequestId() requestId: string,
  ): Promise<QuarterAttendanceValues> {
    return this.settings.setAttendanceValues(
      access,
      branchOf(access),
      params.id,
      record,
      requestId,
    );
  }

  @Get('checklist')
  @Requires('settings', 'view')
  @Returns(setupChecklistSchema)
  checklist(@CurrentAccess() access: Access): Promise<SetupChecklist> {
    return this.settings.checklist(access, branchOf(access));
  }
}
