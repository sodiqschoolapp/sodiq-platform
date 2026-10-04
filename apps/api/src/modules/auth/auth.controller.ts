import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import {
  changePasswordSchema,
  sessionResponseSchema,
  signInSchema,
  type ChangePassword,
  type SessionResponse,
  type SignIn,
} from '@sodiq/shared';
import { RequestId } from '../../http/request-id.js';
import { Returns, ReturnsNothing, ValidBody } from '../../http/schemas.js';
import { SessionCookie, type SessionCookieJar } from '../../http/session-cookie.js';
import { AllowedBeforePasswordChange, CurrentSession, Public } from './session.guard.js';
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
    @RequestId() requestId: string,
  ): Promise<SessionResponse> {
    const { token, session } = await this.sessions.signIn(body.login, body.password, requestId);
    cookie.set(token);
    return { login: session.login, mustChangePassword: session.mustChangePassword };
  }

  @Get('session')
  @AllowedBeforePasswordChange()
  @Returns(sessionResponseSchema)
  read(@CurrentSession() session: ActiveSession): SessionResponse {
    return { login: session.login, mustChangePassword: session.mustChangePassword };
  }

  @Post('password')
  @AllowedBeforePasswordChange()
  @ReturnsNothing()
  async changePassword(
    @CurrentSession() session: ActiveSession,
    @ValidBody(changePasswordSchema) body: ChangePassword,
    @RequestId() requestId: string,
  ): Promise<void> {
    await this.sessions.changePassword(session, body.currentPassword, body.newPassword, requestId);
  }

  @Post('sign-out')
  @AllowedBeforePasswordChange()
  @ReturnsNothing()
  async signOut(
    @CurrentSession() session: ActiveSession,
    @SessionCookie() cookie: SessionCookieJar,
    @RequestId() requestId: string,
  ): Promise<void> {
    await this.sessions.signOut(session, requestId);
    cookie.clear();
  }
}
