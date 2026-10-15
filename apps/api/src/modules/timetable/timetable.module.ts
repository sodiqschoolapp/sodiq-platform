import { Module } from '@nestjs/common';
import { TimetableController } from './timetable.controller.js';
import { Timetable } from './timetable.service.js';

/** Draft timetable versions and their teaching load (task 3.4a). */
@Module({
  controllers: [TimetableController],
  providers: [Timetable],
})
export class TimetableModule {}
