import { Module } from '@nestjs/common';
import { Assignments } from './assignments.service.js';

@Module({
  providers: [Assignments],
  exports: [Assignments],
})
export class AccessModule {}
