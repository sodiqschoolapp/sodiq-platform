import { Controller, Get, Post } from '@nestjs/common';
import {
  notificationListSchema,
  notificationParamsSchema,
  type NotificationList,
  type NotificationParams,
} from '@sodiq/shared';
import { Returns, ReturnsNothing, ValidParams } from '../../http/schemas.js';
import { AnySignedIn } from '../access/access.decorators.js';
import { OpenToKeys } from '../access/key-routes.js';
import { CurrentReader } from '../auth/session.guard.js';
import { Notifications, type NoticeReader } from './notifications.service.js';

/**
 * The notifications of the signed-in person
 * (docs/spec/10-portal-notifications-release-2.md, last paragraph). Every
 * route acts on the account of the session only: the id in the path is looked
 * for among its own notifications, and another account's is not found. Open
 * to every signed-in account, the Principal included: the owner's spec change
 * adds reading and marking his own notifications to his own-account changes
 * (edge cases, "Who can act"; answer 10 of the plan of task 0.9).
 *
 * Task 10.11 (pull request #371): open to integration keys, for the person the key acts
 * for, with only the notices sent for their Teacher, Head Teacher or Senior Head Teacher
 * role (`02`, Integration keys: "Their other roles do not count through a key"). Any other
 * notice is unknown to the key: not listed, not counted, 404 to mark, left unread.
 */
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: Notifications) {}

  @Get()
  @AnySignedIn()
  @OpenToKeys()
  @Returns(notificationListSchema)
  list(@CurrentReader() reader: NoticeReader): Promise<NotificationList> {
    return this.notifications.list(reader);
  }

  @Post('read-all')
  @AnySignedIn()
  @OpenToKeys()
  @ReturnsNothing()
  readAll(@CurrentReader() reader: NoticeReader): Promise<void> {
    return this.notifications.markAllRead(reader);
  }

  @Post(':id/read')
  @AnySignedIn()
  @OpenToKeys()
  @ReturnsNothing()
  read(
    @CurrentReader() reader: NoticeReader,
    @ValidParams(notificationParamsSchema) params: NotificationParams,
  ): Promise<void> {
    return this.notifications.markRead(reader, params.id);
  }
}
