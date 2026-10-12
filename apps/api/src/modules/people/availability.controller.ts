import { Controller, Get, Put } from '@nestjs/common';
import {
  availabilitySchema,
  availabilitySetSchema,
  staffParamsSchema,
  type Availability,
  type AvailabilitySet,
  type StaffParams,
} from '@sodiq/shared';
import { RequestId } from '../../http/request-id.js';
import { Returns, ValidBody, ValidParams } from '../../http/schemas.js';
import { Requires } from '../access/access.decorators.js';
import { CurrentAccess, type Access } from '../access/permission.guard.js';
import { StaffAvailability } from './availability.service.js';

/**
 * Availability of a staff record, a person or a vacancy, per branch
 * (docs/spec/04-people.md, Availability; 06, Teachers who work in several
 * branches; task 2.2b, pull request #57). The area `staff_teaching`
 * (decision 1): the Academic Vice Principal "edits a teacher's availability"
 * and the Super Admin with him; the Principal views. The hours of the branch
 * of the request are edited; the other branches' are read only.
 */
@Controller('people')
export class AvailabilityController {
  constructor(private readonly availability: StaffAvailability) {}

  @Get('staff/:id/availability')
  @Requires('staff_teaching', 'view')
  @Returns(availabilitySchema)
  read(
    @CurrentAccess() access: Access,
    @ValidParams(staffParamsSchema) params: StaffParams,
  ): Promise<Availability> {
    return this.availability.read(access, params.id);
  }

  @Put('staff/:id/availability')
  @Requires('staff_teaching', 'edit')
  @Returns(availabilitySchema)
  set(
    @CurrentAccess() access: Access,
    @ValidParams(staffParamsSchema) params: StaffParams,
    @ValidBody(availabilitySetSchema) input: AvailabilitySet,
    @RequestId() requestId: string,
  ): Promise<Availability> {
    return this.availability.set(access, params.id, input, requestId);
  }
}
