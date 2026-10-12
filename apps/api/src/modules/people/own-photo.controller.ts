import { Controller, Delete, Get, Put } from '@nestjs/common';
import { OWN_PHOTO_ROUTE, type UploadedFile } from '../../http/file-routes.js';
import type { PhotoFile } from '../../http/photo-file.js';
import { RequestId } from '../../http/request-id.js';
import { ReturnsNothing, ReturnsPhoto, ValidFile } from '../../http/schemas.js';
import { AnySignedIn } from '../access/access.decorators.js';
import { CurrentSession } from '../auth/session.guard.js';
import type { ActiveSession } from '../auth/sessions.service.js';
import { StaffPhotos } from './staff-photos.service.js';

/**
 * The own photo (`edge/people-roles-accounts`, Accounts and sign-in: "Staff
 * can change their own ... photo"; Who can act: the Principal's own account
 * includes the photo; task 2.3c-2, pull request #66, decision 18). Routes of
 * the own account beside `/api/auth/language`: they act on the record linked
 * to the session's account and never on one named in the request.
 */
@Controller('auth')
export class OwnPhotoController {
  constructor(private readonly photos: StaffPhotos) {}

  @Put('photo')
  @AnySignedIn()
  @ReturnsNothing()
  setPhoto(
    @CurrentSession() session: ActiveSession,
    @ValidFile(OWN_PHOTO_ROUTE) file: UploadedFile | null,
    @RequestId() requestId: string,
  ): Promise<void> {
    return this.photos.setOwnPhoto(session.accountId, file, requestId);
  }

  @Delete('photo')
  @AnySignedIn()
  @ReturnsNothing()
  removePhoto(
    @CurrentSession() session: ActiveSession,
    @RequestId() requestId: string,
  ): Promise<void> {
    return this.photos.removeOwnPhoto(session.accountId, requestId);
  }

  @Get('photo')
  @AnySignedIn()
  @ReturnsPhoto()
  readPhoto(@CurrentSession() session: ActiveSession): Promise<PhotoFile> {
    return this.photos.readOwnPhoto(session.accountId);
  }
}
