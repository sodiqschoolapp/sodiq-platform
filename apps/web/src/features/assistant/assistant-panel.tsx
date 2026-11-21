import {
  ASSISTANT_QUESTION_MAX_LENGTH,
  isAssistantRole,
  type AssistantConversation,
  type AssistantMessage,
  type AssistantRole,
  type AssistantStatus,
} from '@sodiq/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { ApiFailure } from '@/api/failure';
import { FailureAlert } from '@/components/failure-alert';
import { AddCommentIcon, ChatIcon, CloseIcon, SendIcon } from '@/components/icons';
import { ErrorState, LoadingOutline } from '@/components/states';
import { Button } from '@/components/ui/button';
import { FIELD, SECTION_TITLE } from '@/components/ui/control';
import { BUILT_PAGES } from '@/features/access/menu-pages';
import { useMayView, useView } from '@/features/access/use-view';
import {
  ASSISTANT_KEY,
  askAssistant,
  assistantConversationQuery,
  assistantConversationsQuery,
  assistantStatusQuery,
} from './assistant-api';

/** The refusals the panel says in a line of its own (`02`, Limits). */
const REFUSALS = [
  'assistant_off',
  'assistant_daily_limit',
  'assistant_cap_reached',
  'assistant_model_unavailable',
] as const;

type Refusal = (typeof REFUSALS)[number];

/** The refusal of a limit or of the model that a failed question answered, or `null`. */
function refusalOf(error: unknown): Refusal | null {
  if (!(error instanceof ApiFailure)) return null;
  return REFUSALS.find((code) => code === error.code) ?? null;
}

/**
 * The assistant's button in the top bar (task 11.12; `02`, Assistant: "A button in the top bar
 * opens a chat panel beside the page; on a phone it fills the screen"). Shown only while the
 * role chosen in the role switcher is one the table gives the panel and the assistant is not
 * switched off for it; the server decides every question all the same.
 */
export function AssistantButton() {
  const { t } = useTranslation();
  const { role } = useView();
  const assistantRole: AssistantRole | null = role !== null && isAssistantRole(role) ? role : null;
  const mayOpen = useMayView('assistant') && assistantRole !== null;
  const status = useQuery(assistantStatusQuery(assistantRole ?? 'super_admin', mayOpen));
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);

  if (!mayOpen || assistantRole === null) return null;
  // Switched off: nothing in the top bar (`02`: "A person whose chosen role is another role does
  // not see it"; it is off until switched on). Loading: nothing yet; a failure shows the button,
  // and the panel says what failed.
  if (status.data?.refusal === 'assistant_off' || status.isPending) return null;

  return (
    <>
      <Button
        ref={button}
        variant="ghost"
        size="icon"
        className="max-sm:size-11"
        aria-label={t('assistant.open')}
        aria-expanded={open}
        onClick={() => {
          setOpen((now) => !now);
        }}
      >
        <ChatIcon aria-hidden />
      </Button>
      {open &&
        createPortal(
          <AssistantPanel
            role={assistantRole}
            status={status.data}
            statusError={status.error}
            onRetryStatus={() => {
              void status.refetch();
            }}
            onClose={() => {
              setOpen(false);
              button.current?.focus();
            }}
          />,
          document.body,
        )}
    </>
  );
}

interface PanelProps {
  role: AssistantRole;
  status: AssistantStatus | undefined;
  statusError: unknown;
  onRetryStatus: () => void;
  onClose: () => void;
}

