import { Module } from '@nestjs/common';
import { type AppConfig } from '../../config/config.js';
import { CONFIG } from '../../config/config.module.js';
import { PHOTO_STORE, photoStoreOf } from '../people/photo-store.js';
import { ExemptionsController } from './exemptions.controller.js';
import { Exemptions } from './exemptions.service.js';
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
    // Task 8.5: the exemptions.
    ExemptionsController,
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
    Exemptions,
    // Task 8.5 (decision 17): the documents of exemptions and the files of reasons of absence go
    // to the photos' store under `exemptions/` and `absences/`.
    {
      provide: PHOTO_STORE,
      useFactory: (config: AppConfig) => photoStoreOf(config.photos),
      inject: [CONFIG],
    },
  ],
})
export class JournalModule {}
