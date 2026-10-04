import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Accounts } from './accounts.service.js';
import { AuthController } from './auth.controller.js';
import { FirstAccount } from './first-account.service.js';
import { PasswordResets } from './password-resets.service.js';
import { SessionGuard } from './session.guard.js';
import { Sessions } from './sessions.service.js';
import { SignInThrottle } from './sign-in-throttle.service.js';

@Module({
  controllers: [AuthController],
  providers: [
    Accounts,
    Sessions,
    SignInThrottle,
    PasswordResets,
    FirstAccount,
    // On every route of the application, whichever module it belongs to.
    { provide: APP_GUARD, useClass: SessionGuard },
  ],
  exports: [Accounts, Sessions, PasswordResets, FirstAccount],
})
export class AuthModule {}
