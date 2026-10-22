import { Controller, Get, Post } from '@nestjs/common';
import {
  branchViewQuerySchema,
  classViewQuerySchema,
  roomViewQuerySchema,
  teacherViewQuerySchema,
  timetableViewSchema,
  viewChoicesQuerySchema,
  viewChoicesSchema,
  viewExportRequestSchema,
  type BranchViewQuery,
  type ClassViewQuery,
  type RoomViewQuery,
  type TeacherViewQuery,
  type TimetableView,
  type ViewChoices,
  type ViewChoicesQuery,
  type ViewExportRequest,
} from '@sodiq/shared';
import type { PdfFile } from '../../http/pdf.js';
import { RequestId } from '../../http/request-id.js';
import { Returns, ReturnsFile, ValidBody, ValidQuery } from '../../http/schemas.js';
import type { XlsxFile } from '../../http/xlsx.js';
import { Requires } from '../access/access.decorators.js';
import { CurrentAccess, type Access } from '../access/permission.guard.js';
import { TimetableViewExports } from './views-export.service.js';
import { TimetableViews } from './views.service.js';

/**
 * The read-only timetable views (task 5.9a, pull request #197): the area
 * `timetable_views` (decision 2), the scope of each role checked by the
 * service on every request (decisions 3 and 4). Every route works for the
 * branch of the request; the views write no audit entry (a view is no change
 * and no export, decision 11), the export of task 5.9c-1 writes one.
 */
@Controller('timetable/views')
export class TimetableViewsController {
  constructor(
    private readonly views: TimetableViews,
    private readonly exports: TimetableViewExports,
  ) {}

  @Get('choices')
  @Requires('timetable_views', 'view')
  @Returns(viewChoicesSchema)
  choices(
    @CurrentAccess() access: Access,
    @ValidQuery(viewChoicesQuerySchema) query: ViewChoicesQuery,
  ): Promise<ViewChoices> {
    return this.views.choices(access, query);
  }

  @Get('branch')
  @Requires('timetable_views', 'view')
  @Returns(timetableViewSchema)
  branch(
    @CurrentAccess() access: Access,
    @ValidQuery(branchViewQuerySchema) query: BranchViewQuery,
  ): Promise<TimetableView> {
    return this.views.branch(access, query);
  }

  @Get('class')
  @Requires('timetable_views', 'view')
  @Returns(timetableViewSchema)
  class(
    @CurrentAccess() access: Access,
    @ValidQuery(classViewQuerySchema) query: ClassViewQuery,
  ): Promise<TimetableView> {
    return this.views.class(access, query);
  }

  @Get('teacher')
  @Requires('timetable_views', 'view')
  @Returns(timetableViewSchema)
  teacher(
    @CurrentAccess() access: Access,
    @ValidQuery(teacherViewQuerySchema) query: TeacherViewQuery,
  ): Promise<TimetableView> {
    return this.views.teacher(access, query);
  }

  @Get('room')
  @Requires('timetable_views', 'view')
  @Returns(timetableViewSchema)
  room(
    @CurrentAccess() access: Access,
    @ValidQuery(roomViewQuerySchema) query: RoomViewQuery,
  ): Promise<TimetableView> {
    return this.views.room(access, query);
  }

  /**
   * Print, PDF and Excel of one view (task 5.9c-1, pull request #199): the
   * view of the body in the scope of the role, as the routes above read it,
   * written as a file and logged (decisions 2, 5 and 14). POST: the export
   * writes an audit entry.
   */
  @Post('export')
  @Requires('timetable_views', 'export')
  @ReturnsFile({ pdf: true })
  export(
    @CurrentAccess() access: Access,
    @ValidBody(viewExportRequestSchema) request: ViewExportRequest,
    @RequestId() requestId: string,
  ): Promise<XlsxFile | PdfFile> {
    return this.exports.export(access, request, requestId);
  }
}
