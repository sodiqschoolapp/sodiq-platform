import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { BulkCancelsController } from './bulk-cancels.controller.js';
import { TimetableCalendarLessons } from './calendar-lessons.js';
import { TimetableBulkCancels } from './bulk-cancels.service.js';
import { DayChangesController } from './day-changes.controller.js';
import { TimetableDayChanges } from './day-changes.service.js';
import { JournalSubstitutionsController } from './journal-substitutions.controller.js';
import { TimetableJournalSubstitutions } from './journal-substitutions.service.js';
import { SubstitutionsController } from './substitutions.controller.js';
import { TimetableSubstitutions } from './substitutions.service.js';
import { AbsencesController } from './absences.controller.js';
import { RoomClosuresController } from './room-closures.controller.js';
import { TimetableRoomClosures } from './room-closures.service.js';
import { TimetableAbsences } from './absences.service.js';
import { ExamsController } from './exams.controller.js';
import { TimetableExams } from './exams.service.js';
import { TimetableController } from './timetable.controller.js';
import { TimetablePattern } from './pattern.service.js';
import { TimetablePublish } from './publish.service.js';
import { TimetableWithdraw } from './withdraw.service.js';
import { Timetable } from './timetable.service.js';
import { TimetableUpToDate } from './up-to-date.service.js';
import { VacancyFillsController } from './vacancy-fills.controller.js';
import { VacancyFills } from './vacancy-fills.service.js';
import { ActingTeachersController } from './acting-teachers.controller.js';
import { ActingTeachers } from './acting-teachers.service.js';

/** Draft timetable versions, their teaching load (task 3.4a) and the grid of their pattern (task 5.4a) publish (task 5.5a-1) bringing a draft up to date (tasks 5.5a-3b-1 and 5.5a-3b-2) one-day changes (task 5.6a-1), the bulk cancel (task 5.6a-3) exams (task 5.6c-1) the vacancy fill (task 5.7a-3a) and the acting teacher (task 5.7a-3c). */
@Module({
  imports: [NotificationsModule],
  controllers: [
    TimetableController,
    DayChangesController,
    SubstitutionsController,
    JournalSubstitutionsController,
    BulkCancelsController,
    ExamsController,
    AbsencesController,
    RoomClosuresController,
    VacancyFillsController,
    ActingTeachersController,
  ],
  providers: [
    Timetable,
    TimetablePattern,
    TimetablePublish,
    TimetableUpToDate,
    TimetableWithdraw,
    TimetableDayChanges,
    TimetableSubstitutions,
    TimetableJournalSubstitutions,
    TimetableBulkCancels,
    TimetableCalendarLessons,
    TimetableExams,
    TimetableAbsences,
    TimetableRoomClosures,
    VacancyFills,
    ActingTeachers,
  ],
  // Task 5.6b-1: a calendar save writes the lessons of the dates it changes.
  exports: [TimetableCalendarLessons],
})
export class TimetableModule {}
