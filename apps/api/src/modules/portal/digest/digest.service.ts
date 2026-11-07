import { Inject, Injectable, Logger } from '@nestjs/common';
import { dailyAttendance } from '@sodiq/calc';
import {
  DIGEST_TEXTS,
  DIGEST_TIME_ZONE,
  MINI_APP_PATH,
  classDisplayName,
  digestFrequencySchema,
  isLanguage,
  schoolDateOf,
  type DigestSettings,
  type Language,
} from '@sodiq/shared';
import { sql } from 'kysely';
import { z } from 'zod';
import { CONFIG } from '../../../config/config.module.js';
import type { AppConfig } from '../../../config/config.js';
import {
  transactionMoment,
  Transactions,
  type Transaction,
} from '../../../database/transactions.js';
import { defineJob } from '../../../jobs/job-definition.js';
import { Jobs } from '../../../jobs/jobs.service.js';
import { StudentResultsService } from '../../results/student-results.service.js';
import { childSpans } from '../portal-scope.js';
import { TelegramBot } from '../telegram/bot-api.js';
import {
  digestText,
  splitText,
  type AttendanceSummary,
  type ChildPart,
  type ListedComment,
  type ListedMark,
  type ListedScore,
  type ListedState,
} from './digest-message.js';
import {
  journalEntriesOf,
  type DigestEntryKind,
  type JournalEntry,
  type SubjectNames,
} from './digest-read.js';
import {
  DIGEST_ATTEMPTS,
  DIGEST_OVERLAP_MS,
  dueToday,
  quietAt,
  retryMinutes,
} from './digest-schedule.js';

/**
 * Task 11.5 (pull request #299): the parents' digest (`10`, The parents' digest).
 *
 * `digest.tick`, every minute by pg-boss's cron, with no branch: each Parent account with an open
 * Telegram link whose day it is and whose time has passed (Tashkent, the injected clock) gets
 * its digest row of the date, and `digest.send` is enqueued in the same transaction; a row still
 * `due` whose next try has come is enqueued again, outside the quiet hours only. The tick is the
 * retry: a delivery of a job that runs with no transaction is claimed once (plan decision 14).
 */
export const digestTickJob = defineJob({
  name: 'digest.tick',
  data: z.strictObject({}),
  transaction: 'none',
  cron: '* * * * *',
});

/**
 * `digest.send`: everything read at the moment of sending (plan decision 18), the scope read
 * again in the transaction of the send. No branch: the digest tables are school-wide; the
 * journal is read in transactions of each child's branches (decision 11).
 */
export const digestSendJob = defineJob({
  name: 'digest.send',
  data: z.strictObject({ digestId: z.uuid() }),
  transaction: 'none',
  options: { retryLimit: 0 },
});

export const DIGEST_JOBS = [digestTickJob, digestSendJob];

/** A child the digest may name (`digest_children`, 0161). */
interface DigestChild {
  readonly studentId: string;
  readonly firstName: string;
  readonly className: string | null;
}

/** The value last sent for an entry (`digest_entries`). */
interface SentEntry {
  readonly kind: DigestEntryKind;
  readonly sourceId: string;
  readonly removed: boolean;
  readonly mark: number | null;
  readonly score: number | null;
  readonly total: number | null;
  readonly version: number | null;
  readonly date: string | null;
  readonly subjectId: string | null;
  readonly subject: SubjectNames | null;
}

/** An entry the digest lists, with the value it records as sent. */
interface Listed {
  readonly entry: JournalEntry;
  readonly state: ListedState;
}

/** What one child's part holds before the send. */
interface ChildRead {
  readonly child: DigestChild;
  readonly held: number;
  readonly summary: AttendanceSummary;
  readonly listed: readonly Listed[];
}

const DAY_MS = 86_400_000;
const addDays = (date: string, days: number): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

/** How far back entries sent earlier are read again (plan decision 7: the current year). */
const SENT_DAYS = 366;

