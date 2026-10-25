import { NotificationsModule } from '../notifications/notifications.module.js';
import { Module } from '@nestjs/common';
import { TimetableModule } from '../timetable/timetable.module.js';
import { AcademicYearsController } from './academic-years.controller.js';
import { AcademicYears } from './academic-years.service.js';
import { BranchesController } from './branches.controller.js';
import { Branches } from './branches.service.js';
import { BuildingsController } from './buildings.controller.js';
import { CalendarController } from './calendar.controller.js';
import { Calendar } from './calendar.service.js';
import { DayTemplatesController } from './day-templates.controller.js';
import { DayTemplates } from './day-templates.service.js';
import { Buildings } from './buildings.service.js';
import { DivisionsController } from './divisions.controller.js';
import { Divisions } from './divisions.service.js';
import { PlaceForcedDeletesController } from './place-forced-deletes.controller.js';
import { PlaceForcedDeletes } from './place-forced-deletes.service.js';
import { RoomsController } from './rooms.controller.js';
import { SettingsController } from './settings.controller.js';
import { Settings } from './settings.service.js';
import { TravelTimesController } from './travel-times.controller.js';
import { TravelTimes } from './travel-times.service.js';
import { Rooms } from './rooms.service.js';
import { SubjectsController } from './subjects.controller.js';
import { Subjects } from './subjects.service.js';
import { QuarterLessons } from './quarter-lessons.js';
import { TemplateLessons } from './template-lessons.js';
import { PlansModule } from '../plans/plans.module.js';

/**
 * School setup (docs/spec/03-school-setup.md): the branch record, buildings,
 * floors and rooms (task 1.1); divisions and departments (task 1.2); academic
 * years, quarters and the go-live date (task 1.3); slot types and day
 * templates (task 1.5); the calendar (task 1.4); the settings, travel time
 * and the setup checklist (task 1.6); subjects and their weights (task 2.1);
 * the forced delete of a building, floor or room (task 5.8c).
 */
@Module({
  imports: [TimetableModule, PlansModule, NotificationsModule],
  controllers: [
    BranchesController,
    BuildingsController,
    RoomsController,
    PlaceForcedDeletesController,
    DivisionsController,
    AcademicYearsController,
    DayTemplatesController,
    CalendarController,
    SettingsController,
    TravelTimesController,
    SubjectsController,
  ],
  providers: [
    Branches,
    Buildings,
    Rooms,
    PlaceForcedDeletes,
    Divisions,
    AcademicYears,
    QuarterLessons,
    DayTemplates,
    TemplateLessons,
    Calendar,
    Settings,
    TravelTimes,
    Subjects,
  ],
})
export class SetupModule {}
