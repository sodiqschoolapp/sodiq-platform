import { Module } from '@nestjs/common';
import { type AppConfig } from '../../config/config.js';
import { CONFIG } from '../../config/config.module.js';
import { PHOTO_STORE, photoStoreOf } from '../people/photo-store.js';
import { PlanFiles } from './plan-files.service.js';
import { PlansController } from './plans.controller.js';
import { PlansService } from './plans.service.js';

@Module({
  controllers: [PlansController],
  providers: [
    PlansService,
    PlanFiles,
    // The files of plan items go to the photos' store under `plans/` (task 7.1a, decision 1).
    {
      provide: PHOTO_STORE,
      useFactory: (config: AppConfig) => photoStoreOf(config.photos),
      inject: [CONFIG],
    },
  ],
})
export class PlansModule {}
