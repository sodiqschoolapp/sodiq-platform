import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { DayChangesController } from './day-changes.controller.js';
import { TimetableDayChanges } from './day-changes.service.js';
import { TimetableController } from './timetable.controller.js';
import { TimetablePattern } from './pattern.service.js';
import { TimetablePublish } from './publish.service.js';
import { TimetableWithdraw } from './withdraw.service.js';
import { Timetable } from './timetable.service.js';
import { TimetableUpToDate } from './up-to-date.service.js';

/** Draft timetable versions, their teaching load (task 3.4a) and the grid of their pattern (task 5.4a) publish (task 5.5a-1) bringing a draft up to date (tasks 5.5a-3b-1 and 5.5a-3b-2) and one-day changes (task 5.6a-1). */
@Module({
  imports: [NotificationsModule],
  controllers: [TimetableController, DayChangesController],
  providers: [
    Timetable,
    TimetablePattern,
    TimetablePublish,
    TimetableUpToDate,
    TimetableWithdraw,
    TimetableDayChanges,
  ],
})
export class TimetableModule {}
