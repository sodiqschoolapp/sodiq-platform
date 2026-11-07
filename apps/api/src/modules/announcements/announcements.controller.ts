import { Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import {
  announcementEditSchema,
  announcementListSchema,
  announcementMonthSchema,
  announcementParamsSchema,
  announcementRecordSchema,
  announcementSchema,
  announcementsMonthQuerySchema,
  announcementsQuerySchema,
  announcementVersionSchema,
  portalChildParamsSchema,
  type Announcement,
  type AnnouncementEdit,
  type AnnouncementList,
  type AnnouncementMonth,
  type AnnouncementParams,
  type AnnouncementRecord,
  type AnnouncementsMonthQuery,
  type AnnouncementsQuery,
  type AnnouncementVersion,
  type PortalChildParams,
} from '@sodiq/shared';
import { RequestId } from '../../http/request-id.js';
import { RequestKey, Returns, ValidBody, ValidParams, ValidQuery } from '../../http/schemas.js';
import { PortalChild, Requires } from '../access/access.decorators.js';
import { CurrentAccess, type Access } from '../access/permission.guard.js';
import { CurrentSession } from '../auth/session.guard.js';
import type { ActiveSession } from '../auth/sessions.service.js';
import { AnnouncementsService } from './announcements.service.js';

/**
 * Announcements and events (task 11.7, pull request #306). The authors' routes under
 * `announcements`, for the branch of the request (a whole-school announcement is the Super
 * Admin's alone, checked in the service); the staff feed under `announcements_feed`; the portal
 * page of a child, `@PortalChild()`, the child scope checked on every request.
 */
@Controller()
export class AnnouncementsController {
  constructor(private readonly announcements: AnnouncementsService) {}

  @Get('announcements')
  @Requires('announcements', 'view')
  @Returns(announcementListSchema)
  list(
    @CurrentAccess() access: Access,
    @ValidQuery(announcementsQuerySchema) query: AnnouncementsQuery,
  ): Promise<AnnouncementList> {
    return this.announcements.list(access, query);
  }

  @Post('announcements')
  @Requires('announcements', 'create')
  @Returns(announcementSchema)
  create(
    @CurrentAccess() access: Access,
    @RequestKey() key: string,
    @ValidBody(announcementRecordSchema) record: AnnouncementRecord,
    @RequestId() requestId: string,
  ): Promise<Announcement> {
    return this.announcements.create(access, record, key, requestId);
  }

  @Put('announcements/:id')
  @Requires('announcements', 'edit')
  @Returns(announcementSchema)
  edit(
    @CurrentAccess() access: Access,
    @ValidParams(announcementParamsSchema) params: AnnouncementParams,
    @ValidBody(announcementEditSchema) change: AnnouncementEdit,
    @RequestId() requestId: string,
  ): Promise<Announcement> {
    return this.announcements.edit(access, params.id, change, requestId);
  }

  @Post('announcements/:id/archive')
  @HttpCode(200)
  @Requires('announcements', 'archive')
  @Returns(announcementSchema)
  archive(
    @CurrentAccess() access: Access,
    @ValidParams(announcementParamsSchema) params: AnnouncementParams,
    @ValidBody(announcementVersionSchema) body: AnnouncementVersion,
    @RequestId() requestId: string,
  ): Promise<Announcement> {
    return this.announcements.archive(access, params.id, body.version, requestId);
  }

  @Post('announcements/:id/restore')
  @HttpCode(200)
  @Requires('announcements', 'archive')
  @Returns(announcementSchema)
  restore(
    @CurrentAccess() access: Access,
    @ValidParams(announcementParamsSchema) params: AnnouncementParams,
    @ValidBody(announcementVersionSchema) body: AnnouncementVersion,
    @RequestId() requestId: string,
  ): Promise<Announcement> {
    return this.announcements.restore(access, params.id, body.version, requestId);
  }

  @Get('announcements-feed')
  @Requires('announcements_feed', 'view')
  @Returns(announcementMonthSchema)
  addressed(
    @CurrentAccess() access: Access,
    @ValidQuery(announcementsMonthQuerySchema) query: AnnouncementsMonthQuery,
  ): Promise<AnnouncementMonth> {
    return this.announcements.addressed(access, query.month);
  }

  @Get('portal/children/:studentId/announcements')
  @PortalChild()
  @Returns(announcementMonthSchema)
  portal(
    @CurrentSession() session: ActiveSession,
    @ValidParams(portalChildParamsSchema) params: PortalChildParams,
    @ValidQuery(announcementsMonthQuerySchema) query: AnnouncementsMonthQuery,
  ): Promise<AnnouncementMonth> {
    return this.announcements.portal(session.accountId, params.studentId, query.month);
  }
}
