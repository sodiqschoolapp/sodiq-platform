import { Module, type OnModuleInit } from '@nestjs/common';
import { JobRunner } from '../../jobs/job-runner.js';
import { AuthModule } from '../auth/auth.module.js';
import { deliverNotifications, deliverNotificationsJob } from './deliver.job.js';
import { LiveListener } from './live/listener.js';
import { LiveSockets } from './live/socket-server.js';
import { NotificationsController } from './notifications.controller.js';
import { Notifications } from './notifications.service.js';

/**
 * Notifications to staff in the app (task 0.9): the helper later tasks call,
 * the routes of the own list, the delivery job and the live connection. The
 * API process attaches `LiveSockets` to its HTTP server and starts
 * `LiveListener` (`main.ts`); the worker runs the job.
 */
@Module({
  imports: [AuthModule],
  controllers: [NotificationsController],
  providers: [Notifications, LiveSockets, LiveListener],
  exports: [Notifications, LiveSockets, LiveListener],
})
export class NotificationsModule implements OnModuleInit {
  constructor(private readonly runner: JobRunner) {}

  onModuleInit(): void {
    this.runner.handle(deliverNotificationsJob, deliverNotifications);
  }
}
