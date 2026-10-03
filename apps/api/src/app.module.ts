import { Module } from '@nestjs/common';
import { HealthController } from './health/health.controller.js';
import { AccessModule } from './modules/access/access.module.js';
import { AuditModule } from './modules/audit/audit.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { ClassesModule } from './modules/classes/classes.module.js';
import { JournalModule } from './modules/journal/journal.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { PeopleModule } from './modules/people/people.module.js';
import { PlansModule } from './modules/plans/plans.module.js';
import { ResultsModule } from './modules/results/results.module.js';
import { SetupModule } from './modules/setup/setup.module.js';
import { TimetableModule } from './modules/timetable/timetable.module.js';

@Module({
  imports: [
    AuthModule,
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
  ],
  controllers: [HealthController],
})
export class AppModule {}
