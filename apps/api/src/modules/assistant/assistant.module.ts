import { Module } from '@nestjs/common';
import { CONFIG } from '../../config/config.module.js';
import type { AppConfig } from '../../config/config.js';
import { AccessModule } from '../access/access.module.js';
import { AuthModule } from '../auth/auth.module.js';
import {
  AssistantActionsController,
  AssistantAdminController,
  AssistantController,
  AssistantSettingsController,
} from './assistant.controller.js';
import { ASSISTANT_PRICES, AssistantEngine } from './assistant.engine.js';
import { AssistantSettingsService } from './assistant-settings.service.js';
import { AssistantSwitches } from './assistant-switches.service.js';
import { AssistantConversations } from './assistant.service.js';
import { AssistantProposals } from './assistant-proposals.service.js';
import { AssistantDispatcher } from './dispatcher.js';
import { GeminiModel } from './gemini-model.js';
import { ASSISTANT_MODEL } from './model.js';
import { ASSISTANT_WAIT, ModelCaller, REAL_WAIT, type AssistantWait } from './model-caller.js';
import { AssistantWork } from './assistant-work.js';
import { AssistantFiles } from './assistant-files.service.js';
import { PHOTO_STORE, photoStoreOf } from '../people/photo-store.js';
import { ScriptedModel } from './scripted-model.js';

/**
 * The assistant (`02`, Assistant; task 11.12): the engine, its reads as the person, the
 * conversations and the switches. Nothing else in the platform depends on it (`02`, Limits).
 */
@Module({
  imports: [AccessModule, AuthModule],
  controllers: [
    AssistantController,
    AssistantAdminController,
    AssistantSettingsController,
    AssistantActionsController,
  ],
  providers: [
    AssistantEngine,
    AssistantSettingsService,
    AssistantSwitches,
    AssistantConversations,
    AssistantProposals,
    AssistantDispatcher,
    AssistantFiles,
    {
      provide: PHOTO_STORE,
      useFactory: (config: AppConfig) => photoStoreOf(config.photos),
      inject: [CONFIG],
    },
    {
      provide: ASSISTANT_MODEL,
      useFactory: (config: AppConfig, wait: AssistantWait) =>
        config.assistant.scripted
          ? new ScriptedModel(wait, config.assistant.scriptedDelayMs)
          : new GeminiModel(config.assistant),
      inject: [CONFIG, ASSISTANT_WAIT],
    },
    {
      provide: ASSISTANT_PRICES,
      useFactory: (config: AppConfig) => config.assistant.prices,
      inject: [CONFIG],
    },
    ModelCaller,
    AssistantWork,
    { provide: ASSISTANT_WAIT, useValue: REAL_WAIT },
  ],
})
export class AssistantModule {}