/** The chat panel: the own conversations, the open one, and the question. */
export function AssistantPanel({ role, status, statusError, onRetryStatus, onClose }: PanelProps) {
  const { t } = useTranslation();
  const { branchId } = useView();
  const queryClient = useQueryClient();
  const heading = useRef<HTMLHeadingElement>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [text, setText] = useState('');
  const conversations = useQuery(assistantConversationsQuery(true));
  const conversation = useQuery(assistantConversationQuery(conversationId));

  useEffect(() => {
    heading.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !event.defaultPrevented) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const ask = useMutation({
    mutationFn: (question: string) =>
      askAssistant({
        role,
        text: question,
        ...(conversationId === null ? {} : { conversationId }),
      }),
    onSuccess: (answer) => {
      // The typed question is cleared only once the server took it (`12`, No lost work).
      setText('');
      setConversationId(answer.conversation.id);
      queryClient.setQueryData(
        assistantConversationQuery(answer.conversation.id).queryKey,
        answer.conversation,
      );
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: [...ASSISTANT_KEY, 'status'] });
      await queryClient.invalidateQueries({ queryKey: [...ASSISTANT_KEY, 'conversations'] });
    },
  });

  const open = conversation.data;
  // A conversation of another branch or role is read only: a question runs in this tab's
  // branch and role (plan decision 9).
  const readOnly = open !== undefined && (open.branchId !== branchId || open.role !== role);
  const refusedBy = refusalOf(ask.error);
  const refusal = refusedBy ?? status?.refusal ?? null;

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const question = text.trim();
    if (question === '' || ask.isPending) return;
    ask.mutate(question);
  };

  return (
    <aside
      aria-labelledby="assistant-title"
      data-print="hide"
      className="fixed inset-y-0 right-0 z-40 flex w-[26rem] flex-col border-l bg-card shadow-float max-sm:w-full max-sm:border-l-0"
    >
      <header className="flex items-center gap-2 border-b px-6 py-3 max-sm:px-4">
        <h2 id="assistant-title" ref={heading} tabIndex={-1} className={`${SECTION_TITLE} mr-auto`}>
          {t('assistant.title')}
        </h2>
        <Button
          variant="ghost"
          size="icon"
          className="max-sm:size-11"
          aria-label={t('assistant.newConversation')}
          onClick={() => {
            setConversationId(null);
            ask.reset();
          }}
        >
          <AddCommentIcon aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="max-sm:size-11"
          aria-label={t('assistant.close')}
          onClick={onClose}
        >
          <CloseIcon aria-hidden />
        </Button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-4 max-sm:px-4">
        {statusError !== null && statusError !== undefined && (
          <ErrorState error={statusError} onRetry={onRetryStatus} />
        )}
        {conversationId === null ? (
          <ConversationList
            loading={conversations.isPending}
            error={conversations.error}
            onRetry={() => {
              void conversations.refetch();
            }}
            items={conversations.data?.conversations ?? []}
            onOpen={(id) => {
              setConversationId(id);
              ask.reset();
            }}
          />
        ) : conversation.isError ? (
          <ErrorState
            error={conversation.error}
            onRetry={() => {
              void conversation.refetch();
            }}
          />
        ) : open === undefined ? (
          <LoadingOutline />
        ) : (
          <Messages conversation={open} />
        )}
      </div>
      <footer className="grid gap-2 border-t px-6 py-3 max-sm:px-4">
        {refusal !== null && (
          <p role="status" className="text-sm text-muted-foreground">
            {t(`assistant.refusals.${refusal}`)}
          </p>
        )}
        {readOnly ? (
          <p className="text-sm text-muted-foreground">{t('assistant.readOnly')}</p>
        ) : (
          <form className="flex items-end gap-2" onSubmit={submit}>
            <label className="sr-only" htmlFor="assistant-question">
              {t('assistant.question')}
            </label>
            <textarea
              id="assistant-question"
              className={`${FIELD} h-auto min-h-10 resize-none py-2`}
              rows={2}
              maxLength={ASSISTANT_QUESTION_MAX_LENGTH}
              value={text}
              placeholder={t('assistant.placeholder')}
              onChange={(event) => {
                setText(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) submit(event);
              }}
            />
            <Button
              type="submit"
              size="icon"
              className="max-sm:size-11"
              aria-label={ask.isPending ? t('assistant.sending') : t('assistant.send')}
              pending={ask.isPending}
              disabled={text.trim() === '' || (status !== undefined && !status.available)}
            >
              {!ask.isPending && <SendIcon aria-hidden />}
            </Button>
          </form>
        )}
        {ask.error !== null && refusedBy === null && <FailureAlert error={ask.error} />}
      </footer>
    </aside>
  );
}

function ConversationList({
  loading,
  error,
  onRetry,
  items,
  onOpen,
}: {
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  items: readonly { id: string; title: string; branchName: string }[];
  onOpen: (id: string) => void;
}) {
  const { t } = useTranslation();
  if (error !== null && error !== undefined) return <ErrorState error={error} onRetry={onRetry} />;
  if (loading) return <LoadingOutline />;
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('assistant.empty')}</p>;
  }
  return (
    <nav aria-label={t('assistant.conversations')}>
      <ul className="grid gap-1">
        {items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              className="w-full rounded-lg px-3 py-2 text-left hover:bg-accent"
              onClick={() => {
                onOpen(item.id);
              }}
            >
              <span className="block truncate font-semibold">{item.title}</span>
              <span className="block text-sm text-muted-foreground">{item.branchName}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** The messages of a conversation, as plain text (plan decision 14): never HTML or Markdown. */
export function Messages({ conversation }: { conversation: AssistantConversation }) {
  const { t } = useTranslation();
  return (
    <ol aria-label={conversation.title} className="grid gap-3">
      {conversation.messages.map((message) => (
        <li key={message.id}>
          <MessageView message={message} />
        </li>
      ))}
      {conversation.messages.length === 0 && (
        <li className="text-sm text-muted-foreground">{t('assistant.empty')}</li>
      )}
    </ol>
  );
}

function MessageView({ message }: { message: AssistantMessage }) {
  const { t } = useTranslation();
  switch (message.kind) {
    case 'question':
      return (
        <p className="ml-8 rounded-lg bg-accent px-3 py-2 break-words whitespace-pre-wrap">
          {message.text}
        </p>
      );
    case 'answer':
      return (
        <div className="grid gap-2">
          <p className="break-words whitespace-pre-wrap">{message.text}</p>
          {message.pages.length > 0 && (
            <ul className="flex flex-wrap gap-x-4 gap-y-1">
              {message.pages.map((page) => {
                const built = BUILT_PAGES[page];
                return built === undefined ? null : (
                  <li key={page}>
                    <Link to={built.to} className="text-link font-semibold hover:underline">
                      {t(built.titleKey)}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      );
    case 'read':
      return (
        <p className="text-sm text-muted-foreground">
          {message.group === null
            ? t('assistant.readRefused')
            : message.status >= 400 || message.status === 0
              ? t('assistant.readFailed', { what: t(`assistant.groups.${message.group}`) })
              : t('assistant.read', { what: t(`assistant.groups.${message.group}`) })}
        </p>
      );
    case 'notice':
      return (
        <p className="text-sm text-muted-foreground">{t(`assistant.refusals.${message.code}`)}</p>
      );
  }
}
