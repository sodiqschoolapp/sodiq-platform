import { Module } from '@nestjs/common';
import { ClassMembers } from './class-members.service.js';
import { ClassTutors } from './class-tutors.service.js';
import { ClassesController } from './classes.controller.js';
import { Classes } from './classes.service.js';

/**
 * Classes and their Tutors (docs/spec/05-classes-groups-subjects.md; task
 * 3.1a), their members (task 3.1b). The class scope of Tutors (3.1c) comes next.
 */
@Module({
  controllers: [ClassesController],
  providers: [Classes, ClassTutors, ClassMembers],
})
export class ClassesModule {}
