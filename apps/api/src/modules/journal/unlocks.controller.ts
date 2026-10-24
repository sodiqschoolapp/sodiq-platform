import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import {
  editExtensionCreateSchema,
  editExtensionSchema,
  editExtensionsSchema,
  journalRatingParamsSchema,
  journalUnlockSchema,
  journalUnlocksQuerySchema,
  journalUnlocksSchema,
  lessonUnlockParamsSchema,
  unlockCreateSchema,
  unlockDecisionSchema,
  unlockParamsSchema,
  unlockWithdrawSchema,
  type EditExtension,
  type EditExtensionCreate,
  type EditExtensions,
  type JournalRatingParams,
  type JournalUnlock,
  type JournalUnlocks,
  type JournalUnlocksQuery,
  type LessonUnlockParams,
  type UnlockCreate,
  type UnlockDecision,
  type UnlockParams,
  type UnlockWithdraw,
} from '@sodiq/shared';
import { RequestId } from '../../http/request-id.js';
import { Returns, ValidBody, ValidParams, ValidQuery } from '../../http/schemas.js';
import { Requires } from '../access/access.decorators.js';
import { CurrentAccess, type Access } from '../access/permission.guard.js';
import { ExtensionsService } from './extensions.service.js';
import { UnlocksService } from './unlocks.service.js';

/**
 * Unlock requests (task 8.4, pull request #222, decision 5, Look first): the
 * area `journal_unlocks`. `create` sends and withdraws the person's own;
 * `edit` decides, routed by the posts in force (`access/request-routing.ts`),
 * never the reader's own. The route decides the lesson or rating exam as
 * entry does (`journal_entry_scope`, `rating_exam_scope`).
 */
@Controller('journal')
export class UnlocksController {
  constructor(
    private readonly unlocks: UnlocksService,
    private readonly extensions: ExtensionsService,
  ) {}

  @Get('unlocks')
  @Requires('journal_unlocks', 'view')
  @Returns(journalUnlocksSchema)
  list(
    @CurrentAccess() access: Access,
    @ValidQuery(journalUnlocksQuerySchema) query: JournalUnlocksQuery,
  ): Promise<JournalUnlocks> {
    return this.unlocks.list(access, query.view);
  }

  @Post('lessons/:lessonId/unlocks')
  @Requires('journal_unlocks', 'create')
  @Returns(journalUnlockSchema, 201)
  requestLesson(
    @CurrentAccess() access: Access,
    @ValidParams(lessonUnlockParamsSchema) params: LessonUnlockParams,
    @ValidBody(unlockCreateSchema) input: UnlockCreate,
    @RequestId() requestId: string,
  ): Promise<JournalUnlock> {
    return this.unlocks.requestLesson(access, params.lessonId, input, requestId);
  }

  @Post('journals/:journalId/rating/:quarterId/unlocks')
  @Requires('journal_unlocks', 'create')
  @Returns(journalUnlockSchema, 201)
  requestRating(
    @CurrentAccess() access: Access,
    @ValidParams(journalRatingParamsSchema) params: JournalRatingParams,
    @ValidBody(unlockCreateSchema) input: UnlockCreate,
    @RequestId() requestId: string,
  ): Promise<JournalUnlock> {
    return this.unlocks.requestRating(access, params.journalId, params.quarterId, input, requestId);
  }

  @Post('unlocks/:unlockId/decide')
  @HttpCode(200)
  @Requires('journal_unlocks', 'edit')
  @Returns(journalUnlockSchema)
  decide(
    @CurrentAccess() access: Access,
    @ValidParams(unlockParamsSchema) params: UnlockParams,
    @ValidBody(unlockDecisionSchema) input: UnlockDecision,
    @RequestId() requestId: string,
  ): Promise<JournalUnlock> {
    return this.unlocks.decide(access, params.unlockId, input, requestId);
  }

  @Post('unlocks/:unlockId/withdraw')
  @HttpCode(200)
  @Requires('journal_unlocks', 'create')
  @Returns(journalUnlockSchema)
  withdraw(
    @CurrentAccess() access: Access,
    @ValidParams(unlockParamsSchema) params: UnlockParams,
    @ValidBody(unlockWithdrawSchema) input: UnlockWithdraw,
    @RequestId() requestId: string,
  ): Promise<JournalUnlock> {
    return this.unlocks.withdraw(access, params.unlockId, input, requestId);
  }

  /** `edge/system-behaviour`: the branch-wide extension of the edit period (decision 13). */
  @Get('extensions')
  @Requires('journal_extensions', 'view')
  @Returns(editExtensionsSchema)
  listExtensions(@CurrentAccess() access: Access): Promise<EditExtensions> {
    return this.extensions.list(access);
  }

  @Post('extensions')
  @Requires('journal_extensions', 'create')
  @Returns(editExtensionSchema, 201)
  extend(
    @CurrentAccess() access: Access,
    @ValidBody(editExtensionCreateSchema) input: EditExtensionCreate,
    @RequestId() requestId: string,
  ): Promise<EditExtension> {
    return this.extensions.create(access, input, requestId);
  }
}
