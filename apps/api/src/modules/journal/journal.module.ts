import { Module, type OnModuleInit } from '@nestjs/common';
import { AccessModule } from '../access/access.module.js';
import { ChromiumPdfRenderer, PDF_RENDERER } from '../../http/pdf.js';
import { JobRunner } from '../../jobs/job-runner.js';
import { SupportViewController } from './support-view.controller.js';
import { SupportView } from './support-view.service.js';
import { SaveRefusals } from './save-refusals.js';
import { JournalExportsController } from './journal-exports.controller.js';
import { exportsCleanupJob } from '../results/daily/daily-jobs.js';
import { branchExportJob, JournalExports } from './journal-exports.service.js';
import { type AppConfig } from '../../config/config.js';
import { CONFIG } from '../../config/config.module.js';
import { PHOTO_STORE, photoStoreOf } from '../people/photo-store.js';
import { ExemptionsController, ExemptionsTodayController } from './exemptions.controller.js';
import { Exemptions } from './exemptions.service.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { AttendanceController } from './attendance.controller.js';
import { AttendanceTodayController } from './attendance-today.controller.js';
import { AttendanceTodayService } from './attendance-today.service.js';
import { AttendanceService } from './attendance.service.js';
import { CellActionsService } from './cell-actions.service.js';
import { CommentsController } from './comments.controller.js';
import { CommentsService } from './comments.service.js';
import { JournalGridReader } from './journal-grid.service.js';
import { JournalsController } from './journals.controller.js';
import { LeavingResultsController } from './leaving-results.controller.js';
import { LeavingResults } from './leaving-results.service.js';
import { LessonStatusController } from './lesson-status.controller.js';
import { LessonStatusService } from './lesson-status.service.js';
import { RatingController } from './rating.controller.js';
import { RatingService } from './rating.service.js';
import { ExtensionsService } from './extensions.service.js';
import { UnlocksController } from './unlocks.controller.js';
import { UnlocksService } from './unlocks.service.js';
import { StudentAbsencesController } from './student-absences.controller.js';
import { StudentAbsences } from './student-absences.service.js';
import { WorksController } from './works.controller.js';
import { WorksService } from './works.service.js';

@Module({
  imports: [NotificationsModule, AccessModule],
  controllers: [
    // Task 8.4: before the controllers whose `lessons/:lessonId` and `journals/:journalId` paths
    // would take `unlocks`.
    UnlocksController,
    // Task 8.5: the exemptions.
    ExemptionsController,
    ExemptionsTodayController,
    JournalsController,
    AttendanceController,
    StudentAbsencesController,
    WorksController,
    RatingController,
    CommentsController,
    // Task 8.6: the results at leaving on the student's record.
    LeavingResultsController,
    // Task 8.7: the reminders, the counts per teacher and the orphan lessons.
    LessonStatusController,
    // Task 9.4b: the attendance of classes for the home pages.
    AttendanceTodayController,
    // Task 8.9: the exports of journals.
    JournalExportsController,
    SupportViewController,
  ],
  providers: [
    JournalGridReader,
    AttendanceService,
    AttendanceTodayService,
    StudentAbsences,
    WorksService,
    RatingService,
    CommentsService,
    CellActionsService,
    UnlocksService,
    ExtensionsService,
    Exemptions,
    LeavingResults,
    LessonStatusService,
    JournalExports,
    SaveRefusals,
    SupportView,
    // Task 8.9: the PDFs of journals.
    {
      provide: PDF_RENDERER,
      useFactory: (config: AppConfig) => new ChromiumPdfRenderer(config),
      inject: [CONFIG],
    },
    // Task 8.5 (decision 17): the documents of exemptions and the files of reasons of absence go
    // to the photos' store under `exemptions/` and `absences/`.
    {
      provide: PHOTO_STORE,
      useFactory: (config: AppConfig) => photoStoreOf(config.photos),
      inject: [CONFIG],
    },
  ],
})
export class JournalModule implements OnModuleInit {
  constructor(
    private readonly runner: JobRunner,
    private readonly exports: JournalExports,
  ) {}

  onModuleInit(): void {
    this.runner.handleWithoutTransaction(branchExportJob, (data, job) =>
      this.exports.runBranchExport(data, job),
    );
    // Task 10.2a: a daily kind of the schedule (`results/daily`), run for one branch.
    this.runner.handleWithoutTransaction(exportsCleanupJob, (_data, job) =>
      this.exports.cleanupFiles(job),
    );
  }
}
