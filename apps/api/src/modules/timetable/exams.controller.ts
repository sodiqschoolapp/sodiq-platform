import { Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import {
  examBodySchema,
  examCancelBodySchema,
  examCreateBodySchema,
  examParamsSchema,
  examSaveAnswerSchema,
  examSchema,
  examsAnswerSchema,
  examsQuerySchema,
  type Exam,
  type ExamCancelBody,
  type ExamInput,
  type ExamParams,
  type ExamSaveAnswer,
  type ExamsAnswer,
  type ExamsQuery,
} from '@sodiq/shared';
import { RequestId } from '../../http/request-id.js';
import { RequestKey, Returns, ValidBody, ValidParams, ValidQuery } from '../../http/schemas.js';
import { Requires } from '../access/access.decorators.js';
import { CurrentAccess, type Access } from '../access/permission.guard.js';
import { TimetableExams } from './exams.service.js';

/**
 * Exams in the timetable (task 5.6c-1, pull request #181): the area
 * `timetable`, no role widened. The Super Admin and the Academic Vice
 * Principal create, change and cancel (`edit`; `06`, Exam: "The Academic Vice
 * Principal creates, changes and cancels exams"); the roles that view the
 * timetable read them (`view`). Every route works for the branch of the
 * request.
 */
@Controller('timetable/exams')
export class ExamsController {
  constructor(private readonly exams: TimetableExams) {}

  @Get()
  @Requires('timetable', 'view')
  @Returns(examsAnswerSchema)
  list(
    @CurrentAccess() access: Access,
    @ValidQuery(examsQuerySchema) query: ExamsQuery,
  ): Promise<ExamsAnswer> {
    return this.exams.list(access, query);
  }

  @Get(':id')
  @Requires('timetable', 'view')
  @Returns(examSchema)
  one(
    @CurrentAccess() access: Access,
    @ValidParams(examParamsSchema) params: ExamParams,
  ): Promise<Exam> {
    return this.exams.one(access, params.id);
  }

  /** A new exam, safe to repeat with its key. */
  @Post()
  @HttpCode(201)
  @Requires('timetable', 'edit')
  @Returns(examSaveAnswerSchema)
  create(
    @CurrentAccess() access: Access,
    @RequestKey() key: string,
    @ValidBody(examCreateBodySchema) input: ExamInput,
    @RequestId() requestId: string,
  ): Promise<ExamSaveAnswer> {
    return this.exams.create(access, input, key, requestId);
  }

  /** A change of an exam, the whole exam checked again, safe to repeat with its key. */
  @Put(':id')
  @Requires('timetable', 'edit')
  @Returns(examSaveAnswerSchema)
  change(
    @CurrentAccess() access: Access,
    @ValidParams(examParamsSchema) params: ExamParams,
    @RequestKey() key: string,
    @ValidBody(examBodySchema) input: ExamInput,
    @RequestId() requestId: string,
  ): Promise<ExamSaveAnswer> {
    return this.exams.change(access, params.id, input, key, requestId);
  }

  /** The cancel of an exam, final, safe to repeat with its key. */
  @Post(':id/cancel')
  @HttpCode(200)
  @Requires('timetable', 'edit')
  @Returns(examSaveAnswerSchema)
  cancel(
    @CurrentAccess() access: Access,
    @ValidParams(examParamsSchema) params: ExamParams,
    @RequestKey() key: string,
    @ValidBody(examCancelBodySchema) input: ExamCancelBody,
    @RequestId() requestId: string,
  ): Promise<ExamSaveAnswer> {
    return this.exams.cancel(access, params.id, input, key, requestId);
  }
}
