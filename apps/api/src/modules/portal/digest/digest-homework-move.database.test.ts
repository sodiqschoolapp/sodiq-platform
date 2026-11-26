import { DIGEST_TEXTS, studentNameKey } from '@sodiq/shared';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  dayTemplatesKit,
  START,
  type DayTemplatesKit,
} from '../../../testing/day-templates-kit.js';
import { LoadKit } from '../../../testing/load-kit.js';
import { ParentsKit } from '../../../testing/parents-kit.js';
import { publishedScene, type PublishedScene } from '../../../testing/published-scene.js';
import { TEST_BOT_TOKEN, TEST_WEBHOOK_SECRET } from '../../../testing/telegram-kit.js';
import type { TelegramFetch } from '../telegram/bot-api.js';
import { DigestService } from './digest.service.js';

const MOVE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../../../db/migrations/0186_homework_at_its_lesson.sql',
);

/** The move itself: the `do` block of 0186, as the migration runs it. */
async function moveBlock(): Promise<string> {
  const text = await readFile(MOVE, 'utf8');
  const start = text.indexOf('\ndo $$\n');
  const end = text.indexOf('\nend\n$$;\n', start);
  if (start < 0 || end < 0) throw new Error('0186 has no move block.');
  return text.slice(start + 1, end + '\nend\n$$;'.length);
}

