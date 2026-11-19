import { Controller, Get } from '@nestjs/common';
import {
  statusProvidersQuerySchema,
  statusProvidersSchema,
  systemStatusSchema,
  type StatusProviders,
  type StatusProvidersQuery,
  type SystemStatus,
} from '@sodiq/shared';
import { Returns, ValidQuery } from '../http/schemas.js';
import { Requires } from '../modules/access/access.decorators.js';
import { CurrentAccess, type Access } from '../modules/access/permission.guard.js';
import { SystemStatusReader } from './system-status.service.js';

/**
 * The System status page of the Super Admin (pull request #361; owner, 19 November 2026):
 * school-wide, under the area `monitoring`, which the Super Admin alone holds.
 */
@Controller('system-status')
export class SystemStatusController {
  constructor(private readonly status: SystemStatusReader) {}

  /** The app's own checks, read from the database at once. */
  @Get()
  @Requires('monitoring', 'view', { branch: 'none' })
  @Returns(systemStatusSchema)
  own(@CurrentAccess() access: Access): Promise<SystemStatus> {
    return this.status.own(access);
  }

  /**
   * UptimeRobot, Grafana and Sentry, read on the server with read-only keys, up to 5 s each, with
   * their history of the period (pull request #363): 24 hours unless the query names 7 or 14 days.
   */
  @Get('providers')
  @Requires('monitoring', 'view', { branch: 'none' })
  @Returns(statusProvidersSchema)
  providers(
    @ValidQuery(statusProvidersQuerySchema) query: StatusProvidersQuery,
  ): Promise<StatusProviders> {
    return this.status.providers(query.period ?? '24h');
  }
}
