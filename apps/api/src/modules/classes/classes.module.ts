import { Module } from '@nestjs/common';
import { ClassMembers } from './class-members.service.js';
import { ClassTutors } from './class-tutors.service.js';
import { ClassesController } from './classes.controller.js';
import { Classes } from './classes.service.js';
import { GroupMembers } from './group-members.service.js';
import { GroupsController } from './groups.controller.js';
import { Groups } from './groups.service.js';

/**
 * Classes and their Tutors (docs/spec/05-classes-groups-subjects.md; task
 * 3.1a), their members (task 3.1b), groups and splits (task 3.2a) and their
 * members (task 3.2b).
 */
@Module({
  controllers: [ClassesController, GroupsController],
  providers: [Classes, ClassTutors, ClassMembers, Groups, GroupMembers],
})
export class ClassesModule {}
