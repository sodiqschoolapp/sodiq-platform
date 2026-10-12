import { Controller, Get } from '@nestjs/common';
import { appointmentListSchema, type AppointmentList } from '@sodiq/shared';
import { Returns } from '../../http/schemas.js';
import { Requires } from '../access/access.decorators.js';
import { CurrentAccess, type Access } from '../access/permission.guard.js';
import { HeadTeachers } from './head-teachers.service.js';

/**
 * The Head Teacher and Senior Head Teacher appointments of the branch of the
 * request (task 2.3b-1, area `head_teachers`, decision 8 of #63), limited to
 * the reader's own subjects for a Head Teacher or Senior Head Teacher.
 */
@Controller()
export class HeadTeachersController {
  constructor(private readonly headTeachers: HeadTeachers) {}

  @Get('access/head-teachers')
  @Requires('head_teachers', 'view')
  @Returns(appointmentListSchema)
  list(@CurrentAccess() access: Access): Promise<AppointmentList> {
    return this.headTeachers.list(access);
  }
}
