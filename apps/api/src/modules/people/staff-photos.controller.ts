import { Controller, Delete, Get, Put } from '@nestjs/common';
import {
  staffDetailSchema,
  staffParamsSchema,
  type StaffDetail,
  type StaffParams,
} from '@sodiq/shared';
import { STAFF_PHOTO_ROUTE, type UploadedFile } from '../../http/file-routes.js';
import type { PhotoFile } from '../../http/photo-file.js';
import { RequestId } from '../../http/request-id.js';
import {
  Returns,
  ReturnsNothing,
  ReturnsPhoto,
  ValidFile,
  ValidParams,
} from '../../http/schemas.js';
import { Requires } from '../access/access.decorators.js';
import { CurrentAccess, type Access } from '../access/permission.guard.js';
import { StaffPhotos } from './staff-photos.service.js';
import { Staff } from './staff.service.js';

/**
 * The photo of a staff record (docs/spec/04-people.md, Teacher and staff
 * record; task 2.2c-2, pull request #59). Set and removed under `staff`
 * `edit` (the Super Admin and the Academic Vice Principal, decision 2), read
 * under `staff` `view`; each for the branch of the request. The upload is the
 * one declared exception of the JSON-only rule (`file-routes.ts`).
 */
@Controller('people')
export class StaffPhotosController {
  constructor(
    private readonly photos: StaffPhotos,
    private readonly staff: Staff,
  ) {}

  @Put('staff/:id/photo')
  @Requires('staff', 'edit')
  @Returns(staffDetailSchema)
  async setPhoto(
    @CurrentAccess() access: Access,
    @ValidParams(staffParamsSchema) params: StaffParams,
    @ValidFile(STAFF_PHOTO_ROUTE) file: UploadedFile,
    @RequestId() requestId: string,
  ): Promise<StaffDetail> {
    await this.photos.setPhoto(access, params.id, file, requestId);
    return this.staff.detail(access, params.id);
  }

  @Delete('staff/:id/photo')
  @Requires('staff', 'edit')
  @ReturnsNothing()
  removePhoto(
    @CurrentAccess() access: Access,
    @ValidParams(staffParamsSchema) params: StaffParams,
    @RequestId() requestId: string,
  ): Promise<void> {
    return this.photos.removePhoto(access, params.id, requestId);
  }

  @Get('staff/:id/photo')
  @Requires('staff', 'view')
  @ReturnsPhoto()
  readPhoto(
    @CurrentAccess() access: Access,
    @ValidParams(staffParamsSchema) params: StaffParams,
  ): Promise<PhotoFile> {
    return this.photos.readPhoto(access, params.id);
  }
}
