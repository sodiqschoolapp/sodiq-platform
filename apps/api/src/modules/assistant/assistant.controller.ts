import { Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import {
  assistantConfirmedSchema,
  type AssistantConfirmed,
  assistantActionsSchema,
  assistantSwitchChangesSchema,
  type AssistantActions,
  type AssistantSwitchChanges,
  assistantAllConversationsQuerySchema,
  assistantAllConversationsSchema,
  assistantAnswerSchema,
  assistantAnyConversationDetailSchema,
  assistantConversationListSchema,
  assistantConversationParamsSchema,
  assistantConversationSchema,
  assistantDecisionSchema,
  assistantUndoSchema,
  assistantQuestionSchema,
  assistantSettingsRecordSchema,
  assistantSettingsSchema,
  assistantStatusQuerySchema,
  assistantStatusSchema,
  type AssistantAllConversations,
  type AssistantAllConversationsQuery,
  type AssistantAnswer,
  type AssistantAnyConversationDetail,
  type AssistantConversation,
  type AssistantConversationList,
  type AssistantConversationParams,
  type AssistantDecision,
  type AssistantUndo,
  type AssistantQuestion,
  type AssistantSettings,
  type AssistantSettingsRecord,
  type AssistantStatus,
  type AssistantStatusQuery,
} from '@sodiq/shared';
import { ApiException } from '../../http/api-exception.js';
import { RequestId } from '../../http/request-id.js';
import { Returns, ValidBody, ValidParams, ValidQuery } from '../../http/schemas.js';
import { RequestSessionPass, type SessionPass } from '../../http/session-cookie.js';
import { Requires } from '../access/access.decorators.js';
import { CurrentAccess, type Access } from '../access/permission.guard.js';
import { CurrentSession } from '../auth/session.guard.js';
import type { ActiveSession } from '../auth/sessions.service.js';
import { AssistantEngine } from './assistant.engine.js';
import { AssistantSettingsService } from './assistant-settings.service.js';
import { AssistantConversations } from './assistant.service.js';
import { AssistantProposals } from './assistant-proposals.service.js';
import { AssistantSwitches } from './assistant-switches.service.js';

/**
 * The chat panel of the assistant (`02`, Assistant; task 11.12), for the person in the role
 * chosen in the role switcher. The area `assistant` (view) is the Super Admin's in this task,
 * approved by the owner (build plan 11.12).
 */
@Controller('assistant')
export class AssistantController {
  constructor(
    private readonly engine: AssistantEngine,
    private readonly conversations: AssistantConversations,
    private readonly proposals: AssistantProposals,
  ) {}

  @Get('status')
  @Requires('assistant', 'view')
  @Returns(assistantStatusSchema)
  status(
    @CurrentAccess() access: Access,
    @ValidQuery(assistantStatusQuerySchema) query: AssistantStatusQuery,
  ): Promise<AssistantStatus> {
    return this.conversations.status(access, query.role);
  }

  @Get('conversations')
  @Requires('assistant', 'view')
  @Returns(assistantConversationListSchema)
  list(
    @CurrentAccess() access: Access,
    @CurrentSession() session: ActiveSession,
  ): Promise<AssistantConversationList> {
    return this.conversations.own(access, session.assignments);
  }

  @Get('conversations/:id')
  @Requires('assistant', 'view')
  @Returns(assistantConversationSchema)
  read(
    @CurrentAccess() access: Access,
    @CurrentSession() session: ActiveSession,
    @ValidParams(assistantConversationParamsSchema) params: AssistantConversationParams,
  ): Promise<AssistantConversation> {
    return this.conversations.ownOne(access, session.assignments, params.id);
  }

  /**
   * A question. Task 11.16 (`02`, While it works): 202 at once with the conversation holding the
   * question; the answer is written after, and the person's tabs hear of it live.
   */
  @Post('questions')
  @HttpCode(202)
  @Requires('assistant', 'view')
  @Returns(assistantAnswerSchema)
  ask(
    @CurrentAccess() access: Access,
    @CurrentSession() session: ActiveSession,
    @RequestSessionPass() pass: SessionPass | undefined,
    @ValidBody(assistantQuestionSchema) question: AssistantQuestion,
  ): Promise<AssistantAnswer> {
    if (pass === undefined) {
      // The guard read a session from this cookie: never reached.
      throw new ApiException('not_signed_in', 401);
    }
    return this.engine.ask({ access, pass, language: session.language }, question);
  }

  /**
   * Task 11.13 (`02`, Reading and proposing): runs the steps of a waiting proposal in order,
   * through their own routes as the person, and stops at the first refusal. No request key:
   * the one decision of a proposal makes a repeat 409 (plan review, should fix 11).
   */
  @Post('proposals/:id/confirm')
  @HttpCode(200)
  @Requires('assistant', 'view')
  @Returns(assistantConfirmedSchema)
  confirm(
    @CurrentAccess() access: Access,
    @RequestSessionPass() pass: SessionPass | undefined,
    @ValidParams(assistantConversationParamsSchema) params: AssistantConversationParams,
    @ValidBody(assistantDecisionSchema) decision: AssistantDecision,
  ): Promise<AssistantConfirmed> {
    if (pass === undefined) {
      throw new ApiException('not_signed_in', 401);
    }
    return this.proposals.confirm(access, pass, params.id, decision.role);
  }

  /**
   * Task 11.21 (`02`, Reading and proposing: "A confirmed proposal can be undone"): proposes the
   * reverse of each change of a confirmed proposal, as a new proposal confirmed like any other.
   * No model call. The area of Confirm and Decline: no role gains a right.
   */
  @Post('proposals/:id/undo')
  @HttpCode(200)
  @Requires('assistant', 'view')
  @Returns(assistantAnswerSchema)
  undo(
    @CurrentAccess() access: Access,
    @CurrentSession() session: ActiveSession,
    @RequestSessionPass() pass: SessionPass | undefined,
    @ValidParams(assistantConversationParamsSchema) params: AssistantConversationParams,
    @ValidBody(assistantUndoSchema) undo: AssistantUndo,
  ): Promise<AssistantAnswer> {
    if (pass === undefined) {
      throw new ApiException('not_signed_in', 401);
    }
    return this.engine.undo({ access, pass, language: session.language }, params.id, undo.role);
  }

  /** Task 11.13: declines a waiting proposal; nothing changes. */
  @Post('proposals/:id/decline')
  @HttpCode(200)
  @Requires('assistant', 'view')
  @Returns(assistantConversationSchema)
  decline(
    @CurrentAccess() access: Access,
    @ValidParams(assistantConversationParamsSchema) params: AssistantConversationParams,
    @ValidBody(assistantDecisionSchema) decision: AssistantDecision,
  ): Promise<AssistantConversation> {
    return this.proposals.decline(access, params.id, decision.role);
  }
}

/**
 * The Super Admin's page of every conversation (`02`: "the Super Admin sees all of them … reads
 * it and can restore it"), under the existing area `monitoring`, the Super Admin's alone (plan
 * decision 3, Look first).
 */
@Controller('assistant/all-conversations')
export class AssistantAdminController {
  constructor(private readonly conversations: AssistantConversations) {}

  @Get()
  @Requires('monitoring', 'view', { branch: 'none' })
  @Returns(assistantAllConversationsSchema)
  list(
    @ValidQuery(assistantAllConversationsQuerySchema) query: AssistantAllConversationsQuery,
  ): Promise<AssistantAllConversations> {
    return this.conversations.all(query);
  }

  @Get(':id')
  @Requires('monitoring', 'view', { branch: 'none' })
  @Returns(assistantAnyConversationDetailSchema)
  read(
    @ValidParams(assistantConversationParamsSchema) params: AssistantConversationParams,
  ): Promise<AssistantAnyConversationDetail> {
    return this.conversations.any(params.id);
  }

  @Post(':id/restore')
  @HttpCode(200)
  @Requires('monitoring', 'edit', { branch: 'none' })
  @Returns(assistantAnyConversationDetailSchema)
  restore(
    @CurrentAccess() access: Access,
    @ValidParams(assistantConversationParamsSchema) params: AssistantConversationParams,
    @RequestId() requestId: string,
  ): Promise<AssistantAnyConversationDetail> {
    return this.conversations.restore(access, params.id, requestId);
  }
}

/** The assistant's switches and limits (`02`, Limits), under `school_settings` (decision 3). */
@Controller('setup/school-settings/assistant')
export class AssistantSettingsController {
  constructor(private readonly settings: AssistantSettingsService) {}

  @Get()
  @Requires('school_settings', 'view', { branch: 'none' })
  @Returns(assistantSettingsSchema)
  read(): Promise<AssistantSettings> {
    return this.settings.view();
  }

  @Put()
  @Requires('school_settings', 'edit', { branch: 'none' })
  @Returns(assistantSettingsSchema)
  change(
    @CurrentAccess() access: Access,
    @ValidBody(assistantSettingsRecordSchema) record: AssistantSettingsRecord,
    @RequestId() requestId: string,
  ): Promise<AssistantSettings> {
    return this.settings.change(access, record, requestId);
  }
}

/**
 * Task 11.20 (`02`, Assistant, Switches): every action of each of the three roles, by area, and
 * the Super Admin's switches of them, under `school_settings` as the other settings of the
 * assistant (plan decision 11). On no list of the assistant (decision 5).
 */
@Controller('assistant/actions')
export class AssistantActionsController {
  constructor(private readonly switches: AssistantSwitches) {}

  @Get()
  @Requires('school_settings', 'view', { branch: 'none' })
  @Returns(assistantActionsSchema)
  read(): Promise<AssistantActions> {
    return this.switches.catalogue();
  }

  @Put()
  @Requires('school_settings', 'edit', { branch: 'none' })
  @Returns(assistantActionsSchema)
  change(
    @CurrentAccess() access: Access,
    @ValidBody(assistantSwitchChangesSchema) body: AssistantSwitchChanges,
    @RequestId() requestId: string,
  ): Promise<AssistantActions> {
    return this.switches.change(access, body.changes, requestId);
  }
}
