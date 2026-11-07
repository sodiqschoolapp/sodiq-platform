import { Logger } from '@nestjs/common';
import {
  parentAccountSchema,
  relativeReportSchema,
  sessionResponseSchema,
  TELEGRAM_TEXTS,
} from '@sodiq/shared';
import { sql } from 'kysely';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions } from '../../database/transactions.js';
import { ShippingLogger } from '../../monitoring/monitoring.service.js';
import { ClassesKit } from '../../testing/classes-kit.js';
import { createTestApp } from '../../testing/create-test-app.js';
import { dayTemplatesKit, UNKNOWN, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { ParentsKit } from '../../testing/parents-kit.js';
import { cookieOf, errorCode, NEW_PASSWORD, signInKit } from '../../testing/sign-in-kit.js';
import { signedLaunch, TEST_BOT_TOKEN, TEST_WEBHOOK_SECRET } from '../../testing/telegram-kit.js';
import type { TelegramFetch } from '../portal/telegram/bot-api.js';
import { TellMovedSender } from '../portal/telegram/tell-moved.job.js';

const HOUR_MS = 60 * 60 * 1000;
const WEB_ORIGIN = 'https://app-test.example.invalid';

/** The calls the bot made to the Bot API: the address without the token, and the body. */
interface BotCall {
  method: string;
  body: Record<string, unknown>;
}

// Task 11.4 (pull request #298): the Telegram bot and the chat link. `10`, Signing in: Telegram;
// `02`, Accounts and sign-in (the webhook); `edge/close-relatives` (a shared phone; a forgotten
// password or lost phone). Every name, token, secret and Telegram id is invented.
describe('the Telegram chat link', () => {
  let t: DayTemplatesKit;
  let classes: ClassesKit;
  let parents: ParentsKit;
  let southVice: string;
  let tutor: string;
  /** A staff account that locks a parent's account in a test. */
  let lockerId: string;
  let nextChat = 7_000_100;
  const botCalls: BotCall[] = [];
  let botAnswer = { ok: true, status: 200 };

  const fakeFetch: TelegramFetch = (url, init) => {
    const method = url.slice(url.lastIndexOf('/') + 1);
    botCalls.push({
      method,
      body: JSON.parse(typeof init.body === 'string' ? init.body : '{}') as Record<string, unknown>,
    });
    return Promise.resolve(botAnswer);
  };

  const chat = (): number => {
    nextChat += 1;
    return nextChat;
  };

  const launch = (telegramUserId: number, signedAt = t.clock.now()) =>
    signedLaunch({ telegramUserId, signedAt });

  const server = () => t.kit.server;

  const launchSignIn = (telegramInitData: string) =>
    request(server()).post('/api/auth/sign-in').send({ telegramInitData });

  const passwordSignIn = (login: string, password: string, telegramInitData?: string) =>
    request(server())
      .post('/api/auth/sign-in')
      .send(
        telegramInitData === undefined
          ? { login, password }
          : { login, password, telegramInitData },
      );

  const changePassword = (
    cookie: string,
    currentPassword: string,
    newPassword: string,
    telegramInitData?: string,
  ) =>
    request(server())
      .post('/api/auth/password')
      .set('Cookie', cookie)
      .send({
        currentPassword,
        newPassword,
        ...(telegramInitData === undefined ? {} : { telegramInitData }),
      });

  const sessionOf = (cookie: string) =>
    request(server()).get('/api/auth/session').set('Cookie', cookie);

  const unlinkOwn = (cookie?: string) => {
    const call = request(server()).delete('/api/auth/telegram-link');
    return cookie === undefined ? call : call.set('Cookie', cookie);
  };

  const unlinkBy = (relativeId: string, branch = t.north, cookie = t.vicePrincipal) =>
    t.post(`/api/people/parents/${relativeId}/telegram-unlink`, branch, {}, cookie);

  const refusedWith = (response: Response, status: number, code: string) => {
    expect(response.status, JSON.stringify(response.body)).toBe(status);
    expect(errorCode(response)).toBe(code);
  };

  const cookieFrom = (response: Response): string => {
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const cookie = cookieOf(response);
    if (cookie === undefined) throw new Error('The sign-in gave no session cookie.');
    return cookie;
  };

  /** The links of an account, oldest first. */
  const linksOf = (accountId: string) =>
    t.database.migrator
      .selectFrom('telegram_links')
      .selectAll()
      .where('account_id', '=', accountId)
      .orderBy('linked_at')
      .orderBy('id')
      .execute();

  const openLinkOfChat = (chatId: number) =>
    t.database.migrator
      .selectFrom('telegram_links')
      .selectAll()
      .where('telegram_user_id', '=', String(chatId))
      .where('ended_at', 'is', null)
      .executeTakeFirst();

  /** A parent whose own password is chosen (signed in once in a browser). */
  async function parent(branch = t.north) {
    const { studentId, relativeId } = await parents.student(branch);
    const { account } = await parents.session(relativeId);
    return { studentId, relativeId, account, login: account.login };
  }

  /** A parent linked to a new chat through the mini app, with the session it opened. */
  async function linkedParent(branch = t.north) {
    const one = await parent(branch);
    const chatId = chat();
    const cookie = cookieFrom(await passwordSignIn(one.login, NEW_PASSWORD, launch(chatId)));
    return { ...one, chatId, cookie };
  }

  const telegramJobs = async () =>
    (
      await sql<{
        data: { data: { linkId: string } };
      }>`select data from pgboss.job where name = 'telegram.tell_moved' order by created_on`.execute(
        t.database.migrator,
      )
    ).rows.map((row) => row.data.data.linkId);

  /** The school-wide audit entries of an action (links and sign-ins have no branch). */
  const schoolEntries = (action: string, recordId?: string) => {
    let query = t.database.migrator
      .selectFrom('audit_log_school')
      .selectAll()
      .where('action', '=', action)
      .orderBy('occurred_at')
      .orderBy('id');
    if (recordId !== undefined) query = query.where('record_id', '=', recordId);
    return query.execute();
  };

  /** Every row of the tables a link route writes, and the log: what a refused one leaves. */
  const rowsOf = () =>
    Promise.all(
      ['telegram_links', 'sessions', 'accounts', 'audit_log', 'audit_log_school'].map(
        async (table) =>
          (await sql`select * from ${sql.table(table)} order by 1`.execute(t.database.migrator))
            .rows,
      ),
    );

  beforeAll(async () => {
    t = await dayTemplatesKit({
      jobs: true,
      telegramFetch: fakeFetch,
      config: {
        telegram: {
          botToken: TEST_BOT_TOKEN,
          webhookSecret: TEST_WEBHOOK_SECRET,
          webOrigin: WEB_ORIGIN,
        },
      },
    });
    classes = new ClassesKit(t.database.migrator);
    lockerId = await classes.account();
    parents = new ParentsKit(t.app, t.database.migrator, lockerId);
    southVice = (
      await signInKit(t.app, {
        newAccountsHold: { role: 'academic_vice_principal', branchId: t.south },
      }).completeSession('Southvice', 'Nazarov')
    ).cookie;
    tutor = (
      await signInKit(t.app, { newAccountsHold: { role: 'tutor', branchId: t.north } }).fullSession(
        'Tutor',
        'Qosimov',
      )
    ).cookie;
  }, 120_000);

  afterAll(async () => {
    await t.close();
  });

  describe('the webhook', () => {
    const webhook = (body: object, secret?: string) => {
      const call = request(server()).post('/api/telegram/webhook');
      return (
        secret === undefined ? call : call.set('X-Telegram-Bot-Api-Secret-Token', secret)
      ).send(body);
    };
    const start = (chatId: number, languageCode?: string, type = 'private', text = '/start') => ({
      update_id: 1,
      message: {
        message_id: 5,
        date: 1_700_000_000,
        chat: { id: chatId, type },
        from: {
          id: chatId,
          is_bot: false,
          first_name: 'Invented',
          ...(languageCode === undefined ? {} : { language_code: languageCode }),
        },
        text,
      },
    });

    it('refuses a call without the secret, or with another one, before reading it', async () => {
      refusedWith(await webhook(start(chat())), 401, 'not_signed_in');
      refusedWith(
        await webhook(start(chat()), 'another-invented-secret-0000'),
        401,
        'not_signed_in',
      );
      refusedWith(await webhook({ not: 'an update' }), 401, 'not_signed_in');
    });

    // Review correction 3: Telegram's call carries no Origin and no Sec-Fetch-Site, and the
    // same-site guard of changing requests lets it through without being loosened.
    it('answers /start with the button that opens the mini app, in Uzbek until known', async () => {
      const response = await webhook(start(chat()), TEST_WEBHOOK_SECRET);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        method: 'sendMessage',
        chat_id: nextChat,
        text: TELEGRAM_TEXTS.uz.start,
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: TELEGRAM_TEXTS.uz.openPortal,
                web_app: { url: `${WEB_ORIGIN}/portal/telegram` },
              },
            ],
          ],
        },
      });
    });

    it('answers in Telegram’s language of the user, and in the linked account’s once linked', async () => {
      const ru = await webhook(start(chat(), 'ru'), TEST_WEBHOOK_SECRET);
      expect((ru.body as { text: string }).text).toBe(TELEGRAM_TEXTS.ru.start);
      const de = await webhook(start(chat(), 'de'), TEST_WEBHOOK_SECRET);
      expect((de.body as { text: string }).text).toBe(TELEGRAM_TEXTS.uz.start);

      const linked = await linkedParent();
      await t.database.migrator
        .updateTable('accounts')
        .set({ language: 'en' })
        .where('id', '=', linked.account.id)
        .execute();
      const en = await webhook(start(linked.chatId, 'ru'), TEST_WEBHOOK_SECRET);
      expect((en.body as { text: string }).text).toBe(TELEGRAM_TEXTS.en.start);
    });

    it('answers nothing to another message, a group chat or an update without a message', async () => {
      for (const body of [
        start(chat(), undefined, 'private', 'hello'),
        start(chat(), undefined, 'group'),
        { update_id: 2, my_chat_member: { chat: { id: 1 } } },
      ]) {
        const response = await webhook(body, TEST_WEBHOOK_SECRET);
        expect(response.status).toBe(200);
        expect(response.body).toEqual({});
      }
    });
  });

  // Plan decision 13 (permission review of the code, should-fix 4): before the owner sets the
  // values, everything Telegram is refused; no database is reached.
  describe('before the owner set the bot up', () => {
    it('refuses the webhook without a configured secret, and a launch without a token', async () => {
      const noSecret = await createTestApp({
        config: {
          telegram: { botToken: TEST_BOT_TOKEN, webhookSecret: undefined, webOrigin: WEB_ORIGIN },
        },
      });
      const noBot = await createTestApp({ config: { telegram: undefined } });
      try {
        refusedWith(
          await request(noSecret.getHttpServer())
            .post('/api/telegram/webhook')
            .set('X-Telegram-Bot-Api-Secret-Token', TEST_WEBHOOK_SECRET)
            .send({ update_id: 1 }),
          401,
          'not_signed_in',
        );
        refusedWith(
          await request(noBot.getHttpServer())
            .post('/api/auth/sign-in')
            .send({ telegramInitData: launch(chat()) }),
          401,
          'telegram_sign_in_needed',
        );
        refusedWith(
          await request(noBot.getHttpServer())
            .post('/api/telegram/webhook')
            .set('X-Telegram-Bot-Api-Secret-Token', TEST_WEBHOOK_SECRET)
            .send({ update_id: 1 }),
          401,
          'not_signed_in',
        );
      } finally {
        await noSecret.close();
        await noBot.close();
      }
    });
  });

  describe('the first sign-in in the mini app', () => {
    it('links the chat, and the next opening signs in without the password', async () => {
      const one = await parent();
      const chatId = chat();
      const signed = await passwordSignIn(one.login, NEW_PASSWORD, launch(chatId));
      cookieFrom(signed);

      const links = await linksOf(one.account.id);
      expect(links).toHaveLength(1);
      expect(links[0]).toMatchObject({ telegram_user_id: String(chatId), ended_at: null });
      expect(sessionResponseSchema.parse(signed.body).telegramLinkedAt).toBe(
        t.clock.now().toISOString(),
      );
      expect(await schoolEntries('telegram.linked', links[0]?.id)).toHaveLength(1);

      const opened = await launchSignIn(launch(chatId));
      const cookie = cookieFrom(opened);
      expect(sessionResponseSchema.parse(opened.body)).toMatchObject({
        kind: 'parent',
        login: one.login,
        mustChangePassword: false,
      });
      expect((await sessionOf(cookie)).status).toBe(200);
      const signIns = await schoolEntries('auth.sign_in');
      expect(signIns.at(-1)).toMatchObject({ details: { telegram: true } });
    });

    it('links nothing while a first password is owed, and links at the change sent with the launch', async () => {
      const { relativeId } = await parents.student(t.north);
      const account = await parents.account(relativeId);
      const chatId = chat();
      const signed = await passwordSignIn(account.login, account.firstPassword, launch(chatId));
      const cookie = cookieFrom(signed);
      expect(await linksOf(account.id)).toEqual([]);
      refusedWith(await launchSignIn(launch(chatId)), 401, 'telegram_sign_in_needed');

      const changed = await changePassword(
        cookie,
        account.firstPassword,
        NEW_PASSWORD,
        launch(chatId),
      );
      expect(changed.status, JSON.stringify(changed.body)).toBe(204);
      expect(await linksOf(account.id)).toMatchObject([
        { telegram_user_id: String(chatId), ended_at: null },
      ]);
      cookieFrom(await launchSignIn(launch(chatId)));
    });

    it('keeps the password change when the chat was linked to another account in between', async () => {
      const { relativeId } = await parents.student(t.north);
      const account = await parents.account(relativeId);
      const other = await parent();
      const chatId = chat();
      const cookie = cookieFrom(
        await passwordSignIn(account.login, account.firstPassword, launch(chatId)),
      );
      cookieFrom(await passwordSignIn(other.login, NEW_PASSWORD, launch(chatId)));

      refusedWith(
        await changePassword(cookie, account.firstPassword, NEW_PASSWORD, launch(chatId)),
        409,
        'telegram_chat_linked',
      );
      expect(await linksOf(account.id)).toEqual([]);
      expect((await openLinkOfChat(chatId))?.account_id).toBe(other.account.id);
      // The new password stands.
      cookieFrom(await passwordSignIn(account.login, NEW_PASSWORD));
    });

    it('links nothing for a staff account that signs in with launch data', async () => {
      const staff = await signInKit(t.app).fullSession('Staffer', 'Rahimov');
      const chatId = chat();
      cookieFrom(await passwordSignIn(staff.account.login, NEW_PASSWORD, launch(chatId)));
      expect(await openLinkOfChat(chatId)).toBeUndefined();
    });

    it('links nothing with launch data that does not check out, and the sign-in goes on', async () => {
      const one = await parent();
      const chatId = chat();
      const old = launch(chatId, new Date(t.clock.now().getTime() - 25 * HOUR_MS));
      cookieFrom(await passwordSignIn(one.login, NEW_PASSWORD, old));
      expect(await linksOf(one.account.id)).toEqual([]);
    });
  });

  describe('the opening from a chat', () => {
    it('refuses a chat with no link, a forged launch, one older than 24 hours, and a mixed body', async () => {
      const linked = await linkedParent();
      const before = await rowsOf();
      refusedWith(await launchSignIn(launch(chat())), 401, 'telegram_sign_in_needed');
      refusedWith(
        await launchSignIn(
          signedLaunch({
            telegramUserId: linked.chatId,
            signedAt: t.clock.now(),
            botToken: '987654321:AAanotherInventedTokenNotTheBots_98765',
          }),
        ),
        401,
        'telegram_sign_in_needed',
      );
      refusedWith(
        await launchSignIn(
          launch(linked.chatId, new Date(t.clock.now().getTime() - 24 * HOUR_MS - 1000)),
        ),
        401,
        'telegram_sign_in_needed',
      );
      const mixed = await request(server())
        .post('/api/auth/sign-in')
        .send({ telegramInitData: launch(linked.chatId), trustDevice: true });
      refusedWith(mixed, 400, 'validation_failed');
      expect(await rowsOf()).toEqual(before);
      // Exactly 24 hours old is still accepted.
      cookieFrom(
        await launchSignIn(launch(linked.chatId, new Date(t.clock.now().getTime() - 24 * HOUR_MS))),
      );
    });

    it('ends the link of an account that can no longer sign in, and refuses the opening', async () => {
      const linked = await linkedParent();
      await t.database.migrator
        .updateTable('student_relatives')
        .set({ portal_access: false })
        .where('relative_id', '=', linked.relativeId)
        .execute();
      refusedWith(await launchSignIn(launch(linked.chatId)), 401, 'telegram_sign_in_needed');
      expect(await linksOf(linked.account.id)).toMatchObject([{ end_reason: 'blocked' }]);
      // The session opened through the link ended with it.
      expect((await sessionOf(linked.cookie)).status).toBe(401);
    });

    it('ends the link of a locked account', async () => {
      const linked = await linkedParent();
      await t.database.migrator
        .updateTable('accounts')
        .set({
          locked_at: t.clock.now(),
          locked_by: lockerId,
          lock_reason: 'Invented reason',
        })
        .where('id', '=', linked.account.id)
        .execute();
      refusedWith(await launchSignIn(launch(linked.chatId)), 401, 'telegram_sign_in_needed');
      expect(await linksOf(linked.account.id)).toMatchObject([{ end_reason: 'blocked' }]);
    });

    it('keeps the launch data out of the logs and the audit log', async () => {
      const one = await parent();
      const chatId = chat();
      const data = launch(chatId);
      const hash = new URLSearchParams(data).get('hash') ?? '';
      const lines: string[] = [];
      Logger.overrideLogger(new ShippingLogger());
      ShippingLogger.sink = (_level, text) => {
        lines.push(text);
      };
      try {
        cookieFrom(await passwordSignIn(one.login, NEW_PASSWORD, data));
        cookieFrom(await launchSignIn(data));
        refusedWith(await launchSignIn(launch(chat())), 401, 'telegram_sign_in_needed');
      } finally {
        ShippingLogger.sink = undefined;
      }
      const audit = JSON.stringify(
        (await sql`select * from audit_log_school`.execute(t.database.migrator)).rows,
      );
      for (const secret of [hash, String(chatId), TEST_BOT_TOKEN]) {
        expect(audit).not.toContain(secret);
        expect(lines.join('\n')).not.toContain(secret);
      }
    });
  });

  describe('one account to one chat, one chat to one account', () => {
    it('moves the link to a new chat, ends the old one and tells the old chat', async () => {
      const linked = await linkedParent();
      const newChat = chat();
      const before = await telegramJobs();
      const opened = cookieFrom(await passwordSignIn(linked.login, NEW_PASSWORD, launch(newChat)));

      const links = await linksOf(linked.account.id);
      expect(links.map((one) => [one.telegram_user_id, one.end_reason])).toEqual([
        [String(linked.chatId), 'moved'],
        [String(newChat), null],
      ]);
      expect(await telegramJobs()).toEqual([...before, links[0]?.id]);
      expect(await schoolEntries('telegram.moved', links[0]?.id)).toHaveLength(1);
      // The session of the old chat ended; the new one is signed in.
      expect((await sessionOf(linked.cookie)).status).toBe(401);
      expect((await sessionOf(opened)).status).toBe(200);
      refusedWith(await launchSignIn(launch(linked.chatId)), 401, 'telegram_sign_in_needed');

      // The worker's notice: in the account's language, to the old chat, once.
      botCalls.length = 0;
      const sender = t.app.get(TellMovedSender);
      const linkId = links[0]?.id ?? '';
      await t.app.get(Transactions).run([], (transaction) => sender.send(transaction, { linkId }));
      await t.app.get(Transactions).run([], (transaction) => sender.send(transaction, { linkId }));
      expect(botCalls).toEqual([
        {
          method: 'sendMessage',
          body: { chat_id: String(linked.chatId), text: TELEGRAM_TEXTS.uz.moved },
        },
      ]);
    });

    it('tries the notice again when Telegram fails, and not when the chat blocked the bot', async () => {
      const linked = await linkedParent();
      cookieFrom(await passwordSignIn(linked.login, NEW_PASSWORD, launch(chat())));
      const linkId = (await linksOf(linked.account.id))[0]?.id ?? '';
      const send = () =>
        t.app
          .get(Transactions)
          .run([], (transaction) => t.app.get(TellMovedSender).send(transaction, { linkId }));
      botAnswer = { ok: false, status: 502 };
      await expect(send()).rejects.toThrow('Telegram answered 502.');
      expect((await linksOf(linked.account.id))[0]?.told_at).toBeNull();
      botAnswer = { ok: false, status: 403 };
      await send();
      expect((await linksOf(linked.account.id))[0]?.told_at).not.toBeNull();
      botAnswer = { ok: true, status: 200 };
    });

    it('refuses a chat linked to another account that can still sign in, with no session', async () => {
      const linked = await linkedParent();
      const other = await parent();
      const before = await rowsOf();
      refusedWith(
        await passwordSignIn(other.login, NEW_PASSWORD, launch(linked.chatId)),
        409,
        'telegram_chat_linked',
      );
      expect(await rowsOf()).toEqual(before);
      // The chat opens the first account only.
      const opened = await launchSignIn(launch(linked.chatId));
      expect(sessionResponseSchema.parse(opened.body).login).toBe(linked.login);
    });

    it('takes a shared chat from an account that can no longer sign in (a shared phone)', async () => {
      const linked = await linkedParent();
      await t.database.migrator
        .updateTable('relatives')
        .set({ archived_at: t.clock.now() })
        .where('id', '=', linked.relativeId)
        .execute()
        .catch(async () => {
          // A relative linked to a student cannot be archived: switch portal access off instead.
          await t.database.migrator
            .updateTable('student_relatives')
            .set({ portal_access: false })
            .where('relative_id', '=', linked.relativeId)
            .execute();
        });
      const other = await parent();
      cookieFrom(await passwordSignIn(other.login, NEW_PASSWORD, launch(linked.chatId)));
      expect(await linksOf(linked.account.id)).toMatchObject([{ end_reason: 'blocked' }]);
      expect((await openLinkOfChat(linked.chatId))?.account_id).toBe(other.account.id);
    });

    it('answers 409, never 500, when another account links the same new chat at the same moment', async () => {
      for (const commit of [true, false]) {
        const first = await parent();
        const second = await parent();
        const target = chat();
        // The held side writes what the route writes: the account row held, the link inserted.
        const held = await t.database.app.connection().execute(async (connection) => {
          await sql`begin`.execute(connection);
          await sql`select id from accounts where id = ${first.account.id} for update`.execute(
            connection,
          );
          await connection
            .insertInto('telegram_links')
            .values({
              account_id: first.account.id,
              telegram_user_id: String(target),
              linked_at: t.clock.now(),
            })
            .execute();
          const waiting = new Promise<Response>((resolve, reject) => {
            passwordSignIn(second.login, NEW_PASSWORD, launch(target)).then(resolve, reject);
          });
          // The sign-in waits on the index entry of the held link.
          for (let i = 0; i < 200; i += 1) {
            const blocked = await sql<{ n: number }>`
              select count(*)::int as n from pg_locks l join pg_stat_activity a on a.pid = l.pid
              where not l.granted and a.datname = current_database()
            `.execute(t.database.migrator);
            if ((blocked.rows[0]?.n ?? 0) > 0) break;
            await new Promise((resolve) => setTimeout(resolve, 25));
          }
          await sql.raw(commit ? 'commit' : 'rollback').execute(connection);
          return waiting;
        });
        if (commit) {
          refusedWith(held, 409, 'telegram_chat_linked');
          expect((await openLinkOfChat(target))?.account_id).toBe(first.account.id);
        } else {
          cookieFrom(held);
          expect((await openLinkOfChat(target))?.account_id).toBe(second.account.id);
        }
      }
    });
  });

  describe('the ends of a link', () => {
    it('ends on a sign-out in the mini app, and the next opening asks for the password', async () => {
      const linked = await linkedParent();
      const opened = cookieFrom(await launchSignIn(launch(linked.chatId)));
      const signedOut = await request(server()).post('/api/auth/sign-out').set('Cookie', opened);
      expect(signedOut.status).toBe(204);
      expect(await linksOf(linked.account.id)).toMatchObject([{ end_reason: 'sign_out' }]);
      // Every session opened through the link ended with it.
      expect((await sessionOf(linked.cookie)).status).toBe(401);
      refusedWith(await launchSignIn(launch(linked.chatId)), 401, 'telegram_sign_in_needed');
    });

    // Permission review of the code, must-fix 2: a sign-out in the mini app takes the account row
    // before its own session, as a move of the link does, so the two wait and never deadlock.
    it('waits for a move of the link that holds the account row, then signs out', async () => {
      const linked = await linkedParent();
      const opened = cookieFrom(await launchSignIn(launch(linked.chatId)));
      const old = (await linksOf(linked.account.id))[0]?.id ?? '';
      const newChat = chat();
      const answer = await t.database.app.connection().execute(async (connection) => {
        await sql`begin`.execute(connection);
        const pid = (await sql<{ pid: number }>`select pg_backend_pid() as pid`.execute(connection))
          .rows[0]?.pid;
        // The held side is a moving sign-in: the account row first.
        await sql`select id from accounts where id = ${linked.account.id} for update`.execute(
          connection,
        );
        const signingOut = new Promise<Response>((resolve, reject) => {
          request(server()).post('/api/auth/sign-out').set('Cookie', opened).then(resolve, reject);
        });
        let waited = false;
        for (let i = 0; i < 200 && !waited; i += 1) {
          const blocked = await sql<{ n: number }>`
            select count(*)::int as n from pg_stat_activity
            where datname = current_database() and ${pid}::int = any(pg_blocking_pids(pid))
          `.execute(t.database.migrator);
          waited = (blocked.rows[0]?.n ?? 0) > 0;
          if (!waited) await new Promise((resolve) => setTimeout(resolve, 25));
        }
        expect(waited).toBe(true);
        // Then what the move writes: the old link and its sessions ended, the new link.
        const now = t.clock.now();
        await connection
          .updateTable('telegram_links')
          .set({ ended_at: now, end_reason: 'moved' })
          .where('id', '=', old)
          .execute();
        await connection
          .updateTable('sessions')
          .set({ ended_at: now, end_reason: 'telegram_unlinked' })
          .where('telegram_link_id', '=', old)
          .where('ended_at', 'is', null)
          .execute();
        await connection
          .insertInto('telegram_links')
          .values({
            account_id: linked.account.id,
            telegram_user_id: String(newChat),
            linked_at: now,
          })
          .execute();
        await sql`commit`.execute(connection);
        return signingOut;
      });
      expect(answer.status, JSON.stringify(answer.body)).toBe(204);
      expect((await linksOf(linked.account.id)).map((one) => one.end_reason)).toEqual([
        'moved',
        null,
      ]);
      expect((await openLinkOfChat(newChat))?.account_id).toBe(linked.account.id);
    });

    it('stays on a sign-out of a browser session of the same parent', async () => {
      const linked = await linkedParent();
      const browser = cookieFrom(await passwordSignIn(linked.login, NEW_PASSWORD));
      expect(
        (await request(server()).post('/api/auth/sign-out').set('Cookie', browser)).status,
      ).toBe(204);
      expect(await linksOf(linked.account.id)).toMatchObject([{ ended_at: null }]);
    });

    it('ends on a password change; the session that changed it stays signed in', async () => {
      const linked = await linkedParent();
      const changed = await changePassword(linked.cookie, NEW_PASSWORD, 'another-password-81');
      expect(changed.status).toBe(204);
      expect(await linksOf(linked.account.id)).toMatchObject([{ end_reason: 'password_change' }]);
      expect((await sessionOf(linked.cookie)).status).toBe(200);
      refusedWith(await launchSignIn(launch(linked.chatId)), 401, 'telegram_sign_in_needed');
    });

    it('ends on a reset by the Academic Vice Principal', async () => {
      const linked = await linkedParent();
      const reset = await t.post(
        `/api/people/parents/${linked.relativeId}/password-reset`,
        t.north,
        { language: 'uz' },
        t.vicePrincipal,
      );
      expect(reset.status, JSON.stringify(reset.body)).toBe(200);
      expect(await linksOf(linked.account.id)).toMatchObject([{ end_reason: 'password_reset' }]);
      refusedWith(await launchSignIn(launch(linked.chatId)), 401, 'telegram_sign_in_needed');
    });

    it('ends on the parent’s own "Unlink Telegram"', async () => {
      const linked = await linkedParent();
      const browser = cookieFrom(await passwordSignIn(linked.login, NEW_PASSWORD));
      expect((await unlinkOwn(browser)).status).toBe(204);
      expect(await linksOf(linked.account.id)).toMatchObject([
        { end_reason: 'unlinked', ended_by: null },
      ]);
      expect((await sessionOf(linked.cookie)).status).toBe(401);
      expect((await sessionOf(browser)).status).toBe(200);
      expect(
        sessionResponseSchema.parse((await sessionOf(browser)).body).telegramLinkedAt,
      ).toBeNull();
      refusedWith(await launchSignIn(launch(linked.chatId)), 401, 'telegram_sign_in_needed');
    });

    it('refuses the own unlink without a session, without a link, and for a staff account', async () => {
      refusedWith(await unlinkOwn(), 401, 'not_signed_in');
      const one = await parent();
      const browser = cookieFrom(await passwordSignIn(one.login, NEW_PASSWORD));
      refusedWith(await unlinkOwn(browser), 409, 'no_telegram_link');
      refusedWith(await unlinkOwn(t.teacher), 409, 'no_telegram_link');
    });
  });

  // Plan decision 12; spec review of the plan, should-fix 11: the reader of the links.
  describe('the personal data report of a relative', () => {
    it('lists each link with its moments and end, never the Telegram id', async () => {
      const linked = await linkedParent();
      cookieFrom(await passwordSignIn(linked.login, NEW_PASSWORD, launch(chat())));
      const response = await t.post(
        `/api/people/relatives/${linked.relativeId}/report`,
        t.north,
        {},
        t.admin,
      );
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      const now = t.clock.now().toISOString();
      expect(relativeReportSchema.parse(response.body).relative.account?.telegramLinks).toEqual([
        { linkedAt: now, endedAt: now, endReason: 'moved' },
        { linkedAt: now, endedAt: null, endReason: null },
      ]);
      expect(JSON.stringify(response.body)).not.toContain(String(linked.chatId));
    });
  });

  describe('"Unlink Telegram" on the Parent page', () => {
    it('ends the link at once for the Academic Vice Principal, "unlinked by X for Y"', async () => {
      const linked = await linkedParent();
      const account = parentAccountSchema.parse(
        (await t.get(`/api/people/parents/${linked.relativeId}/account`, t.north, t.vicePrincipal))
          .body,
      );
      expect(account.account?.telegramLinkedAt).toBe(t.clock.now().toISOString());
      expect(JSON.stringify(account)).not.toContain(String(linked.chatId));

      expect((await unlinkBy(linked.relativeId)).status).toBe(204);
      const links = await linksOf(linked.account.id);
      expect(links).toMatchObject([{ end_reason: 'unlinked' }]);
      expect(links[0]?.ended_by).not.toBeNull();
      const entries = await t.entries('telegram.unlinked', links[0]?.id);
      expect(entries).toMatchObject([
        { branch_id: t.north, details: { reason: 'unlinked', accountId: linked.account.id } },
      ]);
      expect((await sessionOf(linked.cookie)).status).toBe(401);
      refusedWith(await launchSignIn(launch(linked.chatId)), 401, 'telegram_sign_in_needed');
      refusedWith(await unlinkBy(linked.relativeId), 409, 'no_telegram_link');
    });

    it('allows the Super Admin', async () => {
      const linked = await linkedParent();
      expect((await unlinkBy(linked.relativeId, t.north, t.admin)).status).toBe(204);
    });

    it('refuses the Principal, a Tutor, a Teacher, a parent and the Vice Principal of another branch', async () => {
      const linked = await linkedParent();
      for (const cookie of [t.principal, tutor, t.teacher, southVice]) {
        const before = await rowsOf();
        refusedWith(await unlinkBy(linked.relativeId, t.north, cookie), 403, 'permission_denied');
        expect(await rowsOf()).toEqual(before);
      }
      refusedWith(
        await unlinkBy(linked.relativeId, t.north, linked.cookie),
        403,
        'permission_denied',
      );
      // In the own branch, the Vice Principal of the south reaches no relative of the north.
      refusedWith(await unlinkBy(linked.relativeId, t.south, southVice), 404, 'not_found');
      expect(await linksOf(linked.account.id)).toMatchObject([{ ended_at: null }]);
    });

    it('answers 404 for a relative of another branch or unknown', async () => {
      const south = await linkedParent(t.south);
      for (const id of [south.relativeId, UNKNOWN]) {
        const before = await rowsOf();
        refusedWith(await unlinkBy(id), 404, 'not_found');
        refusedWith(await unlinkBy(id, t.north, t.admin), 404, 'not_found');
        expect(await rowsOf()).toEqual(before);
      }
    });
  });
});
