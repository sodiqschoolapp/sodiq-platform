import {
  ASSISTANT_QUESTION_MAX_LENGTH,
  type AssistantConversation,
  type AssistantMessage,
  type AssistantRole,
  type AssistantStatus,
} from '@sodiq/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useRouter, type LinkProps } from '@tanstack/react-router';
import {
  useEffect,
  useState,
  type Dispatch,
  type FormEvent,
  type ReactNode,
  type SetStateAction,
} from 'react';
import { useTranslation } from 'react-i18next';
import { ApiFailure } from '@/api/failure';
import { FailureAlert } from '@/components/failure-alert';
import { SendIcon } from '@/components/icons';
import { ErrorState, LoadingOutline } from '@/components/states';
import { Button } from '@/components/ui/button';
import { FIELD } from '@/components/ui/control';
import { BUILT_PAGES } from '@/features/access/menu-pages';
import { useView } from '@/features/access/use-view';
import { appNow } from '@/lib/app-now';
import { schoolDateText } from '@/lib/dates';
import { languageOf } from '@/i18n/i18n';
import { AnswerText } from './answer-text';
import {
  ASSISTANT_KEY,
  askAssistant,
  assistantConversationQuery,
  decideProposal,
} from './assistant-api';
import { placeOf } from './assistant-place';
import { progressQuery, type QuestionProgress } from './assistant-progress';
import { ProposalCard } from './proposal-card';

/** The refusals the chat says in a line of its own (`02`, Limits; task 11.16). */
const REFUSALS = [
  'assistant_off',
  'assistant_daily_limit',
  'assistant_cap_reached',
  'assistant_model_unavailable',
  // Task 11.15: busy or no answer in time, apart from "cannot reach its model".
  'assistant_model_busy',
  // Task 11.16: a question of the person is still being answered.
  'assistant_question_running',
] as const;

type Refusal = (typeof REFUSALS)[number];

/** The refusal of a limit or of the model that a failed question answered, or `null`. */
function refusalOf(error: unknown): Refusal | null {
  if (!(error instanceof ApiFailure)) return null;
  return REFUSALS.find((code) => code === error.code) ?? null;
}

/**
 * The question being answered, while its window lasts on the tab's clock (task 11.16): past
 * `until` the server writes nothing more for it, so the tab stops showing it as working by itself,
 * with a timer of the display only, never a call (`.claude/rules/web.md`).
 */
function useWorking(conversation: AssistantConversation | undefined) {
  const working = conversation?.working ?? null;
  const until = working === null ? null : Date.parse(working.until);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (until === null) return;
    const left = until - appNow().getTime();
    if (left <= 0) return;
    const timer = setTimeout(() => {
      setTick((tick) => tick + 1);
    }, left + 50);
    return () => {
      clearTimeout(timer);
    };
  }, [until]);
  return working !== null && until !== null && until > appNow().getTime() ? working : null;
}

interface ChatProps {
  role: AssistantRole;
  /** The open conversation, or `null` for a new one. */
  conversationId: string | null;
  onConversation: (id: string) => void;
  status: AssistantStatus | undefined;
  /** The question typed and not sent, kept by the part that holds the chat (`12`, No lost work). */
  text: string;
  onTextChange: Dispatch<SetStateAction<string>>;
  /** What shows in place of a conversation when none is open (the list, or a line). */
  empty: ReactNode;
  /** Shown above the conversation (the status's failure). */
  top?: ReactNode;
  /**
   * Task 11.19: the panel sends the page it is beside with each question; the Assistant page,
   * which is beside no page, sends none.
   */
  withPlace?: boolean;
}

/**
 * The chat of the assistant (task 11.16): the messages and proposals of one conversation, what
 * the assistant reads and writes while it works, and the question. The panel and the Assistant
 * page draw the same chat, so both show the same messages (`edge/people-roles-accounts`, "… or in
 * two tabs").
 */
