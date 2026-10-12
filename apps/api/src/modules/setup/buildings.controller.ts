import { Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import {
  buildingExportSchema,
  buildingListSchema,
  buildingRecordSchema,
  buildingSchema,
  floorRecordSchema,
  floorSchema,
  setupIdParamsSchema,
  type Building,
  type BuildingExport,
  type BuildingList,
  type BuildingRecord,
  type Floor,
  type FloorRecord,
  type SetupIdParams,
} from '@sodiq/shared';
import { RequestId } from '../../http/request-id.js';
import { Returns, ReturnsFile, ValidBody, ValidParams } from '../../http/schemas.js';
import type { XlsxFile } from '../../http/xlsx.js';
import { Requires } from '../access/access.decorators.js';
import { CurrentAccess, type Access } from '../access/permission.guard.js';
import { Buildings } from './buildings.service.js';

/**
 * Buildings and floors of the branch of the request (docs/spec/03-school-setup.md,
 * Building, floor, room; task 1.1). The area `rooms` of the permission table
 * covers the three: one row of the table of `03`.
 */
@Controller('setup')
export class BuildingsController {
  constructor(private readonly buildings: Buildings) {}

  @Get('buildings')
  @Requires('rooms', 'view')
  @Returns(buildingListSchema)
  list(@CurrentAccess() access: Access): Promise<BuildingList> {
    return this.buildings.list(access);
  }

  /** The Excel file of the list (task 2.2c-1). */
  @Post('buildings/export')
  @Requires('rooms', 'export')
  @ReturnsFile()
  export(
    @CurrentAccess() access: Access,
    @ValidBody(buildingExportSchema) request: BuildingExport,
    @RequestId() requestId: string,
  ): Promise<XlsxFile> {
    return this.buildings.export(access, request, requestId);
  }

  @Post('buildings')
  @Requires('rooms', 'create')
  @Returns(buildingSchema, 201)
  create(
    @CurrentAccess() access: Access,
    @ValidBody(buildingRecordSchema) record: BuildingRecord,
    @RequestId() requestId: string,
  ): Promise<Building> {
    return this.buildings.createBuilding(access, record, requestId);
  }

  @Put('buildings/:id')
  @Requires('rooms', 'edit')
  @Returns(buildingSchema)
  rename(
    @CurrentAccess() access: Access,
    @ValidParams(setupIdParamsSchema) params: SetupIdParams,
    @ValidBody(buildingRecordSchema) record: BuildingRecord,
    @RequestId() requestId: string,
  ): Promise<Building> {
    return this.buildings.renameBuilding(access, params.id, record, requestId);
  }

  @Post('buildings/:id/archive')
  @HttpCode(200)
  @Requires('rooms', 'archive')
  @Returns(buildingSchema)
  archive(
    @CurrentAccess() access: Access,
    @ValidParams(setupIdParamsSchema) params: SetupIdParams,
    @RequestId() requestId: string,
  ): Promise<Building> {
    return this.buildings.archiveBuilding(access, params.id, requestId);
  }

  @Post('buildings/:id/restore')
  @HttpCode(200)
  @Requires('rooms', 'archive')
  @Returns(buildingSchema)
  restore(
    @CurrentAccess() access: Access,
    @ValidParams(setupIdParamsSchema) params: SetupIdParams,
    @RequestId() requestId: string,
  ): Promise<Building> {
    return this.buildings.restoreBuilding(access, params.id, requestId);
  }

  @Post('buildings/:id/floors')
  @Requires('rooms', 'create')
  @Returns(floorSchema, 201)
  createFloor(
    @CurrentAccess() access: Access,
    @ValidParams(setupIdParamsSchema) params: SetupIdParams,
    @ValidBody(floorRecordSchema) record: FloorRecord,
    @RequestId() requestId: string,
  ): Promise<Floor> {
    return this.buildings.createFloor(access, params.id, record, requestId);
  }

  @Put('floors/:id')
  @Requires('rooms', 'edit')
  @Returns(floorSchema)
  renameFloor(
    @CurrentAccess() access: Access,
    @ValidParams(setupIdParamsSchema) params: SetupIdParams,
    @ValidBody(floorRecordSchema) record: FloorRecord,
    @RequestId() requestId: string,
  ): Promise<Floor> {
    return this.buildings.renameFloor(access, params.id, record, requestId);
  }

  @Post('floors/:id/archive')
  @HttpCode(200)
  @Requires('rooms', 'archive')
  @Returns(floorSchema)
  archiveFloor(
    @CurrentAccess() access: Access,
    @ValidParams(setupIdParamsSchema) params: SetupIdParams,
    @RequestId() requestId: string,
  ): Promise<Floor> {
    return this.buildings.archiveFloor(access, params.id, requestId);
  }

  @Post('floors/:id/restore')
  @HttpCode(200)
  @Requires('rooms', 'archive')
  @Returns(floorSchema)
  restoreFloor(
    @CurrentAccess() access: Access,
    @ValidParams(setupIdParamsSchema) params: SetupIdParams,
    @RequestId() requestId: string,
  ): Promise<Floor> {
    return this.buildings.restoreFloor(access, params.id, requestId);
  }
}
