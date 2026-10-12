import { Module } from '@nestjs/common';
import { AvailabilityController } from './availability.controller.js';
import { StaffAvailability } from './availability.service.js';
import { StaffController } from './staff.controller.js';
import { Staff } from './staff.service.js';
import { VacanciesController } from './vacancies.controller.js';
import { Vacancies } from './vacancies.service.js';

/**
 * People (docs/spec/04-people.md): staff records and their status (task
 * 2.2a), availability and vacancies (task 2.2b).
 */
@Module({
  controllers: [StaffController, AvailabilityController, VacanciesController],
  providers: [Staff, StaffAvailability, Vacancies],
})
export class PeopleModule {}
