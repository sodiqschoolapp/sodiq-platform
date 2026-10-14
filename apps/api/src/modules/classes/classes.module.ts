import { Module } from '@nestjs/common';
import { ClassTutors } from './class-tutors.service.js';
import { ClassesController } from './classes.controller.js';
import { Classes } from './classes.service.js';

/**
 * Classes and their Tutors (docs/spec/05-classes-groups-subjects.md; task
 * 3.1a). Membership (3.1b) and the class scope of Tutors (3.1c) come next.
 */
@Module({
  controllers: [ClassesController],
  providers: [Classes, ClassTutors],
})
export class ClassesModule {}