// Task 11.24 (the plan's Build (4) and decision 8): "the move does not make the digest send a
// moved score again as 'corrected'". `10`, The parents' digest: "A score, mark or comment that
// was in an earlier digest and was changed or removed since appears again, marked 'corrected'
// or 'removed'": a number left out by the move (its student was exempt at the lesson where
// the homework was given) left the averages, so it is listed once as "removed". The homework
// is written as the code before 0186 wrote it, at the next lesson, then the move block of
// 0186 runs as the migration runs it. All names and chats are invented.
describe('the digest across the homework move of 0186', () => {
  let t: DayTemplatesKit;
  let load: LoadKit;
  let parents: ParentsKit;
  let s: PublishedScene;
  let digest: DigestService;
  let given: string;
  let checked: string;
  let kamron: string;
  let aziza: string;
  let motherA: { accountId: string; chat: string };
  let fatherB: { accountId: string; chat: string };
  const sent: { chat: string; text: string }[] = [];
  let nextChat = 7_200_000;

  const fakeFetch: TelegramFetch = (_url, init) => {
    const body = JSON.parse(typeof init.body === 'string' ? init.body : '{}') as {
      chat_id: string;
      text: string;
    };
    sent.push({ chat: String(body.chat_id), text: body.text });
    return Promise.resolve({ ok: true, status: 200 });
  };

  const messagesTo = (chat: string): string[] =>
    sent.filter((one) => one.chat === chat).map((one) => one.text);

  /** The tick, then the send of every digest it made due, at the moment. */
  const run = async (moment: string): Promise<void> => {
    t.clock.set(moment);
    try {
      await digest.tick();
      const due = await t.database.migrator
        .selectFrom('digests')
        .select('id')
        .where('status', '=', 'due')
        .orderBy('id')
        .execute();
      for (const one of due) await digest.send(one.id);
    } finally {
      t.clock.set(START);
    }
  };

  const named = async (studentId: string, firstName: string) => {
    await t.database.migrator
      .updateTable('students')
      .set({ first_name: firstName, name_key: studentNameKey('Rahimova', firstName) })
      .where('id', '=', studentId)
      .execute();
  };

  /** A parent of the student with an open Telegram link and a daily digest. */
  const family = async (firstName: string) => {
    const student = await parents.student(s.branch);
    await named(student.studentId, firstName);
    await parents.members.member({
      branch: s.branch,
      classId: s.otherClass,
      studentId: student.studentId,
      from: '2026-09-01',
    });
    const session = await parents.session(student.relativeId);
    nextChat += 1;
    await t.database.migrator
      .insertInto('telegram_links')
      .values({
        account_id: session.account.id,
        telegram_user_id: String(nextChat),
        linked_at: new Date('2026-10-01T10:00:00+05:00'),
      })
      .execute();
    await t.database.migrator
      .insertInto('digest_frequencies')
      .values({ account_id: session.account.id, frequency: 'daily', chosen_at: new Date(0) })
      .execute();
    return {
      studentId: student.studentId,
      parent: { accountId: session.account.id, chat: String(nextChat) },
    };
  };

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
    s = await publishedScene(t, load, { graded: true });
    digest = t.app.get(DigestService);
    const lessons = (
      await t.database.migrator
        .selectFrom('lessons')
        .select('id')
        .where('class_id', '=', s.otherClass)
        .where('subject_id', '=', s.subject)
        .where('lesson_date', '<=', '2026-10-31')
        .orderBy('starts_at')
        .execute()
    ).map((one) => one.id);
    [given = '', checked = ''] = lessons;
    const a = await family('Kamron');
    kamron = a.studentId;
    motherA = a.parent;
    const b = await family('Aziza');
    aziza = b.studentId;
    fatherB = b.parent;
    const writer = await load.classes.account();
    // Aziza is exempt on the day the homework was given, and back at the lesson that checked it.
    const day = await t.database.migrator
      .selectFrom('lessons')
      .select('lesson_date')
      .where('id', '=', given)
      .executeTakeFirstOrThrow();
    await t.database.migrator.transaction().execute(async (transaction) => {
      await sql`select set_config('app.now', ${new Date('2026-10-01T09:00:00+05:00').toISOString()}, true)`.execute(
        transaction,
      );
      await transaction
        .insertInto('exemptions')
        .values({
          branch_id: s.branch,
          student_id: aziza,
          year_id: s.year,
          batch_id: '019a0000-0000-7000-8000-0000000011b4',
          kind: 'temporary',
          all_subjects: true,
          start_date: day.lesson_date,
          end_date: day.lesson_date,
          category: 'illness',
          detail: 'A certificate from the clinic',
          granted_by: writer,
          granted_at: new Date(0),
          version: 0,
          changed_at: new Date(0),
        })
        .execute();
    });
    // The homework given at the first lesson, stored at the next lesson with the numbers, as the
    // check lesson saved them before 0186. Since 0186 the database refuses that shape
    // (journal_works_at_source), so the test lifts the check for its fixture and puts it back.
    await t.database.migrator.transaction().execute(async (transaction) => {
      await sql`select set_config('app.now', ${new Date('2026-10-19T18:00:00+05:00').toISOString()}, true)`.execute(
        transaction,
      );
      await sql`alter table journal_works drop constraint journal_works_at_source`.execute(
        transaction,
      );
      const work = await transaction
        .insertInto('journal_works')
        .values({
          branch_id: s.branch,
          lesson_id: checked,
          source_lesson_id: given,
          kind: 'homework',
          position: 1,
          title: 'Reading page 12',
          total: 10,
          changed_by: writer,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      for (const [student, value] of [
        [kamron, 7],
        [aziza, 6],
      ] as const) {
        await transaction
          .insertInto('journal_cells')
          .values({
            branch_id: s.branch,
            lesson_id: checked,
            student_id: student,
            work_id: work.id,
            score: value,
            version: 1,
            changed_by: writer,
            changed_how: 'entry',
            changed_at: new Date('2026-10-19T18:00:00+05:00'),
          })
          .execute();
      }
    });
  }, 240_000);

  afterAll(async () => {
    await t.close();
  });

  it('sends the homework scores once before the move', async () => {
    await run('2026-10-19T19:00:00+05:00');
    expect(messagesTo(motherA.chat).join('\n')).toContain('7/10');
    expect(messagesTo(fatherB.chat).join('\n')).toContain('6/10');
  });

  it('sends no moved score again, and the score left out once as "removed"', async () => {
    const block = await moveBlock();
    await t.database.migrator.transaction().execute(async (transaction) => {
      await sql`select set_config('app.now', ${new Date('2026-10-20T10:00:00+05:00').toISOString()}, true)`.execute(
        transaction,
      );
      await sql.raw(block).execute(transaction);
      await sql`
        alter table journal_works add constraint journal_works_at_source check (
          source_lesson_id is null or lesson_id = source_lesson_id
        )
      `.execute(transaction);
    });
    const moved = await t.database.migrator
      .selectFrom('journal_cells')
      .select(['lesson_id', 'score', 'student_id'])
      .where('work_id', 'is not', null)
      .where('student_id', 'in', [kamron, aziza])
      .execute();
    expect(moved.find((one) => one.student_id === kamron)).toMatchObject({
      lesson_id: given,
      score: 7,
    });
    expect(moved.find((one) => one.student_id === aziza)).toMatchObject({
      lesson_id: given,
      score: null,
    });
    const mother = messagesTo(motherA.chat).length;
    const father = messagesTo(fatherB.chat).length;
    await run('2026-10-20T19:00:00+05:00');
    const toMother = messagesTo(motherA.chat).slice(mother).join('\n');
    expect(toMother).not.toContain('7/10');
    expect(toMother).not.toContain(DIGEST_TEXTS.uz.corrected);
    const toFather = messagesTo(fatherB.chat).slice(father).join('\n');
    expect(toFather.match(new RegExp(DIGEST_TEXTS.uz.removed, 'gu'))?.length).toBe(1);
    expect(toFather).not.toContain(DIGEST_TEXTS.uz.corrected);
    await run('2026-10-21T19:00:00+05:00');
    const later = messagesTo(fatherB.chat).slice(father).join('\n');
    expect(later.match(new RegExp(DIGEST_TEXTS.uz.removed, 'gu'))?.length).toBe(1);
  });
});
