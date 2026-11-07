import { Module, type OnModuleInit } from '@nestjs/common';
import { JobRunner } from '../../jobs/job-runner.js';
import { tellMovedJob } from '../auth/telegram-links.js';
import { nodeFetch, TELEGRAM_FETCH, TelegramBot } from './telegram/bot-api.js';
import { TelegramController } from './telegram/telegram.controller.js';
import { TellMovedSender } from './telegram/tell-moved.job.js';
import { type AppConfig } from '../../config/config.js';
import { CONFIG } from '../../config/config.module.js';
import { PHOTO_STORE, photoStoreOf } from '../people/photo-store.js';
import { ResultsModule } from '../results/results.module.js';
import { TimetableModule } from '../timetable/timetable.module.js';
import { PortalGradesService } from './portal-grades.service.js';
import { PortalHomeworkService } from './portal-homework.service.js';
import { PortalTimetable } from './portal-timetable.service.js';
import { PortalController } from './portal.controller.js';

/**
 * The parent portal (task 11.2, pull request #294; grades and attendance, task 11.3); the
 * Telegram bot's webhook and the notice of a moved link (task 11.4).
 */
@Module({
  imports: [TimetableModule, ResultsModule],
  controllers: [PortalController, TelegramController],
  providers: [
    PortalTimetable,
    PortalHomeworkService,
    PortalGradesService,
    TelegramBot,
    { provide: TELEGRAM_FETCH, useValue: nodeFetch },
    TellMovedSender,
    // The plan files are read from the photos' store under `plans/` (as `plans.module.ts`).
    {
      provide: PHOTO_STORE,
      useFactory: (config: AppConfig) => photoStoreOf(config.photos),
      inject: [CONFIG],
    },
  ],
})
export class PortalModule implements OnModuleInit {
  constructor(
    private readonly runner: JobRunner,
    private readonly tellMoved: TellMovedSender,
  ) {}

  onModuleInit(): void {
    this.runner.handle(tellMovedJob, (transaction, data) => this.tellMoved.send(transaction, data));
  }
}
