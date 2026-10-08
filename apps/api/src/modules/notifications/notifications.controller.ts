import { Controller, Get, Post } from '@nestjs/common';
import {
  notificationListSchema,
  notificationParamsSchema,
  type NotificationList,
  type NotificationParams,
} from '@sodiq/shared';
import { Returns, ReturnsNothing, ValidParams } from '../../http/schemas.js';
import { AnySignedIn } from '../access/access.decorators.js';
import { CurrentSession } from '../auth/session.guard.js';
import type { ActiveSession } from '../auth/sessions.service.js';
import { Notifications } from './notifications.service.js';

/**
 * The notifications of the signed-in person
 * (docs/spec/10-portal-notifications-release-2.md, last paragraph). Every
 * route acts on the account of the session only: the id in the path is looked
 * for among its own notifications, and another account's is not found. Open
 * to every signed-in account, the Principal included: the owner's spec change
 * adds reading and marking his own notifications to his own-account changes
 * (edge cases, "Who can act"; answer 10 of the plan of task 0.9).
 */
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: Notifications) {}

  @Get()
  @AnySignedIn()
  @Returns(notificationListSchema)
  list(@CurrentSession() session: ActiveSession): Promise<NotificationList> {
    return this.notifications.list(session.accountId);
  }

  @Post('read-all')
  @AnySignedIn()
  @ReturnsNothing()
  readAll(@CurrentSession() session: ActiveSession): Promise<void> {
    return this.notifications.markAllRead(session.accountId);
  }

  @Post(':id/read')
  @AnySignedIn()
  @ReturnsNothing()
  read(
    @CurrentSession() session: ActiveSession,
    @ValidParams(notificationParamsSchema) params: NotificationParams,
  ): Promise<void> {
    return this.notifications.markRead(session.accountId, params.id);
  }
}
