import { Module } from '@nestjs/common';
import { type AppConfig } from '../../config/config.js';
import { CONFIG } from '../../config/config.module.js';
import { PHOTO_STORE, photoStoreOf } from '../people/photo-store.js';
import { TimetableModule } from '../timetable/timetable.module.js';
import { PortalHomeworkService } from './portal-homework.service.js';
import { PortalTimetable } from './portal-timetable.service.js';
import { PortalController } from './portal.controller.js';

/** The parent portal (task 11.2, pull request #294). */
@Module({
  imports: [TimetableModule],
  controllers: [PortalController],
  providers: [
    PortalTimetable,
    PortalHomeworkService,
    // The plan files are read from the photos' store under `plans/` (as `plans.module.ts`).
    {
      provide: PHOTO_STORE,
      useFactory: (config: AppConfig) => photoStoreOf(config.photos),
      inject: [CONFIG],
    },
  ],
})
export class PortalModule {}
