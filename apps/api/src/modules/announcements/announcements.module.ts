import { Module, type OnModuleInit } from '@nestjs/common';
import { JobRunner } from '../../jobs/job-runner.js';
import { PortalModule } from '../portal/portal.module.js';
import { AnnouncementDelivery } from './announcement-delivery.service.js';
import {
  announcementDeliverJob,
  announcementFanOutJob,
  announcementTickJob,
} from './announcement-jobs.js';
import { AnnouncementsController } from './announcements.controller.js';
import { AnnouncementsService } from './announcements.service.js';

/** Announcements and events (task 11.7, pull request #306); the bot of the portal sends them. */
@Module({
  imports: [PortalModule],
  controllers: [AnnouncementsController],
  providers: [AnnouncementsService, AnnouncementDelivery],
})
export class AnnouncementsModule implements OnModuleInit {
  constructor(
    private readonly runner: JobRunner,
    private readonly delivery: AnnouncementDelivery,
  ) {}

  onModuleInit(): void {
    this.runner.handleWithoutTransaction(announcementFanOutJob, (data) =>
      this.delivery.fanOut(data.announcementId),
    );
    this.runner.handleWithoutTransaction(announcementTickJob, () => this.delivery.tick());
    this.runner.handleWithoutTransaction(announcementDeliverJob, (data) =>
      this.delivery.deliver(data.deliveryId),
    );
  }
}
