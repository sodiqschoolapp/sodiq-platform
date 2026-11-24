import { isAssistantRole, PERMISSIONS, permits, type AssistantRole } from '@sodiq/shared';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AddCommentIcon, ChevronLeftIcon } from '@/components/icons';
import { PageHeader } from '@/components/page-header';
import { ErrorState, LoadingOutline } from '@/components/states';
import { Button } from '@/components/ui/button';
import { PANEL } from '@/components/ui/control';
import { useView } from '@/features/access/use-view';
import { useMinWidth } from '@/lib/use-min-width';
import { AssistantChat } from './assistant-chat';
import { assistantConversationsQuery, assistantStatusQuery } from './assistant-api';

/** The address of the page: the open conversation, `new`, or none (the list, on a phone). */
export interface AssistantSearch {
  conversation?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function assistantSearch(search: Record<string, unknown>): AssistantSearch {
  const conversation = search.conversation;
  return typeof conversation === 'string' && (conversation === 'new' || UUID.test(conversation))
    ? { conversation }
    : {};
}

/**
 * The page Assistant (task 11.16; `02`, Assistant, Where: "The same conversations also open on a
 * page of their own, Assistant, in the menu of the three roles, with the person's conversations
 * listed beside the chat"). Opened by the role chosen in the switcher, as the button of the top bar
 * is (`.claude/rules/web.md`); no right of its own: the `assistant` view of the three roles. On a
 * phone the list and the chat are two steps, the open one named in the address.
 */
export function AssistantPage() {
  const { t } = useTranslation();
  const { role } = useView();
  const assistantRole: AssistantRole | null = role !== null && isAssistantRole(role) ? role : null;
  // The route lets in any assignment with the `assistant` view; the page follows the chosen role.
  if (assistantRole === null || !permits(PERMISSIONS, assistantRole, 'assistant', 'view')) {
    return (
      <>
        <PageHeader title={t('assistant.page.title')} />
        <p role="alert" className={PANEL}>
          {t('problems.noAccessPart')}
        </p>
      </>
    );
  }
  return <AssistantOfRole key={assistantRole} role={assistantRole} />;
}

function AssistantOfRole({ role }: { role: AssistantRole }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const search = useSearch({ from: '/app/assistant' });
  const status = useQuery(assistantStatusQuery(role, true));
  const conversations = useQuery(assistantConversationsQuery(true));
  // Kept here, so a question typed and not sent stays while another conversation is opened.
  const [text, setText] = useState('');
  // A phone: the list, then the chat, as two steps (`12`, Devices).
  const wide = useMinWidth(640);
  const open = search.conversation;
  const selected = open === undefined || open === 'new' ? null : open;
  const go = (conversation: string | undefined): void => {
    void navigate({
      to: '/assistant',
      search: conversation === undefined ? {} : { conversation },
    });
  };

  const header = <PageHeader title={t('assistant.page.title')} />;
  if (status.data?.refusal === 'assistant_off') {
    return (
      <>
        {header}
        <p className={PANEL}>{t('assistant.refusals.assistant_off')}</p>
      </>
    );
  }

  return (
    <>
      {header}
      <div className="grid gap-4 sm:grid-cols-[18rem_minmax(0,1fr)]">
        {(wide || open === undefined) && (
          <nav
            aria-label={t('assistant.conversations')}
            className={`${PANEL} grid content-start gap-3`}
          >
            <Button
              className="justify-self-start"
              onClick={() => {
                go('new');
              }}
            >
              <AddCommentIcon aria-hidden />
              {t('assistant.newConversation')}
            </Button>
            {conversations.isError ? (
              <ErrorState
                error={conversations.error}
                onRetry={() => {
                  void conversations.refetch();
                }}
              />
            ) : conversations.isPending ? (
              <LoadingOutline />
            ) : conversations.data.conversations.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('assistant.empty')}</p>
            ) : (
              <ul className="grid gap-1">
                {conversations.data.conversations.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      aria-current={item.id === selected ? 'true' : undefined}
                      className="w-full rounded-lg px-3 py-2 text-left hover:bg-accent aria-[current=true]:bg-accent"
                      onClick={() => {
                        go(item.id);
                      }}
                    >
                      <span className="block truncate font-semibold">{item.title}</span>
                      <span className="block text-sm text-muted-foreground">{item.branchName}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </nav>
        )}
        {(wide || open !== undefined) && (
          <section
            aria-label={t('assistant.title')}
            className="flex h-[calc(100dvh-12rem)] min-h-[24rem] flex-col rounded-xl bg-card"
          >
            {!wide && (
              <div className="border-b px-4 py-2">
                <Button
                  variant="ghost"
                  onClick={() => {
                    go(undefined);
                  }}
                >
                  <ChevronLeftIcon aria-hidden />
                  {t('assistant.page.back')}
                </Button>
              </div>
            )}
            <AssistantChat
              key={selected ?? 'new'}
              role={role}
              conversationId={selected}
              onConversation={(id) => {
                go(id);
              }}
              status={status.data}
              text={text}
              onTextChange={setText}
              top={
                status.isError ? (
                  <ErrorState
                    error={status.error}
                    onRetry={() => {
                      void status.refetch();
                    }}
                  />
                ) : undefined
              }
              empty={<p className="text-sm text-muted-foreground">{t('assistant.page.choose')}</p>}
            />
          </section>
        )}
      </div>
    </>
  );
}
