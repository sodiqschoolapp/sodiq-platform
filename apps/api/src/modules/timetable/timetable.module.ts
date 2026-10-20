import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { BulkCancelsController } from './bulk-cancels.controller.js';
import { TimetableCalendarLessons } from './calendar-lessons.js';
import { TimetableBulkCancels } from './bulk-cancels.service.js';
import { DayChangesController } from './day-changes.controller.js';
import { TimetableDayChanges } from './day-changes.service.js';
import { AbsencesController } from './absences.controller.js';
import { TimetableAbsences } from './absences.service.js';
import { ExamsController } from './exams.controller.js';
import { TimetableExams } from './exams.service.js';
import { TimetableController } from './timetable.controller.js';
import { TimetablePattern } from './pattern.service.js';
import { TimetablePublish } from './publish.service.js';
import { TimetableWithdraw } from './withdraw.service.js';
import { Timetable } from './timetable.service.js';
import { TimetableUpToDate } from './up-to-date.service.js';

/** Draft timetable versions, their teaching load (task 3.4a) and the grid of their pattern (task 5.4a) publish (task 5.5a-1) bringing a draft up to date (tasks 5.5a-3b-1 and 5.5a-3b-2) one-day changes (task 5.6a-1), the bulk cancel (task 5.6a-3) and exams (task 5.6c-1). */
@Module({
  imports: [NotificationsModule],
  controllers: [
    TimetableController,
    DayChangesController,
    BulkCancelsController,
    ExamsController,
    AbsencesController,
  ],
  providers: [
    Timetable,
    TimetablePattern,
    TimetablePublish,
    TimetableUpToDate,
    TimetableWithdraw,
    TimetableDayChanges,
    TimetableBulkCancels,
    TimetableCalendarLessons,
    TimetableExams,
    TimetableAbsences,
  ],
  // Task 5.6b-1: a calendar save writes the lessons of the dates it changes.
  exports: [TimetableCalendarLessons],
})
export class TimetableModule {}
