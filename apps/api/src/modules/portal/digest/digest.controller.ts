import { Controller, Get, Put } from '@nestjs/common';
import {
  digestFrequencyAnswerSchema,
  digestFrequencyChangeSchema,
  digestLogQuerySchema,
  digestLogSchema,
  digestSettingsChangeSchema,
  digestSettingsSchema,
  type DigestFrequencyAnswer,
  type DigestFrequencyChange,
  type DigestLog,
  type DigestLogQuery,
  type DigestSettings,
  type DigestSettingsChange,
} from '@sodiq/shared';
import { RequestId } from '../../../http/request-id.js';
import { Returns, ValidBody, ValidQuery } from '../../../http/schemas.js';
import { AnySignedIn, Requires } from '../../access/access.decorators.js';
import { CurrentAccess, type Access } from '../../access/permission.guard.js';
import { CurrentSession } from '../../auth/session.guard.js';
import type { ActiveSession } from '../../auth/sessions.service.js';
import { DigestAdmin } from './digest-admin.service.js';

/**
 * Task 11.5 (pull request #299). The digest's settings under `school_settings`, the Super Admin
 * alone (plan decision 2, Look first: the approval names the Super Admin only, so the read is not
 * under `settings` view); the send log under the new area `digest_log` view.
 */
@Controller()
export class DigestController {
  constructor(private readonly admin: DigestAdmin) {}

  @Get('setup/school-settings/digest')
  @Requires('school_settings', 'view', { branch: 'none' })
  @Returns(digestSettingsSchema)
  settings(): Promise<DigestSettings> {
    return this.admin.settings();
  }

  @Put('setup/school-settings/digest')
  @Requires('school_settings', 'edit', { branch: 'none' })
  @Returns(digestSettingsSchema)
  change(
    @CurrentAccess() access: Access,
    @ValidBody(digestSettingsChangeSchema) change: DigestSettingsChange,
    @RequestId() requestId: string,
  ): Promise<DigestSettings> {
    return this.admin.change(access, change, requestId);
  }

  @Get('digest-log')
  @Requires('digest_log', 'view', { branch: 'none' })
  @Returns(digestLogSchema)
  log(@ValidQuery(digestLogQuerySchema) query: DigestLogQuery): Promise<DigestLog> {
    return this.admin.log(query);
  }

  /**
   * The parent's own frequency (plan decision 1, Look first: a route of the parent session's
   * pinned list); a staff account is refused (403).
   */
  @Get('auth/digest-frequency')
  @AnySignedIn({ parent: true })
  @Returns(digestFrequencyAnswerSchema)
  frequency(@CurrentSession() session: ActiveSession): Promise<DigestFrequencyAnswer> {
    return this.admin.frequency(session);
  }

  @Put('auth/digest-frequency')
  @AnySignedIn({ parent: true })
  @Returns(digestFrequencyAnswerSchema)
  setFrequency(
    @CurrentSession() session: ActiveSession,
    @ValidBody(digestFrequencyChangeSchema) change: DigestFrequencyChange,
    @RequestId() requestId: string,
  ): Promise<DigestFrequencyAnswer> {
    return this.admin.setFrequency(session, change, requestId);
  }
}
