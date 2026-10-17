import { Module } from '@nestjs/common';
import { TimetableController } from './timetable.controller.js';
import { TimetablePattern } from './pattern.service.js';
import { Timetable } from './timetable.service.js';

/** Draft timetable versions, their teaching load (task 3.4a) and the grid of their pattern (task 5.4a). */
@Module({
  controllers: [TimetableController],
  providers: [Timetable, TimetablePattern],
})
export class TimetableModule {}
