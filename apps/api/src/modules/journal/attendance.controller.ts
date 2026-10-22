import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import {
  allPresentSchema,
  attendanceSaveSchema,
  attendanceSavedSchema,
  cellHistorySchema,
  journalLessonParamsSchema,
  lessonStudentParamsSchema,
  type AllPresent,
  type AttendanceSave,
  type AttendanceSaved,
  type CellHistory,
  type JournalLessonParams,
  type LessonStudentParams,
} from '@sodiq/shared';
import { RequestId } from '../../http/request-id.js';
import { Returns, ValidBody, ValidParams } from '../../http/schemas.js';
import { Requires } from '../access/access.decorators.js';
import { CurrentAccess, type Access } from '../access/permission.guard.js';
import { AttendanceService } from './attendance.service.js';

/**
 * Attendance entry and the history of a cell (task 6.3, pull request #211;
 * `07`, Entering data, Editing rules and locks, Who can do what). The table
 * lets in the roles of `journal` `edit` (decision 1 with review correction
 * 1); the route decides the lesson for every request (`attendance-entry.ts`):
 * 404 for an unknown lesson or another branch's, then 403
 * `journal_entry_scope`, then the lesson's state (decision 15). The history
 * is read by the readers of the journal, within what their grid shows.
 */
@Controller('journal/lessons')
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Post(':lessonId/attendance')
  @HttpCode(200)
  @Requires('journal', 'edit')
  @Returns(attendanceSavedSchema)
  save(
    @CurrentAccess() access: Access,
    @ValidParams(journalLessonParamsSchema) params: JournalLessonParams,
    @ValidBody(attendanceSaveSchema) input: AttendanceSave,
    @RequestId() requestId: string,
  ): Promise<AttendanceSaved> {
    return this.attendance.save(access, params.lessonId, input, requestId);
  }

  @Post(':lessonId/all-present')
  @HttpCode(200)
  @Requires('journal', 'edit')
  @Returns(allPresentSchema)
  allPresent(
    @CurrentAccess() access: Access,
    @ValidParams(journalLessonParamsSchema) params: JournalLessonParams,
    @RequestId() requestId: string,
  ): Promise<AllPresent> {
    return this.attendance.allPresent(access, params.lessonId, requestId);
  }

  @Get(':lessonId/students/:studentId/history')
  @Requires('journal', 'view')
  @Returns(cellHistorySchema)
  history(
    @CurrentAccess() access: Access,
    @ValidParams(lessonStudentParamsSchema) params: LessonStudentParams,
  ): Promise<CellHistory> {
    return this.attendance.history(access, params.lessonId, params.studentId);
  }
}
