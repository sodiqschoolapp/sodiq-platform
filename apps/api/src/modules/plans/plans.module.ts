import { Module } from '@nestjs/common';
import { type AppConfig } from '../../config/config.js';
import { CONFIG } from '../../config/config.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { PHOTO_STORE, photoStoreOf } from '../people/photo-store.js';
import { PlanFiles } from './plan-files.service.js';
import { PlanFollow } from './plan-follow.js';
import { PlanMasterTakes } from './plan-master-takes.service.js';
import { PlanMastersController } from './plan-masters.controller.js';
import { PlanMastersService } from './plan-masters.service.js';
import { PlanRequestsController } from './plan-requests.controller.js';
import { PlanRequestsService } from './plan-requests.service.js';
import { PlanSharing } from './plan-sharing.service.js';
import { PlanWindowsController } from './plan-windows.controller.js';
import { PlanWindowsService } from './plan-windows.service.js';
import { PlansController } from './plans.controller.js';
import { PlansService } from './plans.service.js';

@Module({
  imports: [NotificationsModule],
  // Task 7.2: the windows and the requests; before `PlansController`, whose
  // `journals/:journalId` paths would not take `windows` or `requests`.
  // Task 7.3: the masters, before `PlansController` too.
  controllers: [
    PlanWindowsController,
    PlanRequestsController,
    PlanMastersController,
    PlansController,
  ],
  providers: [
    PlansService,
    PlanFiles,
    // Task 7.1c: shared plans and copies.
    PlanSharing,
    // Task 7.1b: the plans follow the timetable before every commit (decision 5).
    PlanFollow,
    // Task 7.2: the plan window and edit requests.
    PlanWindowsService,
    PlanRequestsService,
    // Task 7.3: master plans, their copies and the parallel classes.
    PlanMastersService,
    PlanMasterTakes,
    // The files of plan items go to the photos' store under `plans/` (task 7.1a, decision 1).
    {
      provide: PHOTO_STORE,
      useFactory: (config: AppConfig) => photoStoreOf(config.photos),
      inject: [CONFIG],
    },
  ],
  exports: [PlanFollow],
})
export class PlansModule {}
