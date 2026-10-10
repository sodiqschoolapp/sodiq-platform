import { Module } from '@nestjs/common';
import { BranchesController } from './branches.controller.js';
import { Branches } from './branches.service.js';
import { BuildingsController } from './buildings.controller.js';
import { Buildings } from './buildings.service.js';
import { RoomsController } from './rooms.controller.js';
import { Rooms } from './rooms.service.js';

/** School setup (docs/spec/03-school-setup.md): the branch record, buildings, floors and rooms (task 1.1). */
@Module({
  controllers: [BranchesController, BuildingsController, RoomsController],
  providers: [Branches, Buildings, Rooms],
})
export class SetupModule {}
