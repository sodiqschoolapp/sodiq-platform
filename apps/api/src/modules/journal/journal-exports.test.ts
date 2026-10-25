import { randomUUID } from 'node:crypto';
import {
  BRANCH_HEADER,
  REQUEST_KEY_HEADER,
  JOURNAL_EXPORT_TEXTS,
  journalExportListSchema,
  journalGridSchema,
  journalExportRequestedSchema,
  type Language,
} from '@sodiq/shared';
import ExcelJS from 'exceljs';
import { sql } from 'kysely';
import request, { type Response } from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Transactions } from '../../database/transactions.js';
import { dayTemplatesKit, START, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { MembersKit } from '../../testing/members-kit.js';
import { RecordingPdf, refusedFile } from '../../testing/pdf-kit.js';
import { publishedScene, type PublishedScene } from '../../testing/published-scene.js';
import { binary } from '../../testing/xlsx-kit.js';
import { Audit } from '../audit/audit.service.js';
import { MemoryPhotoStore } from '../people/photo-store.js';
import { saveCells } from './cells.js';
import { journalSheet } from './journal-export.js';
import { JournalExports } from './journal-exports.service.js';
import { JournalGridReader } from './journal-grid.service.js';

const store = new MemoryPhotoStore();
const pdf = new RecordingPdf();

/** Tuesday 27 October 2026, noon in Tashkent: the Mondays 12, 19 and 26 October are held. */
const MOMENT = '2026-10-27T12:00:00+05:00';

const codeOf = (response: Response): string => {
  let body: unknown = response.body;
  if (Buffer.isBuffer(body)) {
    try {
      body = JSON.parse(body.toString('utf8'));
    } catch {
      return `status ${String(response.status)}`;
    }
  }
  return (body as { error?: { code?: string } }).error?.code ?? `status ${String(response.status)}`;
};

/** Every sheet of a workbook, each row as its values from the first column. */
async function sheetsOf(content: Buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(content as unknown as ArrayBuffer);
  return workbook.worksheets.map((sheet) => {
    const rows: { values: unknown[]; formats: (string | undefined)[] }[] = [];
    sheet.eachRow({ includeEmpty: true }, (row) => {
      const values = (row.values as unknown[]).slice(1);
      rows.push({
        values,
        formats: values.map((_, index) => row.getCell(index + 1).numFmt),
      });
    });
    return { name: sheet.name, rows };
  });
}

// All names are invented. Task 8.9, pull request #227: the exports of journals
// (docs/spec/07-journal.md, last paragraph; docs/spec/edge-cases/system-behaviour.md, "A whole
// branch's journals are exported to PDF during lessons"; docs/spec/edge-cases/journal.md, "A
// results table is exported in week 6").
describe('journal exports', () => {
  let t: DayTemplatesKit;
  let load: LoadKit;
  let names = 0;

  const account = async (language: Language = 'en') => {
    names += 1;
    const browser = await t.kit.completeSession('Nodira', `Usmonova${'a'.repeat(names % 7)}`);
    await t.database.migrator
      .updateTable('accounts')
      .set({ language })
      .where('id', '=', browser.account.id)
      .execute();
    return browser;
  };

  type Held = Parameters<DayTemplatesKit['kit']['giveRole']>[1];
  type Browser = { cookie: string; account: { id: string } };

  /** Gives the roles from 1 September and answers the assignments. */
  const give = async (browser: Browser, roles: readonly Omit<Held, 'validFrom'>[]) => {
    const given: string[] = [];
    for (const held of roles) {
      const assignment = await t.kit.giveRole(browser.account.id, {
        ...held,
        validFrom: new Date('2026-09-01T00:00:00+05:00'),
      });
      given.push(assignment.id);
    }
    return given;
  };

  /** The clock at the moment, with the browser's session in use then. */
  const at = async (browser: Browser, moment: string) => {
    t.clock.set(moment);
    await t.database.migrator
      .updateTable('sessions')
      .set({ created_at: new Date(moment), last_used_at: new Date(moment) })
      .where('account_id', '=', browser.account.id)
      .execute();
  };

  const fileCall = (browser: Browser, branch: string, method: 'get' | 'post', path: string) =>
    request(t.kit.server)
      [method](path)
      .set('Cookie', browser.cookie)
      .set(BRANCH_HEADER, branch)
      .buffer(true)
      .parse(binary);

  const exportOf = (browser: Browser, branch: string, journalId: string, body: object) =>
    fileCall(browser, branch, 'post', `/api/journal/journals/${journalId}/export`).send(body);

  const askBranch = (browser: Browser, branch: string, body: object, key = randomUUID()) =>
    t.post('/api/journal/exports', branch, body, browser.cookie).set(REQUEST_KEY_HEADER, key);

  const student = async (
    branch: string,
    classId: string,
    name: { first: string; last: string; paternal?: string },
    from = '2026-09-01',
    until?: string,
  ): Promise<string> => {
    const members = new MembersKit(t.database.migrator, await load.classes.account());
    const id = await members.student(branch, { startsOn: '2026-09-01', grade: 7 });
    await t.database.migrator
      .updateTable('students')
      .set({
        first_name: name.first,
        last_name: name.last,
        ...(name.paternal === undefined ? {} : { paternal_name: name.paternal }),
      })
      .where('id', '=', id)
      .execute();
    await members.member({
      branch,
      classId,
      studentId: id,
      from,
      ...(until === undefined ? {} : { ownUntil: until }),
    });
    return id;
  };

  const lessonsOf = async (scene: Pick<PublishedScene, 'classId'>) =>
    t.database.migrator
      .selectFrom('lessons')
      .select(['id', 'lesson_date'])
      .where('class_id', '=', scene.classId)
      .where('lesson_date', '<=', '2026-10-31')
      .orderBy('starts_at')
      .execute();

  const journalOf = async (classId: string) =>
    (
      await t.database.migrator
        .selectFrom('journals')
        .select('id')
        .where('class_id', '=', classId)
        .executeTakeFirstOrThrow()
    ).id;

  const quarterOf = async (year: string, number: number) =>
    (
      await t.database.migrator
        .selectFrom('quarters')
        .select('id')
        .where('academic_year_id', '=', year)
        .where('number', '=', number)
        .executeTakeFirstOrThrow()
    ).id;

  const save = async (
    branch: string,
    cells: { lessonId: string; studentId: string; workId?: string; value: number }[],
  ) => {
    t.clock.set(MOMENT);
    try {
      const writer = await load.classes.account();
      await t.app.get(Transactions).run([branch], (transaction) =>
        saveCells(
          transaction,
          t.app.get(Audit),
          { accountId: writer },
          cells.map((cell) => ({
            lessonId: cell.lessonId,
            studentId: cell.studentId,
            workId: cell.workId ?? null,
            value: cell.value,
            version: null,
          })),
        ),
      );
    } finally {
      t.clock.set(START);
    }
  };

  const work = async (
    branch: string,
    lessonId: string,
    kind: 'classwork' | 'homework',
    total: number,
  ) =>
    (
      await t.database.migrator
        .insertInto('journal_works')
        .values({ branch_id: branch, lesson_id: lessonId, kind, total })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

  /**
   * The graded scene of 6.2: 7th grade maths on the Mondays 12, 19 and 26 October;
   * Zokirov 1 and a classwork 12 of 30 on the 12th; two students named Karimov Ali,
   * told apart by the paternal name; Oʻktamov, Shodiyev and Abdullayev, who left on the
   * 20th (the folded section).
   */
  async function scene() {
    const s = await publishedScene(t, load, { graded: true });
    const [first, second, third] = await lessonsOf(s);
    if (first === undefined || second === undefined || third === undefined) {
      throw new Error('The scene has three lessons in the first quarter.');
    }
    const zokirov = await student(s.branch, s.classId, { first: 'Ali', last: 'Zokirov' });
    const oktamov = await student(s.branch, s.classId, { first: 'Bek', last: 'Oʻktamov' });
    const shodiyev = await student(s.branch, s.classId, { first: 'Bek', last: 'Shodiyev' });
    await student(s.branch, s.classId, { first: 'Bek', last: 'Gʻaniyev' });
    await student(s.branch, s.classId, { first: 'Bek', last: 'Chorshanbiyev' });
    const karimov1 = await student(s.branch, s.classId, {
      first: 'Ali',
      last: 'Karimov',
      paternal: 'Botirovich',
    });
    const karimov2 = await student(s.branch, s.classId, {
      first: 'Ali',
      last: 'Karimov',
      paternal: 'Anvarovich',
    });
    const abdullayev = await student(
      s.branch,
      s.classId,
      { first: 'Said', last: 'Abdullayev' },
      '2026-09-01',
      '2026-10-20',
    );
    const cw = await work(s.branch, first.id, 'classwork', 30);
    await save(s.branch, [
      { lessonId: first.id, studentId: zokirov, value: 1 },
      { lessonId: first.id, studentId: zokirov, workId: cw, value: 12 },
      { lessonId: first.id, studentId: abdullayev, value: 0 },
    ]);
    return {
      s,
      journal: await journalOf(s.classId),
      q1: await quarterOf(s.year, 1),
      q2: await quarterOf(s.year, 2),
      lessons: [first, second, third],
      cw,
      zokirov,
      oktamov,
      shodiyev,
      karimov1,
      karimov2,
      abdullayev,
    };
  }

  beforeAll(async () => {
    t = await dayTemplatesKit({ jobs: true, photoStore: store, pdfRenderer: pdf });
    load = new LoadKit(t.database.migrator);
  });

  afterEach(() => {
    t.clock.set(START);
  });

  afterAll(async () => {
    await t.close();
  });

  describe('of one journal', () => {
    it('writes the grid of the reader to Excel: header and stamp, real numbers and dates, the fixed name order, the folded section and one audit entry', async () => {
      const principal = await account();
      const x = await scene();
      await give(principal, [{ role: 'principal', branchId: x.s.branch }]);
      await at(principal, MOMENT);
      const answer = await exportOf(principal, x.s.branch, x.journal, {
        format: 'xlsx',
        quarterId: x.q1,
      });
      expect(answer.status, codeOf(answer)).toBe(200);
      expect(String(answer.headers['content-type'])).toContain('spreadsheetml');
      const [sheet, ...others] = await sheetsOf(answer.body as Buffer);
      expect(others).toEqual([]);
      if (sheet === undefined) throw new Error('One sheet.');
      const values = sheet.rows.map((row) => row.values);
      // 07, Opening a journal: "Sinf jurnali", then Class · Subject · Quarter · Month, "Teacher".
      expect(values[0]).toEqual(['Class journal']);
      expect(String(values[1]?.[0])).toContain('Quarter 1');
      expect(String(values[2]?.[0])).toMatch(/^Teacher: /);
      // edge/journal, "A results table is exported in week 6": "Provisional" with date and time.
      expect(values[3]).toEqual(['Provisional · 27.10.2026 12:00']);
      const headings = (values[4] ?? []).map(String);
      expect(headings.slice(0, 3)).toEqual(['No.', 'Student', 'UID']);
      const markColumn = headings.findIndex(
        (one) => one.startsWith('12.10.2026 Mon') && one.endsWith('· A'),
      );
      expect(markColumn).toBeGreaterThan(2);
      const cwColumn = headings.findIndex((one) => one.includes('CW1') && one.includes('Soni 30'));
      expect(headings[cwColumn + 1]).toMatch(/%$/);
      // The date row: real dates (edge/system-behaviour: "Excel exports contain real numbers and dates").
      const dateRow = sheet.rows[5];
      expect(dateRow?.values[1]).toBe('Date');
      expect(dateRow?.values[markColumn]).toBeInstanceOf(Date);
      expect((dateRow?.values[markColumn] as Date).toISOString().slice(0, 10)).toBe('2026-10-12');
      expect(dateRow?.formats[markColumn]).toBe('yyyy-mm-dd');
      // The rows in the grid's fixed order: Karimov twice, told apart by the paternal name, then
      // Zokirov, then oʻ and sh after z (edge/journal, Uzbek names).
      const rows = values.slice(6);
      const listed = rows.map((row) => row[1]);
      expect(listed.slice(0, 7)).toEqual([
        'Karimov Ali Anvarovich',
        'Karimov Ali Botirovich',
        'Zokirov Ali',
        'Oʻktamov Bek',
        'Gʻaniyev Bek',
        'Shodiyev Bek',
        'Chorshanbiyev Bek',
      ]);
      const zokirov = rows[2] ?? [];
      // A real number for the mark, the number typed and its percent from the grid.
      expect(zokirov[markColumn]).toBe(1);
      expect(zokirov[cwColumn]).toBe(12);
      expect(zokirov[cwColumn + 1]).toBe(40);
      // The bottom row, then the folded section with the student who left.
      expect(rows[7]?.[1]).toBe('Average');
      expect(rows[8]?.[0]).toBe('Left or moved');
      expect(rows[9]?.[1]).toBe('Abdullayev Said');
      expect(rows[9]?.[markColumn]).toBe(0);
      const entries = await t.entries('journal.export', x.journal);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        actor_id: principal.account.id,
        details: { quarterId: x.q1, month: null, format: 'xlsx', shape: 'whole', rows: 8 },
      });
      t.clock.set(START);
    });

    it('writes the PDF with a number and its percent in one cell, in the language of the account, with subject names in it and class names as entered', async () => {
      const vice = await account('ru');
      const x = await scene();
      await give(vice, [{ role: 'academic_vice_principal', branchId: x.s.branch }]);
      await at(vice, MOMENT);
      const subject = await t.database.migrator
        .selectFrom('subjects')
        .select(['name_ru', 'name_en'])
        .where('id', '=', x.s.subject)
        .executeTakeFirstOrThrow();
      const unit = await t.database.migrator
        .selectFrom('classes')
        .select('name')
        .where('id', '=', x.s.classId)
        .executeTakeFirstOrThrow();
      const answer = await exportOf(vice, x.s.branch, x.journal, {
        format: 'pdf',
        quarterId: x.q1,
        month: '2026-10',
      });
      expect(answer.status, codeOf(answer)).toBe(200);
      expect(String(answer.headers['content-type'])).toContain('application/pdf');
      const html = pdf.last;
      expect(html).toContain('Классный журнал');
      expect(html).toContain(subject.name_ru);
      expect(html).not.toContain(`· ${subject.name_en} ·`);
      expect(html).toContain(unit.name);
      expect(html).toContain('12 · 40%');
      expect(html).toContain('Предварительно · 27.10.2026 12:00');
      expect(html).toContain('Месяц 2026-10');
      t.clock.set(START);
    });

    it('writes attendance only for a reader of attendance, and refuses a month outside the quarter, a lesson reader, another branch and an unknown quarter', async () => {
      const spiritual = await account();
      const x = await scene();
      const elsewhere = await scene();
      await give(spiritual, [{ role: 'spiritual_vice_principal', branchId: x.s.branch }]);
      await at(spiritual, MOMENT);
      const answer = await exportOf(spiritual, x.s.branch, x.journal, {
        format: 'xlsx',
        quarterId: x.q1,
      });
      expect(answer.status, codeOf(answer)).toBe(200);
      const [sheet] = await sheetsOf(answer.body as Buffer);
      const headings = (sheet?.rows[4]?.values ?? []).map(String);
      // 07, Who can do what: "the last two see attendance".
      expect(headings.some((one) => one.includes('CW'))).toBe(false);
      expect(headings).not.toContain('Result');
      expect(headings).toContain('Attendance');
      refusedFile(
        await exportOf(spiritual, x.s.branch, x.journal, {
          format: 'xlsx',
          quarterId: x.q1,
          month: '2026-12',
        }),
        400,
        'journal_month_outside',
      );
      refusedFile(
        await exportOf(spiritual, x.s.branch, elsewhere.journal, {
          format: 'xlsx',
          quarterId: x.q1,
        }),
        404,
        'not_found',
      );
      refusedFile(
        await exportOf(spiritual, x.s.branch, x.journal, {
          format: 'xlsx',
          quarterId: randomUUID(),
        }),
        404,
        'not_found',
      );
      // A teacher who taught one lesson of the journal reads that lesson only ("lessons"):
      // "teachers export their own journals".
      const substitute = await account();
      await give(substitute, [{ role: 'teacher', branchId: x.s.branch }]);
      await load.classes.person(x.s.branch, ['uz'], { accountId: substitute.account.id });
      const staff = await t.database.migrator
        .selectFrom('staff')
        .select('id')
        .where('account_id', '=', substitute.account.id)
        .executeTakeFirstOrThrow();
      await t.database.migrator
        .updateTable('lessons')
        .set({ teacher_id: staff.id })
        .where('id', '=', x.lessons[1]?.id ?? '')
        .execute();
      await at(substitute, MOMENT);
      const before = (await t.entries('journal.export')).length;
      refusedFile(
        await exportOf(substitute, x.s.branch, x.journal, { format: 'xlsx', quarterId: x.q1 }),
        403,
        'journal_export_scope',
      );
      // A teacher of no lesson of the journal: outside the scope.
      const stranger = await account();
      await give(stranger, [{ role: 'teacher', branchId: x.s.branch }]);
      await at(stranger, MOMENT);
      refusedFile(
        await exportOf(stranger, x.s.branch, x.journal, { format: 'xlsx', quarterId: x.q1 }),
        403,
        'journal_scope',
      );
      expect(await t.entries('journal.export')).toHaveLength(before);
      t.clock.set(START);
    });

    it('writes an exempt cell as 4, and never the reason, the category or the document of the exemption (From 8.5)', async () => {
      const vice = await account();
      const x = await scene();
      await give(vice, [{ role: 'academic_vice_principal', branchId: x.s.branch }]);
      await at(vice, MOMENT);
      const created = await t
        .post(
          '/api/exemptions',
          x.s.branch,
          {
            studentIds: [x.oktamov],
            kind: 'temporary',
            subjectIds: null,
            startDate: '2026-10-12',
            endDate: '2026-10-14',
            slots: null,
            category: 'competition',
            detail: 'Regional chess cup in Samarqand',
            choices: [],
          },
          vice.cookie,
        )
        .set(REQUEST_KEY_HEADER, randomUUID());
      expect(created.status, JSON.stringify(created.body)).toBe(200);
      const full = await t
        .post(
          '/api/exemptions',
          x.s.branch,
          {
            studentIds: [x.shodiyev],
            kind: 'full',
            subjectIds: null,
            startDate: '2026-10-12',
            endDate: null,
            slots: null,
            category: 'illness',
            detail: 'A long illness',
            choices: [],
          },
          vice.cookie,
        )
        .set(REQUEST_KEY_HEADER, randomUUID());
      expect(full.status, JSON.stringify(full.body)).toBe(200);
      const answer = await exportOf(vice, x.s.branch, x.journal, {
        format: 'xlsx',
        quarterId: x.q1,
      });
      expect(answer.status, codeOf(answer)).toBe(200);
      const [sheet] = await sheetsOf(answer.body as Buffer);
      const headings = (sheet?.rows[4]?.values ?? []).map(String);
      const first = headings.findIndex(
        (one) => one.startsWith('12.10.2026') && one.endsWith('· A'),
      );
      const oktamov = sheet?.rows.find((row) => row.values[1] === 'Oʻktamov Bek');
      expect(oktamov?.values[first]).toBe(4);
      // A full exemption for the whole quarter's lessons: in the folded "Exempt" section, as 5.
      const shodiyev = sheet?.rows.find((row) => row.values[1] === 'Shodiyev Bek');
      expect(shodiyev?.values[first]).toBe(5);
      const text = JSON.stringify(sheet?.rows.map((row) => row.values));
      for (const word of ['Samarqand', 'chess', 'competition', 'Competition', 'long illness']) {
        expect(text).not.toContain(word);
      }
      const printed = await exportOf(vice, x.s.branch, x.journal, {
        format: 'pdf',
        quarterId: x.q1,
      });
      expect(printed.status, codeOf(printed)).toBe(200);
      expect(pdf.last).not.toContain('Samarqand');
      expect(pdf.last).not.toContain('competition');
      t.clock.set(START);
    });

    it('follows the scope of the grid: a Head Teacher of the subject, a Senior Head Teacher in another branch and the Tutor of the class are let in; the same roles outside their scope are refused', async () => {
      const x = await scene();
      const elsewhere = await scene();
      const body = { format: 'xlsx', quarterId: x.q1 };
      const allowed = async (browser: Browser, branch: string, journal: string, quarter = x.q1) => {
        await at(browser, MOMENT);
        const answer = await exportOf(browser, branch, journal, { ...body, quarterId: quarter });
        expect(answer.status, codeOf(answer)).toBe(200);
      };
      const refused = async (browser: Browser, branch: string, journal: string, quarter = x.q1) => {
        await at(browser, MOMENT);
        refusedFile(
          await exportOf(browser, branch, journal, { ...body, quarterId: quarter }),
          403,
          'journal_scope',
        );
      };
      // Head Teachers: of the journal's subject, and of another subject in the same branch.
      const head = await account();
      await give(head, [{ role: 'head_teacher', branchId: x.s.branch, subjectIds: [x.s.subject] }]);
      await allowed(head, x.s.branch, x.journal);
      const otherHead = await account();
      await give(otherHead, [
        { role: 'head_teacher', branchId: x.s.branch, subjectIds: [elsewhere.s.subject] },
      ]);
      await refused(otherHead, x.s.branch, x.journal);
      // A Senior Head Teacher of the other scene's subject: let in there, refused here.
      const senior = await account();
      await give(senior, [{ role: 'senior_head_teacher', subjectIds: [elsewhere.s.subject] }]);
      await allowed(senior, elsewhere.s.branch, elsewhere.journal, elsewhere.q1);
      await refused(senior, x.s.branch, x.journal);
      // Tutors: of the class, and of the other class of the branch.
      const tutorOf = async (classId: string) => {
        const browser = await account();
        const [assignment] = await give(browser, [{ role: 'tutor', branchId: x.s.branch }]);
        await load.classes.person(x.s.branch, ['uz'], { accountId: browser.account.id });
        await load.classes.tutorRow(x.s.branch, classId, assignment ?? '');
        return browser;
      };
      await allowed(await tutorOf(x.s.classId), x.s.branch, x.journal);
      await refused(await tutorOf(x.s.otherClass), x.s.branch, x.journal);
      t.clock.set(START);
    });

    it('writes only the rows and averages the grid answers: a Tutor of a mixed group gets own rows and no bottom row', async () => {
      const principal = await account();
      const x = await scene();
      await give(principal, [{ role: 'principal', branchId: x.s.branch }]);
      await at(principal, MOMENT);
      const read = await t.get(
        `/api/journal/journals/${x.journal}?quarterId=${x.q1}`,
        x.s.branch,
        principal.cookie,
      );
      expect(read.status, JSON.stringify(read.body)).toBe(200);
      const grid = journalGridSchema.parse(read.body);
      // The answer the grid gives a Tutor of a mixed group (task 6.2, decision 2): own rows only,
      // and no bottom row ("The group's averages are hidden for them").
      const tutorGrid = {
        ...grid,
        students: grid.students.filter((one) => one.id === x.zokirov),
        bottom: null,
      };
      const { sheet, rows } = journalSheet(
        {
          grid: tutorGrid,
          month: null,
          language: 'en',
          timeZone: 'Asia/Tashkent',
          asOf: new Date(MOMENT),
        },
        JOURNAL_EXPORT_TEXTS.en,
        'journal',
      );
      expect(rows).toBe(1);
      const names = sheet.rows.map((row) => row[1]);
      expect(names).toContain('Zokirov Ali');
      expect(names).not.toContain('Karimov Ali Anvarovich');
      expect(names).not.toContain('Average');
      t.clock.set(START);
    });

    it('answers 404 for an unknown journal and a quarter of another branch, and writes nothing in either branch', async () => {
      const principal = await account();
      const x = await scene();
      const elsewhere = await scene();
      await give(principal, [{ role: 'principal', branchId: x.s.branch }]);
      await at(principal, MOMENT);
      const entries = () =>
        t.database.migrator
          .selectFrom('audit_log')
          .select(['id', 'branch_id'])
          .where('action', 'like', 'journal.%export%')
          .where('branch_id', 'in', [x.s.branch, elsewhere.s.branch])
          .orderBy('id')
          .execute();
      const before = await entries();
      refusedFile(
        await exportOf(principal, x.s.branch, randomUUID(), { format: 'xlsx', quarterId: x.q1 }),
        404,
        'not_found',
      );
      refusedFile(
        await exportOf(principal, x.s.branch, x.journal, {
          format: 'pdf',
          quarterId: elsewhere.q1,
        }),
        404,
        'not_found',
      );
      expect(await entries()).toEqual(before);
      t.clock.set(START);
    });
  });

  describe('of the branch', () => {
    it('repeats a key: the stored answer for the same account, 409 for another, 404 and 403 checked first', async () => {
      const vice = await account();
      const other = await account();
      const teacher = await account();
      const x = await scene();
      await give(vice, [{ role: 'academic_vice_principal', branchId: x.s.branch }]);
      await give(other, [{ role: 'academic_vice_principal', branchId: x.s.branch }]);
      await give(teacher, [{ role: 'teacher', branchId: x.s.branch }]);
      await at(vice, MOMENT);
      const key = randomUUID();
      const body = { format: 'xlsx', quarterId: x.q1 };
      const first = await askBranch(vice, x.s.branch, body, key);
      expect(first.status, codeOf(first)).toBe(200);
      const repeated = await askBranch(vice, x.s.branch, body, key);
      expect(repeated.status, codeOf(repeated)).toBe(200);
      expect(journalExportRequestedSchema.parse(repeated.body).export.id).toBe(
        journalExportRequestedSchema.parse(first.body).export.id,
      );
      await at(other, MOMENT);
      expect(codeOf(await askBranch(other, x.s.branch, body, key))).toBe('request_key_reused');
      await at(vice, MOMENT);
      expect(
        codeOf(await askBranch(vice, x.s.branch, { ...body, quarterId: randomUUID() }, key)),
      ).toBe('not_found');
      // The used key with another branch's quarter: 404, never the stored answer.
      const elsewhereQuarter = await t.database.migrator
        .selectFrom('quarters')
        .select('id')
        .where('branch_id', '<>', x.s.branch)
        .executeTakeFirstOrThrow();
      expect(
        codeOf(await askBranch(vice, x.s.branch, { ...body, quarterId: elsewhereQuarter.id }, key)),
      ).toBe('not_found');
      await at(teacher, MOMENT);
      expect(codeOf(await askBranch(teacher, x.s.branch, body, key))).toBe('journal_export_scope');
      // One export in every branch, and one request entry: the repeats wrote nothing anywhere.
      const rows = await t.database.migrator.selectFrom('journal_exports').select('id').execute();
      expect(
        rows.filter((one) => one.id === journalExportRequestedSchema.parse(first.body).export.id),
      ).toHaveLength(1);
      const created = await t.database.migrator
        .selectFrom('journal_exports')
        .select('id')
        .where('account_id', 'in', [vice.account.id, other.account.id, teacher.account.id])
        .execute();
      expect(created).toHaveLength(1);
      const requested = await t.database.migrator
        .selectFrom('audit_log')
        .select('id')
        .where('action', '=', 'journal.branch_export')
        .where('actor_id', 'in', [vice.account.id, other.account.id, teacher.account.id])
        .execute();
      expect(requested).toHaveLength(1);
      t.clock.set(START);
    });

    const exportRow = (id: string) =>
      t.database.migrator
        .selectFrom('journal_exports')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirstOrThrow();

    const run = (branch: string, exportId: string) =>
      t.app.get(JournalExports).runBranchExport({ exportId }, { branchIds: [branch] });

    it('is a job from one snapshot, one queued per person, with a link that works for 24 hours and access checked again at download', async () => {
      const principal = await account();
      const x = await scene();
      const [assignment] = await give(principal, [{ role: 'principal', branchId: x.s.branch }]);
      await at(principal, MOMENT);
      const jobsBefore = Number(
        (
          await sql<{ count: string }>`
            select count(*) as count from pgboss.job where name = 'journal.branch_export'
          `.execute(t.database.migrator)
        ).rows[0]?.count,
      );
      const asked = await askBranch(principal, x.s.branch, { format: 'xlsx', quarterId: x.q1 });
      expect(asked.status, codeOf(asked)).toBe(200);
      const item = journalExportRequestedSchema.parse(asked.body).export;
      expect(item).toMatchObject({ status: 'queued', format: 'xlsx', asOf: null, expiresAt: null });
      // The job is written in the transaction of the request.
      const jobsAfter = Number(
        (
          await sql<{ count: string }>`
            select count(*) as count from pgboss.job where name = 'journal.branch_export'
          `.execute(t.database.migrator)
        ).rows[0]?.count,
      );
      expect(jobsAfter).toBe(jobsBefore + 1);
      // One at a time (edge/system-behaviour: "one per user").
      const again = await askBranch(principal, x.s.branch, { format: 'pdf', quarterId: x.q1 });
      expect(codeOf(again)).toBe('journal_export_running');
      // Not ready yet.
      refusedFile(
        await fileCall(principal, x.s.branch, 'get', `/api/journal/exports/${item.id}/file`),
        409,
        'journal_export_not_ready',
      );
      t.clock.set('2026-10-27T12:05:00+05:00');
      await run(x.s.branch, item.id);
      const ready = await exportRow(item.id);
      expect(ready).toMatchObject({ status: 'ready', journals: 2, rows: 8 });
      expect(ready.ready_at?.toISOString()).toBe('2026-10-27T07:05:00.000Z');
      expect(ready.expires_at?.toISOString()).toBe('2026-10-28T07:05:00.000Z');
      // A second run of a row no longer queued does nothing.
      await run(x.s.branch, item.id);
      expect((await exportRow(item.id)).file_key).toBe(ready.file_key);
      expect(await t.entries('journal.branch_export_ready', item.id)).toHaveLength(1);
      expect((await t.entries('journal.branch_export_ready', item.id))[0]).toMatchObject({
        details: { journals: 2, rows: 8, format: 'xlsx' },
      });
      // The link works at 23:59:59 after the file is ready and not at 24:00:00.
      await at(principal, '2026-10-28T12:04:59+05:00');
      const list = journalExportListSchema.parse(
        (await t.get('/api/journal/exports', x.s.branch, principal.cookie)).body,
      );
      expect(list.canExportBranch).toBe(true);
      expect(list.exports.map((one) => [one.id, one.status])).toEqual([[item.id, 'ready']]);
      const file = await fileCall(
        principal,
        x.s.branch,
        'get',
        `/api/journal/exports/${item.id}/file`,
      );
      expect(file.status, codeOf(file)).toBe(200);
      const sheets = await sheetsOf(file.body as Buffer);
      expect(sheets).toHaveLength(2);
      expect(sheets.map((one) => one.rows[3]?.values[0])).toEqual([
        'Provisional · 27.10.2026 12:05',
        'Provisional · 27.10.2026 12:05',
      ]);
      expect(await t.entries('journal.branch_export_download', item.id)).toHaveLength(1);
      // The entry is committed before the store is read: a store that fails leaves it standing.
      const get = store.get.bind(store);
      store.get = () => Promise.reject(new Error('The store is away.'));
      try {
        const away = await fileCall(
          principal,
          x.s.branch,
          'get',
          `/api/journal/exports/${item.id}/file`,
        );
        expect(away.status).toBe(500);
      } finally {
        store.get = get;
      }
      expect(await t.entries('journal.branch_export_download', item.id)).toHaveLength(2);
      await at(principal, '2026-10-28T12:05:00+05:00');
      refusedFile(
        await fileCall(principal, x.s.branch, 'get', `/api/journal/exports/${item.id}/file`),
        410,
        'journal_export_expired',
      );
      // Another account's export, and another branch's, are unknown.
      const vice = await account();
      await give(vice, [{ role: 'academic_vice_principal', branchId: x.s.branch }]);
      await at(vice, '2026-10-28T09:00:00+05:00');
      refusedFile(
        await fileCall(vice, x.s.branch, 'get', `/api/journal/exports/${item.id}/file`),
        404,
        'not_found',
      );
      refusedFile(
        await fileCall(vice, x.s.branch, 'get', `/api/journal/exports/${randomUUID()}/file`),
        404,
        'not_found',
      );
      expect(await t.entries('journal.branch_export_download', item.id)).toHaveLength(2);
      const elsewhere = await t.newBranch();
      await give(principal, [{ role: 'principal', branchId: elsewhere }]);
      await at(principal, '2026-10-28T09:00:00+05:00');
      refusedFile(
        await fileCall(principal, elsewhere, 'get', `/api/journal/exports/${item.id}/file`),
        404,
        'not_found',
      );
      // Access checked again at download: the Principal's assignment ended. As a Teacher of the
      // branch the person passes the guard (`journal` `export`), and the route refuses.
      await give(principal, [{ role: 'teacher', branchId: x.s.branch }]);
      await t.database.migrator
        .updateTable('assignments')
        .set({ valid_until: new Date('2026-10-28T08:00:00+05:00') })
        .where('id', '=', assignment ?? '')
        .execute();
      const downloads = (await t.entries('journal.branch_export_download')).length;
      const refused = await fileCall(
        principal,
        x.s.branch,
        'get',
        `/api/journal/exports/${item.id}/file`,
      );
      refusedFile(refused, 403, 'journal_export_scope');
      expect(await t.entries('journal.branch_export_download')).toHaveLength(downloads);
      t.clock.set(START);
    });

    it('turns a queued export stale at 20 minutes, never before, and then takes a new one', async () => {
      const vice = await account();
      const x = await scene();
      await give(vice, [{ role: 'academic_vice_principal', branchId: x.s.branch }]);
      await at(vice, MOMENT);
      const first = journalExportRequestedSchema.parse(
        (await askBranch(vice, x.s.branch, { format: 'xlsx', quarterId: x.q1 })).body,
      ).export;
      await at(vice, '2026-10-27T12:19:59+05:00');
      expect(codeOf(await askBranch(vice, x.s.branch, { format: 'xlsx', quarterId: x.q1 }))).toBe(
        'journal_export_running',
      );
      await at(vice, '2026-10-27T12:20:00+05:00');
      const listed = journalExportListSchema.parse(
        (await t.get('/api/journal/exports', x.s.branch, vice.cookie)).body,
      );
      expect(listed.exports[0]).toMatchObject({
        status: 'failed',
        failure: 'journal_export_stale',
      });
      refusedFile(
        await fileCall(vice, x.s.branch, 'get', `/api/journal/exports/${first.id}/file`),
        409,
        'journal_export_failed',
      );
      const second = await askBranch(vice, x.s.branch, { format: 'xlsx', quarterId: x.q1 });
      expect(second.status, codeOf(second)).toBe(200);
      expect(await exportRow(first.id)).toMatchObject({
        status: 'failed',
        failure: 'journal_export_stale',
      });
      // The job of the stale row does nothing.
      await run(x.s.branch, first.id);
      expect((await exportRow(first.id)).status).toBe('failed');
      t.clock.set(START);
    });

    it('answers one 409 of two requests at the same moment, through the unique index', async () => {
      const vice = await account();
      const x = await scene();
      await give(vice, [{ role: 'academic_vice_principal', branchId: x.s.branch }]);
      await at(vice, MOMENT);
      const answers = await Promise.all([
        askBranch(vice, x.s.branch, { format: 'xlsx', quarterId: x.q1 }),
        askBranch(vice, x.s.branch, { format: 'pdf', quarterId: x.q1 }),
      ]);
      expect(answers.map((one) => one.status).sort()).toEqual([200, 409]);
      expect(answers.map(codeOf).filter((one) => one !== 'status 200')).toEqual([
        'journal_export_running',
      ]);
      t.clock.set(START);
    });

    it('fails a job whose requester lost the role, and is refused to a reader of part of the branch', async () => {
      const vice = await account();
      const x = await scene();
      const other = await scene();
      const [assignment] = await give(vice, [
        { role: 'academic_vice_principal', branchId: x.s.branch },
      ]);
      await at(vice, MOMENT);
      const item = journalExportRequestedSchema.parse(
        (await askBranch(vice, x.s.branch, { format: 'pdf', quarterId: x.q1 })).body,
      ).export;
      await t.database.migrator
        .updateTable('assignments')
        .set({ valid_until: new Date('2026-10-27T12:01:00+05:00') })
        .where('id', '=', assignment ?? '')
        .execute();
      t.clock.set('2026-10-27T12:02:00+05:00');
      const renders = pdf.htmls.length;
      await run(x.s.branch, item.id);
      expect(await exportRow(item.id)).toMatchObject({
        status: 'failed',
        failure: 'journal_export_scope',
      });
      expect(pdf.htmls).toHaveLength(renders);
      // The Head Tutor reads attendance of every journal, the Teacher own journals: neither
      // exports the branch (decision 3).
      for (const role of ['head_tutor', 'teacher'] as const) {
        const reader = await account();
        await give(reader, [{ role, branchId: x.s.branch }]);
        await at(reader, MOMENT);
        expect(
          codeOf(await askBranch(reader, x.s.branch, { format: 'xlsx', quarterId: x.q1 })),
        ).toBe('journal_export_scope');
        const list = journalExportListSchema.parse(
          (await t.get('/api/journal/exports', x.s.branch, reader.cookie)).body,
        );
        expect(list).toMatchObject({ canExportBranch: false, exports: [] });
        expect(list.quarters.map((one) => one.number)).toEqual([1, 2, 3, 4]);
      }
      // A quarter of another branch, and a month outside the quarter.
      await at(vice, MOMENT);
      expect(
        codeOf(await askBranch(vice, x.s.branch, { format: 'xlsx', quarterId: other.q1 })),
      ).toBe('not_found');
      expect(
        codeOf(
          await askBranch(vice, x.s.branch, { format: 'xlsx', quarterId: x.q2, month: '2026-10' }),
        ),
      ).toBe('journal_month_outside');
      t.clock.set(START);
    });

    it('reads every journal from one snapshot: a mark saved between the reads of two journals is in neither file', async () => {
      const vice = await account();
      const x = await scene();
      await give(vice, [{ role: 'academic_vice_principal', branchId: x.s.branch }]);
      const other = await student(x.s.branch, x.s.otherClass, { first: 'Dono', last: 'Yoqubova' });
      const [otherFirst] = await lessonsOf({ classId: x.s.otherClass });
      const [ownFirst] = x.lessons;
      if (otherFirst === undefined || ownFirst === undefined)
        throw new Error('Lessons on the 12th.');
      const otherJournal = await journalOf(x.s.otherClass);
      await at(vice, MOMENT);
      const item = journalExportRequestedSchema.parse(
        (await askBranch(vice, x.s.branch, { format: 'xlsx', quarterId: x.q1 })).body,
      ).export;
      // After the first journal is read, another transaction commits a mark in the other one.
      const reader = t.app.get(JournalGridReader);
      const original = reader.gridIn.bind(reader);
      let saved = false;
      const spy = vi.spyOn(reader, 'gridIn').mockImplementation(async (...args) => {
        const grid = await original(...args);
        if (!saved) {
          saved = true;
          const [lesson, studentId] =
            args[3] === x.journal ? [otherFirst.id, other] : [ownFirst.id, x.oktamov];
          await t.database.migrator.transaction().execute(async (transaction) => {
            await sql`select set_config('app.now', ${MOMENT}, true)`.execute(transaction);
            await transaction
              .insertInto('journal_cells')
              .values({
                branch_id: x.s.branch,
                lesson_id: lesson,
                student_id: studentId,
                mark: 2,
                version: 1,
                changed_by: vice.account.id,
                changed_how: 'entry',
                changed_at: new Date(0),
              })
              .execute();
          });
        }
        return grid;
      });
      try {
        await t.app
          .get(JournalExports)
          .runBranchExport({ exportId: item.id }, { branchIds: [x.s.branch] });
      } finally {
        spy.mockRestore();
      }
      expect(saved).toBe(true);
      const row = await exportRow(item.id);
      expect(row.status).toBe('ready');
      const sheets = await sheetsOf(await store.get(row.file_key ?? ''));
      expect(sheets).toHaveLength(2);
      // Neither sheet has the mark 2 typed meanwhile; the journals were read at one moment.
      for (const sheet of sheets) {
        const rows = sheet.rows.slice(6).map((one) => one.values);
        const named = rows.find((one) => one[1] === 'Yoqubova Dono' || one[1] === 'Oʻktamov Bek');
        expect(named).toBeDefined();
        expect(named?.includes(2)).toBe(false);
      }
      // The mark is stored: a later read has it.
      const cell = await t.database.migrator
        .selectFrom('journal_cells')
        .select('mark')
        .where('student_id', 'in', [other, x.oktamov])
        .where('mark', '=', 2)
        .execute();
      expect(cell).toHaveLength(1);
      expect(otherJournal).not.toBe(x.journal);
      t.clock.set(START);
    });

    it('writes a PDF of every journal, each from a new page, and marks the export failed when the PDF cannot be made', async () => {
      const vice = await account();
      const x = await scene();
      await give(vice, [{ role: 'academic_vice_principal', branchId: x.s.branch }]);
      await at(vice, MOMENT);
      const item = journalExportRequestedSchema.parse(
        (await askBranch(vice, x.s.branch, { format: 'pdf', quarterId: x.q1 })).body,
      ).export;
      await run(x.s.branch, item.id);
      expect((await exportRow(item.id)).status).toBe('ready');
      const html = pdf.last;
      expect(html.match(/class="journal-part next-day"/g)).toHaveLength(1);
      expect(html.match(/class="journal-part"/g)).toHaveLength(1);
      const failing = journalExportRequestedSchema.parse(
        (await askBranch(vice, x.s.branch, { format: 'pdf', quarterId: x.q1 })).body,
      ).export;
      pdf.failing = true;
      try {
        await run(x.s.branch, failing.id);
      } finally {
        pdf.failing = false;
      }
      expect(await exportRow(failing.id)).toMatchObject({
        status: 'failed',
        failure: 'journal_export_failed',
        file_key: null,
      });
      t.clock.set(START);
    });
  });

  describe('the snapshot of a transaction', () => {
    it('sees one moment in every statement, and a row committed meanwhile is not in it', async () => {
      const branch = await t.newBranch();
      const transactions = t.app.get(Transactions);
      const count = (transaction: Parameters<Parameters<Transactions['run']>[1]>[0]) =>
        sql<{ count: string }>`select count(*) as count from branches`
          .execute(transaction)
          .then((found) => Number(found.rows[0]?.count));
      const seen = await transactions.run(
        [branch],
        async (transaction) => {
          const before = await count(transaction);
          await t.newBranch();
          return [before, await count(transaction)];
        },
        { snapshot: true },
      );
      expect(seen[1]).toBe(seen[0]);
      const plain = await transactions.run([branch], async (transaction) => {
        const before = await count(transaction);
        await t.newBranch();
        return [before, await count(transaction)];
      });
      expect(plain[1]).toBe((plain[0] ?? 0) + 1);
      // Read only: a write is refused.
      await expect(
        transactions.run(
          [branch],
          (transaction) =>
            sql`update branches set name = name where id = ${branch}::uuid`.execute(transaction),
          { snapshot: true },
        ),
      ).rejects.toThrow(/read-only/);
    });
  });
});
