import { Module } from '@nestjs/common';
import { FeedbackController } from './feedback.controller.js';
import { FeedbackReports } from './feedback-reports.service.js';

@Module({
  controllers: [FeedbackController],
  providers: [FeedbackReports],
})
export class FeedbackModule {}
