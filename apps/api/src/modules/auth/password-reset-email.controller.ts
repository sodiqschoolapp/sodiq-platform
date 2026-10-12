import { Controller, Post } from '@nestjs/common';
import {
  passwordResetConfirmSchema,
  passwordResetRequestSchema,
  type PasswordResetConfirm,
  type PasswordResetRequest,
} from '@sodiq/shared';
import { RequestId } from '../../http/request-id.js';
import { AcceptedNothing, ReturnsNothing, ValidBody } from '../../http/schemas.js';
import { EmailPasswordResets } from './email-password-resets.service.js';
import { Public } from './session.guard.js';

/**
 * Password reset by email (docs/spec/02-roles-and-access.md, Accounts and
 * sign-in: build order: "later password reset by email" is in the short list
 * of public routes; task 2.3c-2, decision 1 of pull request #66). Both routes
 * are in `PUBLIC_ROUTES`.
 */
@Controller('auth')
export class PasswordResetEmailController {
  constructor(private readonly emailResets: EmailPasswordResets) {}

  /** "Forgot your password?": the same answer for every login (decision 8). */
  @Post('password-reset')
  @Public()
  @AcceptedNothing()
  async requestPasswordReset(
    @ValidBody(passwordResetRequestSchema) body: PasswordResetRequest,
    @RequestId() requestId: string,
  ): Promise<void> {
    await this.emailResets.request(body.login, requestId);
  }

  /** The new password chosen with a link of the mail. */
  @Post('password-reset/confirm')
  @Public()
  @ReturnsNothing()
  async confirmPasswordReset(
    @ValidBody(passwordResetConfirmSchema) body: PasswordResetConfirm,
    @RequestId() requestId: string,
  ): Promise<void> {
    await this.emailResets.confirm(body.token, body.newPassword, requestId);
  }
}