export async function digestSettingsOf(transaction: Transaction): Promise<DigestSettings> {
  const row = await sql<{ send_at: string; quiet_from: string; quiet_until: string }>`
    select to_char(send_at, 'HH24:MI') as send_at, to_char(quiet_from, 'HH24:MI') as quiet_from,
      to_char(quiet_until, 'HH24:MI') as quiet_until
    from digest_settings
  `.execute(transaction);
  const one = row.rows[0];
  if (one === undefined) throw new Error('The digest settings row is missing.');
  return { sendAt: one.send_at, quietFrom: one.quiet_from, quietUntil: one.quiet_until };
}

async function digestChildren(transaction: Transaction, accountId: string): Promise<DigestChild[]> {
  const at = await transactionMoment(transaction);
  const found = await sql<{
    student_id: string;
    first_name: string;
    class_grade: number | null;
    class_name: string | null;
  }>`
    select student_id, first_name, class_grade, class_name
    from digest_children(${accountId}::uuid, ${at})
    order by first_name, student_id
  `.execute(transaction);
  return found.rows.map((row) => ({
    studentId: row.student_id,
    firstName: row.first_name,
    className:
      row.class_grade === null || row.class_name === null
        ? null
        : classDisplayName(row.class_grade, row.class_name),
  }));
}

const sameValue = (sent: SentEntry, entry: JournalEntry): boolean =>
  entry.value !== null &&
  sent.mark === entry.value.mark &&
  sent.score === entry.value.score &&
  sent.total === entry.value.total &&
  sent.version === entry.value.version;

/**
 * Whether and how an entry is listed (plan decision 7): an entry never sent, or last sent as
 * removed, is listed when it was saved in the period and shows a value (an attendance mark only
 * when absent, late or skipped); an entry sent before is listed again when its value differs:
 * "corrected", or "removed" when it is gone or no longer shown (an exempt lesson is never
 * listed, review must-fix 5).
 */
export function listedState(sent: SentEntry | undefined, entry: JournalEntry): ListedState | null {
  if (sent === undefined || sent.removed) {
    if (!entry.savedInPeriod || entry.value === null) return null;
    if (entry.kind === 'attendance' && entry.value.mark === 1) return null;
    return 'new';
  }
  if (entry.value === null) return 'removed';
  return sameValue(sent, entry) ? null : 'corrected';
}

@Injectable()
export class DigestService {
  private readonly log = new Logger('Digest');

