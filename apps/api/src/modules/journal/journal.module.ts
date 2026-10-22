import { Module } from '@nestjs/common';
import { AttendanceController } from './attendance.controller.js';
import { AttendanceService } from './attendance.service.js';
import { JournalGridReader } from './journal-grid.service.js';
import { JournalsController } from './journals.controller.js';
import { StudentAbsencesController } from './student-absences.controller.js';
import { StudentAbsences } from './student-absences.service.js';

@Module({
  controllers: [JournalsController, AttendanceController, StudentAbsencesController],
  providers: [JournalGridReader, AttendanceService, StudentAbsences],
})
export class JournalModule {}
