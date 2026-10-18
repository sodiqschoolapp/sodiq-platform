import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { TimetableController } from './timetable.controller.js';
import { TimetablePattern } from './pattern.service.js';
import { TimetablePublish } from './publish.service.js';
import { Timetable } from './timetable.service.js';
import { TimetableUpToDate } from './up-to-date.service.js';

/** Draft timetable versions, their teaching load (task 3.4a) and the grid of their pattern (task 5.4a) publish (task 5.5a-1) and bringing a draft up to date (tasks 5.5a-3b-1 and 5.5a-3b-2). */
@Module({
  imports: [NotificationsModule],
  controllers: [TimetableController],
  providers: [Timetable, TimetablePattern, TimetablePublish, TimetableUpToDate],
})
export class TimetableModule {}
