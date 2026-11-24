import type { AssistantProgress, AssistantReadGroup } from '@sodiq/shared';
import { queryOptions, type QueryClient } from '@tanstack/react-query';
import { ASSISTANT_KEY } from './assistant-api';

/**
 * What the tab heard of the question being answered in one conversation (task 11.16; `02`,
 * While it works: "The conversation shows what the assistant is reading as it reads it, and the
 * answer as it is written"). Kept in the query cache, never asked of the API: the live
 * connection fills it, and the conversation read again on `done` replaces it.
 */
export interface QuestionProgress {
  questionId: string;
  reads: { group: AssistantReadGroup | null; status: number }[];
  /** The answer's text so far. */
  text: string;
  /** The last piece of text taken; a piece that does not follow it is left for `done`. */
  seq: number;
}

export const progressKey = (conversationId: string) =>
  [...ASSISTANT_KEY, 'progress', conversationId] as const;

/** The progress of a conversation, read from the cache only. */
export const progressQuery = (conversationId: string | null) =>
  queryOptions<QuestionProgress | null>({
    queryKey: progressKey(conversationId ?? ''),
    queryFn: () => null,
    enabled: false,
    initialData: null,
    staleTime: Infinity,
  });

const empty = (questionId: string): QuestionProgress => ({
  questionId,
  reads: [],
  text: '',
  seq: 0,
});

/** One message of the live connection. */
export function applyProgress(queryClient: QueryClient, progress: AssistantProgress): void {
  const { conversationId, questionId, event } = progress;
  const key = progressKey(conversationId);
  const now = queryClient.getQueryData<QuestionProgress | null>(key);
  const current = now !== null && now !== undefined && now.questionId === questionId ? now : null;
  switch (event.kind) {
    case 'question':
      queryClient.setQueryData(key, empty(questionId));
      void readAgain(queryClient, conversationId);
      return;
    case 'read': {
      const base = current ?? empty(questionId);
      queryClient.setQueryData(key, {
        ...base,
        reads: [...base.reads, { group: event.group, status: event.status }],
      });
      return;
    }
    case 'text': {
      const base = current ?? empty(questionId);
      if (event.seq !== base.seq + 1) return;
      queryClient.setQueryData(key, { ...base, text: base.text + event.delta, seq: event.seq });
      return;
    }
    case 'reset':
      queryClient.setQueryData(key, { ...(current ?? empty(questionId)), text: '', seq: 0 });
      return;
    case 'done':
      void readAgain(queryClient, conversationId).then(() => {
        const after = queryClient.getQueryData<QuestionProgress | null>(key);
        if (after?.questionId === questionId) queryClient.setQueryData(key, null);
      });
      return;
  }
}

/** The conversation, the list and the status read again. */
async function readAgain(queryClient: QueryClient, conversationId: string): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: [...ASSISTANT_KEY, 'conversation', conversationId] }),
    queryClient.invalidateQueries({ queryKey: [...ASSISTANT_KEY, 'conversations'] }),
    queryClient.invalidateQueries({ queryKey: [...ASSISTANT_KEY, 'status'] }),
  ]);
}

/** At a (re)connection: every open conversation is read again; what was heard is dropped. */
export async function catchUpAssistant(queryClient: QueryClient): Promise<void> {
  queryClient.removeQueries({ queryKey: [...ASSISTANT_KEY, 'progress'] });
  await queryClient.invalidateQueries({ queryKey: [...ASSISTANT_KEY, 'conversation'] });
}
