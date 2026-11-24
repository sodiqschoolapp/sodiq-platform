import { Module } from '@nestjs/common';
import { CONFIG } from '../../config/config.module.js';
import type { AppConfig } from '../../config/config.js';
import { AccessModule } from '../access/access.module.js';
import {
  AssistantAdminController,
  AssistantController,
  AssistantSettingsController,
} from './assistant.controller.js';
import { ASSISTANT_PRICES, AssistantEngine } from './assistant.engine.js';
import { AssistantSettingsService } from './assistant-settings.service.js';
import { AssistantConversations } from './assistant.service.js';
import { AssistantProposals } from './assistant-proposals.service.js';
import { AssistantDispatcher } from './dispatcher.js';
import { GeminiModel } from './gemini-model.js';
import { ASSISTANT_MODEL } from './model.js';
import { ASSISTANT_WAIT, ModelCaller, REAL_WAIT } from './model-caller.js';
import { ScriptedModel } from './scripted-model.js';

/**
 * The assistant (`02`, Assistant; task 11.12): the engine, its reads as the person, the
 * conversations and the switches. Nothing else in the platform depends on it (`02`, Limits).
 */
@Module({
  imports: [AccessModule],
  controllers: [AssistantController, AssistantAdminController, AssistantSettingsController],
  providers: [
    AssistantEngine,
    AssistantSettingsService,
    AssistantConversations,
    AssistantProposals,
    AssistantDispatcher,
    {
      provide: ASSISTANT_MODEL,
      useFactory: (config: AppConfig) =>
        config.assistant.scripted ? new ScriptedModel() : new GeminiModel(config.assistant),
      inject: [CONFIG],
    },
    {
      provide: ASSISTANT_PRICES,
      useFactory: (config: AppConfig) => config.assistant.prices,
      inject: [CONFIG],
    },
    ModelCaller,
    { provide: ASSISTANT_WAIT, useValue: REAL_WAIT },
  ],
})
export class AssistantModule {}
