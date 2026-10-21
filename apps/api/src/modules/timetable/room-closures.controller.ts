import { Controller, Get, HttpCode, Patch, Post } from '@nestjs/common';
import {
  roomClosureEditSchema,
  roomClosureLessonsSchema,
  roomClosureListSchema,
  roomClosureMoveAnswerSchema,
  roomClosureMoveSchema,
  roomClosureParamsSchema,
  roomClosureRecordSchema,
  roomClosureSchema,
  roomClosuresQuerySchema,
  type RoomClosure,
  type RoomClosureEdit,
  type RoomClosureLessons,
  type RoomClosureList,
  type RoomClosureMove,
  type RoomClosureMoveAnswer,
  type RoomClosureParams,
  type RoomClosureRecord,
  type RoomClosuresQuery,
} from '@sodiq/shared';
import { RequestId } from '../../http/request-id.js';
import { Returns, ValidBody, ValidParams, ValidQuery } from '../../http/schemas.js';
import { Requires } from '../access/access.decorators.js';
import { CurrentAccess, type Access } from '../access/permission.guard.js';
import { TimetableRoomClosures } from './room-closures.service.js';

/**
 * Room closures (task 5.7a-2b, pull request #187, decision 11): the area
 * `timetable`, no role widened. The Super Admin and the Academic Vice
 * Principal enter (`create`), change, withdraw and "move all" (`edit`); the
 * roles that view the timetable read them (`view`). Every route works for
 * the branch of the request.
 */
@Controller('timetable')
export class RoomClosuresController {
  constructor(private readonly closures: TimetableRoomClosures) {}

  @Get('room-closures')
  @Requires('timetable', 'view')
  @Returns(roomClosureListSchema)
  list(
    @CurrentAccess() access: Access,
    @ValidQuery(roomClosuresQuerySchema) query: RoomClosuresQuery,
  ): Promise<RoomClosureList> {
    return this.closures.list(access, query);
  }

  @Post('room-closures')
  @HttpCode(201)
  @Requires('timetable', 'create')
  @Returns(roomClosureSchema)
  create(
    @CurrentAccess() access: Access,
    @ValidBody(roomClosureRecordSchema) input: RoomClosureRecord,
    @RequestId() requestId: string,
  ): Promise<RoomClosure> {
    return this.closures.create(access, input, requestId);
  }

  @Patch('room-closures/:id')
  @Requires('timetable', 'edit')
  @Returns(roomClosureSchema)
  edit(
    @CurrentAccess() access: Access,
    @ValidParams(roomClosureParamsSchema) params: RoomClosureParams,
    @ValidBody(roomClosureEditSchema) input: RoomClosureEdit,
    @RequestId() requestId: string,
  ): Promise<RoomClosure> {
    return this.closures.edit(access, params.id, input, requestId);
  }

  @Post('room-closures/:id/withdraw')
  @HttpCode(200)
  @Requires('timetable', 'edit')
  @Returns(roomClosureSchema)
  withdraw(
    @CurrentAccess() access: Access,
    @ValidParams(roomClosureParamsSchema) params: RoomClosureParams,
    @RequestId() requestId: string,
  ): Promise<RoomClosure> {
    return this.closures.withdraw(access, params.id, requestId);
  }

  @Get('room-closures/:id/lessons')
  @Requires('timetable', 'view')
  @Returns(roomClosureLessonsSchema)
  lessons(
    @CurrentAccess() access: Access,
    @ValidParams(roomClosureParamsSchema) params: RoomClosureParams,
  ): Promise<RoomClosureLessons> {
    return this.closures.lessons(access, params.id);
  }

  /** "Move all to room R for the period" (`edge/timetable`, After publishing; decision 6). */
  @Post('room-closures/:id/move')
  @HttpCode(200)
  @Requires('timetable', 'edit')
  @Returns(roomClosureMoveAnswerSchema)
  move(
    @CurrentAccess() access: Access,
    @ValidParams(roomClosureParamsSchema) params: RoomClosureParams,
    @ValidBody(roomClosureMoveSchema) input: RoomClosureMove,
    @RequestId() requestId: string,
  ): Promise<RoomClosureMoveAnswer> {
    return this.closures.move(access, params.id, input, requestId);
  }
}
