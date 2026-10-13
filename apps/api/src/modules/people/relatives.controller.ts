import { Controller, Get, HttpCode, Patch, Post } from '@nestjs/common';
import {
  relativeDetailSchema,
  relativeIdentitySchema,
  relativeLinkEditSchema,
  relativeLinkInputSchema,
  relativeListQuerySchema,
  relativeListSchema,
  relativeParamsSchema,
  relativePhoneMatchResultSchema,
  relativePhoneMatchSchema,
  relativeRecordSchema,
  relativeUnlinkSchema,
  studentParamsSchema,
  studentRelativeParamsSchema,
  studentRelativesSchema,
  type RelativeDetail,
  type RelativeIdentity,
  type RelativeLinkEdit,
  type RelativeLinkInput,
  type RelativeList,
  type RelativeListQuery,
  type RelativeParams,
  type RelativePhoneMatch,
  type RelativePhoneMatchResult,
  type RelativeRecord,
  type RelativeUnlink,
  type StudentParams,
  type StudentRelativeParams,
  type StudentRelatives,
} from '@sodiq/shared';
import { RequestId } from '../../http/request-id.js';
import { Returns, ValidBody, ValidParams, ValidQuery } from '../../http/schemas.js';
import { Requires } from '../access/access.decorators.js';
import { CurrentAccess, type Access } from '../access/permission.guard.js';
import { Relatives } from './relatives.service.js';

/**
 * Close relatives, the Parents (docs/spec/04-people.md, Close relatives;
 * edge/close-relatives; task 2.5a, pull request #72). The area `relatives`
 * (decision 4, Look first): the Super Admin and the Academic Vice Principal
 * view, create and edit, the Principal views. The links of a student are
 * written under `students` `edit` and read on the Relatives tab under
 * `student_contact` `view`. Every route works for the branch of the request.
 */
@Controller('people')
export class RelativesController {
  constructor(private readonly relatives: Relatives) {}

  /** `search` by name; `phone` for the Super Admin and the Academic Vice Principal only. */
  @Get('relatives')
  @Requires('relatives', 'view')
  @Returns(relativeListSchema)
  list(
    @CurrentAccess() access: Access,
    @ValidQuery(relativeListQuerySchema) query: RelativeListQuery,
  ): Promise<RelativeList> {
    return this.relatives.list(access, query);
  }

  /** The phone typed first: the holder of that exact phone, or none. */
  @Post('relatives/phone-match')
  @HttpCode(200)
  @Requires('relatives', 'create')
  @Returns(relativePhoneMatchResultSchema)
  phoneMatch(
    @CurrentAccess() access: Access,
    @ValidBody(relativePhoneMatchSchema) input: RelativePhoneMatch,
  ): Promise<RelativePhoneMatchResult> {
    return this.relatives.phoneMatch(access, input.phone);
  }

  @Get('relatives/:id')
  @Requires('relatives', 'view')
  @Returns(relativeDetailSchema)
  detail(
    @CurrentAccess() access: Access,
    @ValidParams(relativeParamsSchema) params: RelativeParams,
  ): Promise<RelativeDetail> {
    return this.relatives.detail(access, params.id);
  }

  @Patch('relatives/:id')
  @Requires('relatives', 'edit')
  @Returns(relativeDetailSchema)
  edit(
    @CurrentAccess() access: Access,
    @ValidParams(relativeParamsSchema) params: RelativeParams,
    @ValidBody(relativeRecordSchema) record: RelativeRecord,
    @RequestId() requestId: string,
  ): Promise<RelativeDetail> {
    return this.relatives.edit(access, params.id, record, requestId);
  }

  /** The Principal's logged show of workplace and email (decision 5). */
  @Post('relatives/:id/show')
  @HttpCode(200)
  @Requires('relatives', 'view')
  @Returns(relativeIdentitySchema)
  show(
    @CurrentAccess() access: Access,
    @ValidParams(relativeParamsSchema) params: RelativeParams,
    @RequestId() requestId: string,
  ): Promise<RelativeIdentity> {
    return this.relatives.show(access, params.id, requestId);
  }

  /** The student's Relatives tab. */
  @Get('students/:id/relatives')
  @Requires('student_contact', 'view')
  @Returns(studentRelativesSchema)
  ofStudent(
    @CurrentAccess() access: Access,
    @ValidParams(studentParamsSchema) params: StudentParams,
  ): Promise<StudentRelatives> {
    return this.relatives.ofStudent(access, params.id);
  }

  @Post('students/:id/relatives')
  @Requires('students', 'edit')
  @Returns(studentRelativesSchema, 201)
  link(
    @CurrentAccess() access: Access,
    @ValidParams(studentParamsSchema) params: StudentParams,
    @ValidBody(relativeLinkInputSchema) input: RelativeLinkInput,
    @RequestId() requestId: string,
  ): Promise<StudentRelatives> {
    return this.relatives.link(access, params.id, input, requestId);
  }

  @Patch('students/:id/relatives/:relativeId')
  @Requires('students', 'edit')
  @Returns(studentRelativesSchema)
  editLink(
    @CurrentAccess() access: Access,
    @ValidParams(studentRelativeParamsSchema) params: StudentRelativeParams,
    @ValidBody(relativeLinkEditSchema) input: RelativeLinkEdit,
    @RequestId() requestId: string,
  ): Promise<StudentRelatives> {
    return this.relatives.editLink(access, params.id, params.relativeId, input, requestId);
  }

  @Post('students/:id/relatives/:relativeId/unlink')
  @HttpCode(200)
  @Requires('students', 'edit')
  @Returns(studentRelativesSchema)
  unlink(
    @CurrentAccess() access: Access,
    @ValidParams(studentRelativeParamsSchema) params: StudentRelativeParams,
    @ValidBody(relativeUnlinkSchema) input: RelativeUnlink,
    @RequestId() requestId: string,
  ): Promise<StudentRelatives> {
    return this.relatives.unlink(access, params.id, params.relativeId, input, requestId);
  }
}
