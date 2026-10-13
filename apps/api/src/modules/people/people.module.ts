import { Module } from '@nestjs/common';
import { CONFIG } from '../../config/config.module.js';
import type { AppConfig } from '../../config/config.js';
import { AccessModule } from '../access/access.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { AccountAccessController } from './account-access.controller.js';
import { AccountAccess } from './account-access.service.js';
import { AvailabilityController } from './availability.controller.js';
import { StaffAvailability } from './availability.service.js';
import { HeadTeachersController } from './head-teachers.controller.js';
import { HeadTeachers } from './head-teachers.service.js';
import { PersonalDataController } from './personal-data.controller.js';
import { PersonalData } from './personal-data.service.js';
import { PHOTO_STORE, photoStoreOf } from './photo-store.js';
import { RelativeWrites } from './relative-writes.js';
import { RelativesController } from './relatives.controller.js';
import { Relatives } from './relatives.service.js';
import { StaffAccountsController } from './staff-accounts.controller.js';
import { StaffAccounts } from './staff-accounts.service.js';
import { OwnPhotoController } from './own-photo.controller.js';
import { StaffPhotosController } from './staff-photos.controller.js';
import { StaffPhotos } from './staff-photos.service.js';
import { StaffController } from './staff.controller.js';
import { Staff } from './staff.service.js';
import { StudentExports } from './student-exports.service.js';
import { StudentPhotosController } from './student-photos.controller.js';
import { StudentPhotos } from './student-photos.service.js';
import { StudentStatusesController } from './student-statuses.controller.js';
import { StudentStatuses } from './student-statuses.service.js';
import { StudentsController } from './students.controller.js';
import { Students } from './students.service.js';
import { VacanciesController } from './vacancies.controller.js';
import { Vacancies } from './vacancies.service.js';

/**
 * People (docs/spec/04-people.md): staff records and their status (task
 * 2.2a), availability and vacancies (task 2.2b), staff photos (task 2.2c-2),
 * the account section of a record (task 2.3a), the Head Teacher appointments
 * (task 2.3b-1), the sign-in access of an account (task 2.3c-1), student
 * records (task 2.4a), their leaving, return and delete (task 2.4b-1), their
 * export and photos (task 2.4b-2), their close relatives (task 2.5a), the personal data report (task 2.6b).
 */
@Module({
  imports: [AccessModule, AuthModule, NotificationsModule],
  controllers: [
    StaffController,
    StaffAccountsController,
    AccountAccessController,
    HeadTeachersController,
    StaffPhotosController,
    OwnPhotoController,
    AvailabilityController,
    VacanciesController,
    StudentsController,
    StudentStatusesController,
    StudentPhotosController,
    RelativesController,
    PersonalDataController,
  ],
  providers: [
    PersonalData,
    Staff,
    StaffAccounts,
    AccountAccess,
    HeadTeachers,
    StaffPhotos,
    StaffAvailability,
    Vacancies,
    Students,
    StudentStatuses,
    StudentExports,
    StudentPhotos,
    RelativeWrites,
    Relatives,
    {
      provide: PHOTO_STORE,
      useFactory: (config: AppConfig) => photoStoreOf(config.photos),
      inject: [CONFIG],
    },
  ],
})
export class PeopleModule {}
