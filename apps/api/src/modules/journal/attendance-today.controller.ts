import { Controller, Get } from '@nestjs/common';
import {
  attendanceTodayQuerySchema,
  attendanceTodaySchema,
  type AttendanceToday,
  type AttendanceTodayQuery,
} from '@sodiq/shared';
import { Returns, ValidQuery } from '../../http/schemas.js';
import { Requires } from '../access/access.decorators.js';
import { CurrentAccess, type Access } from '../access/permission.guard.js';
import { AttendanceTodayService } from './attendance-today.service.js';

/**
 * The attendance of classes for the home pages (task 9.4b; `08`, Home pages by role, Tutor and
 * Head Tutor rows). The classes read are decided in the service: own classes for a Tutor, the
 * branch for the others. A read writes no audit entry.
 */
@Controller('journal')
export class AttendanceTodayController {
  constructor(private readonly attendance: AttendanceTodayService) {}

  @Get('attendance-today')
  @Requires('attendance_today', 'view')
  @Returns(attendanceTodaySchema)
  read(
    @ValidQuery(attendanceTodayQuerySchema) query: AttendanceTodayQuery,
    @CurrentAccess() access: Access,
  ): Promise<AttendanceToday> {
    return this.attendance.read(access, query);
  }
}