  constructor(
    private readonly transactions: Transactions,
    private readonly jobs: Jobs,
    private readonly results: StudentResultsService,
    private readonly bot: TelegramBot,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  /** `digest.tick`. Nothing while the bot is not set up: no digest could be sent. */
  async tick(): Promise<void> {
    if (!this.bot.configured) return;
    await this.transactions.run([], async (transaction) => {
      const now = await transactionMoment(transaction);
      const settings = await digestSettingsOf(transaction);
      const recipients = await sql<{
        account_id: string;
        telegram_link_id: string;
        frequency: string;
      }>`select account_id, telegram_link_id, frequency from digest_recipients()`.execute(
        transaction,
      );
      for (const row of recipients.rows) {
        const frequency = digestFrequencySchema.safeParse(row.frequency);
        if (!frequency.success) continue;
        const due = dueToday(now, frequency.data, settings);
        if (due === null) continue;
        const made = await transaction
          .insertInto('digests')
          .values({
            account_id: row.account_id,
            digest_date: due.date,
            telegram_link_id: row.telegram_link_id,
            due_at: due.dueAt,
            // The job enqueued here is the first try; the tick sends it again from then on
            // (a send held by the quiet hours, a worker that was down).
            next_try_at: new Date(now.getTime() + 2 * 60_000),
          })
          .onConflict((conflict) => conflict.columns(['account_id', 'digest_date']).doNothing())
          .returning('id')
          .executeTakeFirst();
        if (made === undefined) continue;
        await this.jobs.enqueue(transaction, digestSendJob, {
          branchIds: [],
          data: { digestId: made.id },
        });
      }
      if (quietAt(now, settings)) return;
      const waiting = await transaction
        .selectFrom('digests')
        .select('id')
        .where('status', '=', 'due')
        .where('next_try_at', '<=', now)
        .orderBy('next_try_at')
        .limit(500)
        .execute();
      for (const one of waiting) {
        await this.jobs.enqueue(transaction, digestSendJob, {
          branchIds: [],
          data: { digestId: one.id },
        });
      }
    });
  }

  /** `digest.send`. */
  async send(digestId: string): Promise<void> {
    const start = await this.transactions.run([], async (transaction) => {
      const digest = await transaction
        .selectFrom('digests')
        .select(['id', 'account_id', 'digest_date', 'status', 'attempts', 'next_try_at'])
        .where('id', '=', digestId)
        .forUpdate()
        .executeTakeFirst();
      if (digest === undefined || digest.status !== 'due') return null;
      const now = await transactionMoment(transaction);
      // A send enqueued twice runs once: the second finds the next try not come yet.
      if (digest.attempts > 0 && digest.next_try_at.getTime() > now.getTime()) return null;
      // Every attempt moves the next try, so the tick does not send it again meanwhile.
      const settings = await digestSettingsOf(transaction);
      // `10`, Sending: "a digest not delivered before they start is sent when they end"; the
      // tick enqueues it again once they end (review correction 3).
      if (quietAt(now, settings)) return null;
      if (digest.attempts >= DIGEST_ATTEMPTS) {
        await transaction
          .updateTable('digests')
          .set({ status: 'failed' })
          .where('id', '=', digestId)
          .execute();
        this.log.warn(`Digest ${digestId}: failed after ${String(digest.attempts)} attempts.`);
        return null;
      }
      // The children the digest is for, kept for the send log whatever becomes of it (`10`,
      // Sending: "for which children ... delivered or not"; spec review of the code, must-fix 2).
      const children = await digestChildren(transaction, digest.account_id);
      if (children.length > 0) {
        await transaction
          .insertInto('digest_parts')
          .values(
            children.map((child) => ({
              digest_id: digestId,
              student_id: child.studentId,
              first_name: child.firstName,
              class_name: child.className,
            })),
          )
          .onConflict((conflict) => conflict.columns(['digest_id', 'student_id']).doNothing())
          .execute();
      }
      const link = await transaction
        .selectFrom('telegram_links')
        .select(['id', 'linked_at', 'bot_blocked_at'])
        .where('account_id', '=', digest.account_id)
        .where('ended_at', 'is', null)
        .executeTakeFirst();
      if (link === undefined || link.bot_blocked_at !== null) {
        await transaction
          .updateTable('digests')
          .set({ status: link === undefined ? 'no_chat' : 'blocked' })
          .where('id', '=', digestId)
          .execute();
        return null;
      }
      const attempts = digest.attempts + 1;
      await transaction
        .updateTable('digests')
        .set({
          attempts,
          next_try_at: new Date(now.getTime() + retryMinutes(attempts) * 60_000),
        })
        .where('id', '=', digestId)
        .execute();
      // Plan decision 8: from the end of the last digest delivered or with nothing new.
      const previous = await transaction
        .selectFrom('digests')
        .select('period_until')
        .where('account_id', '=', digest.account_id)
        .where('status', 'in', ['delivered', 'nothing'])
        .where('period_until', 'is not', null)
        .orderBy('period_until', 'desc')
        .limit(1)
        .executeTakeFirst();
      const account = await transaction
        .selectFrom('accounts')
        .select('language')
        .where('id', '=', digest.account_id)
        .executeTakeFirstOrThrow();
      return {
        accountId: digest.account_id,
        digestDate: digest.digest_date,
        attempts,
        // Review correction 1: the end is taken before the journal is read.
        until: now,
        from: previous?.period_until ?? link.linked_at,
        language: isLanguage(account.language) ? account.language : 'uz',
      };
    });
    if (start === null) return;

    const read = await this.read(start.accountId, start.from, start.until);

    await this.transactions.run([], async (transaction) => {
      const digest = await transaction
        .selectFrom('digests')
        .select(['status', 'attempts'])
        .where('id', '=', digestId)
        .forUpdate()
        .executeTakeFirst();
      if (digest?.status !== 'due' || digest.attempts !== start.attempts) return;
      // `10`, Privacy: "Each message is checked again just before it is sent".
      const inScope = new Set(
        (await digestChildren(transaction, start.accountId)).map((one) => one.studentId),
      );
      const parts = read.filter(
        (one) => inScope.has(one.child.studentId) && (one.held > 0 || one.listed.length > 0),
      );
      const close = {
        period_from: start.from,
        period_until: start.until,
      };
      if (parts.length === 0) {
        await transaction
          .updateTable('digests')
          .set({ status: 'nothing', ...close })
          .where('id', '=', digestId)
          .execute();
        return;
      }
      const link = await transaction
        .selectFrom('telegram_links')
        .select(['id', 'telegram_user_id'])
        .where('account_id', '=', start.accountId)
        .where('ended_at', 'is', null)
        // Not locked: a sign-in, sign-out or reset of the parent never waits on Telegram's answer
        // (permission review of the code, should-fix 6). Only the digest's own row is held.
        .executeTakeFirst();
      if (link === undefined) {
        await transaction
          .updateTable('digests')
          .set({ status: 'no_chat' })
          .where('id', '=', digestId)
          .execute();
        return;
      }
      const text = digestText(start.language, start.digestDate, parts.map(partOf));
      const messages = splitText(text);
      const button = this.button(start.language);
      for (const [index, message] of messages.entries()) {
        const outcome = await this.bot.sendMessage(
          link.telegram_user_id,
          message,
          index === messages.length - 1 ? button : undefined,
        );
        if (outcome === 'blocked') {
          const now = await transactionMoment(transaction);
          await transaction
            .updateTable('telegram_links')
            .set({ bot_blocked_at: now })
            .where('id', '=', link.id)
            .execute();
          await transaction
            .updateTable('digests')
            .set({ status: 'blocked' })
            .where('id', '=', digestId)
            .execute();
          this.log.log(`Digest ${digestId}: not sent, the chat blocked the bot.`);
          return;
        }
      }
      const now = await transactionMoment(transaction);
      await transaction
        .updateTable('digests')
        .set({ status: 'delivered', sent_at: now, ...close })
        .where('id', '=', digestId)
        .execute();
      await transaction
        .insertInto('digest_parts')
        .values(
          parts.map((one) => ({
            digest_id: digestId,
            student_id: one.child.studentId,
            first_name: one.child.firstName,
            class_name: one.child.className,
            in_message: true,
          })),
        )
        .onConflict((conflict) =>
          conflict.columns(['digest_id', 'student_id']).doUpdateSet({ in_message: true }),
        )
        .execute();
      const entries = parts.flatMap((one) =>
        one.listed.map(({ entry, state }) => ({
          digest_id: digestId,
          account_id: start.accountId,
          student_id: one.child.studentId,
          kind: entry.kind,
          source_id: entry.sourceId,
          subject_id: entry.subjectId,
          lesson_date: entry.date,
          state,
          sent_mark: state === 'removed' ? null : (entry.value?.mark ?? null),
          sent_score: state === 'removed' ? null : (entry.value?.score ?? null),
          sent_total: state === 'removed' ? null : (entry.value?.total ?? null),
          sent_version: state === 'removed' ? null : (entry.value?.version ?? null),
        })),
      );
      if (entries.length > 0) {
        await transaction.insertInto('digest_entries').values(entries).execute();
      }
    });
  }

  private button(language: Language): { text: string; url: string } | undefined {
    const telegram = this.config.telegram;
    if (telegram === undefined) return undefined;
    return {
      text: DIGEST_TEXTS[language].openPortal,
      url: `${telegram.webOrigin}${MINI_APP_PATH}`,
    };
  }

  /** Each child's part, read at the moment of sending, in the branches of its journal. */
  private async read(accountId: string, from: Date, until: Date): Promise<ChildRead[]> {
    const scope = await this.transactions.run([], async (transaction) => {
      const children = await digestChildren(transaction, accountId);
      const today = schoolDateOf(until, DIGEST_TIME_ZONE);
      const firstDay = schoolDateOf(from, DIGEST_TIME_ZONE);
      const since = addDays(today, -SENT_DAYS);
      const found = [];
      for (const child of children) {
        const periodSpans = await childSpans(
          transaction,
          accountId,
          child.studentId,
          firstDay < since ? since : firstDay,
          today,
        );
        // Review must-fix 6: every branch of the year, so a late mark from before a move is read.
        const yearSpans = await childSpans(transaction, accountId, child.studentId, since, today);
        const sent = await sql<{
          kind: DigestEntryKind;
          source_id: string;
          state: string;
          sent_mark: number | null;
          sent_score: number | null;
          sent_total: number | null;
          sent_version: number | null;
          lesson_date: string | null;
          subject_id: string | null;
          name_uz: string | null;
          name_ru: string | null;
          name_en: string | null;
        }>`
          select distinct on (e.kind, e.source_id)
            e.kind, e.source_id, e.state, e.sent_mark, e.sent_score, e.sent_total,
            e.sent_version, e.lesson_date::text as lesson_date, e.subject_id,
            s.name_uz, s.name_ru, s.name_en
          from digest_entries e
          join digests d on d.id = e.digest_id
          left join subjects s on s.id = e.subject_id
          where e.account_id = ${accountId}::uuid
            and e.student_id = ${child.studentId}::uuid
            and d.status = 'delivered'
            and (e.lesson_date is null or e.lesson_date >= ${since}::date)
          order by e.kind, e.source_id, d.sent_at desc, e.id desc
        `.execute(transaction);
        found.push({
          child,
          periodSpans,
          branches: [...new Set(yearSpans.map((one) => one.branchId))],
          sent: sent.rows.map((row): SentEntry => ({
            kind: row.kind,
            sourceId: row.source_id,
            removed: row.state === 'removed',
            mark: row.sent_mark,
            score: row.sent_score,
            total: row.sent_total,
            version: row.sent_version,
            date: row.lesson_date,
            subjectId: row.subject_id,
            subject:
              row.name_uz === null || row.name_ru === null || row.name_en === null
                ? null
                : { uz: row.name_uz, ru: row.name_ru, en: row.name_en },
          })),
        });
      }
      return found;
    });

    const answer: ChildRead[] = [];
    for (const one of scope) {
      const summary = await this.summary(one.child.studentId, one.periodSpans, from, until);
      const listed: Listed[] = [];
      const sentIds = new Map<DigestEntryKind, string[]>();
      for (const row of one.sent) {
        sentIds.set(row.kind, [...(sentIds.get(row.kind) ?? []), row.sourceId]);
      }
      const sentOf = new Map(one.sent.map((row) => [`${row.kind}/${row.sourceId}`, row]));
      const seen = new Set<string>();
      // An entry sent earlier is asked for in every branch of the year: its own branch answers
      // it, the others find nothing (plan decision 17).
      for (const branchId of one.branches) {
        const entries = await this.transactions.run([branchId], (transaction) =>
          journalEntriesOf(transaction, {
            branchId,
            studentId: one.child.studentId,
            from: new Date(from.getTime() - DIGEST_OVERLAP_MS),
            until,
            sent: sentIds,
          }),
        );
        for (const entry of entries) {
          const key = `${entry.kind}/${entry.sourceId}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const state = listedState(sentOf.get(key), entry);
          if (state !== null) listed.push({ entry, state });
        }
      }
      // A row sent earlier and found in no branch is gone (a work removed, review correction 2).
      for (const row of one.sent) {
        const key = `${row.kind}/${row.sourceId}`;
        if (seen.has(key) || row.removed) continue;
        listed.push({
          entry: {
            kind: row.kind,
            sourceId: row.sourceId,
            branchId: one.branches[0] ?? '',
            date: row.date,
            subjectId: row.subjectId,
            subject: row.subject,
            savedInPeriod: false,
            value: null,
          },
          state: 'removed',
        });
      }
      listed.sort(
        (a, b) =>
          (a.entry.date ?? '').localeCompare(b.entry.date ?? '') ||
          (a.entry.subject?.en ?? '').localeCompare(b.entry.subject?.en ?? '') ||
          a.entry.sourceId.localeCompare(b.entry.sourceId),
      );
      answer.push({ child: one.child, held: summary.held, summary: summary.counts, listed });
    }
    return answer;
  }

  /**
   * The summary of the held lessons that started in the period (plan decision 4), from the
   * lessons the portal's Attendance page reads (`familyLessons`) and counted by `dailyAttendance`
   * of `packages/calc`, as the staff pages count (Release 2 plan, reading 9).
   */
  private async summary(
    studentId: string,
    spans: readonly { branchId: string; from: string; until: string }[],
    from: Date,
    until: Date,
  ): Promise<{ held: number; counts: AttendanceSummary }> {
    const cells: { mark: 0 | 1 | 2 | 3 | null; exempt: boolean }[] = [];
    for (const span of spans) {
      const lessons = await this.results.familyLessons(
        span.branchId,
        studentId,
        span.from,
        addDays(span.until, -1),
      );
      if (lessons.length === 0) continue;
      const starts = await this.transactions.run([span.branchId], (transaction) =>
        transaction
          .selectFrom('lessons')
          .select(['id', 'starts_at'])
          .where(
            'id',
            'in',
            lessons.map((one) => one.lessonId),
          )
          .execute(),
      );
      const startOf = new Map(starts.map((row) => [row.id, row.starts_at.getTime()]));
      for (const lesson of lessons) {
        const start = startOf.get(lesson.lessonId);
        if (start === undefined || start < from.getTime() || start >= until.getTime()) continue;
        const exempt = lesson.mark === 4 || lesson.mark === 5;
        const mark =
          lesson.mark === 0 || lesson.mark === 1 || lesson.mark === 2 || lesson.mark === 3
            ? lesson.mark
            : null;
        cells.push({ mark: exempt ? null : mark, exempt });
      }
    }
    const figure = dailyAttendance(cells);
    return {
      // Exempt lessons are left out: a period of exempt lessons only is nothing new (spec review
      // of the code, should-fix 1).
      held: figure.marked + figure.unmarked,
      counts: {
        marked: figure.marked,
        attended: figure.attended,
        late: cells.filter((cell) => !cell.exempt && cell.mark === 2).length,
        unmarked: figure.unmarked,
      },
    };
  }
}

/** The text's input of a child's part. */
function partOf(read: ChildRead): ChildPart {
  const marks: ListedMark[] = [];
  const scores: ListedScore[] = [];
  const comments: ListedComment[] = [];
  for (const { entry, state } of read.listed) {
    const value = state === 'removed' ? null : entry.value;
    if (entry.kind === 'attendance') {
      marks.push({ date: entry.date, subject: entry.subject, mark: value?.mark ?? null, state });
    } else if (entry.kind === 'comment') {
      comments.push({
        date: entry.date,
        subject: entry.subject,
        body: state === 'removed' ? null : (entry.body ?? null),
        state,
      });
    } else {
      scores.push({
        date: entry.date,
        subject: entry.subject,
        work: entry.kind === 'rating' || entry.work === undefined ? { kind: 'rating' } : entry.work,
        score: value?.score ?? null,
        total: value?.total ?? null,
        state,
      });
    }
  }
  return {
    firstName: read.child.firstName,
    className: read.child.className,
    summary: read.summary,
    marks,
    scores,
    comments,
  };
}
