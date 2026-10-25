import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module.js';
import { StudentResultsController } from './student-results.controller.js';
import { StudentResultsService } from './student-results.service.js';

/** Results of students (task 9.1 on): read from the journal through `packages/calc`. */
@Module({
  imports: [AccessModule],
  controllers: [StudentResultsController],
  providers: [StudentResultsService],
})
export class ResultsModule {}
