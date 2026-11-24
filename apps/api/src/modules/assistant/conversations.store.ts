import {
  ASSISTANT_ANSWER_WINDOW_MS,
  ASSISTANT_ARCHIVE_DAYS,
  assistantMessageSchema,
  type AssistantConversation,
  type AssistantConversationSummary,
  type AssistantLessonLink,
  type AssistantMessage,
  type AssistantNotice,
  type AssistantReadGroup,
  type AssistantRole,
  type MenuItem,
} from '@sodiq/shared';
import { sql } from 'kysely';
import type { JsonValue } from '../../database/types.generated.js';
import type { Transaction } from '../../database/transactions.js';
import { accountNames } from '../timetable/edit-lock.js';
import { proposalsOf } from './proposal-views.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** The content of each kind of message as stored in `assistant_messages.content` (0178). */
export type StoredContent =
  | { kind: 'question'; text: string }
  | { kind: 'answer'; text: string; pages: MenuItem[]; lessons?: AssistantLessonLink[] }
  | {
      kind: 'read';
      tool: string;
      /** `null`: not on the list, or not sent; then `fault` says why. */
      route: string | null;
      group: AssistantReadGroup | null;
      args: Record<string, unknown>;
      status: number;
      fault?: string;
      /** What the model was given: the filtered result, cut to its bound. */
      result: unknown;
    }
  | { kind: 'notice'; code: AssistantNotice };

export interface ConversationRow {
  id: string;
  branchId: string;
  accountId: string;
  role: AssistantRole;
  title: string;
  createdAt: Date;
}

export interface MessageRow {
  id: string;
  seq: number;
  createdAt: Date;
  content: StoredContent;
}

/**
 * The moment a conversation's last activity was: its last message or its last restore
 * (plan decision 8). Archived when that moment and 90 days are not after now. Read each time,
 * never stored, and no job flips it (`CLAUDE.md`, State from stored moments).
 */
export function archivesAt(lastActivity: Date): Date {
  return new Date(lastActivity.getTime() + ASSISTANT_ARCHIVE_DAYS * DAY_MS);
}

export function isArchived(lastActivity: Date, now: Date): boolean {
  return archivesAt(lastActivity).getTime() <= now.getTime();
}

/** The conversations of the transaction's branches, with their last activity. */
export function conversationsQuery(transaction: Transaction) {
  return transaction
    .selectFrom('assistant_conversations as c')
    .innerJoin('branches as b', 'b.id', 'c.branch_id')
    .select([
      'c.id',
      'c.branch_id',
      'c.account_id',
      'c.role',
      'c.title',
      'c.created_at',
      'b.name as branch_name',
      sql<Date>`greatest(
        c.created_at,
        (select max(m.created_at) from assistant_messages m where m.conversation_id = c.id),
        (select max(r.restored_at) from assistant_conversation_restores r where r.conversation_id = c.id)
      )`.as('last_activity_at'),
    ]);
}

export type ConversationListRow = Awaited<
  ReturnType<ReturnType<typeof conversationsQuery>['execute']>
>[number];

export function summaryOf(row: ConversationListRow): AssistantConversationSummary {
  return {
    id: row.id,
    branchId: row.branch_id,
    branchName: row.branch_name,
    role: row.role as AssistantRole,
    title: row.title,
    createdAt: new Date(row.created_at).toISOString(),
    lastActivityAt: new Date(row.last_activity_at).toISOString(),
  };
}

/** The messages of a conversation in order. */
export async function messagesOf(
  transaction: Transaction,
  conversationId: string,
): Promise<MessageRow[]> {
  const rows = await transaction
    .selectFrom('assistant_messages')
    .select(['id', 'seq', 'created_at', 'content'])
    .where('conversation_id', '=', conversationId)
    .orderBy('seq')
    .execute();
  return rows.map((row) => ({
    id: row.id,
    seq: row.seq,
    createdAt: new Date(row.created_at),
    content: row.content as unknown as StoredContent,
  }));
}

/** A message as the person and the Super Admin read it: never the filtered result of a read. */
export function messageOf(row: MessageRow): AssistantMessage {
  const base = { id: row.id, seq: row.seq, at: row.createdAt.toISOString() };
  const content = row.content;
  switch (content.kind) {
    case 'question':
      return { ...base, kind: 'question', text: content.text };
    case 'answer':
      return {
        ...base,
        kind: 'answer',
        text: content.text,
        pages: content.pages,
        lessons: content.lessons ?? [],
      };
    case 'read':
      return assistantMessageSchema.parse({
        ...base,
        kind: 'read',
        group: content.group,
        status: content.status,
      });
    case 'notice':
      return { ...base, kind: 'notice', code: content.code };
  }
}

export async function conversationOf(
  transaction: Transaction,
  row: ConversationListRow,
  now: Date,
): Promise<AssistantConversation> {
  const last = new Date(row.last_activity_at);
  const messages = await messagesOf(transaction, row.id);
  return {
    ...summaryOf(row),
    archived: isArchived(last, now),
    archivesAt: archivesAt(last).toISOString(),
    messages: messages.map(messageOf),
    proposals: await proposalsOf(transaction, row.id, now),
    working: workingOf(messages, now),
  };
}

/**
 * The question being answered now (task 11.16): the last question with no answer and no notice
 * after it, while its answer window lasts, read from its stored moment (`CLAUDE.md`, State from
 * stored moments); the same rule as `assistant_question_running` of 0181.
 */
export function workingOf(
  messages: readonly MessageRow[],
  now: Date,
): AssistantConversation['working'] {
  let question: MessageRow | undefined;
  for (const message of messages) {
    if (message.content.kind === 'question') question = message;
    else if (message.content.kind === 'answer' || message.content.kind === 'notice') {
      question = undefined;
    }
  }
  if (question === undefined) return null;
  const until = new Date(question.createdAt.getTime() + ASSISTANT_ANSWER_WINDOW_MS);
  if (until.getTime() <= now.getTime()) return null;
  return {
    questionId: question.id,
    askedAt: question.createdAt.toISOString(),
    until: until.toISOString(),
  };
}

/** The name of each account, "last first", as the audit log names its actors. */
export async function personNames(
  transaction: Transaction,
  accountIds: readonly string[],
): Promise<Map<string, string>> {
  return accountNames(transaction, [...new Set(accountIds)]);
}

/**
 * Appends a message to a conversation: the conversation is held by an advisory lock of its id
 * first, then the next `seq` is read (plan review, should fix 7), so two writers never take the
 * same number.
 */
export async function appendMessage(
  transaction: Transaction,
  conversation: { id: string; branchId: string; accountId: string },
  content: StoredContent,
  now: Date,
): Promise<string> {
  await sql`select pg_advisory_xact_lock(hashtextextended(${`assistant_conversation:${conversation.id}`}, 0))`.execute(
    transaction,
  );
  const last = await transaction
    .selectFrom('assistant_messages')
    .select((eb) => eb.fn.max('seq').as('seq'))
    .where('conversation_id', '=', conversation.id)
    .executeTakeFirst();
  const inserted = await transaction
    .insertInto('assistant_messages')
    .values({
      conversation_id: conversation.id,
      branch_id: conversation.branchId,
      account_id: conversation.accountId,
      seq: (last?.seq ?? 0) + 1,
      kind: content.kind,
      content: sql<JsonValue>`${JSON.stringify(content)}::jsonb`,
      created_at: now,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return inserted.id;
}
