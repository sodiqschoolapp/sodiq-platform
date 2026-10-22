import { randomUUID } from 'node:crypto';
import { BRANCH_HEADER, REQUEST_KEY_HEADER } from '@sodiq/shared';
import ExcelJS from 'exceljs';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import type { PdfRenderer } from '../../http/pdf.js';
import { PDF_MEDIA_TYPE } from '../../http/pdf.js';
import { XLSX_MEDIA_TYPE } from '../../http/xlsx.js';
import { dayTemplatesKit, UNKNOWN, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { standingExamOver } from '../../testing/exams-kit.js';
import { heldEntry } from '../../testing/held-entry.js';
import { LoadKit } from '../../testing/load-kit.js';
import { publishedScene, type PublishedScene } from '../../testing/published-scene.js';
import { errorCode } from '../../testing/sign-in-kit.js';
import { binary } from '../../testing/xlsx-kit.js';

const NEXT_MONDAY = '2026-10-19';

/** Keeps the HTML of each PDF it is asked for; a fake for the API tests (Chromium runs in the browser test). */
class RecordingPdf implements PdfRenderer {
  readonly htmls: string[] = [];
  failing = false;

  render(html: string): Promise<Buffer> {
    if (this.failing) return Promise.reject(new ApiException('pdf_unavailable', 503));
    this.htmls.push(html);
    return Promise.resolve(Buffer.from('%PDF-1.7 recorded'));
  }

  get last(): string {
    const html = this.htmls[this.htmls.length - 1];
    if (html === undefined) throw new Error('No PDF was made.');
    return html;
  }
}

type Body = Readonly<Record<string, string | undefined>>;

/** A refusal is JSON; the file routes read every body as bytes. */
const refused = (response: Response, status: number, code: string) => {
  const body: unknown = Buffer.isBuffer(response.body)
    ? JSON.parse(response.body.toString('utf8'))
    : response.body;
  expect(response.status, JSON.stringify(body)).toBe(status);
  expect(errorCode({ ...response, body } as Response)).toBe(code);
};

/** The lines of the one sheet, each cell as ExcelJS reads it back. */
async function linesOf(content: Buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(content as unknown as ArrayBuffer);
  const [sheet] = workbook.worksheets;
  if (sheet === undefined) throw new Error('The file has no sheet.');
  const lines: { values: unknown[]; bold: boolean }[] = [];
  sheet.eachRow({ includeEmpty: true }, (row) => {
    lines.push({
      values: (row.values as unknown[]).slice(1),
      bold: row.getCell(1).font?.bold === true,
    });
  });
  return { sheet, lines };
}

// All names are invented. Task 5.9c-1, pull request #199: Print, PDF and
// Excel of the timetable views (06, Views and outputs: "Print, PDF and Excel
// for one class, one teacher, one room or the whole school"; edge/timetable,
// "The wall timetable is out of date": "A printed day or week includes them
// with an 'as of' time"). The clock stands at 23:55 on Saturday 10 October
// 2026 in Tashkent; the scene's version runs from Monday 12 October, with
// maths of each class on Monday at 08:00.
describe('the timetable files', () => {
  const pdf = new RecordingPdf();
  let t: DayTemplatesKit;
  let load: LoadKit;
  let s: PublishedScene;
  let south: PublishedScene;
  const cookies: Record<string, string> = {};

  const send = (body: Body, cookie = t.admin, branch = s.branch) =>
    request(t.kit.server)
      .post('/api/timetable/views/export')
      .set('Cookie', cookie)
      .set(BRANCH_HEADER, branch)
      .buffer(true)
      .parse(binary)
      .send({ date: NEXT_MONDAY, span: 'day', format: 'pdf', ...body });

  const ok = (response: Response, type = PDF_MEDIA_TYPE) => {
    expect(response.status, String(response.body)).toBe(200);
    expect(response.headers['content-type']).toContain(type);
    return response.body as Buffer;
  };

  /** The HTML of the PDF of a view. */
  const printed = async (body: Body, cookie = t.admin, branch = s.branch) => {
    ok(await send({ ...body, format: 'pdf' }, cookie, branch));
    return pdf.last;
  };

  const lessonOf = async (scene: PublishedScene, date: string, classId = scene.classId) => {
    const found = await t.database.migrator
      .selectFrom('lessons')
      .selectAll()
      .where('class_id', '=', classId)
      .where('lesson_date', '=', date)
      .executeTakeFirst();
    if (found === undefined) throw new Error('No such lesson.');
    return found;
  };

  const keyed = (path: string, branch: string, body: object) =>
    request(t.kit.server)
      .post(path)
      .set('Cookie', t.admin)
      .set(BRANCH_HEADER, branch)
      .set(REQUEST_KEY_HEADER, randomUUID())
      .send(body);

  type Held = {
    role: Parameters<DayTemplatesKit['kit']['giveRole']>[1]['role'];
    subjectIds?: string[];
  };

  const person = async (first: string, last: string, held: Held, branch = s.branch) => {
    const browser = await t.kit.completeSession(first, last);
    await t.kit.giveRole(browser.account.id, {
      role: held.role,
      validFrom: new Date('2026-09-01T00:00:00+05:00'),
      ...(held.role === 'senior_head_teacher' ? {} : { branchId: branch }),
      ...(held.subjectIds === undefined ? {} : { subjectIds: held.subjectIds }),
    });
    return { cookie: browser.cookie, accountId: browser.account.id };
  };

  const branchName = async (branch: string) =>
    (
      await t.database.migrator
        .selectFrom('branches')
        .select('name')
        .where('id', '=', branch)
        .executeTakeFirstOrThrow()
    ).name;

  const speak = (language: 'uz' | 'ru' | 'en') =>
    t.database.migrator.updateTable('accounts').set({ language }).execute();

  beforeAll(async () => {
    t = await dayTemplatesKit({ jobs: true, pdfRenderer: pdf });
    load = new LoadKit(t.database.migrator);
    const ownBrowser = await t.kit.completeSession('Kamola', 'Tursunova');
    s = await publishedScene(t, load, {
      branch: t.north,
      accounts: { teacher: ownBrowser.account.id },
    });
    south = await publishedScene(t, load, { branch: t.south });
    await t.kit.giveRole(ownBrowser.account.id, {
      role: 'teacher',
      branchId: s.branch,
      validFrom: new Date('2026-09-01T00:00:00+05:00'),
    });
    const tutor = await person('Gulnora', 'Azimova', { role: 'tutor' });
    const tutorAssignment = (
      await t.database.migrator
        .selectFrom('assignments')
        .select('id')
        .where('account_id', '=', tutor.accountId)
        .executeTakeFirstOrThrow()
    ).id;
    await load.teacher(s.branch, { accountId: tutor.accountId });
    await load.classes.tutorRow(s.branch, s.classId, tutorAssignment);
    const headTutor = await person('Sardor', 'Yusupov', { role: 'head_tutor' });
    const head = await person('Shahlo', 'Qodirova', {
      role: 'head_teacher',
      subjectIds: [s.subject],
    });
    Object.assign(cookies, {
      own: ownBrowser.cookie,
      tutor: tutor.cookie,
      headTutor: headTutor.cookie,
      head: head.cookie,
    });
    await speak('en');
  });

  afterAll(async () => {
    await t.close();
  });

  describe('who may print what (06, Views and outputs; the 5.9a scope)', () => {
    it('lets the Super Admin, the Principal and the Academic Vice Principal print every view of the branch', async () => {
      for (const cookie of [t.admin, t.principal, t.vicePrincipal]) {
        for (const body of [
          { kind: 'branch' },
          { kind: 'class', classId: s.classId },
          { kind: 'teacher', staffId: s.teacher.staffId },
          { kind: 'room', roomId: s.room },
        ]) {
          ok(await send(body, cookie));
          ok(await send({ ...body, format: 'xlsx' }, cookie), XLSX_MEDIA_TYPE);
        }
      }
    });

    it('lets the Tutor print the school and own class, nothing else', async () => {
      const cookie = cookies.tutor ?? '';
      ok(await send({ kind: 'branch' }, cookie));
      ok(await send({ kind: 'class', classId: s.classId }, cookie));
      refused(
        await send({ kind: 'class', classId: s.otherClass }, cookie),
        403,
        'timetable_view_scope',
      );
      refused(await send({ kind: 'room', roomId: s.room }, cookie), 403, 'timetable_view_scope');
      refused(
        await send({ kind: 'teacher', staffId: s.teacher.staffId }, cookie),
        403,
        'timetable_view_scope',
      );
    });

    it('lets the Head Tutor print the school and every class, no room and no other teacher', async () => {
      const cookie = cookies.headTutor ?? '';
      ok(await send({ kind: 'branch' }, cookie));
      ok(await send({ kind: 'class', classId: s.otherClass }, cookie));
      refused(await send({ kind: 'room', roomId: s.room }, cookie), 403, 'timetable_view_scope');
      refused(
        await send({ kind: 'teacher', staffId: s.teacher.staffId }, cookie),
        403,
        'timetable_view_scope',
      );
    });

    it('lets a Head Teacher print a teacher of own subject, not the school, a class or a room', async () => {
      const cookie = cookies.head ?? '';
      ok(await send({ kind: 'teacher', staffId: s.teacher.staffId }, cookie));
      refused(await send({ kind: 'branch' }, cookie), 403, 'timetable_view_scope');
      refused(
        await send({ kind: 'class', classId: s.classId }, cookie),
        403,
        'timetable_view_scope',
      );
      refused(await send({ kind: 'room', roomId: s.room }, cookie), 403, 'timetable_view_scope');
    });

    it('lets a teacher print their own timetable and nobody else’s', async () => {
      const cookie = cookies.own ?? '';
      ok(await send({ kind: 'teacher', staffId: s.teacher.staffId }, cookie));
      refused(
        await send({ kind: 'teacher', staffId: s.otherTeacher.staffId }, cookie),
        403,
        'timetable_view_scope',
      );
      refused(await send({ kind: 'branch' }, cookie), 403, 'timetable_view_scope');
      // A teacher with no staff record has no own timetable.
      refused(
        await send({ kind: 'teacher', staffId: s.teacher.staffId }, t.teacher),
        403,
        'timetable_view_scope',
      );
    });

    it('answers 404 for another branch’s and an unknown class, teacher and room, with no file and no entry', async () => {
      for (const [kind, key, ids] of [
        ['class', 'classId', [south.classId, UNKNOWN]],
        ['teacher', 'staffId', [south.teacher.staffId, UNKNOWN]],
        ['room', 'roomId', [south.room, UNKNOWN]],
      ] as const) {
        for (const id of ids) {
          for (const format of ['pdf', 'xlsx']) {
            const before = await t.auditCount();
            const made = pdf.htmls.length;
            refused(await send({ kind, [key]: id, format }), 404, 'not_found');
            expect(await t.auditCount()).toBe(before);
            expect(pdf.htmls).toHaveLength(made);
          }
        }
      }
      // The Super Admin too, whose assignment holds every branch.
      refused(await send({ kind: 'class', classId: south.classId }), 404, 'not_found');
    });

    it('refuses a body the kind has no use for (correction 6)', async () => {
      refused(await send({ kind: 'branch', classId: s.classId }), 400, 'validation_failed');
      refused(await send({ kind: 'class' }), 400, 'validation_failed');
    });
  });

  describe('what a file holds', () => {
    it('prints the lesson with the version, its "valid from" and the "as of" time in branch time', async () => {
      const html = await printed({ kind: 'class', classId: s.classId, span: 'week' });
      expect(html).toContain('Version 1, valid from 12.10.2026');
      // The clock: 23:55 on 10 October 2026 in Tashkent (decision 8).
      expect(html).toContain('As of 10.10.2026 23:55');
      expect(html).toMatch(/@bottom-left \{ content: "As of 10\.10\.2026 23:55"/);
      expect(html).toMatch(/@bottom-right \{ content: "Page " counter\(page\)/);
      expect(html).toContain('size: A4 landscape');
    });

    it('marks a changed, a cancelled and a replaced lesson as the views do', async () => {
      const date = '2026-11-09';
      const lesson = await lessonOf(s, date);
      const cancelled = await keyed(`/api/timetable/lessons/${lesson.id}/cancel`, s.branch, {
        reason: 'School trip',
      });
      expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
      await t.database.migrator
        .insertInto('lesson_changes')
        .values({
          lesson_id: lesson.id,
          branch_id: s.branch,
          changed_at: new Date('2026-10-10T12:00:00+05:00'),
        })
        .onConflict((conflict) =>
          conflict
            .column('lesson_id')
            .doUpdateSet({ changed_at: new Date('2026-10-10T12:00:00+05:00') }),
        )
        .execute();
      // The clock is 10 October: the mark of a change of that day still stands on 9 November's lesson.
      const html = await printed({ kind: 'class', classId: s.classId, date });
      expect(html).toContain('Cancelled: School trip');
      expect(html).toContain('changed');
      const { lines } = await linesOf(
        ok(
          await send({ kind: 'class', classId: s.classId, date, format: 'xlsx' }),
          XLSX_MEDIA_TYPE,
        ),
      );
      const row = lines.find((one) => one.values[9] === 'Lesson');
      expect(row?.values[10]).toBe('Cancelled: School trip; changed');
    });

    it('prints an exam marked "Exam" on each view that holds it (06, Exam)', async () => {
      const date = '2026-12-07';
      const lesson = await lessonOf(s, date);
      await standingExamOver(t.database.migrator, {
        lessonId: lesson.id,
        roomId: s.room,
        staffId: s.spareTeacher.staffId,
      });
      for (const body of [
        { kind: 'branch' },
        { kind: 'class', classId: s.classId },
        { kind: 'teacher', staffId: s.spareTeacher.staffId },
        { kind: 'room', roomId: s.room },
      ]) {
        const html = await printed({ ...body, date });
        expect(html, body.kind).toContain('<b>Exam</b> Quarter exam');
        const { lines } = await linesOf(
          ok(await send({ ...body, date, format: 'xlsx' }), XLSX_MEDIA_TYPE),
        );
        expect(
          lines.some((one) => one.values[9] === 'Exam'),
          body.kind,
        ).toBe(true);
      }
      // Another class does not hold it.
      expect(await printed({ kind: 'class', classId: s.otherClass, date })).not.toContain(
        'Quarter exam',
      );
    });

    it('names a day off, and a day outside the year, on the file', async () => {
      const scene = await publishedScene(t, load);
      await t.database.migrator
        .insertInto('calendar_entries')
        .values({
          branch_id: scene.branch,
          kind: 'day_off',
          name: 'Teachers’ Day',
          first_date: NEXT_MONDAY,
          last_date: NEXT_MONDAY,
        })
        .execute();
      expect(
        await printed({ kind: 'class', classId: scene.classId }, t.admin, scene.branch),
      ).toContain('Day off: Teachers’ Day');
      const { lines } = await linesOf(
        ok(
          await send(
            { kind: 'class', classId: scene.classId, format: 'xlsx' },
            t.admin,
            scene.branch,
          ),
          XLSX_MEDIA_TYPE,
        ),
      );
      // The day's lesson stays (the entry was written past the calendar routes); its row names the day off.
      expect(lines.find((one) => one.values[9] === 'Lesson')?.values[10]).toContain(
        'Day off: Teachers’ Day',
      );
      // The year ends on Monday 31 May 2027.
      expect(
        await printed({ kind: 'branch', date: '2027-05-31', span: 'week' }, t.admin, scene.branch),
      ).toContain('Outside the academic year');
    });

    it('says "one-day changes not included" on a day read from its pattern, and only there (edge/timetable)', async () => {
      const scene = await publishedScene(t, load);
      await t.app.get(Transactions).run([scene.branch], async (transaction: Transaction) => {
        const blocks = await transaction
          .selectFrom('lesson_blocks')
          .select('id')
          .where('version_id', '=', scene.version)
          .execute();
        const ids = blocks.map((one) => one.id);
        await transaction.deleteFrom('lessons').where('block_id', 'in', ids).execute();
        await transaction.deleteFrom('lesson_blocks').where('id', 'in', ids).execute();
        await heldEntry(transaction, scene.branch);
      });
      const html = await printed(
        { kind: 'class', classId: scene.classId, span: 'week' },
        t.admin,
        scene.branch,
      );
      expect(html.match(/From the weekly pattern; one-day changes not included/g)).toHaveLength(5);
      const { lines } = await linesOf(
        ok(
          await send(
            { kind: 'class', classId: scene.classId, span: 'week', format: 'xlsx' },
            t.admin,
            scene.branch,
          ),
          XLSX_MEDIA_TYPE,
        ),
      );
      expect(lines.find((one) => one.values[9] === 'Lesson')?.values[10]).toBe(
        'From the weekly pattern; one-day changes not included',
      );
      // A branch whose days are stored says nothing of the kind.
      expect(await printed({ kind: 'class', classId: s.classId, span: 'week' })).not.toContain(
        'one-day changes not included',
      );
    });
  });

  describe('a Head Teacher’s file (5.9a: "in those subjects only and with no busy block")', () => {
    it('leaves out the lessons of another subject and the busy blocks of another branch', async () => {
      const here = await publishedScene(t, load, { secondSubject: true });
      const away = await publishedScene(t, load);
      const head = await person(
        'Jamshid',
        'Hakimov',
        { role: 'head_teacher', subjectIds: [here.subject] },
        here.branch,
      );
      await speak('en');
      // A busy block: the teacher's own lesson of that Monday is cancelled, and
      // the other branch's lesson at the same time is theirs.
      const own = await lessonOf(here, NEXT_MONDAY);
      const cancelled = await keyed(`/api/timetable/lessons/${own.id}/cancel`, here.branch, {
        reason: 'Training day',
      });
      expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
      await t.database.migrator
        .insertInto('staff_branches')
        .values({ staff_id: here.teacher.staffId, branch_id: away.branch, is_main: false })
        .execute();
      await t.database.migrator
        .updateTable('lessons')
        .set({ teacher_id: here.teacher.staffId })
        .where('id', '=', (await lessonOf(away, NEXT_MONDAY)).id)
        .execute();
      // The teacher's second subject, in the other class on Monday's second slot.
      const other = here.secondSubject;
      if (other === null) throw new Error('The scene has a second subject.');
      const otherName = (
        await t.database.migrator
          .selectFrom('subjects')
          .select('name_en')
          .where('id', '=', other)
          .executeTakeFirstOrThrow()
      ).name_en;
      const awayName = await branchName(away.branch);
      const body = (date: string) => ({
        kind: 'teacher',
        staffId: here.teacher.staffId,
        span: 'week',
        date,
      });

      // The Super Admin's files hold both, so the fixture can fail.
      expect(await printed(body(NEXT_MONDAY), t.admin, here.branch)).toContain(awayName);
      expect(await printed(body('2026-10-26'), t.admin, here.branch)).toContain(otherName);

      const busyWeek = await printed(body(NEXT_MONDAY), head.cookie, here.branch);
      expect(busyWeek).toContain('Cancelled: Training day');
      expect(busyWeek).not.toContain(awayName);
      expect(await printed(body('2026-10-26'), head.cookie, here.branch)).not.toContain(otherName);
      for (const date of [NEXT_MONDAY, '2026-10-26']) {
        const content = ok(
          await send({ ...body(date), format: 'xlsx' }, head.cookie, here.branch),
          XLSX_MEDIA_TYPE,
        );
        const { lines } = await linesOf(content);
        const text = JSON.stringify(lines.map((one) => one.values));
        expect(text).not.toContain(awayName);
        expect(text).not.toContain(otherName);
      }
    });
  });

  describe('the language, the names and the fonts', () => {
    it('writes the texts in the account’s language and the names as entered, escaped', async () => {
      const scene = await publishedScene(t, load);
      const name = '<img src="http://x.invalid/a"> Oʻquv Ўқув';
      await t.database.migrator
        .updateTable('rooms')
        .set({ name })
        .where('id', '=', scene.room)
        .execute();
      await speak('ru');
      try {
        const html = await printed(
          { kind: 'class', classId: scene.classId, span: 'week' },
          t.admin,
          scene.branch,
        );
        expect(html).toContain('<html lang="ru">');
        expect(html).toContain('По состоянию на 10.10.2026 23:55');
        expect(html).toContain('Расписание класса');
        expect(html).toContain('Версия 1, действует с 12.10.2026');
        // The name is printed as typed, never read as markup (spec review should-fix 2).
        expect(html).not.toContain('<img src="http://x.invalid');
        expect(html).toContain('&lt;img src=&quot;http://x.invalid/a&quot;&gt; Oʻquv Ўқув');
        const { lines } = await linesOf(
          ok(
            await send(
              { kind: 'class', classId: scene.classId, span: 'week', format: 'xlsx' },
              t.admin,
              scene.branch,
            ),
            XLSX_MEDIA_TYPE,
          ),
        );
        expect(lines[1]?.values[0]).toBe('По состоянию на 10.10.2026 23:55');
        expect(lines.find((one) => one.values[9] === 'Урок')?.values[8]).toBe(name);
      } finally {
        await speak('en');
      }
    });

    it('holds the four Golos Text files with their ranges, the Uzbek mark face and the brand logo', async () => {
      const html = await printed({ kind: 'class', classId: s.classId });
      expect(html.match(/src: url\(data:font\/woff2;base64,/g)).toHaveLength(5);
      for (const range of [
        'U+0460-052F',
        'U+0301,U+0400-045F',
        'U+0100-02BA',
        'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC',
      ]) {
        expect(html).toContain(`unicode-range: ${range}`);
      }
      expect(html).toContain("font-family: 'Sodiq Uzbek mark'");
      expect(html).toContain('unicode-range: U+02BB;');
      // The exact file of the brand book (correction 4).
      const { readFile } = await import('node:fs/promises');
      const logo = await readFile(
        new URL('../../../../web/public/brand/sodiq-logo-horizontal-on-dark.svg', import.meta.url),
        'utf8',
      );
      expect(html).toContain(logo);
      // Nothing is fetched: no address outside the document.
      expect(html).not.toMatch(/(src|href)=["']?https?:/);
    });
  });

  describe('the Excel file', () => {
    it('has the title and "as of" above a bold, frozen heading row, and real dates and times', async () => {
      const content = ok(
        await send({ kind: 'class', classId: s.classId, span: 'week', format: 'xlsx' }),
        XLSX_MEDIA_TYPE,
      );
      const { sheet, lines } = await linesOf(content);
      expect(sheet.name).toBe('Timetable');
      expect(String(lines[0]?.values[0])).toContain('Class timetable');
      expect(lines[1]?.values[0]).toBe('As of 10.10.2026 23:55');
      expect(lines[2]?.values[0]).toBe('Version 1, valid from 12.10.2026');
      const heading = lines.findIndex((one) => one.values[0] === 'Date');
      expect(heading).toBe(3);
      expect(lines[heading]?.bold).toBe(true);
      expect(lines[0]?.bold).toBe(false);
      expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: heading + 1 });
      const lesson = lines[heading + 1]?.values ?? [];
      expect(lesson[0]).toBeInstanceOf(Date);
      expect((lesson[0] as Date).toISOString().slice(0, 10)).toBe(NEXT_MONDAY);
      expect(lesson[1]).toBe('Monday');
      expect(lesson[2]).toBe(1);
      // 08:00 and 08:45 as parts of a day.
      // ExcelJS reads a time cell back as a moment of 30 December 1899.
      expect((lesson[3] as Date).toISOString()).toBe('1899-12-30T08:00:00.000Z');
      expect((lesson[4] as Date).toISOString()).toBe('1899-12-30T08:45:00.000Z');
      expect(sheet.getColumn(4).numFmt).toBe('hh:mm');
      expect(lesson[11]).toBe(1);
      expect((lesson[12] as Date).toISOString().slice(0, 10)).toBe('2026-10-12');
    });

    it('keeps the list exports’ heading on the first row', async () => {
      const response = await request(t.kit.server)
        .post('/api/setup/rooms/export')
        .set('Cookie', t.admin)
        .set(BRANCH_HEADER, s.branch)
        .buffer(true)
        .parse(binary)
        .send({
          ids: [s.room],
          columns: ['name'],
          selection: 'ticked',
          search: '',
          filters: {},
        });
      const { sheet, lines } = await linesOf(ok(response, XLSX_MEDIA_TYPE));
      expect(lines[0]?.bold).toBe(true);
      expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    });
  });

  describe('the audit log (02, Rules: every export is logged)', () => {
    it('writes one entry per file with the request, "as of" and the counts', async () => {
      const before = (await t.entries('timetable_view.export')).length;
      ok(
        await send({ kind: 'class', classId: s.classId, span: 'week', format: 'xlsx' }),
        XLSX_MEDIA_TYPE,
      );
      const entries = await t.entries('timetable_view.export');
      expect(entries).toHaveLength(before + 1);
      expect(entries[entries.length - 1]).toMatchObject({
        branch_id: s.branch,
        details: {
          kind: 'class',
          viewOf: s.classId,
          date: NEXT_MONDAY,
          span: 'week',
          format: 'xlsx',
          asOf: '2026-10-10T18:55:00.000Z',
          lessons: 1,
          exams: 0,
          busy: 0,
          fromPatternDays: 0,
        },
      });
    });

    it('writes none for a refusal or a PDF that could not be made, and sends no file', async () => {
      const before = await t.auditCount();
      refused(
        await send({ kind: 'room', roomId: s.room }, cookies.tutor),
        403,
        'timetable_view_scope',
      );
      pdf.failing = true;
      try {
        refused(await send({ kind: 'class', classId: s.classId }), 503, 'pdf_unavailable');
      } finally {
        pdf.failing = false;
      }
      expect(await t.auditCount()).toBe(before);
      // Excel does not need Chromium (edge/system-behaviour: "Only that function fails").
      ok(await send({ kind: 'class', classId: s.classId, format: 'xlsx' }), XLSX_MEDIA_TYPE);
    });
  });
});
