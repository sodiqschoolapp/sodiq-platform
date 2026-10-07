import { Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import {
  changePasswordSchema,
  sessionListSchema,
  sessionResponseSchema,
  setLanguageSchema,
  signInSchema,
  type ChangePassword,
  type SessionList,
  type SessionResponse,
  type SetLanguage,
  type SignIn,
} from '@sodiq/shared';
import { DeviceCookie, UserAgent, type DeviceCookieJar } from '../../http/device-cookie.js';
import { RequestId } from '../../http/request-id.js';
import { Returns, ReturnsNothing, ValidBody } from '../../http/schemas.js';
import { SessionCookie, type SessionCookieJar } from '../../http/session-cookie.js';
import { AnySignedIn } from '../access/access.decorators.js';
import {
  AllowedBeforePasswordChange,
  AllowedBeforeSecondStep,
  AllowedBeforeSecondStepSetUp,
  CurrentSession,
  Public,
} from './session.guard.js';
import { Sessions, type ActiveSession } from './sessions.service.js';

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
    cookie.set(token, session.trustedUntil);
    device.set(deviceToken);
    return this.sessions.answerOf(session);
  }

  @Get('session')
  @AnySignedIn()
  @AllowedBeforeSecondStep()
  @AllowedBeforePasswordChange()
  @AllowedBeforeSecondStepSetUp()
  @Returns(sessionResponseSchema)
  read(@CurrentSession() session: ActiveSession): Promise<SessionResponse> {
    return this.sessions.answerOf(session);
  }

  /** Edge cases, "Accounts and sign-in": the profile lists the sessions. Own sessions only. */
  @Get('sessions')
  @AnySignedIn()
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
  @AnySignedIn()
  @AllowedBeforePasswordChange()
  @AllowedBeforeSecondStepSetUp()
  @ReturnsNothing()
  async changePassword(
    @CurrentSession() session: ActiveSession,
    @ValidBody(changePasswordSchema) body: ChangePassword,
    @SessionCookie() cookie: SessionCookieJar,
    @DeviceCookie() device: DeviceCookieJar,
    @RequestId() requestId: string,
  ): Promise<void> {
    const changed = await this.sessions.changePassword(
      session,
      body.currentPassword,
      body.newPassword,
      { deviceToken: device.token, requestId },
    );
    if (changed.trustEnded) {
      // The device is trusted no more: its cookie ends with the browser again.
      cookie.keep(null);
    }
  }

  @Post('sign-out')
  @AnySignedIn()
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

  /**
   * "Sign out everywhere": every other session of the account; this one stays
   * signed in and loses its trust (decided by the owner, task 0.8d).
   */
  @Post('sign-out-everywhere')
  @AnySignedIn()
  @ReturnsNothing()
  async signOutEverywhere(
    @CurrentSession() session: ActiveSession,
    @SessionCookie() cookie: SessionCookieJar,
    @RequestId() requestId: string,
  ): Promise<void> {
    const ended = await this.sessions.signOutEverywhere(session, requestId);
    if (ended.trustEnded) {
      // The device is trusted no more: its cookie ends with the browser again.
      cookie.keep(null);
    }
  }

  /**
   * docs/spec/12-ux-standards.md, Language: the choice is remembered, on the
   * account (task 0.8d). For a complete session only: before that the chooser
   * changes the browser alone (decided by the owner).
   */
  @Put('language')
  @AnySignedIn()
  @ReturnsNothing()
  async setLanguage(
    @CurrentSession() session: ActiveSession,
    @ValidBody(setLanguageSchema) body: SetLanguage,
    @RequestId() requestId: string,
  ): Promise<void> {
    await this.sessions.setLanguage(session, body.language, requestId);
  }
}
