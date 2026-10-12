import { Module } from '@nestjs/common';
import { CONFIG } from '../../config/config.module.js';
import type { AppConfig } from '../../config/config.js';
import { AvailabilityController } from './availability.controller.js';
import { StaffAvailability } from './availability.service.js';
import { PHOTO_STORE, photoStoreOf } from './photo-store.js';
import { StaffPhotosController } from './staff-photos.controller.js';
import { StaffPhotos } from './staff-photos.service.js';
import { StaffController } from './staff.controller.js';
import { Staff } from './staff.service.js';
import { VacanciesController } from './vacancies.controller.js';
import { Vacancies } from './vacancies.service.js';

/**
 * People (docs/spec/04-people.md): staff records and their status (task
 * 2.2a), availability and vacancies (task 2.2b), staff photos (task 2.2c-2).
 */
@Module({
  controllers: [
    StaffController,
    StaffPhotosController,
    AvailabilityController,
    VacanciesController,
  ],
  providers: [
    Staff,
    StaffPhotos,
    StaffAvailability,
    Vacancies,
    {
      provide: PHOTO_STORE,
      useFactory: (config: AppConfig) => photoStoreOf(config.photos),
      inject: [CONFIG],
    },
  ],
})
export class PeopleModule {}
