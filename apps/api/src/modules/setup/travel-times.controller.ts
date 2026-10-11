import { Controller, Get, Put } from '@nestjs/common';
import {
  travelTimeListSchema,
  travelTimeRecordSchema,
  type TravelTimeList,
  type TravelTimeRecord,
} from '@sodiq/shared';
import { RequestId } from '../../http/request-id.js';
import { Returns, ValidBody } from '../../http/schemas.js';
import { Requires } from '../access/access.decorators.js';
import { CurrentAccess, type Access } from '../access/permission.guard.js';
import { branchOf } from './branches.controller.js';
import { TravelTimes } from './travel-times.service.js';

/**
 * Travel time between the branch of the request and every other branch
 * (`06`, Teachers who work in several branches; task 1.6), under the area
 * `branches` (the owner's answer 24): edited by the Super Admin alone.
 */
@Controller('setup')
export class TravelTimesController {
  constructor(private readonly travelTimes: TravelTimes) {}

  @Get('travel-times')
  @Requires('branches', 'view')
  @Returns(travelTimeListSchema)
  list(@CurrentAccess() access: Access): Promise<TravelTimeList> {
    return this.travelTimes.list(access, branchOf(access));
  }

  @Put('travel-times')
  @Requires('branches', 'edit')
  @Returns(travelTimeListSchema)
  set(
    @CurrentAccess() access: Access,
    @ValidBody(travelTimeRecordSchema) record: TravelTimeRecord,
    @RequestId() requestId: string,
  ): Promise<TravelTimeList> {
    return this.travelTimes.set(access, branchOf(access), record, requestId);
  }
}
