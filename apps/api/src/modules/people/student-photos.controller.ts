import { Controller, Delete, Get, Put } from '@nestjs/common';
import { studentParamsSchema, type StudentParams } from '@sodiq/shared';
import { STUDENT_PHOTO_ROUTE, type UploadedFile } from '../../http/file-routes.js';
import type { PhotoFile } from '../../http/photo-file.js';
import { RequestId } from '../../http/request-id.js';
import { ReturnsNothing, ReturnsPhoto, ValidFile, ValidParams } from '../../http/schemas.js';
import { Requires } from '../access/access.decorators.js';
import { CurrentAccess, type Access } from '../access/permission.guard.js';
import { StudentPhotos } from './student-photos.service.js';

/**
 * The photo of a student (docs/spec/04-people.md, Student record; task
 * 2.4b-2, pull request #70, decision 7). Set and removed under `students`
 * `edit` (the Super Admin and the Academic Vice Principal), read under
 * `students` `view` (the Basic group); each for the branch of the request.
 * The upload is a declared exception of the JSON-only rule (`file-routes.ts`,
 * decision 4).
 */
@Controller('people')
export class StudentPhotosController {
  constructor(private readonly photos: StudentPhotos) {}

  @Put('students/:id/photo')
  @Requires('students', 'edit')
  @ReturnsNothing()
  setPhoto(
    @CurrentAccess() access: Access,
    @ValidParams(studentParamsSchema) params: StudentParams,
    @ValidFile(STUDENT_PHOTO_ROUTE) file: UploadedFile | null,
    @RequestId() requestId: string,
  ): Promise<void> {
    return this.photos.setPhoto(access, params.id, file, requestId);
  }

  @Delete('students/:id/photo')
  @Requires('students', 'edit')
  @ReturnsNothing()
  removePhoto(
    @CurrentAccess() access: Access,
    @ValidParams(studentParamsSchema) params: StudentParams,
    @RequestId() requestId: string,
  ): Promise<void> {
    return this.photos.removePhoto(access, params.id, requestId);
  }

  @Get('students/:id/photo')
  @Requires('students', 'view')
  @ReturnsPhoto()
  readPhoto(
    @CurrentAccess() access: Access,
    @ValidParams(studentParamsSchema) params: StudentParams,
  ): Promise<PhotoFile> {
    return this.photos.readPhoto(access, params.id);
  }
}
