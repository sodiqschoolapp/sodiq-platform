import { Controller, Get, Post } from '@nestjs/common';
import {
  ratingChoicesQuerySchema,
  ratingChoicesSchema,
  ratingClassesListSchema,
  ratingClassesQuerySchema,
  ratingClassListSchema,
  ratingClassQuerySchema,
  ratingExportSchema,
  ratingSubjectListSchema,
  ratingSubjectQuerySchema,
  type RatingChoices,
  type RatingChoicesQuery,
  type RatingClassesList,
  type RatingClassesQuery,
  type RatingClassList,
  type RatingClassQuery,
  type RatingExport,
  type RatingSubjectList,
  type RatingSubjectQuery,
} from '@sodiq/shared';
import { RequestId } from '../../http/request-id.js';
import { Returns, ReturnsFile, ValidBody, ValidQuery } from '../../http/schemas.js';
import type { XlsxFile } from '../../http/xlsx.js';
import { Requires } from '../access/access.decorators.js';
import { CurrentAccess, type Access } from '../access/permission.guard.js';
import { RatingService } from './rating.service.js';

/**
 * The rating (task 9.3a, pull request #234; `08`, Rating), area `rating` (plan decision 1, Look
 * first). The guard lets the eight staff roles in; which lists each reads is decided in the route
 * (`rating.service.ts`). A read writes no audit entry; an export writes one.
 */
@Controller('results/rating')
export class RatingController {
  constructor(private readonly rating: RatingService) {}

  @Get('choices')
  @Requires('rating', 'view')
  @Returns(ratingChoicesSchema)
  choices(
    @CurrentAccess() access: Access,
    @ValidQuery(ratingChoicesQuerySchema) query: RatingChoicesQuery,
  ): Promise<RatingChoices> {
    return this.rating.choices(access, query);
  }

  @Get('subject')
  @Requires('rating', 'view')
  @Returns(ratingSubjectListSchema)
  subject(
    @CurrentAccess() access: Access,
    @ValidQuery(ratingSubjectQuerySchema) query: RatingSubjectQuery,
  ): Promise<RatingSubjectList> {
    return this.rating.subject(access, query);
  }

  @Get('class')
  @Requires('rating', 'view')
  @Returns(ratingClassListSchema)
  classRating(
    @CurrentAccess() access: Access,
    @ValidQuery(ratingClassQuerySchema) query: RatingClassQuery,
  ): Promise<RatingClassList> {
    return this.rating.classRating(access, query);
  }

  @Get('classes')
  @Requires('rating', 'view')
  @Returns(ratingClassesListSchema)
  classes(
    @CurrentAccess() access: Access,
    @ValidQuery(ratingClassesQuerySchema) query: RatingClassesQuery,
  ): Promise<RatingClassesList> {
    return this.rating.classes(access, query);
  }

  /** One list as Excel, with the reader's own rows and the stamp of `edge/journal`. */
  @Post('export')
  @Requires('rating', 'export')
  @ReturnsFile()
  export(
    @CurrentAccess() access: Access,
    @ValidBody(ratingExportSchema) input: RatingExport,
    @RequestId() requestId: string,
  ): Promise<XlsxFile> {
    return this.rating.export(access, input, requestId);
  }
}
