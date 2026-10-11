import { Module } from '@nestjs/common';
import { AcademicYearsController } from './academic-years.controller.js';
import { AcademicYears } from './academic-years.service.js';
import { BranchesController } from './branches.controller.js';
import { Branches } from './branches.service.js';
import { BuildingsController } from './buildings.controller.js';
import { DayTemplatesController } from './day-templates.controller.js';
import { DayTemplates } from './day-templates.service.js';
import { Buildings } from './buildings.service.js';
import { DivisionsController } from './divisions.controller.js';
import { Divisions } from './divisions.service.js';
import { RoomsController } from './rooms.controller.js';
import { Rooms } from './rooms.service.js';

/**
 * School setup (docs/spec/03-school-setup.md): the branch record, buildings,
 * floors and rooms (task 1.1); divisions and departments (task 1.2); academic
 * years, quarters and the go-live date (task 1.3); slot types and day
 * templates (task 1.5).
 */
@Module({
  controllers: [
    BranchesController,
    BuildingsController,
    RoomsController,
    DivisionsController,
    AcademicYearsController,
    DayTemplatesController,
  ],
  providers: [Branches, Buildings, Rooms, Divisions, AcademicYears, DayTemplates],
})
export class SetupModule {}
