import {
  isAssistantRole,
  PERMISSIONS,
  permits,
  type AssistantRole,
  type AssistantStatus,
} from '@sodiq/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { AddCommentIcon, ChatIcon, CloseIcon, FullscreenIcon } from '@/components/icons';
import { ErrorState, LoadingOutline } from '@/components/states';
import { Button, buttonVariants } from '@/components/ui/button';
import { SECTION_TITLE } from '@/components/ui/control';
import { useMayView, useView } from '@/features/access/use-view';
import { AssistantChat } from './assistant-chat';
import { assistantConversationsQuery, assistantStatusQuery } from './assistant-api';

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
  // The role chosen in the switcher, not any assignment: a Super Admin who is also a Teacher sees
  // no assistant while the Teacher role is chosen (`02`: "A person whose chosen role is another
  // role does not see it").
  const mayOpen =
    useMayView('assistant') &&
    assistantRole !== null &&
    permits(PERMISSIONS, assistantRole, 'assistant', 'view');
  const status = useQuery(assistantStatusQuery(assistantRole ?? 'super_admin', mayOpen));
  const [open, setOpen] = useState(false);
  // Kept here, so a question typed and not sent stays while the panel is closed (`12`, No lost work).
  const [text, setText] = useState('');
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
            text={text}
            onTextChange={setText}
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
  text: string;
  onTextChange: Dispatch<SetStateAction<string>>;
}

/**
 * The chat panel: the own conversations, the open one, and the question. Task 11.16: the chat is
 * the one the Assistant page draws, and the header links to that page.
 */
export function AssistantPanel({
  role,
  status,
  statusError,
  onRetryStatus,
  onClose,
  text,
  onTextChange,
}: PanelProps) {
  const { t } = useTranslation();
  const heading = useRef<HTMLHeadingElement>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const conversations = useQuery(assistantConversationsQuery(true));

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
        <Link
          to="/assistant"
          search={conversationId === null ? {} : { conversation: conversationId }}
          className={`${buttonVariants({ variant: 'ghost', size: 'icon' })} max-sm:size-11`}
          aria-label={t('assistant.openPage')}
          onClick={onClose}
        >
          <FullscreenIcon aria-hidden />
        </Link>
        <Button
          variant="ghost"
          size="icon"
          className="max-sm:size-11"
          aria-label={t('assistant.newConversation')}
          onClick={() => {
            setConversationId(null);
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
      <AssistantChat
        key={conversationId ?? 'new'}
        role={role}
        conversationId={conversationId}
        onConversation={setConversationId}
        status={status}
        text={text}
        onTextChange={onTextChange}
        withPlace
        top={
          statusError !== null && statusError !== undefined ? (
            <ErrorState error={statusError} onRetry={onRetryStatus} />
          ) : undefined
        }
        empty={
          <ConversationList
            loading={conversations.isPending}
            error={conversations.error}
            onRetry={() => {
              void conversations.refetch();
            }}
            items={conversations.data?.conversations ?? []}
            onOpen={setConversationId}
          />
        }
      />
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

export { Messages } from './assistant-chat';
