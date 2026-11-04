import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import {
  demoClockJumpSchema,
  demoClockSchema,
  type DemoClockJump,
  type DemoClockState,
} from '@sodiq/shared';
import { RequestId } from '../../http/request-id.js';
import { Returns, ValidBody } from '../../http/schemas.js';
import { Requires } from '../access/access.decorators.js';
import { CurrentAccess, type Access } from '../access/permission.guard.js';
import { DemoClockService } from './demo-clock.service.js';

/**
 * The demo time of the test environment (task 10.5, pull request #280): read and moved forward
 * by the Super Admin alone (the area `demo_clock`, approved by the owner on 4 November 2026), as
 * school-wide work. Where `DEMO_CLOCK` is off the read says so and a jump is refused.
 */
@Controller('setup')
export class DemoClockController {
  constructor(private readonly demoClock: DemoClockService) {}

  @Get('demo-clock')
  @Requires('demo_clock', 'view', { branch: 'none' })
  @Returns(demoClockSchema)
  read(): Promise<DemoClockState> {
    return this.demoClock.read();
  }

  @Post('demo-clock/jumps')
  @HttpCode(200)
  @Requires('demo_clock', 'edit', { branch: 'none' })
  @Returns(demoClockSchema)
  jump(
    @CurrentAccess() access: Access,
    @ValidBody(demoClockJumpSchema) jump: DemoClockJump,
    @RequestId() requestId: string,
  ): Promise<DemoClockState> {
    return this.demoClock.jump(access, jump, requestId);
  }
}
