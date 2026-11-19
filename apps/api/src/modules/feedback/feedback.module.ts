import { Module } from '@nestjs/common';
import { FeedbackController } from './feedback.controller.js';
import { FeedbackList } from './feedback-list.service.js';
import { FeedbackReportsController } from './feedback-reports.controller.js';
import { FeedbackReports } from './feedback-reports.service.js';

@Module({
  controllers: [FeedbackController, FeedbackReportsController],
  providers: [FeedbackReports, FeedbackList],
})
export class FeedbackModule {}
