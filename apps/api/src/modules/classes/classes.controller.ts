import { Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import {
  classCreateSchema,
  classDetailSchema,
  classEditSchema,
  classExportSchema,
  classListSchema,
  classMemberParamsSchema,
  classMembersSchema,
  classParamsSchema,
  classPlacementSchema,
  classTutorEndSchema,
  classTutorGiveSchema,
  classTutorParamsSchema,
  tutorCandidateListSchema,
  type ClassCreate,
  type ClassDetail,
  type ClassEdit,
  type ClassExport,
  type ClassList,
  type ClassMemberParams,
  type ClassMembers as ClassMembersAnswer,
  type ClassParams,
  type ClassPlacement,
  type ClassTutorEnd,
  type ClassTutorGive,
  type ClassTutorParams,
  type TutorCandidateList,
} from '@sodiq/shared';
import { RequestId } from '../../http/request-id.js';
import { Returns, ReturnsFile, ValidBody, ValidParams } from '../../http/schemas.js';
import type { XlsxFile } from '../../http/xlsx.js';
import { Requires } from '../access/access.decorators.js';
import { CurrentAccess, type Access } from '../access/permission.guard.js';
import { ClassMembers } from './class-members.service.js';
import { ClassTutors } from './class-tutors.service.js';
import { Classes } from './classes.service.js';

/**
 * Classes and their Tutors (docs/spec/05-classes-groups-subjects.md, Class;
 * docs/spec/edge-cases/students-classes-groups.md; task 3.1a, pull request
 * #88). The area `classes` (decision 5): the Super Admin and the Academic Vice
 * Principal change classes and name their Tutors; the readers of `02` view.
 * Every route works for the branch of the request.
 */
@Controller('classes')
export class ClassesController {
  constructor(
    private readonly classes: Classes,
    private readonly tutors: ClassTutors,
    private readonly members: ClassMembers,
  ) {}

  @Get()
  @Requires('classes', 'view')
  @Returns(classListSchema)
  list(@CurrentAccess() access: Access): Promise<ClassList> {
    return this.classes.list(access);
  }

  /**
   * The Tutor assignments of the branch a class can be given (decision 8).
   * Declared before `:id`, which would take it otherwise (correction 7).
   */
  @Get('tutor-candidates')
  @Requires('classes', 'edit')
  @Returns(tutorCandidateListSchema)
  candidates(@CurrentAccess() access: Access): Promise<TutorCandidateList> {
    return this.tutors.candidates(access);
  }

  /** The Excel file of the list. */
  @Post('export')
  @Requires('classes', 'export')
  @ReturnsFile()
  export(
    @CurrentAccess() access: Access,
    @ValidBody(classExportSchema) request: ClassExport,
    @RequestId() requestId: string,
  ): Promise<XlsxFile> {
    return this.classes.export(access, request, requestId);
  }

  @Post()
  @Requires('classes', 'create')
  @Returns(classDetailSchema, 201)
  create(
    @CurrentAccess() access: Access,
    @ValidBody(classCreateSchema) input: ClassCreate,
    @RequestId() requestId: string,
  ): Promise<ClassDetail> {
    return this.classes.create(access, input, requestId);
  }

  @Get(':id')
  @Requires('classes', 'view')
  @Returns(classDetailSchema)
  detail(
    @CurrentAccess() access: Access,
    @ValidParams(classParamsSchema) params: ClassParams,
  ): Promise<ClassDetail> {
    return this.classes.detail(access, params.id);
  }

  @Put(':id')
  @Requires('classes', 'edit')
  @Returns(classDetailSchema)
  edit(
    @CurrentAccess() access: Access,
    @ValidParams(classParamsSchema) params: ClassParams,
    @ValidBody(classEditSchema) input: ClassEdit,
    @RequestId() requestId: string,
  ): Promise<ClassDetail> {
    return this.classes.edit(access, params.id, input, requestId);
  }

  @Post(':id/archive')
  @HttpCode(200)
  @Requires('classes', 'archive')
  @Returns(classDetailSchema)
  archive(
    @CurrentAccess() access: Access,
    @ValidParams(classParamsSchema) params: ClassParams,
    @RequestId() requestId: string,
  ): Promise<ClassDetail> {
    return this.classes.archive(access, params.id, requestId);
  }

  @Post(':id/restore')
  @HttpCode(200)
  @Requires('classes', 'archive')
  @Returns(classDetailSchema)
  restore(
    @CurrentAccess() access: Access,
    @ValidParams(classParamsSchema) params: ClassParams,
    @RequestId() requestId: string,
  ): Promise<ClassDetail> {
    return this.classes.restore(access, params.id, requestId);
  }

  /** A Tutor or an acting Tutor from a date (decisions 9 and 15). */
  @Post(':id/tutors')
  @Requires('classes', 'edit')
  @Returns(classDetailSchema, 201)
  give(
    @CurrentAccess() access: Access,
    @ValidParams(classParamsSchema) params: ClassParams,
    @ValidBody(classTutorGiveSchema) give: ClassTutorGive,
    @RequestId() requestId: string,
  ): Promise<ClassDetail> {
    return this.tutors.give(access, params.id, give, requestId);
  }

  @Post(':id/tutors/:tutorId/end')
  @HttpCode(200)
  @Requires('classes', 'edit')
  @Returns(classDetailSchema)
  end(
    @CurrentAccess() access: Access,
    @ValidParams(classTutorParamsSchema) params: ClassTutorParams,
    @ValidBody(classTutorEndSchema) end: ClassTutorEnd,
    @RequestId() requestId: string,
  ): Promise<ClassDetail> {
    return this.tutors.end(access, params.id, params.tutorId, end, requestId);
  }

  /** The Students tab (task 3.1b): members in force today and planned, and the free seats. */
  @Get(':id/members')
  @Requires('classes', 'view')
  @Returns(classMembersSchema)
  membersOf(
    @CurrentAccess() access: Access,
    @ValidParams(classParamsSchema) params: ClassParams,
  ): Promise<ClassMembersAnswer> {
    return this.members.members(access, params.id);
  }

  /** "Put into a class" from a date, all or none (task 3.1b, decisions 5 and 6). */
  @Post(':id/members')
  @Requires('classes', 'edit')
  @Returns(classMembersSchema, 201)
  place(
    @CurrentAccess() access: Access,
    @ValidParams(classParamsSchema) params: ClassParams,
    @ValidBody(classPlacementSchema) placement: ClassPlacement,
    @RequestId() requestId: string,
  ): Promise<ClassMembersAnswer> {
    return this.members.place(access, params.id, placement, requestId);
  }

  /** The withdraw of a planned placement (task 3.1b, decision 10). */
  @Post(':id/members/:memberId/withdraw')
  @HttpCode(200)
  @Requires('classes', 'edit')
  @Returns(classMembersSchema)
  withdraw(
    @CurrentAccess() access: Access,
    @ValidParams(classMemberParamsSchema) params: ClassMemberParams,
    @RequestId() requestId: string,
  ): Promise<ClassMembersAnswer> {
    return this.members.withdraw(access, params.id, params.memberId, requestId);
  }
}
