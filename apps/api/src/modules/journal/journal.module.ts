import { Module } from '@nestjs/common';
import { JournalGridReader } from './journal-grid.service.js';
import { JournalsController } from './journals.controller.js';

@Module({
  controllers: [JournalsController],
  providers: [JournalGridReader],
})
export class JournalModule {}
