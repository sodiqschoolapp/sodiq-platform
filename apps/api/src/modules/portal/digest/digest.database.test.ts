import { BRANCH_HEADER, studentNameKey } from '@sodiq/shared';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { sql } from 'kysely';
import { MOMENT_SETTING, Transactions } from '../../../database/transactions.js';
import {
  dayTemplatesKit,
  START,
  type DayTemplatesKit,
} from '../../../testing/day-templates-kit.js';
import { LoadKit } from '../../../testing/load-kit.js';
import { ParentsKit } from '../../../testing/parents-kit.js';
import { TEST_BOT_TOKEN, TEST_WEBHOOK_SECRET } from '../../../testing/telegram-kit.js';
import { publishedScene, type PublishedScene } from '../../../testing/published-scene.js';
import { Audit } from '../../audit/audit.service.js';
import { saveCells } from '../../journal/cells.js';
import { StudentResultsService } from '../../results/student-results.service.js';
import type { TelegramFetch } from '../telegram/bot-api.js';
import { DigestService } from './digest.service.js';

/** A message the bot sent: the chat and the text. */
interface Sent {
  chat: string;
  text: string;
  button: boolean;
}

// All names, chats and tokens are invented. Task 11.5, pull request #299: the parents' digest
// (`10`, The parents' digest; `07`, Exemptions and Comments; plan decisions 1 to 18 and review
// corrections 1 to 3). The service is called with the injected clock set, as the jobs call it.
describe('the parents digest', () => {
  let t: DayTemplatesKit;
  let load: LoadKit;
  let parents: ParentsKit;
  let s: PublishedScene;
  let digest: DigestService;
  let lessons: { l12: string; l19: string; l26: string; a12: string; a19: string; a26: string };
  let works: { cw12: string; cw19: string; removable: string };
  /** Family A: Kamron, and his mother, daily. */
  let kamron: string;
  let motherA: { accountId: string; chat: string; relativeId: string };
  /** Family B: Dilnoza in the same class, and her father, daily. */
  let dilnoza: string;
  let fatherB: { accountId: string; chat: string; relativeId: string };
  const sent: Sent[] = [];
  let goodStart: string;
  let answer = { ok: true, status: 200 };
  let nextChat = 7_100_000;

  const fakeFetch: TelegramFetch = (_url, init) => {
    const body = JSON.parse(typeof init.body === 'string' ? init.body : '{}') as {
      chat_id: string;
      text: string;
      reply_markup?: unknown;
    };
    if (answer.ok) {
      sent.push({
        chat: String(body.chat_id),
        text: body.text,
        button: body.reply_markup !== undefined,
      });
    }
    return Promise.resolve(answer);
  };

  const messagesTo = (chat: string): string[] =>
    sent.filter((one) => one.chat === chat).map((one) => one.text);

  const at = async <T>(moment: string, work: () => Promise<T>): Promise<T> => {
    t.clock.set(moment);
    try {
      return await work();
    } finally {
      t.clock.set(START);
    }
  };

  /** The tick, then the send of every digest it made due, at the moment. */
  const run = async (moment: string): Promise<void> => {
    await at(moment, async () => {
      await digest.tick();
      const due = await t.database.migrator
        .selectFrom('digests')
        .select('id')
        .where('status', '=', 'due')
        .orderBy('id')
        .execute();
      for (const one of due) await digest.send(one.id);
    });
  };

  const digestOf = (accountId: string, date: string) =>
    t.database.migrator
      .selectFrom('digests')
      .selectAll()
      .where('account_id', '=', accountId)
      .where('digest_date', '=', date)
      .executeTakeFirst();

  const saveOn = async (
    moment: string,
    cells: { lessonId: string; studentId: string; workId?: string; value: number | null }[],
    branch?: string,
  ) => {
    const writer = await load.classes.account();
    const versions = await t.database.migrator
      .selectFrom('journal_cells')
      .select(['lesson_id', 'student_id', 'work_id', 'version'])
      .where(
        'student_id',
        'in',
        cells.map((cell) => cell.studentId),
      )
      .execute();
    await at(moment, () =>
      t.app.get(Transactions).run([branch ?? s.branch], (transaction) =>
        saveCells(
          transaction,
          t.app.get(Audit),
          { accountId: writer },
          cells.map((cell) => ({
            lessonId: cell.lessonId,
            studentId: cell.studentId,
            workId: cell.workId ?? null,
            value: cell.value,
            version:
              versions.find(
                (one) =>
                  one.lesson_id === cell.lessonId &&
                  one.student_id === cell.studentId &&
                  one.work_id === (cell.workId ?? null),
              )?.version ?? null,
          })),
        ),
      ),
    );
  };

  const comment = async (input: {
    moment: string;
    studentId: string;
    target: 'mark' | 'work' | 'note';
    lessonId: string;
    workId?: string;
    body: string;
    visibility: 'staff' | 'parents';
  }): Promise<string> => {
    const writer = await load.classes.account();
    return at(input.moment, () =>
      t.app.get(Transactions).run([s.branch], async (transaction) => {
        await t.app.get(Audit).record(transaction, {
          branchId: s.branch,
          actorId: writer,
          action: 'journal.comment',
        });
        const row = await transaction
          .insertInto('journal_comments')
          .values({
            branch_id: s.branch,
            student_id: input.studentId,
            target: input.target,
            lesson_id: input.lessonId,
            work_id: input.workId ?? null,
            rating_exam_id: null,
            body: input.body,
            visibility: input.visibility,
            version: 1,
            changed_by: writer,
            changed_how: 'entry',
            changed_at: new Date(input.moment),
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        return row.id;
      }),
    );
  };

  /** A comment's text changed, as the journal writes it (8.2). */
  const editComment = async (id: string, body: string, moment: string) => {
    const writer = await load.classes.account();
    await at(moment, () =>
      t.app.get(Transactions).run([s.branch], async (transaction) => {
        await t.app.get(Audit).record(transaction, {
          branchId: s.branch,
          actorId: writer,
          action: 'journal.comment',
        });
        await transaction
          .updateTable('journal_comments')
          .set({ body, changed_by: writer, changed_how: 'entry' })
          .where('id', '=', id)
          .execute();
      }),
    );
  };

  const exempt = async (
    studentId: string,
    date: string,
    other?: { branch: string; year: string; moment: string },
  ) => {
    const branch = other?.branch;
    const year = other?.year;
    const writer = await load.classes.account();
    await at(other?.moment ?? `${date}T07:00:00+05:00`, () =>
      t.app.get(Transactions).run([branch ?? s.branch], async (transaction) => {
        await t.app.get(Audit).record(transaction, {
          branchId: branch ?? s.branch,
          actorId: writer,
          action: 'exemption.create',
        });
        await transaction
          .insertInto('exemptions')
          .values({
            branch_id: branch ?? s.branch,
            student_id: studentId,
            year_id: year ?? s.year,
            batch_id: '019a0000-0000-7000-8000-0000000000b2',
            kind: 'temporary',
            all_subjects: true,
            start_date: date,
            end_date: date,
            start_time: null,
            end_time: null,
            category: 'illness',
            detail: 'DIAGNOSIS-staff-only',
            granted_by: writer,
            granted_at: new Date(0),
            version: 0,
            changed_at: new Date(0),
          })
          .execute();
      }),
    );
  };

  const named = async (studentId: string, firstName: string) => {
    await t.database.migrator
      .updateTable('students')
      .set({ first_name: firstName, name_key: studentNameKey('Rahimova', firstName) })
      .where('id', '=', studentId)
      .execute();
  };

  /** A Parent account of the relative with an open Telegram link made at the moment. */
  const linked = async (relativeId: string, moment: string) => {
    const session = await parents.session(relativeId);
    nextChat += 1;
    await t.database.migrator
      .insertInto('telegram_links')
      .values({
        account_id: session.account.id,
        telegram_user_id: String(nextChat),
        linked_at: new Date(moment),
      })
      .execute();
    return {
      accountId: session.account.id,
      chat: String(nextChat),
      relativeId,
      cookie: session.cookie,
    };
  };

  const frequency = async (accountId: string, value: 'daily' | 'twice_weekly' | 'weekly') => {
    await t.database.migrator
      .insertInto('digest_frequencies')
      .values({ account_id: accountId, frequency: value, chosen_at: new Date(0) })
      .onConflict((conflict) => conflict.column('account_id').doUpdateSet({ frequency: value }))
      .execute();
  };

  const linkOf = (studentId: string, relativeId: string) =>
    t.database.migrator
      .updateTable('student_relatives')
      .where('student_id', '=', studentId)
      .where('relative_id', '=', relativeId);

  beforeAll(async () => {
    t = await dayTemplatesKit({
      jobs: true,
      telegramFetch: fakeFetch,
      config: {
        telegram: {
          botToken: TEST_BOT_TOKEN,
          webhookSecret: TEST_WEBHOOK_SECRET,
          webOrigin: 'https://app.example.test',
        },
      },
    });
    load = new LoadKit(t.database.migrator);
    parents = new ParentsKit(t.app, t.database.migrator, await load.classes.account());
    s = await publishedScene(t, load, { graded: true, secondSubject: true });
    digest = t.app.get(DigestService);
    const ofClass = async (subjectId: string) =>
      (
        await t.database.migrator
          .selectFrom('lessons')
          .select('id')
          .where('class_id', '=', s.otherClass)
          .where('subject_id', '=', subjectId)
          .where('lesson_date', '<=', '2026-10-31')
          .orderBy('starts_at')
          .execute()
      ).map((one) => one.id);
    const [l12, l19, l26] = await ofClass(s.subject);
    const [a12, a19, a26] = await ofClass(s.secondSubject ?? '');
    if (
      l12 === undefined ||
      l19 === undefined ||
      l26 === undefined ||
      a12 === undefined ||
      a19 === undefined ||
      a26 === undefined
    ) {
      throw new Error('Three Mondays of each subject.');
    }
    lessons = { l12, l19, l26, a12, a19, a26 };

    const a = await parents.student(s.branch);
    kamron = a.studentId;
    await named(kamron, 'Kamron');
    await parents.members.member({
      branch: s.branch,
      classId: s.otherClass,
      studentId: kamron,
      from: '2026-09-01',
    });
    const b = await parents.student(s.branch);
    dilnoza = b.studentId;
    await named(dilnoza, 'Dilnoza');
    await parents.members.member({
      branch: s.branch,
      classId: s.otherClass,
      studentId: dilnoza,
      from: '2026-09-01',
    });
    motherA = await linked(a.relativeId, '2026-10-01T10:00:00+05:00');
    fatherB = await linked(b.relativeId, '2026-10-01T10:00:00+05:00');
    await frequency(motherA.accountId, 'daily');
    await frequency(fatherB.accountId, 'daily');

    const work = async (lessonId: string, total: number) =>
      (
        await t.database.migrator
          .insertInto('journal_works')
          .values({
            branch_id: s.branch,
            lesson_id: lessonId,
            kind: 'classwork',
            total,
            title: 'Fractions quiz',
          })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
    works = {
      cw12: await work(l12, 30),
      cw19: await work(l19, 5),
      removable: await work(l12, 10),
    };
    // The 12th: Kamron present with 12 of 30, skipped the other subject; the 19th: late with
    // 4 of 5. Dilnoza: present with 30 of 30.
    await saveOn('2026-10-12T18:00:00+05:00', [
      { lessonId: l12, studentId: kamron, value: 1 },
      { lessonId: l12, studentId: kamron, workId: works.cw12, value: 12 },
      { lessonId: a12, studentId: kamron, value: 3 },
      { lessonId: l12, studentId: kamron, workId: works.removable, value: 9 },
      { lessonId: l12, studentId: dilnoza, value: 1 },
      { lessonId: l12, studentId: dilnoza, workId: works.cw12, value: 30 },
    ]);
    await saveOn('2026-10-19T18:00:00+05:00', [
      { lessonId: l19, studentId: kamron, value: 2 },
      { lessonId: l19, studentId: kamron, workId: works.cw19, value: 4 },
    ]);
    goodStart = await comment({
      moment: '2026-10-12T18:30:00+05:00',
      studentId: kamron,
      target: 'work',
      lessonId: l12,
      workId: works.cw12,
      body: 'Good start, parents',
      visibility: 'parents',
    });
    await comment({
      moment: '2026-10-12T18:30:00+05:00',
      studentId: kamron,
      target: 'mark',
      lessonId: l12,
      body: 'STAFF-only-12',
      visibility: 'staff',
    });
    await comment({
      moment: '2026-10-12T18:30:00+05:00',
      studentId: dilnoza,
      target: 'work',
      lessonId: l12,
      workId: works.cw12,
      body: 'OTHER-family-12',
      visibility: 'parents',
    });
  }, 240_000);

  afterAll(async () => {
    await t.close();
  });

  it('sends the first digest at 19:00 with what was saved since the chat was linked', async () => {
    await run('2026-10-19T18:59:00+05:00');
    expect(await digestOf(motherA.accountId, '2026-10-19')).toBeUndefined();
    await run('2026-10-19T19:00:00+05:00');
    const row = await digestOf(motherA.accountId, '2026-10-19');
    expect(row?.status).toBe('delivered');
    expect(row?.period_from?.toISOString()).toBe(
      new Date('2026-10-01T10:00:00+05:00').toISOString(),
    );
    const [text, ...more] = messagesTo(motherA.chat);
    expect(more).toEqual([]);
    expect(text).toContain('Kamron');
    // The summary: three marked lessons (present, skipped, late), one not marked.
    expect(text).toMatch(/Attendance: attended 2 of 3 lessons\.|Davomat: 3 ta darsdan 2 tasiga/u);
    expect(sent.find((one) => one.chat === motherA.chat)?.button).toBe(true);
  });

  it('writes in the parent language, Uzbek until chosen', () => {
    const [text] = messagesTo(motherA.chat);
    expect(text).toContain('Sodiq maktabi');
    expect(text).toContain('12/30');
    expect(text).toContain('4/5');
    expect(text).toContain('Fractions quiz');
    expect(text).toContain('kechikkan');
    expect(text).toContain('Good start, parents');
  });

  it('never names another family child, a staff-only comment or the last name', () => {
    const all = messagesTo(motherA.chat).join('\n');
    expect(all).not.toContain('Dilnoza');
    expect(all).not.toContain('OTHER-family-12');
    expect(all).not.toContain('STAFF-only-12');
    expect(all).not.toContain('Rahimova');
    const theirs = messagesTo(fatherB.chat).join('\n');
    expect(theirs).toContain('Dilnoza');
    expect(theirs).not.toContain('Kamron');
    expect(theirs).not.toContain('Good start, parents');
    expect(theirs).toContain('OTHER-family-12');
  });

  it('lists a correction once marked "corrected" and a late mark for an old lesson once', async () => {
    await t.database.migrator
      .updateTable('accounts')
      .set({ language: 'en' })
      .where('id', '=', motherA.accountId)
      .execute();
    await saveOn('2026-10-20T10:00:00+05:00', [
      { lessonId: lessons.l19, studentId: kamron, workId: works.cw19, value: 5 },
      { lessonId: lessons.a19, studentId: kamron, value: 0 },
    ]);
    const before = messagesTo(motherA.chat).length;
    await run('2026-10-20T19:00:00+05:00');
    const text = messagesTo(motherA.chat).slice(before).join('\n');
    expect(text).toContain('5/5 (corrected)');
    expect(text).toContain('19 Oct: absent');
    expect(text).not.toContain('12/30');
    expect(text).not.toContain('Good start, parents');
    // The next day: nothing saved, no lesson held (the class has lessons on Mondays): no message.
    const next = messagesTo(motherA.chat).length;
    await run('2026-10-21T19:00:00+05:00');
    expect(messagesTo(motherA.chat).length).toBe(next);
    expect((await digestOf(motherA.accountId, '2026-10-21'))?.status).toBe('nothing');
  });

  it('does not list an entry changed and changed back', async () => {
    await saveOn('2026-10-22T09:00:00+05:00', [
      { lessonId: lessons.a19, studentId: kamron, value: 1 },
    ]);
    await saveOn('2026-10-22T09:30:00+05:00', [
      { lessonId: lessons.a19, studentId: kamron, value: 0 },
    ]);
    await run('2026-10-22T19:00:00+05:00');
    expect((await digestOf(motherA.accountId, '2026-10-22'))?.status).toBe('nothing');
  });

  it('lists an absence that became exempt once as "removed", never as an absence', async () => {
    await exempt(kamron, '2026-10-19');
    const before = messagesTo(motherA.chat).length;
    await run('2026-10-23T19:00:00+05:00');
    const text = messagesTo(motherA.chat).slice(before).join('\n');
    expect(text).toContain('19 Oct: removed');
    expect(text).not.toMatch(/: absent|: late/u);
    expect(text).not.toContain('DIAGNOSIS');
  });

  it('counts no exempt lesson in the summary and lists no exempt absence', async () => {
    // Monday the 26th: Kamron exempt for the day before it, absent from both lessons.
    await exempt(kamron, '2026-10-26');
    await saveOn('2026-10-26T15:00:00+05:00', [
      { lessonId: lessons.l26, studentId: dilnoza, value: 1 },
    ]);
    const before = messagesTo(motherA.chat).length;
    await run('2026-10-26T19:00:00+05:00');
    const text = messagesTo(motherA.chat).slice(before).join('\n');
    // Lessons were held, all exempt, nothing saved: nothing new (spec review of the code,
    // should-fix 1).
    expect(text).toBe('');
    expect((await digestOf(motherA.accountId, '2026-10-26'))?.status).toBe('nothing');
  });

  // A work that holds a number cannot be removed (8.1, `work_holds_data`; the delete guard of
  // 0119): a score leaves the journal by being cleared, or with its lesson's forced delete.
  it('lists a cleared score once as "removed", and the clearing is not held up', async () => {
    await saveOn('2026-10-27T10:00:00+05:00', [
      { lessonId: lessons.l12, studentId: kamron, workId: works.removable, value: null },
    ]);
    // Spec review of the code, must-fix 1: a comment beside no score is not sent.
    await comment({
      moment: '2026-10-27T10:30:00+05:00',
      studentId: kamron,
      target: 'work',
      lessonId: lessons.l12,
      workId: works.removable,
      body: 'NO-score-comment',
      visibility: 'parents',
    });
    // Must-fix 6: an edited comment is listed again, "corrected".
    await editComment(goodStart, 'Good start, edited', '2026-10-27T11:00:00+05:00');
    const before = messagesTo(motherA.chat).length;
    await run('2026-10-27T19:00:00+05:00');
    const text = messagesTo(motherA.chat).slice(before).join('\n');
    expect(text.match(/12 Oct: removed/gu)?.length).toBe(1);
    expect(text).not.toContain('9/10');
    expect(text).not.toContain('NO-score-comment');
    expect(text).toContain('«Good start, edited» (corrected)');
  });

  // Review correction 1: a save whose moment lies before the end of the previous digest, committed
  // after that digest read the journal, reaches the next digest once.
  it('sends a save that committed after the previous digest read the journal, once', async () => {
    await saveOn('2026-10-27T18:58:00+05:00', [
      { lessonId: lessons.a12, studentId: kamron, value: 2 },
    ]);
    const before = messagesTo(motherA.chat).length;
    await run('2026-10-28T19:00:00+05:00');
    const text = messagesTo(motherA.chat).slice(before).join('\n');
    expect(text).toContain('12 Oct: late (corrected)');
    expect(text).not.toContain('Good start');
  });

  it('takes a child out whose link lost portal access or "receives notices" after the digest fell due', async () => {
    await saveOn('2026-10-28T20:00:00+05:00', [
      { lessonId: lessons.l26, studentId: dilnoza, value: 2 },
    ]);
    // Due on the 29th, then portal access off before the send.
    await at('2026-10-29T19:00:00+05:00', () => digest.tick());
    await linkOf(dilnoza, fatherB.relativeId).set({ portal_access: false }).execute();
    const before = messagesTo(fatherB.chat).length;
    await run('2026-10-29T19:01:00+05:00');
    expect(messagesTo(fatherB.chat).length).toBe(before);
    expect((await digestOf(fatherB.accountId, '2026-10-29'))?.status).toBe('nothing');
    await linkOf(dilnoza, fatherB.relativeId).set({ portal_access: true }).execute();

    await saveOn('2026-10-29T20:00:00+05:00', [
      { lessonId: lessons.l26, studentId: dilnoza, value: 0 },
    ]);
    await at('2026-10-30T19:00:00+05:00', () => digest.tick());
    await linkOf(dilnoza, fatherB.relativeId).set({ receives_notices: false }).execute();
    await run('2026-10-30T19:01:00+05:00');
    expect(messagesTo(fatherB.chat).length).toBe(before);
    await linkOf(dilnoza, fatherB.relativeId).set({ receives_notices: true }).execute();
  });

  it('waits through the quiet hours and tries a failing Telegram again by back-off', async () => {
    // The worker was down from 18:30 to 21:30: due at 21:30, sent at 08:00 (review correction 3).
    await saveOn('2026-10-31T10:00:00+05:00', [
      { lessonId: lessons.l26, studentId: dilnoza, value: 0 },
    ]);
    await run('2026-10-31T21:30:00+05:00');
    const held = await digestOf(fatherB.accountId, '2026-10-31');
    expect(held?.status).toBe('due');
    expect(held?.attempts).toBe(0);
    answer = { ok: false, status: 502 };
    await expect(
      at('2026-11-01T08:00:00+05:00', () => digest.send(held?.id ?? '')),
    ).rejects.toThrow();
    const failed = await digestOf(fatherB.accountId, '2026-10-31');
    expect(failed?.status).toBe('due');
    expect(failed?.attempts).toBe(1);
    // A save meanwhile is not slowed or refused: the digest writes nothing at a save.
    await saveOn('2026-11-01T08:00:30+05:00', [
      { lessonId: lessons.l26, studentId: dilnoza, value: 2 },
    ]);
    answer = { ok: true, status: 200 };
    const before = messagesTo(fatherB.chat).length;
    await run('2026-11-01T08:01:30+05:00');
    expect((await digestOf(fatherB.accountId, '2026-10-31'))?.status).toBe('delivered');
    const text = messagesTo(fatherB.chat).slice(before).join('\n');
    // The value as it stands when sent: late, saved after the first try.
    expect(text).toContain('kechikkan');
  });

  it('marks a chat that blocked the bot and skips it until it is opened again', async () => {
    await saveOn('2026-11-02T10:00:00+05:00', [
      { lessonId: lessons.l26, studentId: dilnoza, value: 0 },
    ]);
    answer = { ok: false, status: 403 };
    await run('2026-11-02T19:00:00+05:00');
    answer = { ok: true, status: 200 };
    expect((await digestOf(fatherB.accountId, '2026-11-02'))?.status).toBe('blocked');
    const link = await t.database.migrator
      .selectFrom('telegram_links')
      .select('bot_blocked_at')
      .where('account_id', '=', fatherB.accountId)
      .where('ended_at', 'is', null)
      .executeTakeFirstOrThrow();
    expect(link.bot_blocked_at).not.toBeNull();
    await run('2026-11-03T19:00:00+05:00');
    expect(await digestOf(fatherB.accountId, '2026-11-03')).toBeUndefined();
  });

  it('names no child who left the school', async () => {
    await t.database.migrator
      .updateTable('telegram_links')
      .set({ bot_blocked_at: null })
      .where('account_id', '=', fatherB.accountId)
      .execute();
    // A leaving as the service writes it: the class row cut, then the status rows.
    await t.database.migrator.transaction().execute(async (transaction) => {
      const leaving = await parents.members.leaving(transaction, s.branch, dilnoza, '2026-11-04');
      await transaction
        .updateTable('class_memberships')
        .set({ valid_until: '2026-11-04', ended_by: 'leaving', leaving_id: leaving })
        .where('student_id', '=', dilnoza)
        .execute();
    });
    const before = messagesTo(fatherB.chat).length;
    await run('2026-11-04T19:00:00+05:00');
    expect(messagesTo(fatherB.chat).length).toBe(before);
    // The blocked digest's period stayed open: the next one would have covered it.
    expect((await digestOf(fatherB.accountId, '2026-11-04'))?.status).toBe('nothing');
  });

  it('falls due on the days of each frequency, and a changed time moves it', async () => {
    const weekly = await linked(
      (await parents.student(s.branch)).relativeId,
      '2026-11-01T10:00:00+05:00',
    );
    await frequency(weekly.accountId, 'weekly');
    const twice = await linked(
      (await parents.student(s.branch)).relativeId,
      '2026-11-01T10:00:00+05:00',
    );
    // Thursday the 5th: neither; Saturday the 7th: both; Wednesday the 11th: twice a week only.
    await run('2026-11-05T19:00:00+05:00');
    expect(await digestOf(weekly.accountId, '2026-11-05')).toBeUndefined();
    expect(await digestOf(twice.accountId, '2026-11-05')).toBeUndefined();
    await t.database.migrator.updateTable('digest_settings').set({ send_at: '18:00' }).execute();
    await run('2026-11-07T17:59:00+05:00');
    expect(await digestOf(twice.accountId, '2026-11-07')).toBeUndefined();
    await run('2026-11-07T18:00:00+05:00');
    expect((await digestOf(weekly.accountId, '2026-11-07'))?.due_at.toISOString()).toBe(
      new Date('2026-11-07T18:00:00+05:00').toISOString(),
    );
    expect(await digestOf(twice.accountId, '2026-11-07')).toBeDefined();
    await t.database.migrator.updateTable('digest_settings').set({ send_at: '19:00' }).execute();
    await run('2026-11-11T19:00:00+05:00');
    expect(await digestOf(weekly.accountId, '2026-11-11')).toBeUndefined();
    expect(await digestOf(twice.accountId, '2026-11-11')).toBeDefined();
    // Two ticks at once, before any digest of the date, make one (spec review of the code,
    // must-fix 7).
    expect(await digestOf(twice.accountId, '2026-11-14')).toBeUndefined();
    await at('2026-11-14T19:05:00+05:00', () => Promise.all([digest.tick(), digest.tick()]));
    const count = await t.database.migrator
      .selectFrom('digests')
      .select((eb) => eb.fn.countAll().as('n'))
      .where('account_id', '=', twice.accountId)
      .where('digest_date', '=', '2026-11-14')
      .executeTakeFirstOrThrow();
    expect(Number(count.n)).toBe(1);
  });

  it('refuses a digest time inside the quiet hours in the database', async () => {
    await expect(
      t.database.migrator.updateTable('digest_settings').set({ send_at: '22:00' }).execute(),
    ).rejects.toThrow(/digest_settings_send_at_check/u);
  });

  // Permission review of the code, must-fix 2: the privacy cases of the Release 2 section for the
  // digest: a child in another branch, an unlinked relative, another branch's child not linked.
  describe('across branches', () => {
    let laylo: string;
    let bobur: string;
    let sardor: string;
    let southLesson: string;
    let southScene: PublishedScene;
    const mondayLessonOn = async (classId: string, subjectId: string, date: string) =>
      (
        await t.database.migrator
          .selectFrom('lessons')
          .select('id')
          .where('class_id', '=', classId)
          .where('subject_id', '=', subjectId)
          .where('lesson_date', '=', date)
          .executeTakeFirstOrThrow()
      ).id;
    let kamronLesson: string;

    const mondayLesson = async (classId: string, subjectId: string) =>
      (
        await t.database.migrator
          .selectFrom('lessons')
          .select('id')
          .where('class_id', '=', classId)
          .where('subject_id', '=', subjectId)
          .where('lesson_date', '=', '2026-11-09')
          .executeTakeFirstOrThrow()
      ).id;

    beforeAll(async () => {
      const south = await publishedScene(t, load, { branch: t.south, graded: true });
      southScene = south;
      southLesson = await mondayLesson(south.otherClass, south.subject);
      kamronLesson = await mondayLesson(s.otherClass, s.subject);
      // Laylo: the mother's second child, in the other branch.
      laylo = await parents.childOf(t.south, motherA.relativeId);
      await named(laylo, 'Laylo');
      await parents.members.member({
        branch: t.south,
        classId: south.otherClass,
        studentId: laylo,
        from: '2026-09-01',
      });
      // Bobur: another family's child in the other branch, in Laylo's class.
      bobur = (await parents.student(t.south)).studentId;
      await named(bobur, 'Bobur');
      await parents.members.member({
        branch: t.south,
        classId: south.otherClass,
        studentId: bobur,
        from: '2026-09-01',
      });
      // Sardor: in Kamron's class, once linked to the mother, the link ended (unlinked).
      sardor = await parents.childOf(s.branch, motherA.relativeId);
      await named(sardor, 'Sardor');
      await parents.members.member({
        branch: s.branch,
        classId: s.otherClass,
        studentId: sardor,
        from: '2026-09-01',
      });
      // Unlinked as the service writes it: another main contact, the moment of the transaction.
      const father = await parents.relativeOf(s.branch, sardor);
      await t.database.migrator.transaction().execute(async (transaction) => {
        const moment = new Date('2026-10-30T09:00:00+05:00');
        await sql`select set_config(${MOMENT_SETTING}, ${moment.toISOString()}, true)`.execute(
          transaction,
        );
        await transaction
          .updateTable('student_relatives')
          .set({ main_contact: false })
          .where('student_id', '=', sardor)
          .execute();
        await transaction
          .updateTable('student_relatives')
          .set({ main_contact: true })
          .where('student_id', '=', sardor)
          .where('relative_id', '=', father)
          .execute();
        await transaction
          .updateTable('student_relatives')
          .set({ unlinked_at: moment })
          .where('student_id', '=', sardor)
          .where('relative_id', '=', motherA.relativeId)
          .execute();
      });
      await saveOn('2026-11-12T10:00:00+05:00', [
        { lessonId: kamronLesson, studentId: kamron, value: 2 },
        { lessonId: kamronLesson, studentId: sardor, value: 0 },
      ]);
      await saveOn(
        '2026-11-12T10:00:00+05:00',
        [
          { lessonId: southLesson, studentId: laylo, value: 0 },
          { lessonId: southLesson, studentId: bobur, value: 0 },
        ],
        t.south,
      );
    }, 240_000);

    it("gives a parent of two branches one message with each child's own part, and no one else", async () => {
      const before = messagesTo(motherA.chat).length;
      await run('2026-11-12T19:00:00+05:00');
      const text = messagesTo(motherA.chat).slice(before).join('\n');
      const kamronPart = text.slice(text.indexOf('Kamron'), text.indexOf('Laylo'));
      const layloPart = text.slice(text.indexOf('Laylo'));
      expect(text.indexOf('Kamron')).toBeGreaterThan(-1);
      expect(text.indexOf('Laylo')).toBeGreaterThan(text.indexOf('Kamron'));
      expect(kamronPart).toContain('9 Nov: late');
      expect(kamronPart).not.toMatch(/: absent/u);
      expect(layloPart).toContain('9 Nov: absent');
      expect(layloPart).not.toMatch(/: late/u);
      expect(text).not.toContain('Bobur');
      expect(text).not.toContain('Sardor');
    });

    // Permission review of the code, must-fix 1: the scope read again in the transaction of the
    // send, after the journal was read.
    it('takes out a child whose portal access went off after the journal was read', async () => {
      await saveOn('2026-11-13T10:00:00+05:00', [
        { lessonId: kamronLesson, studentId: kamron, value: 0 },
      ]);
      await saveOn(
        '2026-11-13T10:00:00+05:00',
        [{ lessonId: southLesson, studentId: laylo, value: 2 }],
        t.south,
      );
      const results = t.app.get(StudentResultsService);
      const original = results.familyLessons.bind(results);
      // The first child read is Kamron (by first name): his access goes off once his journal was read.
      const spy = vi.spyOn(results, 'familyLessons').mockImplementationOnce(async (...args) => {
        const answer = await original(...args);
        await linkOf(kamron, motherA.relativeId).set({ portal_access: false }).execute();
        return answer;
      });
      const before = messagesTo(motherA.chat).length;
      try {
        await run('2026-11-13T19:00:00+05:00');
      } finally {
        spy.mockRestore();
        await linkOf(kamron, motherA.relativeId).set({ portal_access: true }).execute();
      }
      const text = messagesTo(motherA.chat).slice(before).join('\n');
      expect(text).toContain('Laylo');
      expect(text).not.toContain('Kamron');
      // A sent mark changed to another mark (must-fix 6): listed again, "corrected".
      expect(text).toContain('9 Nov: late (corrected)');
      const row = await digestOf(motherA.accountId, '2026-11-13');
      expect(row?.status).toBe('delivered');
      const parts = await t.database.migrator
        .selectFrom('digest_parts')
        .select(['student_id', 'in_message'])
        .where('digest_id', '=', row?.id ?? '')
        .execute();
      expect(parts.filter((one) => one.in_message).map((one) => one.student_id)).toEqual([laylo]);
      const entries = await t.database.migrator
        .selectFrom('digest_entries')
        .select('student_id')
        .where('digest_id', '=', row?.id ?? '')
        .execute();
      expect(entries.every((one) => one.student_id === laylo)).toBe(true);
    });

    // Spec review of the code, must-fix 6: an exemption granted after the digest fell due and
    // before it is sent: the absence it covers is not sent.
    it('sends no absence that an exemption covers by the time of sending', async () => {
      const lesson = await mondayLessonOn(southScene.otherClass, southScene.subject, '2026-11-16');
      await saveOn(
        '2026-11-16T15:00:00+05:00',
        [{ lessonId: lesson, studentId: laylo, value: 0 }],
        t.south,
      );
      await at('2026-11-16T19:00:00+05:00', () => digest.tick());
      expect((await digestOf(motherA.accountId, '2026-11-16'))?.status).toBe('due');
      await exempt(laylo, '2026-11-16', {
        branch: t.south,
        year: southScene.year,
        moment: '2026-11-16T19:00:30+05:00',
      });
      const before = messagesTo(motherA.chat).length;
      await run('2026-11-16T19:01:00+05:00');
      const text = messagesTo(motherA.chat).slice(before).join('\n');
      expect(text).not.toContain('16 Nov: absent');
    });

    // Must-fix 6: a retry held by the quiet hours; the 8th attempt failed, its period left open.
    it('holds a retry through the quiet hours, and leaves the period of a failed digest open', async () => {
      await saveOn('2026-11-17T10:00:00+05:00', [
        { lessonId: lessons.a12, studentId: kamron, value: 3 },
      ]);
      answer = { ok: false, status: 502 };
      await at('2026-11-17T19:00:00+05:00', () => digest.tick());
      const due = await digestOf(motherA.accountId, '2026-11-17');
      try {
        await expect(
          at('2026-11-17T20:59:30+05:00', () => digest.send(due?.id ?? '')),
        ).rejects.toThrow();
      } finally {
        answer = { ok: true, status: 200 };
      }
      expect((await digestOf(motherA.accountId, '2026-11-17'))?.attempts).toBe(1);
      answer = { ok: true, status: 200 };
      // The next try (21:00:30) falls in the quiet hours: nothing until 08:00.
      await run('2026-11-17T21:30:00+05:00');
      expect((await digestOf(motherA.accountId, '2026-11-17'))?.status).toBe('due');
      await run('2026-11-18T08:00:00+05:00');
      const delivered = await digestOf(motherA.accountId, '2026-11-17');
      expect(delivered?.status).toBe('delivered');
      expect(delivered?.attempts).toBe(2);

      await at('2026-11-18T19:00:00+05:00', () => digest.tick());
      const last = await digestOf(motherA.accountId, '2026-11-18');
      // A first try fails as the others would; then the count stands at the last attempt.
      await saveOn('2026-11-18T10:00:00+05:00', [
        { lessonId: lessons.a12, studentId: kamron, value: 0 },
      ]);
      answer = { ok: false, status: 502 };
      try {
        await expect(
          at('2026-11-18T19:00:30+05:00', () => digest.send(last?.id ?? '')),
        ).rejects.toThrow();
      } finally {
        answer = { ok: true, status: 200 };
      }
      await t.database.migrator
        .updateTable('digests')
        .set({ attempts: 8, next_try_at: new Date('2026-11-18T19:00:00+05:00') })
        .where('id', '=', last?.id ?? '')
        .execute();
      await at('2026-11-18T19:30:00+05:00', () => digest.send(last?.id ?? ''));
      const failed = await digestOf(motherA.accountId, '2026-11-18');
      expect(failed?.status).toBe('failed');
      expect(failed?.period_until).toBeNull();
      // Its children are in the send log all the same (must-fix 2).
      const named = await t.database.migrator
        .selectFrom('digest_parts')
        .select('student_id')
        .where('digest_id', '=', failed?.id ?? '')
        .execute();
      expect(named.map((one) => one.student_id).sort()).toEqual([kamron, laylo].sort());
      await run('2026-11-19T19:00:00+05:00');
      const next = await digestOf(motherA.accountId, '2026-11-19');
      expect(next?.period_from?.toISOString()).toBe(delivered?.period_until?.toISOString());
    });

    // Review correction 2: a score whose row is gone (its lesson's forced delete) is listed once
    // "removed", and the delete is not held up by the digest.
    it('lists once as "removed" what a forced delete of its lesson took away', async () => {
      const deleted = await request(t.kit.server)
        .post(`/api/timetable/lessons/${lessons.l12}/forced-delete`)
        .set('Cookie', t.admin)
        .set(BRANCH_HEADER, s.branch)
        .set('Idempotency-Key', randomUUID())
        .send({ reason: 'Entered for the wrong class' });
      expect(deleted.status, JSON.stringify(deleted.body)).toBe(200);
      const before = messagesTo(motherA.chat).length;
      await run('2026-11-20T19:00:00+05:00');
      const text = messagesTo(motherA.chat).slice(before).join('\n');
      // The score 12/30 and its comment, each once.
      expect(text.match(/12 Oct: removed/gu)?.length).toBe(2);
      expect(text).not.toContain('12/30');
      const after = messagesTo(motherA.chat).length;
      await run('2026-11-21T19:00:00+05:00');
      expect(messagesTo(motherA.chat).slice(after).join('\n')).not.toContain('12 Oct');
    });
  });

  it('never makes a digest for a staff account: a staff account has no Telegram link', async () => {
    const staffAccount = await load.classes.account();
    await expect(
      t.database.migrator
        .insertInto('telegram_links')
        .values({
          account_id: staffAccount,
          telegram_user_id: '7199999',
          linked_at: new Date('2026-10-01T10:00:00+05:00'),
        })
        .execute(),
    ).rejects.toThrow(/telegram_link_not_parent/u);
    const rows = await t.database.migrator
      .selectFrom('digests')
      .select('id')
      .where('account_id', '=', staffAccount)
      .execute();
    expect(rows).toEqual([]);
  });

  // Review must-fix 6 of the plan, decision 17: a mark entered late for a lesson of the branch a
  // child left reaches the parent once.
  it('sends a late mark for a lesson of the branch the child moved from', async () => {
    const southClass = (
      await t.database.migrator
        .selectFrom('classes')
        .select('id')
        .where('branch_id', '=', t.south)
        .orderBy('id')
        .executeTakeFirstOrThrow()
    ).id;
    const moved = await parents.student(s.branch);
    await named(moved.studentId, 'Nodir');
    await parents.members.member({
      branch: s.branch,
      classId: s.otherClass,
      studentId: moved.studentId,
      from: '2026-09-01',
    });
    // The move through the routes of 3.3c: released from the first branch, accepted in the other.
    const read = await t.get(`/api/people/students/${moved.studentId}`, s.branch);
    const released = await t.post(`/api/people/students/${moved.studentId}/branch-move`, s.branch, {
      toBranchId: t.south,
      from: '2026-10-28',
      version: (read.body as { version: number }).version,
    });
    expect(released.status, JSON.stringify(released.body)).toBe(200);
    const move = await t.database.migrator
      .selectFrom('student_branch_moves')
      .select('id')
      .where('student_id', '=', moved.studentId)
      .executeTakeFirstOrThrow();
    // Accepted on its date, the sessions kept fresh at that moment (the idle limit).
    const acceptAt = '2026-10-28T09:00:00+05:00';
    await t.database.migrator
      .updateTable('sessions')
      .set({ created_at: new Date(acceptAt), last_used_at: new Date(acceptAt) })
      .where('ended_at', 'is', null)
      .execute();
    const accepted = await at(acceptAt, () =>
      t.post(`/api/people/branch-moves/${move.id}/accept`, t.south, {
        classId: southClass,
        groups: [],
      }),
    );
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
    const father = await linked(moved.relativeId, '2026-10-01T10:00:00+05:00');
    await frequency(father.accountId, 'daily');
    await saveOn('2026-11-02T10:00:00+05:00', [
      { lessonId: lessons.l26, studentId: moved.studentId, value: 0 },
    ]);
    await run('2026-11-02T19:00:00+05:00');
    const text = messagesTo(father.chat).join('\n');
    expect(text).toContain('Nodir');
    expect(text).toContain('26 okt: kelmagan');
  });
});
