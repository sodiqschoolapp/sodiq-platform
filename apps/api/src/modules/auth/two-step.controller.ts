import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import {
  secondStepCodeSchema,
  secondStepOverviewSchema,
  secondStepRecoveryCodesSchema,
  secondStepSetUpSchema,
  sessionResponseSchema,
  type SecondStepCode,
  type SecondStepOverview,
  type SecondStepRecoveryCodes,
  type SecondStepSetUp,
  type SessionResponse,
} from '@sodiq/shared';
import { RequestId } from '../../http/request-id.js';
import { Returns, ReturnsNothing, ValidBody } from '../../http/schemas.js';
import { SessionCookie, type SessionCookieJar } from '../../http/session-cookie.js';
import { AnySignedIn } from '../access/access.decorators.js';
import { answerOf } from './auth.controller.js';
import {
  AllowedBeforeSecondStep,
  AllowedBeforeSecondStepSetUp,
  CurrentSession,
} from './session.guard.js';
import type { ActiveSession } from './sessions.service.js';
import { TwoStep } from './two-step.service.js';

/**
 * Edge cases, "Accounts and sign-in": the second step is a code from an
 * authenticator app, with ten single-use recovery codes shown at set-up. Every
 * route here acts on the account of the session, never on one named in the
 * request.
 */
@Controller('auth/second-step')
export class TwoStepController {
  constructor(private readonly twoStep: TwoStep) {}

  /** The second step of a sign-in: a code from the app, or a recovery code. */
  @Post()
  @AnySignedIn()
  @AllowedBeforeSecondStep()
  @HttpCode(200)
  @Returns(sessionResponseSchema)
  async pass(
    @CurrentSession() session: ActiveSession,
    @ValidBody(secondStepCodeSchema) body: SecondStepCode,
    @SessionCookie() cookie: SessionCookieJar,
    @RequestId() requestId: string,
  ): Promise<SessionResponse> {
    const trustedUntil = await this.twoStep.pass(session, body.code, requestId);
    if (trustedUntil !== null) {
      // The trust of the device begins with the code: the browser keeps the cookie for its 7 days.
      cookie.keep(trustedUntil);
    }
    return answerOf({ ...session, secondStep: 'passed', trustedUntil });
  }

  @Get()
  @AnySignedIn()
  @AllowedBeforeSecondStepSetUp()
  @Returns(secondStepOverviewSchema)
  overview(@CurrentSession() session: ActiveSession): Promise<SecondStepOverview> {
    return this.twoStep.overview(session);
  }

  /** Starts a set-up: the secret for the authenticator app, shown once. */
  @Post('set-up')
  @AnySignedIn()
  @AllowedBeforeSecondStepSetUp()
  @HttpCode(200)
  @Returns(secondStepSetUpSchema)
  setUp(
    @CurrentSession() session: ActiveSession,
    @RequestId() requestId: string,
  ): Promise<SecondStepSetUp> {
    return this.twoStep.begin(session, requestId);
  }

  /** The first right code puts the second step in force and answers the recovery codes, once. */
  @Post('confirm')
  @AnySignedIn()
  @AllowedBeforeSecondStepSetUp()
  @HttpCode(200)
  @Returns(secondStepRecoveryCodesSchema)
  async confirm(
    @CurrentSession() session: ActiveSession,
    @ValidBody(secondStepCodeSchema) body: SecondStepCode,
    @SessionCookie() cookie: SessionCookieJar,
    @RequestId() requestId: string,
  ): Promise<SecondStepRecoveryCodes> {
    const confirmed = await this.twoStep.confirm(session, body.code, requestId);
    if (confirmed.trustedUntil !== null) {
      cookie.keep(confirmed.trustedUntil);
    }
    return { recoveryCodes: confirmed.recoveryCodes };
  }

  /** Only where the second step is optional, and with a right code. */
  @Post('turn-off')
  @AnySignedIn()
  @ReturnsNothing()
  async turnOff(
    @CurrentSession() session: ActiveSession,
    @ValidBody(secondStepCodeSchema) body: SecondStepCode,
    @RequestId() requestId: string,
  ): Promise<void> {
    await this.twoStep.turnOff(session, body.code, requestId);
  }
}
