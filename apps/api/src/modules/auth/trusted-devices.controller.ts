import { Controller, Delete, Get } from '@nestjs/common';
import {
  trustedDeviceListSchema,
  trustedDeviceParamsSchema,
  type TrustedDeviceList,
  type TrustedDeviceParams,
} from '@sodiq/shared';
import { RequestId } from '../../http/request-id.js';
import { Returns, ReturnsNothing, ValidParams } from '../../http/schemas.js';
import { SessionCookie, type SessionCookieJar } from '../../http/session-cookie.js';
import { CurrentSession } from './session.guard.js';
import { Sessions, type ActiveSession } from './sessions.service.js';

/**
 * Edge cases, "Accounts and sign-in": the profile lists trusted devices and
 * each can be removed; removing one ends its session at once. Every route here
 * acts on the account of the session: the id in the path is looked for among
 * its own trusted devices only.
 */
@Controller('auth/trusted-devices')
export class TrustedDevicesController {
  constructor(private readonly sessions: Sessions) {}

  @Get()
  @Returns(trustedDeviceListSchema)
  async list(@CurrentSession() session: ActiveSession): Promise<TrustedDeviceList> {
    const devices = await this.sessions.trustedDevices(session);
    return {
      devices: devices.map((device) => ({
        id: device.id,
        startedAt: device.startedAt.toISOString(),
        lastUsedAt: device.lastUsedAt.toISOString(),
        userAgent: device.userAgent,
        trustedUntil: device.trustedUntil.toISOString(),
        current: device.current,
      })),
    };
  }

  /** Removing the device that asks works like sign-out: its cookie is cleared. */
  @Delete(':id')
  @ReturnsNothing()
  async remove(
    @CurrentSession() session: ActiveSession,
    @ValidParams(trustedDeviceParamsSchema) params: TrustedDeviceParams,
    @SessionCookie() cookie: SessionCookieJar,
    @RequestId() requestId: string,
  ): Promise<void> {
    const removed = await this.sessions.removeTrustedDevice(session, params.id, requestId);
    if (removed.current) {
      cookie.clear();
    }
  }
}