export function AssistantChat({
  role,
  conversationId,
  onConversation,
  status,
  text,
  onTextChange: setText,
  empty,
  top,
  withPlace = false,
}: ChatProps) {
  const { t } = useTranslation();
  const { branchId } = useView();
  const queryClient = useQueryClient();
  const conversation = useQuery(assistantConversationQuery(conversationId));
  const progress = useQuery(progressQuery(conversationId)).data ?? null;
  // The question sent and not yet taken by the server: shown at once (`02`, While it works).
  const [sent, setSent] = useState<string | null>(null);

  const router = useRouter();
  const ask = useMutation({
    mutationFn: (question: string) => {
      const place = withPlace ? placeOf(router.state.matches.at(-1)) : undefined;
      return askAssistant({
        role,
        text: question,
        ...(conversationId === null ? {} : { conversationId }),
        ...(place === undefined ? {} : { place }),
      });
    },
    onMutate: (question) => {
      setSent(question);
      setText('');
    },
    onSuccess: (answer) => {
      setSent(null);
      queryClient.setQueryData(
        assistantConversationQuery(answer.conversation.id).queryKey,
        answer.conversation,
      );
      // The work began at the commit of the question: its `done` may have come before this answer
      // (a new conversation's id was not known then), so the conversation is read again (code
      // review, must fix 2).
      void queryClient.invalidateQueries({
        queryKey: assistantConversationQuery(answer.conversation.id).queryKey,
      });
      onConversation(answer.conversation.id);
    },
    onError: (_error, question) => {
      setSent(null);
      // Refused: the question goes back into the box, unless something new was typed meanwhile.
      setText((now) => (now === '' ? question : now));
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: [...ASSISTANT_KEY, 'status'] });
      await queryClient.invalidateQueries({ queryKey: [...ASSISTANT_KEY, 'conversations'] });
    },
  });

  // Task 11.13: Confirm or Decline; the answer is the conversation with each step's outcome.
  const decide = useMutation({
    mutationFn: (input: { id: string; which: 'confirm' | 'decline' }) =>
      decideProposal({ ...input, role }),
    onSuccess: (answer) => {
      queryClient.setQueryData(assistantConversationQuery(answer.id).queryKey, answer);
    },
    onError: async () => {
      // An expired, decided or superseded proposal: read the conversation again.
      await queryClient.invalidateQueries({ queryKey: [...ASSISTANT_KEY, 'conversation'] });
    },
  });

  const open = conversationId === null ? undefined : conversation.data;
  const working = useWorking(open);
  // A conversation of another branch or role is read only: a question runs in this tab's
  // branch and role (plan decision 9 of 11.12).
  const readOnly = open !== undefined && (open.branchId !== branchId || open.role !== role);
  const refusedBy = refusalOf(ask.error);
  const refusal = refusedBy ?? status?.refusal ?? null;
  const busy = ask.isPending || sent !== null || working !== null;

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const question = text.trim();
    if (question === '' || busy) return;
    ask.reset();
    ask.mutate(question);
  };

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-4 max-sm:px-4">
        {top}
        {conversationId === null && sent === null ? (
          empty
        ) : conversationId !== null && conversation.isError ? (
          <ErrorState
            error={conversation.error}
            onRetry={() => {
              void conversation.refetch();
            }}
          />
        ) : conversationId !== null && open === undefined ? (
          <LoadingOutline />
        ) : (
          <>
            {open !== undefined && (
              <Messages
                conversation={open}
                workingId={working?.questionId ?? null}
                deciding={decide.isPending}
                {...(readOnly
                  ? {}
                  : {
                      onDecide: (id: string, which: 'confirm' | 'decline') => {
                        decide.mutate({ id, which });
                      },
                    })}
              />
            )}
            {sent !== null && (
              <p className="ml-8 rounded-lg bg-accent px-3 py-2 break-words whitespace-pre-wrap">
                {sent}
              </p>
            )}
            {(sent !== null || working !== null) && (
              <Working
                progress={
                  working !== null && progress?.questionId === working.questionId ? progress : null
                }
              />
            )}
            {decide.error !== null && <FailureAlert error={decide.error} />}
          </>
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
              aria-label={
                ask.isPending
                  ? t('assistant.sending')
                  : busy
                    ? t('assistant.working')
                    : t('assistant.send')
              }
              pending={busy}
              disabled={text.trim() === '' || (status !== undefined && !status.available)}
            >
              {!busy && <SendIcon aria-hidden />}
            </Button>
          </form>
        )}
        {ask.error !== null && refusedBy === null && <FailureAlert error={ask.error} />}
      </footer>
    </>
  );
}

/**
 * What the assistant does now (task 11.16; `02`, While it works): each read as it happens and the
 * answer as it is written, drawn as the stored answer is (`AnswerText`: never HTML).
 */
function Working({ progress }: { progress: QuestionProgress | null }) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-2" data-assistant-working="">
      {progress?.reads.map((read, index) => (
        <p key={index} className="text-sm text-muted-foreground">
          {read.group === null
            ? t('assistant.readRefused')
            : t('assistant.reading', { what: t(`assistant.groups.${read.group}`) })}
        </p>
      ))}
      {progress !== null && progress.text !== '' && <AnswerText text={progress.text} />}
      <p role="status" className="text-sm text-muted-foreground">
        {t('assistant.working')}
      </p>
    </div>
  );
}

