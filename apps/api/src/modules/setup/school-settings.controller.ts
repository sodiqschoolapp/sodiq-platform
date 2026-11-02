import { Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import {
  ratingExamsPrimaryChangeSchema,
  ratingExamsPrimaryPreviewSchema,
  schoolSettingsSchema,
  type RatingExamsPrimaryChange,
  type RatingExamsPrimaryPreview,
  type SchoolSettings,
} from '@sodiq/shared';
import { RequestId } from '../../http/request-id.js';
import { Returns, ValidBody } from '../../http/schemas.js';
import { Requires } from '../access/access.decorators.js';
import { CurrentAccess, type Access } from '../access/permission.guard.js';
import { SchoolSettingsService } from './school-settings.service.js';

/**
 * The settings of the whole school (task 9.4f, pull request #276): "Rating exams in grades 0–4"
 * (`05`, Grading weights on a subject, Grades 0–4). Read under `settings` view for the branch of
 * the request (the Super Admin, the Principal, the Academic Vice Principal; decision 9); the
 * preview and the change under the new area `school_settings` edit, the Super Admin alone
 * (the owner's answer A), as school-wide work: the change acts on every branch (decision 4).
 */
@Controller('setup')
export class SchoolSettingsController {
  constructor(private readonly settings: SchoolSettingsService) {}

  @Get('school-settings')
  @Requires('settings', 'view')
  @Returns(schoolSettingsSchema)
  read(@CurrentAccess() access: Access): Promise<SchoolSettings> {
    return this.settings.read(access);
  }

  /** The grades the change would alter in each journal and what refuses it; changes nothing. */
  @Post('school-settings/rating-exams-primary/preview')
  @HttpCode(200)
  @Requires('school_settings', 'edit', { branch: 'none' })
  @Returns(ratingExamsPrimaryPreviewSchema)
  preview(
    @CurrentAccess() access: Access,
    @ValidBody(ratingExamsPrimaryChangeSchema) change: RatingExamsPrimaryChange,
    @RequestId() requestId: string,
  ): Promise<RatingExamsPrimaryPreview> {
    return this.settings.preview(access, change, requestId);
  }

  @Put('school-settings/rating-exams-primary')
  @Requires('school_settings', 'edit', { branch: 'none' })
  @Returns(schoolSettingsSchema)
  change(
    @CurrentAccess() access: Access,
    @ValidBody(ratingExamsPrimaryChangeSchema) change: RatingExamsPrimaryChange,
    @RequestId() requestId: string,
  ): Promise<SchoolSettings> {
    return this.settings.change(access, change, requestId);
  }
}
