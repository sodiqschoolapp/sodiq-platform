import { Controller, Delete, Get, HttpCode, Post, Put } from '@nestjs/common';
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
import { ApiException } from '../../http/api-exception.js';
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
import { TelegramLinks } from './telegram-links.js';

/**
 * docs/spec/02-roles-and-access.md, Rules: staff sign in with login and
 * password and must change the password at first sign-in.
 */
@Controller('auth')
export class AuthController {
  constructor(
    private readonly sessions: Sessions,
    private readonly telegramLinks: TelegramLinks,
  ) {}

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
    if (!('login' in body)) {
      // Task 11.4: the mini app opened from a linked chat, with the launch data alone.
      const launch = this.telegramLinks.launchOf(body.telegramInitData);
      if (launch === undefined) {
        throw new ApiException('telegram_sign_in_needed', 401);
      }
      const opened = await this.sessions.signInByTelegram(launch, {
        deviceToken: device.token,
        userAgent,
        requestId,
      });
      cookie.set(opened.token, null);
      device.set(opened.deviceToken);
      return this.sessions.answerOf(opened.session);
    }
    // Task 11.4: launch data beside a password that does not check out links nothing; the
    // sign-in itself goes on as in a browser.
    const telegram =
      body.telegramInitData === undefined
        ? undefined
        : this.telegramLinks.launchOf(body.telegramInitData);
    const { token, deviceToken, session } = await this.sessions.signIn(body.login, body.password, {
      deviceToken: device.token,
      userAgent,
      trustDevice: body.trustDevice ?? false,
      requestId,
      ...(telegram === undefined ? {} : { telegram }),
    });
    cookie.set(token, session.trustedUntil);
    device.set(deviceToken);
    return this.sessions.answerOf(session);
  }

  @Get('session')
  @AnySignedIn({ parent: true })
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
  @AnySignedIn({ parent: true })
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
      {
        deviceToken: device.token,
        requestId,
        ...this.launchPart(body.telegramInitData),
      },
    );
    if (changed.trustEnded) {
      // The device is trusted no more: its cookie ends with the browser again.
      cookie.keep(null);
    }
  }

  @Post('sign-out')
  @AnySignedIn({ parent: true })
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
  @AnySignedIn({ parent: true })
  @ReturnsNothing()
  async setLanguage(
    @CurrentSession() session: ActiveSession,
    @ValidBody(setLanguageSchema) body: SetLanguage,
    @RequestId() requestId: string,
  ): Promise<void> {
    await this.sessions.setLanguage(session, body.language, requestId);
  }

  /**
   * Task 11.4: the parent ends their own Telegram link ("the `parent` role links and unlinks
   * its own chat"); the sessions opened through it end. A staff account never has a link.
   */
  @Delete('telegram-link')
  @AnySignedIn({ parent: true })
  @ReturnsNothing()
  async unlinkTelegram(
    @CurrentSession() session: ActiveSession,
    @RequestId() requestId: string,
  ): Promise<void> {
    const ended = await this.sessions.unlinkOwnTelegram(session, requestId);
    if (!ended) {
      throw new ApiException('no_telegram_link', 409);
    }
  }

  private launchPart(
    initData: string | undefined,
  ): { telegram: NonNullable<ReturnType<TelegramLinks['launchOf']>> } | Record<string, never> {
    const launch = initData === undefined ? undefined : this.telegramLinks.launchOf(initData);
    return launch === undefined ? {} : { telegram: launch };
  }
}
