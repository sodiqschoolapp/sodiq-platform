import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import {
  changePasswordSchema,
  sessionListSchema,
  sessionResponseSchema,
  signInSchema,
  type ChangePassword,
  type SessionList,
  type SessionResponse,
  type SignIn,
} from '@sodiq/shared';
import { DeviceCookie, UserAgent, type DeviceCookieJar } from '../../http/device-cookie.js';
import { RequestId } from '../../http/request-id.js';
import { Returns, ReturnsNothing, ValidBody } from '../../http/schemas.js';
import { SessionCookie, type SessionCookieJar } from '../../http/session-cookie.js';
import {
  AllowedBeforePasswordChange,
  AllowedBeforeSecondStep,
  AllowedBeforeSecondStepSetUp,
  CurrentSession,
  Public,
} from './session.guard.js';
import { Sessions, type ActiveSession } from './sessions.service.js';

export function answerOf(session: ActiveSession): SessionResponse {
  return {
    login: session.login,
    secondStep: session.secondStep,
    mustChangePassword: session.mustChangePassword,
    passwordResetBy: session.passwordResetBy,
    trustedUntil: session.trustedUntil?.toISOString() ?? null,
  };
}

/**
 * docs/spec/02-roles-and-access.md, Rules: staff sign in with login and
 * password and must change the password at first sign-in.
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly sessions: Sessions) {}

  @Post('sign-in')
  @Public()
  @HttpCode(200)
  @Returns(sessionResponseSchema)
  async signIn(
    @ValidBody(signInSchema) body: SignIn,
    @SessionCookie() cookie: SessionCookieJar,
    @DeviceCookie() device: DeviceCookieJar,
    @UserAgent() userAgent: string | undefined,
    @RequestId() requestId: string,
  ): Promise<SessionResponse> {
    const { token, deviceToken, session } = await this.sessions.signIn(body.login, body.password, {
      deviceToken: device.token,
      userAgent,
      trustDevice: body.trustDevice ?? false,
      requestId,
    });
    cookie.set(token);
    device.set(deviceToken);
    return answerOf(session);
  }

  @Get('session')
  @AllowedBeforeSecondStep()
  @AllowedBeforePasswordChange()
  @AllowedBeforeSecondStepSetUp()
  @Returns(sessionResponseSchema)
  read(@CurrentSession() session: ActiveSession): SessionResponse {
    return answerOf(session);
  }

  /** Edge cases, "Accounts and sign-in": the profile lists the sessions. Own sessions only. */
  @Get('sessions')
  @Returns(sessionListSchema)
  async list(@CurrentSession() session: ActiveSession): Promise<SessionList> {
    const sessions = await this.sessions.list(session);
    return {
      sessions: sessions.map((row) => ({
        id: row.id,
        startedAt: row.startedAt.toISOString(),
        lastUsedAt: row.lastUsedAt.toISOString(),
        userAgent: row.userAgent,
        current: row.current,
        trusted: row.trustedUntil !== null,
      })),
    };
  }

  @Post('password')
  @AllowedBeforePasswordChange()
  @AllowedBeforeSecondStepSetUp()
  @ReturnsNothing()
  async changePassword(
    @CurrentSession() session: ActiveSession,
    @ValidBody(changePasswordSchema) body: ChangePassword,
    @DeviceCookie() device: DeviceCookieJar,
    @RequestId() requestId: string,
  ): Promise<void> {
    await this.sessions.changePassword(session, body.currentPassword, body.newPassword, {
      deviceToken: device.token,
      requestId,
    });
  }

  @Post('sign-out')
  @AllowedBeforeSecondStep()
  @AllowedBeforePasswordChange()
  @AllowedBeforeSecondStepSetUp()
  @ReturnsNothing()
  async signOut(
    @CurrentSession() session: ActiveSession,
    @SessionCookie() cookie: SessionCookieJar,
    @RequestId() requestId: string,
  ): Promise<void> {
    await this.sessions.signOut(session, requestId);
    cookie.clear();
  }

  /** "Sign out everywhere": every session of the account, this one included. */
  @Post('sign-out-everywhere')
  @ReturnsNothing()
  async signOutEverywhere(
    @CurrentSession() session: ActiveSession,
    @SessionCookie() cookie: SessionCookieJar,
    @RequestId() requestId: string,
  ): Promise<void> {
    await this.sessions.signOutEverywhere(session, requestId);
    cookie.clear();
  }
}
