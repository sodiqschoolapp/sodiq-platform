import { Controller, Get, Put } from '@nestjs/common';
import {
  commentHistoryQuerySchema,
  commentHistorySchema,
  commentSaveSchema,
  journalCommentSchema,
  type CommentHistory,
  type CommentHistoryQuery,
  type CommentSave,
  type JournalComment,
} from '@sodiq/shared';
import { RequestId } from '../../http/request-id.js';
import { Returns, ValidBody, ValidQuery } from '../../http/schemas.js';
import { Requires } from '../access/access.decorators.js';
import { CurrentAccess, type Access } from '../access/permission.guard.js';
import { CommentsService } from './comments.service.js';

/**
 * Comments on a mark, a number or a rating entry, and a student's note for a
 * lesson (task 8.2, pull request #218; `07`, Entering data, Comments). The
 * guard decides role and branch; the route decides the target: whoever may
 * enter it may comment on it (`comment_scope`), and the history is read with
 * the scope of the journal cell or rating entry it is on.
 */
@Controller('journal/comments')
export class CommentsController {
  constructor(private readonly comments: CommentsService) {}

  @Put()
  @Requires('journal', 'edit')
  @Returns(journalCommentSchema)
  save(
    @CurrentAccess() access: Access,
    @ValidBody(commentSaveSchema) input: CommentSave,
    @RequestId() requestId: string,
  ): Promise<JournalComment> {
    return this.comments.save(access, input, requestId);
  }

  @Get('history')
  @Requires('journal', 'view')
  @Returns(commentHistorySchema)
  history(
    @CurrentAccess() access: Access,
    @ValidQuery(commentHistoryQuerySchema) query: CommentHistoryQuery,
  ): Promise<CommentHistory> {
    return this.comments.history(access, query);
  }
}
