import { Controller, Get, HttpCode, Patch, Post } from '@nestjs/common';
import {
  calendarChangeSchema,
  calendarDateSchema,
  calendarDayQuerySchema,
  calendarEntryListSchema,
  calendarSaveSchema,
  dayDecisionsBodySchema,
  calendarEntrySchema,
  calendarPreviewSchema,
  setupIdParamsSchema,
  type CalendarChange,
  type CalendarDate,
  type CalendarDayQuery,
  type CalendarEntry,
  type CalendarEntryList,
  type CalendarSave,
  type DayDecisionsBody,
  type CalendarPreview,
  type SetupIdParams,
} from '@sodiq/shared';
import { RequestId } from '../../http/request-id.js';
import { Returns, ValidBody, ValidParams, ValidQuery } from '../../http/schemas.js';
import { Requires } from '../access/access.decorators.js';
import { CurrentAccess, type Access } from '../access/permission.guard.js';
import { branchOf } from './branches.controller.js';
import { Calendar } from './calendar.service.js';

/**
 * The academic calendar of the branch of the request
 * (docs/spec/03-school-setup.md, Academic calendar, owner: Academic Vice
 * Principal; task 1.4), in the area `calendar` (owner's answer 18).
 */
@Controller('setup')
export class CalendarController {
  constructor(private readonly calendar: Calendar) {}

  @Get('calendar-entries')
  @Requires('calendar', 'view')
  @Returns(calendarEntryListSchema)
  list(@CurrentAccess() access: Access): Promise<CalendarEntryList> {
    return this.calendar.list(access, branchOf(access));
  }

  @Post('calendar-entries')
  @Requires('calendar', 'create')
  @Returns(calendarEntrySchema, 201)
  create(
    @CurrentAccess() access: Access,
    @ValidBody(calendarSaveSchema) save: CalendarSave,
    @RequestId() requestId: string,
  ): Promise<CalendarEntry> {
    return this.calendar.create(access, branchOf(access), save, requestId);
  }

  /** The dates and grades a save changes, written nowhere (decisions 11 and 13: under `edit`). */
  @Post('calendar-entries/preview')
  @HttpCode(200)
  @Requires('calendar', 'edit')
  @Returns(calendarPreviewSchema)
  preview(
    @CurrentAccess() access: Access,
    @ValidBody(calendarChangeSchema) change: CalendarChange,
    @RequestId() requestId: string,
  ): Promise<CalendarPreview> {
    return this.calendar.preview(access, branchOf(access), change, requestId);
  }

  @Patch('calendar-entries/:id')
  @Requires('calendar', 'edit')
  @Returns(calendarEntrySchema)
  edit(
    @CurrentAccess() access: Access,
    @ValidParams(setupIdParamsSchema) params: SetupIdParams,
    @ValidBody(calendarSaveSchema) save: CalendarSave,
    @RequestId() requestId: string,
  ): Promise<CalendarEntry> {
    return this.calendar.edit(access, branchOf(access), params.id, save, requestId);
  }

  @Post('calendar-entries/:id/archive')
  @HttpCode(200)
  @Requires('calendar', 'archive')
  @Returns(calendarEntrySchema)
  archive(
    @CurrentAccess() access: Access,
    @ValidParams(setupIdParamsSchema) params: SetupIdParams,
    @ValidBody(dayDecisionsBodySchema) days: DayDecisionsBody,
    @RequestId() requestId: string,
  ): Promise<CalendarEntry> {
    return this.calendar.archive(access, branchOf(access), params.id, days, requestId);
  }

  @Post('calendar-entries/:id/restore')
  @HttpCode(200)
  @Requires('calendar', 'archive')
  @Returns(calendarEntrySchema)
  restore(
    @CurrentAccess() access: Access,
    @ValidParams(setupIdParamsSchema) params: SetupIdParams,
    @ValidBody(dayDecisionsBodySchema) days: DayDecisionsBody,
    @RequestId() requestId: string,
  ): Promise<CalendarEntry> {
    return this.calendar.restore(access, branchOf(access), params.id, days, requestId);
  }

  /** What every grade has on one date ("Check a date", decision 15). */
  @Get('calendar-day')
  @Requires('calendar', 'view')
  @Returns(calendarDateSchema)
  day(
    @CurrentAccess() access: Access,
    @ValidQuery(calendarDayQuerySchema) query: CalendarDayQuery,
  ): Promise<CalendarDate> {
    return this.calendar.day(access, branchOf(access), query.date);
  }
}
