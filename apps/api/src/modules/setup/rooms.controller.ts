import { Controller, Get, Post, Put } from '@nestjs/common';
import {
  roomExportSchema,
  roomListSchema,
  roomRecordSchema,
  roomSchema,
  setupIdParamsSchema,
  type Room,
  type RoomExport,
  type RoomList,
  type RoomRecord,
  type SetupIdParams,
} from '@sodiq/shared';
import { RequestId } from '../../http/request-id.js';
import { Returns, ReturnsFile, ValidBody, ValidParams } from '../../http/schemas.js';
import type { XlsxFile } from '../../http/xlsx.js';
import { Requires } from '../access/access.decorators.js';
import { CurrentAccess, type Access } from '../access/permission.guard.js';
import { Rooms } from './rooms.service.js';

/** The rooms of the branch of the request (docs/spec/03-school-setup.md, Building, floor, room; task 1.1). */
@Controller('setup')
export class RoomsController {
  constructor(private readonly rooms: Rooms) {}

  @Get('rooms')
  @Requires('rooms', 'view')
  @Returns(roomListSchema)
  list(@CurrentAccess() access: Access): Promise<RoomList> {
    return this.rooms.list(access);
  }

  /** The Excel file of the list (task 2.2c-1). */
  @Post('rooms/export')
  @Requires('rooms', 'export')
  @ReturnsFile()
  export(
    @CurrentAccess() access: Access,
    @ValidBody(roomExportSchema) request: RoomExport,
    @RequestId() requestId: string,
  ): Promise<XlsxFile> {
    return this.rooms.export(access, request, requestId);
  }

  @Post('rooms')
  @Requires('rooms', 'create')
  @Returns(roomSchema, 201)
  create(
    @CurrentAccess() access: Access,
    @ValidBody(roomRecordSchema) record: RoomRecord,
    @RequestId() requestId: string,
  ): Promise<Room> {
    return this.rooms.create(access, record, requestId);
  }

  @Put('rooms/:id')
  @Requires('rooms', 'edit')
  @Returns(roomSchema)
  edit(
    @CurrentAccess() access: Access,
    @ValidParams(setupIdParamsSchema) params: SetupIdParams,
    @ValidBody(roomRecordSchema) record: RoomRecord,
    @RequestId() requestId: string,
  ): Promise<Room> {
    return this.rooms.edit(access, params.id, record, requestId);
  }
}
