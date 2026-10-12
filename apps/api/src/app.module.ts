import { Module } from '@nestjs/common';
import { ClockModule } from './clock/clock.module.js';
import { ConfigModule } from './config/config.module.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthController } from './health/health.controller.js';
import { JobsModule } from './jobs/jobs.module.js';
import { MailModule } from './mail/mail.module.js';
import { AccessModule } from './modules/access/access.module.js';
import { AuditModule } from './modules/audit/audit.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { PasswordResetEmailModule } from './modules/auth/password-reset-email.module.js';
import { ClassesModule } from './modules/classes/classes.module.js';
import { FeedbackModule } from './modules/feedback/feedback.module.js';
import { JournalModule } from './modules/journal/journal.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { PeopleModule } from './modules/people/people.module.js';
import { PlansModule } from './modules/plans/plans.module.js';
import { ResultsModule } from './modules/results/results.module.js';
import { SetupModule } from './modules/setup/setup.module.js';
import { TimetableModule } from './modules/timetable/timetable.module.js';
import { ReportingModule } from './reporting/reporting.module.js';

/**
 * What the API and the jobs worker share: the plumbing and the twelve product
 * modules, which hold the job handlers beside the routes.
 */
export const SHARED_MODULES = [
  ConfigModule,
  ClockModule,
  DatabaseModule,
  MailModule,
  AuthModule,
  PasswordResetEmailModule,
  AccessModule,
  AuditModule,
  NotificationsModule,
  SetupModule,
  PeopleModule,
  ClassesModule,
  TimetableModule,
  JournalModule,
  PlansModule,
  ResultsModule,
  FeedbackModule,
  // Last: its shutdown hook runs after the others at the same distance, so the
  // reports of a stop leave after the connections closed.
  ReportingModule,
];

@Module({
  imports: [...SHARED_MODULES, JobsModule.forRoot({ worker: false })],
  controllers: [HealthController],
})
export class AppModule {}
