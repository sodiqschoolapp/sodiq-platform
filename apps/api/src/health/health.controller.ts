import { Controller, Get } from '@nestjs/common';
import type { HealthResponse } from '@sodiq/shared';

/**
 * Public route for uptime checks and the deploy smoke test. It needs no sign-in and
 * tells nothing about the system. Task 0.7 declares it public in the permission table.
 */
@Controller('health')
export class HealthController {
  @Get()
  check(): HealthResponse {
    return { status: 'ok' };
  }
}
