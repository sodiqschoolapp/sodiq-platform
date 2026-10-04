import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AccessModule } from '../access/access.module.js';
import { PermissionGuard } from '../access/permission.guard.js';
import { AccountLocks } from './account-locks.service.js';
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
import { TrustedDevicesController } from './trusted-devices.controller.js';
import { TwoStepController } from './two-step.controller.js';
import { TwoStep } from './two-step.service.js';

@Module({
  // The first-account command gives the Super Admin role; the permission guard reads the table.
  imports: [AccessModule],
  controllers: [AuthController, TwoStepController, TrustedDevicesController],
  providers: [
    Accounts,
    Sessions,
    SignInThrottle,
    PasswordResets,
    AccountLocks,
    SecondStepRule,
    SecondStepSecrets,
    SecondStepKeyCheck,
    TwoStep,
    FirstAccount,
    // On every route of the application, whichever module it belongs to, in
    // this order: the permission guard needs the session the first one found.
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
  ],
  exports: [
    Accounts,
    Sessions,
    PasswordResets,
    AccountLocks,
    TwoStep,
    SecondStepKeyCheck,
    FirstAccount,
  ],
})
export class AuthModule {}
