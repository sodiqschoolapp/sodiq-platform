import { Module } from '@nestjs/common';
import { StaffController } from './staff.controller.js';
import { Staff } from './staff.service.js';

/**
 * People (docs/spec/04-people.md): staff records and their status (task 2.2a).
 */
@Module({
  controllers: [StaffController],
  providers: [Staff],
})
export class PeopleModule {}