/**
 * The messages of a conversation, as plain text (plan decision 14 of 11.12): never HTML or
 * Markdown. Task 11.13: a proposal follows the answer to the question it came with; `onDecide`
 * gives its Confirm and Decline (left out where the conversation is only read). Task 11.16: a
 * question that got no answer, and is not the one being answered, says so.
 */
export function Messages({
  conversation,
  onDecide,
  deciding,
  workingId = null,
}: {
  conversation: AssistantConversation;
  onDecide?: (proposalId: string, which: 'confirm' | 'decline') => void;
  deciding?: boolean;
  workingId?: string | null;
}) {
  const { t } = useTranslation();
  // The question each answer follows, so that its proposal is drawn after it.
  const askedBefore = new Map<string, string>();
  // The questions with no answer and no notice before the next question.
  const unanswered = new Set<string>();
  let open: string | null = null;
  for (const [index, message] of conversation.messages.entries()) {
    if (message.kind === 'answer') {
      const question = conversation.messages
        .slice(0, index)
        .findLast((earlier) => earlier.kind === 'question');
      if (question !== undefined) askedBefore.set(message.id, question.id);
    }
    if (message.kind === 'question') {
      if (open !== null) unanswered.add(open);
      open = message.id;
    } else if (message.kind === 'answer' || message.kind === 'notice') {
      open = null;
    }
  }
  if (open !== null && open !== workingId) unanswered.add(open);
  const noAnswer = (key: string) => (
    <li key={key} className="text-sm text-muted-foreground" data-assistant-no-answer="">
      {t('assistant.noAnswer')}
    </li>
  );
  // A question with no answer says so before the next question, or at the end.
  const items: ReactNode[] = [];
  let waiting: string | null = null;
  for (const message of conversation.messages) {
    if (message.kind === 'question') {
      if (waiting !== null) items.push(noAnswer(`no-answer-${waiting}`));
      waiting = unanswered.has(message.id) ? message.id : null;
    }
    const asked = askedBefore.get(message.id);
    const proposals =
      asked === undefined
        ? []
        : conversation.proposals.filter((proposal) => proposal.questionId === asked);
    items.push(
      <li key={message.id}>
        <MessageView message={message} />
      </li>,
      ...proposals.map((proposal) => (
        <li key={proposal.id}>
          <ProposalCard
            proposal={proposal}
            {...(onDecide === undefined
              ? {}
              : {
                  onDecide: (which: 'confirm' | 'decline') => {
                    onDecide(proposal.id, which);
                  },
                  deciding: deciding === true,
                })}
          />
        </li>
      )),
    );
  }
  if (waiting !== null) items.push(noAnswer(`no-answer-${waiting}`));
  return (
    <ol aria-label={conversation.title} className="grid gap-3">
      {items}
      {conversation.messages.length === 0 && (
        <li className="text-sm text-muted-foreground">{t('assistant.empty')}</li>
      )}
    </ol>
  );
}

function MessageView({ message }: { message: AssistantMessage }) {
  const { t, i18n } = useTranslation();
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
          <AnswerText text={message.text} />
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
          {message.links.length > 0 && (
            <ul className="flex flex-wrap gap-x-4 gap-y-1">
              {message.links.map((link) => (
                <li key={JSON.stringify([link.nodeId, link.params, link.search])}>
                  <Link
                    // The server stores only a link that `link_place` checked against the map of
                    // the platform, which is generated from this router's own routes, so its
                    // template, parameters and search values are the route's own.
                    {...({ to: link.to, params: link.params, search: link.search } as LinkProps)}
                    className="text-link font-semibold hover:underline"
                    data-place={link.to}
                  >
                    {link.label[languageOf(i18n)]}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {message.lessons.length > 0 && (
            <ul className="flex flex-wrap gap-x-4 gap-y-1">
              {message.lessons.map((lesson) => (
                <li key={`${lesson.journalId}:${lesson.date}`}>
                  <Link
                    to="/journal/$journalId"
                    params={{ journalId: lesson.journalId }}
                    search={{ quarter: lesson.quarterId, date: lesson.date }}
                    className="text-link font-semibold hover:underline"
                  >
                    {t('assistant.openLessonJournal', {
                      date: schoolDateText(lesson.date, i18n.language),
                    })}
                  </Link>
                </li>
              ))}
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
