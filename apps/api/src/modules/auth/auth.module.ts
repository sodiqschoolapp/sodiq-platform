import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Accounts } from './accounts.service.js';
import { AuthController } from './auth.controller.js';
import { FirstAccount } from './first-account.service.js';
import { PasswordResets } from './password-resets.service.js';
import { SecondStepKeyCheck } from './second-step-key-check.js';
import { SecondStepRule } from './second-step-rule.js';
import { SecondStepSecrets } from './second-step-secrets.js';
import { SessionGuard } from './session.guard.js';
import { Sessions } from './sessions.service.js';
import { SignInThrottle } from './sign-in-throttle.service.js';
import { TwoStepController } from './two-step.controller.js';
import { TwoStep } from './two-step.service.js';

@Module({
  controllers: [AuthController, TwoStepController],
  providers: [
    Accounts,
    Sessions,
    SignInThrottle,
    PasswordResets,
    SecondStepRule,
    SecondStepSecrets,
    SecondStepKeyCheck,
    TwoStep,
    FirstAccount,
    // On every route of the application, whichever module it belongs to.
    { provide: APP_GUARD, useClass: SessionGuard },
  ],
  exports: [Accounts, Sessions, PasswordResets, TwoStep, SecondStepKeyCheck, FirstAccount],
})
export class AuthModule {}
