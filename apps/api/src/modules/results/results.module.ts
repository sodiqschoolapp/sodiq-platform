import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { PlansModule } from '../plans/plans.module.js';
import { ClosingController } from './closing.controller.js';
import { ClosingService } from './closing.service.js';
import { StudentResultsController } from './student-results.controller.js';
import { StudentResultsService } from './student-results.service.js';

/** Results of students (task 9.1 on): read from the journal through `packages/calc`. */
@Module({
  imports: [AccessModule, NotificationsModule, PlansModule],
  controllers: [StudentResultsController, ClosingController],
  providers: [StudentResultsService, ClosingService],
})
export class ResultsModule {}
