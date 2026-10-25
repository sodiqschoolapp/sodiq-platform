import { Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import {
  copyQuarterWeightsRecordSchema,
  gradeChangesSchema,
  dailyWeightsSchema,
  newSubjectRecordSchema,
  quarterWeightsSchema,
  setupIdParamsSchema,
  subjectExportSchema,
  subjectListSchema,
  subjectQuarterParamsSchema,
  subjectQuarterWeightsQuerySchema,
  subjectQuarterWeightsSchema,
  subjectRecordSchema,
  subjectSchema,
  type CopyQuarterWeightsRecord,
  type GradeChanges,
  type DailyWeights,
  type QuarterWeights,
  type SetupIdParams,
  type Subject,
  type SubjectExport,
  type SubjectList,
  type SubjectQuarterParams,
  type SubjectQuarterWeights,
  type SubjectQuarterWeightsQuery,
  type SubjectRecord,
} from '@sodiq/shared';
import { RequestId } from '../../http/request-id.js';
import { Returns, ReturnsFile, ValidBody, ValidParams, ValidQuery } from '../../http/schemas.js';
import type { XlsxFile } from '../../http/xlsx.js';
import { Requires } from '../access/access.decorators.js';
import { CurrentAccess, type Access } from '../access/permission.guard.js';
import { Subjects } from './subjects.service.js';

/**
 * Subjects and their weights (docs/spec/05-classes-groups-subjects.md, Subject
 * and "Grading weights on a subject"; task 2.1). The area `subjects`: the
 * Super Admin and every Academic Vice Principal change subjects (owner's
 * answer 4), the Principal views. Every route works for the branch of the
 * request: the subject is the same in every branch, its weights are the
 * branch's (answer 3).
 */
@Controller('setup')
export class SubjectsController {
  constructor(private readonly subjects: Subjects) {}

  @Get('subjects')
  @Requires('subjects', 'view')
  @Returns(subjectListSchema)
  list(@CurrentAccess() access: Access): Promise<SubjectList> {
    return this.subjects.list(access);
  }

  /** The Excel file of the list with this branch's daily distribution (task 2.2c-1). */
  @Post('subjects/export')
  @Requires('subjects', 'export')
  @ReturnsFile()
  export(
    @CurrentAccess() access: Access,
    @ValidBody(subjectExportSchema) request: SubjectExport,
    @RequestId() requestId: string,
  ): Promise<XlsxFile> {
    return this.subjects.export(access, request, requestId);
  }

  @Post('subjects')
  @Requires('subjects', 'create')
  @Returns(subjectSchema, 201)
  create(
    @CurrentAccess() access: Access,
    @ValidBody(newSubjectRecordSchema) record: SubjectRecord,
    @RequestId() requestId: string,
  ): Promise<Subject> {
    return this.subjects.create(access, record, requestId);
  }

  @Put('subjects/:id')
  @Requires('subjects', 'edit')
  @Returns(subjectSchema)
  edit(
    @CurrentAccess() access: Access,
    @ValidParams(setupIdParamsSchema) params: SetupIdParams,
    @ValidBody(subjectRecordSchema) record: SubjectRecord,
    @RequestId() requestId: string,
  ): Promise<Subject> {
    return this.subjects.edit(access, params.id, record, requestId);
  }

  @Put('subjects/:id/daily-weights')
  @Requires('subjects', 'edit')
  @Returns(subjectSchema)
  setDaily(
    @CurrentAccess() access: Access,
    @ValidParams(setupIdParamsSchema) params: SetupIdParams,
    @ValidBody(dailyWeightsSchema) weights: DailyWeights,
    @RequestId() requestId: string,
  ): Promise<Subject> {
    return this.subjects.setDaily(access, params.id, weights, requestId);
  }

  @Post('subjects/:id/archive')
  @HttpCode(200)
  @Requires('subjects', 'archive')
  @Returns(subjectSchema)
  archive(
    @CurrentAccess() access: Access,
    @ValidParams(setupIdParamsSchema) params: SetupIdParams,
    @RequestId() requestId: string,
  ): Promise<Subject> {
    return this.subjects.archive(access, params.id, requestId);
  }

  @Post('subjects/:id/restore')
  @HttpCode(200)
  @Requires('subjects', 'archive')
  @Returns(subjectSchema)
  restore(
    @CurrentAccess() access: Access,
    @ValidParams(setupIdParamsSchema) params: SetupIdParams,
    @RequestId() requestId: string,
  ): Promise<Subject> {
    return this.subjects.restore(access, params.id, requestId);
  }

  @Get('subjects/:id/quarter-weights')
  @Requires('subjects', 'view')
  @Returns(subjectQuarterWeightsSchema)
  quarterWeights(
    @CurrentAccess() access: Access,
    @ValidParams(setupIdParamsSchema) params: SetupIdParams,
    @ValidQuery(subjectQuarterWeightsQuerySchema) query: SubjectQuarterWeightsQuery,
  ): Promise<SubjectQuarterWeights> {
    return this.subjects.quarterWeights(access, params.id, query.yearId);
  }

  @Put('subjects/:id/quarter-weights/:quarterId')
  @Requires('subjects', 'edit')
  @Returns(subjectQuarterWeightsSchema)
  setQuarterWeights(
    @CurrentAccess() access: Access,
    @ValidParams(subjectQuarterParamsSchema) params: SubjectQuarterParams,
    @ValidBody(quarterWeightsSchema) weights: QuarterWeights,
    @RequestId() requestId: string,
  ): Promise<SubjectQuarterWeights> {
    return this.subjects.setQuarterWeights(access, params.id, params.quarterId, weights, requestId);
  }

  @Post('subjects/:id/quarter-weights/copy')
  @HttpCode(200)
  @Requires('subjects', 'edit')
  @Returns(subjectQuarterWeightsSchema)
  copyQuarterOne(
    @CurrentAccess() access: Access,
    @ValidParams(setupIdParamsSchema) params: SetupIdParams,
    @ValidBody(copyQuarterWeightsRecordSchema) record: CopyQuarterWeightsRecord,
    @RequestId() requestId: string,
  ): Promise<SubjectQuarterWeights> {
    return this.subjects.copyQuarterOne(access, params.id, record, requestId);
  }

  /** Task 9.1: the grades the copy would alter in each quarter it writes; changes nothing. */
  @Post('subjects/:id/quarter-weights/copy/preview')
  @HttpCode(200)
  @Requires('subjects', 'edit')
  @Returns(gradeChangesSchema)
  previewCopy(
    @CurrentAccess() access: Access,
    @ValidParams(setupIdParamsSchema) params: SetupIdParams,
    @ValidBody(copyQuarterWeightsRecordSchema) record: CopyQuarterWeightsRecord,
    @RequestId() requestId: string,
  ): Promise<GradeChanges> {
    return this.subjects.previewCopy(access, params.id, record, requestId);
  }

  /** Task 9.1: the grades the change would alter in each journal; changes nothing. */
  @Post('subjects/:id/quarter-weights/:quarterId/preview')
  @HttpCode(200)
  @Requires('subjects', 'edit')
  @Returns(gradeChangesSchema)
  previewQuarterWeights(
    @CurrentAccess() access: Access,
    @ValidParams(subjectQuarterParamsSchema) params: SubjectQuarterParams,
    @ValidBody(quarterWeightsSchema) weights: QuarterWeights,
    @RequestId() requestId: string,
  ): Promise<GradeChanges> {
    return this.subjects.previewQuarterWeights(
      access,
      params.id,
      params.quarterId,
      weights,
      requestId,
    );
  }
}
