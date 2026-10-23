import { Module } from '@nestjs/common';
import { AttendanceController } from './attendance.controller.js';
import { AttendanceService } from './attendance.service.js';
import { JournalGridReader } from './journal-grid.service.js';
import { JournalsController } from './journals.controller.js';
import { StudentAbsencesController } from './student-absences.controller.js';
import { StudentAbsences } from './student-absences.service.js';
import { WorksController } from './works.controller.js';
import { WorksService } from './works.service.js';

@Module({
  controllers: [
    JournalsController,
    AttendanceController,
    StudentAbsencesController,
    WorksController,
  ],
  providers: [JournalGridReader, AttendanceService, StudentAbsences, WorksService],
})
export class JournalModule {}
