import { Module, type OnModuleInit } from '@nestjs/common';
import { JobRunner } from '../../jobs/job-runner.js';
import { AuthModule } from './auth.module.js';
import { EmailPasswordResets } from './email-password-resets.service.js';
import { PasswordResetEmailController } from './password-reset-email.controller.js';
import { PasswordResetMailer, passwordResetMailJob } from './password-reset-mail.job.js';

/**
 * The password reset by email (task 2.3c-2, pull request #66): its two
 * public routes, the service and the mail job. A module of its own beside
 * `AuthModule`, because it needs the job queue and the mail service, which the
 * first-account command and the seed of the browser tests do not start.
 */
@Module({
  imports: [AuthModule],
  controllers: [PasswordResetEmailController],
  providers: [EmailPasswordResets, PasswordResetMailer],
})
export class PasswordResetEmailModule implements OnModuleInit {
  constructor(
    private readonly runner: JobRunner,
    private readonly mailer: PasswordResetMailer,
  ) {}

  onModuleInit(): void {
    this.runner.handle(passwordResetMailJob, (transaction, data) =>
      this.mailer.send(transaction, data),
    );
  }
}
