import {
  assistantActionsSchema,
  assistantConfirmedSchema,
  assistantAllConversationsSchema,
  assistantAnswerSchema,
  assistantAnyConversationDetailSchema,
  assistantConversationListSchema,
  assistantConversationSchema,
  assistantSettingsSchema,
  assistantStatusSchema,
  assistantFileSchema,
  type AssistantUploadKind,
  type AssistantPlace,
  type AssistantRole,
  type AssistantSettingsRecord,
  type AssistantSwitchChange,
} from '@sodiq/shared';
import { queryOptions } from '@tanstack/react-query';
import { api, branchHeader } from '@/api/client';
import { answerOf, ApiFailure } from '@/api/failure';
import { fileNameOf, save } from '@/components/list/use-export';

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
        await answerOf(
          api.GET('/api/assistant/status', { params: { query: { role }, header: branchHeader() } }),
        ),
      ),
  });

export const assistantConversationsQuery = (enabled: boolean) =>
  queryOptions({
    queryKey: [...ASSISTANT_KEY, 'conversations'],
    enabled,
    queryFn: async () =>
      assistantConversationListSchema.parse(
        await answerOf(
          api.GET('/api/assistant/conversations', { params: { header: branchHeader() } }),
        ),
      ),
  });

export const assistantConversationQuery = (id: string | null) =>
  queryOptions({
    queryKey: [...ASSISTANT_KEY, 'conversation', id],
    enabled: id !== null,
    queryFn: async () =>
      assistantConversationSchema.parse(
        await answerOf(
          api.GET('/api/assistant/conversations/{id}', {
            params: { path: { id: id ?? '' }, header: branchHeader() },
          }),
        ),
      ),
  });

export const askAssistant = async (body: {
  role: AssistantRole;
  text: string;
  conversationId?: string;
  /** Task 11.19: the page the question is asked from; none from the Assistant page. */
  place?: AssistantPlace;
  /** Task 11.21: Continue of the newest answer, which a limit cut. */
  continue?: true;
  /** Task 11.22: the files attached, and the recording. */
  files?: string[];
  voice?: string;
}) =>
  assistantAnswerSchema.parse(
    await answerOf(
      api.POST('/api/assistant/questions', { params: { header: branchHeader() }, body }),
    ),
  );

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

/**
 * Task 11.21: Undo of a confirmed proposal: the server proposes the reverse of each change made,
 * as a new proposal of the conversation.
 */
export const undoProposal = async (input: { id: string; role: AssistantRole }) =>
  assistantAnswerSchema.parse(
    await answerOf(
      api.POST('/api/assistant/proposals/{id}/undo', {
        params: { path: { id: input.id }, header: branchHeader() },
        body: { role: input.role },
      }),
    ),
  );

/** Task 11.13: Confirm or Decline of a proposal, in the tab's branch and chosen role. */
export const decideProposal = async (input: {
  id: string;
  which: 'confirm' | 'decline';
  role: AssistantRole;
}) =>
  // Task 11.20: a Confirm's answer also holds the secrets its steps gave out, once; the card
  // keeps them in its own state only (`.claude/rules/web.md`: a secret an answer holds once).
  assistantConfirmedSchema.parse(
    await answerOf(
      input.which === 'confirm'
        ? api.POST('/api/assistant/proposals/{id}/confirm', {
            params: { path: { id: input.id }, header: branchHeader() },
            body: { role: input.role },
          })
        : api
            .POST('/api/assistant/proposals/{id}/decline', {
              params: { path: { id: input.id }, header: branchHeader() },
              body: { role: input.role },
            })
            .then((answer) =>
              answer.data === undefined
                ? answer
                : { ...answer, data: { ...answer.data, secrets: [] } },
            ),
    ),
  );

/** Task 11.20: every action of the three roles by area, and the Super Admin's switches. */
export const ASSISTANT_ACTIONS_KEY = [...ASSISTANT_KEY, 'actions'] as const;

export const assistantActionsQuery = (enabled: boolean) =>
  queryOptions({
    queryKey: ASSISTANT_ACTIONS_KEY,
    enabled,
    queryFn: async () =>
      assistantActionsSchema.parse(await answerOf(api.GET('/api/assistant/actions'))),
  });

export const saveAssistantSwitches = async (changes: AssistantSwitchChange[]) =>
  assistantActionsSchema.parse(
    await answerOf(api.PUT('/api/assistant/actions', { body: { changes } })),
  );

/**
 * The key of an action's name under `assistant.actions`: its operation id, except an id that
 * ends like a plural form (`ExamsController_one`), which i18next would read as one (`_op`).
 */
export function actionLabelKey(operation: string): string {
  return /_(zero|one|two|few|many|other)$/.test(operation) ? `${operation}_op` : operation;
}

/** Task 11.22: a file attached to a question, or a recorded question, sent as it is. */
export const uploadAssistantFile = (
  role: AssistantRole,
  kind: AssistantUploadKind,
  file: Blob,
  name: string,
) =>
  answerOf(
    api.PUT('/api/assistant/files', {
      params: { header: branchHeader(), query: { role, kind, name } },
      // The document types the body as a binary string; the browser sends the file as it is.
      body: file as unknown as string,
      bodySerializer: (body: unknown) => body as Blob,
      headers: { 'Content-Type': file.type.split(';')[0] ?? file.type },
    }),
  ).then((answer) => assistantFileSchema.parse(answer));

/**
 * Task 11.22: downloads a file of a conversation under its own name: the person's own, or, with
 * `conversationId`, a file of any conversation the Super Admin reads.
 */
export async function downloadAssistantFile(
  fileId: string,
  name: string,
  conversationId?: string,
): Promise<void> {
  const result =
    conversationId === undefined
      ? await api.GET('/api/assistant/files/{id}', {
          params: { header: branchHeader(), path: { id: fileId } },
          parseAs: 'blob',
        })
      : await api.GET('/api/assistant/all-conversations/{id}/files/{fileId}', {
          params: { path: { id: conversationId, fileId } },
          parseAs: 'blob',
        });
  // The document calls the file a binary string; with `parseAs: 'blob'` it is a Blob.
  const file: unknown = await answerOf(Promise.resolve(result));
  if (!(file instanceof Blob)) throw new ApiFailure('no_answer');
  save(file, fileNameOf(result.response.headers.get('Content-Disposition'), name));
}
