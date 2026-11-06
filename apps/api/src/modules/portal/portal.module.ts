import { Module } from '@nestjs/common';
import { type AppConfig } from '../../config/config.js';
import { CONFIG } from '../../config/config.module.js';
import { PHOTO_STORE, photoStoreOf } from '../people/photo-store.js';
import { ResultsModule } from '../results/results.module.js';
import { TimetableModule } from '../timetable/timetable.module.js';
import { PortalGradesService } from './portal-grades.service.js';
import { PortalHomeworkService } from './portal-homework.service.js';
import { PortalTimetable } from './portal-timetable.service.js';
import { PortalController } from './portal.controller.js';

/** The parent portal (task 11.2, pull request #294; grades and attendance, task 11.3). */
@Module({
  imports: [TimetableModule, ResultsModule],
  controllers: [PortalController],
  providers: [
    PortalTimetable,
    PortalHomeworkService,
    PortalGradesService,
    // The plan files are read from the photos' store under `plans/` (as `plans.module.ts`).
    {
      provide: PHOTO_STORE,
      useFactory: (config: AppConfig) => photoStoreOf(config.photos),
      inject: [CONFIG],
    },
  ],
})
export class PortalModule {}
