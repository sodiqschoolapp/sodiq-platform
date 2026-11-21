import {
  assistantAllConversationsSchema,
  assistantAnswerSchema,
  assistantAnyConversationDetailSchema,
  assistantConversationListSchema,
  assistantConversationSchema,
  assistantSettingsSchema,
  assistantStatusSchema,
  type AssistantRole,
  type AssistantSettingsRecord,
} from '@sodiq/shared';
import { queryOptions } from '@tanstack/react-query';
import { api } from '@/api/client';
import { answerOf } from '@/api/failure';

/**
 * The assistant (task 11.12; `02`, Assistant): the panel's status, the person's conversations, a
 * question, the Super Admin's switches and limits and the list of every conversation.
 */
export const ASSISTANT_KEY = ['assistant'] as const;

export const assistantStatusQuery = (role: AssistantRole, enabled: boolean) =>
  queryOptions({
    queryKey: [...ASSISTANT_KEY, 'status', role],
    enabled,
    queryFn: async () =>
      assistantStatusSchema.parse(
        await answerOf(api.GET('/api/assistant/status', { params: { query: { role } } })),
      ),
  });

export const assistantConversationsQuery = (enabled: boolean) =>
  queryOptions({
    queryKey: [...ASSISTANT_KEY, 'conversations'],
    enabled,
    queryFn: async () =>
      assistantConversationListSchema.parse(
        await answerOf(api.GET('/api/assistant/conversations')),
      ),
  });

export const assistantConversationQuery = (id: string | null) =>
  queryOptions({
    queryKey: [...ASSISTANT_KEY, 'conversation', id],
    enabled: id !== null,
    queryFn: async () =>
      assistantConversationSchema.parse(
        await answerOf(
          api.GET('/api/assistant/conversations/{id}', { params: { path: { id: id ?? '' } } }),
        ),
      ),
  });

export const askAssistant = async (body: {
  role: AssistantRole;
  text: string;
  conversationId?: string;
}) => assistantAnswerSchema.parse(await answerOf(api.POST('/api/assistant/questions', { body })));

export const ASSISTANT_SETTINGS_KEY = [...ASSISTANT_KEY, 'settings'] as const;

export const assistantSettingsQuery = (enabled: boolean) =>
  queryOptions({
    queryKey: ASSISTANT_SETTINGS_KEY,
    enabled,
    queryFn: async () =>
      assistantSettingsSchema.parse(
        await answerOf(api.GET('/api/setup/school-settings/assistant')),
      ),
  });

export const saveAssistantSettings = async (body: AssistantSettingsRecord) =>
  assistantSettingsSchema.parse(
    await answerOf(api.PUT('/api/setup/school-settings/assistant', { body })),
  );

export const ALL_CONVERSATIONS_KEY = [...ASSISTANT_KEY, 'all'] as const;

export const allConversationsQuery = () =>
  queryOptions({
    queryKey: ALL_CONVERSATIONS_KEY,
    queryFn: async () =>
      assistantAllConversationsSchema.parse(
        await answerOf(api.GET('/api/assistant/all-conversations')),
      ),
  });

export const anyConversationQuery = (id: string) =>
  queryOptions({
    queryKey: [...ALL_CONVERSATIONS_KEY, id],
    queryFn: async () =>
      assistantAnyConversationDetailSchema.parse(
        await answerOf(
          api.GET('/api/assistant/all-conversations/{id}', { params: { path: { id } } }),
        ),
      ),
  });

export const restoreConversation = async (id: string) =>
  assistantAnyConversationDetailSchema.parse(
    await answerOf(
      api.POST('/api/assistant/all-conversations/{id}/restore', { params: { path: { id } } }),
    ),
  );
