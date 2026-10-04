import { Controller, Get } from '@nestjs/common';
import { healthResponseSchema, type HealthResponse } from '@sodiq/shared';
import { Returns } from '../http/schemas.js';
import { Public } from '../modules/auth/session.guard.js';

/**
 * Public route for uptime checks and the deploy smoke test. It needs no sign-in and
 * tells nothing about the system, so it is one of the routes declared public
 * (docs/spec/02-roles-and-access.md, "Accounts and sign-in: build order").
 */
@Controller('health')
export class HealthController {
  @Get()
  @Public()
  @Returns(healthResponseSchema)
  check(): HealthResponse {
    return { status: 'ok' };
  }
}
