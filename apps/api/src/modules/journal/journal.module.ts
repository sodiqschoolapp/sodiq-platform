import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { AttendanceController } from './attendance.controller.js';
import { AttendanceService } from './attendance.service.js';
import { CellActionsService } from './cell-actions.service.js';
import { CommentsController } from './comments.controller.js';
import { CommentsService } from './comments.service.js';
import { JournalGridReader } from './journal-grid.service.js';
import { JournalsController } from './journals.controller.js';
import { RatingController } from './rating.controller.js';
import { RatingService } from './rating.service.js';
import { ExtensionsService } from './extensions.service.js';
import { UnlocksController } from './unlocks.controller.js';
import { UnlocksService } from './unlocks.service.js';
import { StudentAbsencesController } from './student-absences.controller.js';
import { StudentAbsences } from './student-absences.service.js';
import { WorksController } from './works.controller.js';
import { WorksService } from './works.service.js';

@Module({
  imports: [NotificationsModule],
  controllers: [
    // Task 8.4: before the controllers whose `lessons/:lessonId` and `journals/:journalId` paths
    // would take `unlocks`.
    UnlocksController,
    JournalsController,
    AttendanceController,
    StudentAbsencesController,
    WorksController,
    RatingController,
    CommentsController,
  ],
  providers: [
    JournalGridReader,
    AttendanceService,
    StudentAbsences,
    WorksService,
    RatingService,
    CommentsService,
    CellActionsService,
    UnlocksService,
    ExtensionsService,
  ],
})
export class JournalModule {}
