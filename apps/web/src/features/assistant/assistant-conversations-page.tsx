import type { AssistantAnyConversation } from '@sodiq/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useConfirm } from '@/components/confirm-dialog';
import { ListPage } from '@/components/list/list-page';
import { type Column, type Filter, type ListSearch } from '@/components/list/list-state';
import { PanelActions } from '@/components/list/panel-actions';
import { PageHeader } from '@/components/page-header';
import { ErrorState, LoadingOutline } from '@/components/states';
import { Button } from '@/components/ui/button';
import { formatMoment } from '@/lib/dates';
import {
  ALL_CONVERSATIONS_KEY,
  allConversationsQuery,
  anyConversationQuery,
  restoreConversation,
} from './assistant-api';
import { Messages } from './assistant-chat';

type State = 'active' | 'archived';

const stateOf = (row: AssistantAnyConversation): State => (row.archived ? 'archived' : 'active');

/**
 * Every conversation of the assistant, for the Super Admin (task 11.12; `02`, Assistant, Audit:
 * "the Super Admin sees all of them. 90 days after its last message a conversation is archived:
 * it leaves the person's list, and the Super Admin reads it and can restore it").
 */
export function AssistantConversationsPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const search = useSearch({ from: '/app/assistant-conversations' });
  const conversations = useQuery(allConversationsQuery());

  const columns = useMemo((): Column<AssistantAnyConversation>[] => {
    const personText = (row: AssistantAnyConversation) =>
      row.personName === '' ? t('audit.unnamed') : row.personName;
    return [
      {
        key: 'title',
        header: t('assistant.conversationsPage.titleColumn'),
        cell: (row) => <span className="line-clamp-2 max-w-prose">{row.title}</span>,
        searchText: (row) => row.title,
        opens: true,
      },
      {
        key: 'person',
        header: t('assistant.conversationsPage.person'),
        cell: personText,
        sortValue: personText,
        searchText: personText,
      },
      {
        key: 'role',
        header: t('assistant.conversationsPage.role'),
        cell: (row) => t(`roles.${row.role}`),
        sortValue: (row) => row.role,
      },
      {
        key: 'branch',
        header: t('assistant.conversationsPage.branch'),
        cell: (row) => row.branchName,
        sortValue: (row) => row.branchName,
        searchText: (row) => row.branchName,
      },
      {
        key: 'last',
        header: t('assistant.conversationsPage.lastActivity'),
        cell: (row) => formatMoment(i18n.language, row.lastActivityAt),
        sortValue: (row) => row.lastActivityAt,
      },
      {
        key: 'state',
        header: t('assistant.conversationsPage.state'),
        cell: (row) => t(`assistant.conversationsPage.state_${stateOf(row)}`),
        sortValue: stateOf,
      },
    ];
  }, [t, i18n.language]);

  const filters = useMemo(
    (): Filter<AssistantAnyConversation>[] => [
      {
        key: 'state',
        label: t('assistant.conversationsPage.state'),
        options: (['active', 'archived'] as const).map((state) => ({
          value: state,
          label: t(`assistant.conversationsPage.state_${state}`),
        })),
        matches: (row, value) => stateOf(row) === value,
      },
    ],
    [t],
  );

  const open = (next: ListSearch, how: 'push' | 'replace'): void => {
    void navigate({ to: '/assistant-conversations', search: next, replace: how === 'replace' });
  };

  return (
    <>
      <PageHeader
        title={t('assistant.conversationsPage.title')}
        breadcrumbs={[
          { label: t('home.title'), to: '/' },
          { label: t('setup.title'), to: '/setup' },
        ]}
      />
      <ListPage
        listId="assistant-conversations"
        caption={t('assistant.conversationsPage.title')}
        rows={conversations.data?.conversations}
        error={conversations.error ?? undefined}
        onRetry={() => {
          void conversations.refetch();
        }}
        rowId={(row) => row.id}
        rowName={(row) => row.title}
        columns={columns}
        filters={filters}
        search={search}
        onSearchChange={open}
        empty={{
          title: t('assistant.conversationsPage.emptyTitle'),
          text: t('assistant.conversationsPage.empty'),
        }}
        panel={(row) => <ConversationPanel key={row.id} row={row} />}
      />
    </>
  );
}

/** One conversation, read; Restore when it is archived. */
function ConversationPanel({ row }: { row: AssistantAnyConversation }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const detail = useQuery(anyConversationQuery(row.id));
  const restore = useMutation({
    mutationFn: async () => {
      const yes = await confirm({
        title: t('assistant.conversationsPage.restoreTitle'),
        text: t('assistant.conversationsPage.restoreText', { title: row.title }),
        action: t('assistant.conversationsPage.restore'),
      });
      if (!yes) return;
      await restoreConversation(row.id);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ALL_CONVERSATIONS_KEY });
    },
  });
  return (
    <div className="grid gap-4">
      {row.archived && (
        <PanelActions
          primary={
            <Button
              pending={restore.isPending}
              onClick={() => {
                restore.mutate();
              }}
            >
              {t('assistant.conversationsPage.restore')}
            </Button>
          }
          error={restore.error}
        />
      )}
      {detail.isError ? (
        <ErrorState
          error={detail.error}
          onRetry={() => {
            void detail.refetch();
          }}
        />
      ) : detail.data === undefined ? (
        <LoadingOutline />
      ) : (
        <Messages conversation={detail.data} readsAny />
      )}
    </div>
  );
}
