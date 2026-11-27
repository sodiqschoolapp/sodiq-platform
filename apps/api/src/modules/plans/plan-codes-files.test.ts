import {
  BRANCH_HEADER,
  REQUEST_KEY_HEADER,
  journalExportRequestedSchema,
  journalGridSchema,
  planRequestsReportSchema,
  type JournalGrid,
} from '@sodiq/shared';
import ExcelJS from 'exceljs';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dayTemplatesKit, START, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { linesOf, RecordingPdf } from '../../testing/pdf-kit.js';
import { publishedScene } from '../../testing/published-scene.js';
import { binary } from '../../testing/xlsx-kit.js';
import { JournalExports } from '../journal/journal-exports.service.js';
import { MemoryPhotoStore } from '../people/photo-store.js';

const pdf = new RecordingPdf();
const store = new MemoryPhotoStore();

/** Tuesday 27 October 2026, noon in Tashkent: the Mondays 12, 19 and 26 October are held. */
const MOMENT = '2026-10-27T12:00:00+05:00';

const ok = (response: Response, status = 200): unknown => {
  const body: unknown = Buffer.isBuffer(response.body)
    ? response.body.toString('utf8').slice(0, 500)
    : response.body;
  expect(response.status, JSON.stringify(body)).toBe(status);
  return response.body;
};

/** The cells of an Excel file, each row as its texts (an empty cell is ''). */
const rowsOfFile = async (content: Buffer): Promise<string[][]> =>
  (await linesOf(content)).lines.map((line) =>
    line.values.map((value) =>
      value === undefined || value === null
        ? ''
        : typeof value === 'object'
          ? JSON.stringify(value)
          : String(value as string | number | boolean),
    ),
  );

// All names are invented. Task 11.27 (pull request #399), review round 1, finding 2: the codes
// hidden while off and shown again when on, in the plan export (PDF and Excel), the journal export
// and print, and the plan reports with their file (docs/spec/09-lesson-plans.md, Codes: "Exports
// and prints show the code before the name"; Done when: "switching off hides the codes in … reports,
// exports … and switching on shows them again unchanged", "another subject is not affected").
describe('codes in the plan and journal files and the plan reports (task 11.27)', () => {
  let t: DayTemplatesKit;
  let load: LoadKit;
  let names = 0;
  const given = new Set<string>();

  type Held = Parameters<DayTemplatesKit['kit']['giveRole']>[1];
  type Browser = { cookie: string; account: { id: string } };

  /** An account that reads in English (the texts of the marks are asserted). */
  const account = async () => {
    names += 1;
    const browser = await t.kit.completeSession('Gulnora', `Rahimova${'a'.repeat(names % 7)}`);
    await t.database.migrator
      .updateTable('accounts')
      .set({ language: 'en' })
      .where('id', '=', browser.account.id)
      .execute();
    return browser;
  };

  /** Runs `work` with the clock at the moment and the roles held from 1 September. */
  async function as<T>(
    browser: Browser,
    roles: readonly Omit<Held, 'validFrom'>[],
    work: () => Promise<T>,
  ): Promise<T> {
    for (const held of roles) {
      const key = `${browser.account.id}|${held.role}|${'branchId' in held ? String(held.branchId) : ''}`;
      if (given.has(key)) continue;
      given.add(key);
      await t.kit.giveRole(browser.account.id, {
        ...held,
        validFrom: new Date('2026-09-01T00:00:00+05:00'),
      });
    }
    t.clock.set(MOMENT);
    try {
      await t.database.migrator
        .updateTable('sessions')
        .set({ created_at: new Date(MOMENT), last_used_at: new Date(MOMENT) })
        .where('account_id', '=', browser.account.id)
        .execute();
      return await work();
    } finally {
      t.clock.set(START);
    }
  }

  const call = (browser: Browser, branch: string, method: 'get' | 'put' | 'post', path: string) =>
    request(t.kit.server)[method](path).set('Cookie', browser.cookie).set(BRANCH_HEADER, branch);

  const fileOf = (browser: Browser, branch: string, path: string, body: object) =>
    call(browser, branch, 'post', path).buffer(true).parse(binary).send(body);

  /** A graded scene with its first quarter's held lessons (12, 19 and 26 October). */
  async function scene() {
    const owner = await account();
    const s = await publishedScene(t, load, {
      graded: true,
      accounts: { teacher: owner.account.id },
    });
    const lessons = (
      await t.database.migrator
        .selectFrom('lessons')
        .select('id')
        .where('class_id', '=', s.classId)
        .where('subject_id', '=', s.subject)
        .where('cancel_cause', 'is', null)
        .where('lesson_date', '>=', '2026-09-01')
        .where('lesson_date', '<=', '2026-10-31')
        .orderBy('starts_at')
        .execute()
    ).map((one) => one.id);
    const held = (
      await t.database.migrator
        .selectFrom('lessons')
        .select('id')
        .where('class_id', '=', s.classId)
        .where('subject_id', '=', s.subject)
        .where('lesson_date', '=', '2026-10-12')
        .executeTakeFirstOrThrow()
    ).id;
    const journal = (
      await t.database.migrator
        .selectFrom('journals')
        .select('id')
        .where('class_id', '=', s.classId)
        .where('subject_id', '=', s.subject)
        .executeTakeFirstOrThrow()
    ).id;
    const q1 = (
      await t.database.migrator
        .selectFrom('quarters')
        .select('id')
        .where('academic_year_id', '=', s.year)
        .where('number', '=', 1)
        .executeTakeFirstOrThrow()
    ).id;
    const plan = (
      await t.database.migrator
        .selectFrom('lesson_plan_journals')
        .select('plan_id')
        .where('journal_id', '=', journal)
        .where('quarter_id', '=', q1)
        .executeTakeFirstOrThrow()
    ).plan_id;
    return { ...s, owner, lessons, held, journal, q1, plan };
  }

  type Scene = Awaited<ReturnType<typeof scene>>;

  const teacherIn = (s: Scene) => [{ role: 'teacher' as const, branchId: s.branch }];
  const viceIn = (s: Scene) => [{ role: 'academic_vice_principal' as const, branchId: s.branch }];

  const switchCodes = (s: Scene, on: boolean) =>
    t.database.migrator
      .updateTable('subjects')
      .set({ codes_on: on })
      .where('id', '=', s.subject)
      .execute();

  /**
   * A coded item of the first quarter, written as the migrator: on the row of `lessonId`, or not
   * covered (a place past the last row) when `lessonId` is null. Answers the ids of its works.
   */
  async function codedItem(
    s: Scene,
    lessonId: string | null,
    item: {
      topic: string;
      code: string;
      classwork?: [string, string];
      homework?: [string, string];
    },
  ) {
    const row = await t.database.migrator
      .insertInto('lesson_plan_items')
      .values({
        branch_id: s.branch,
        plan_id: s.plan,
        topic: item.topic,
        topic_code: item.code,
        objectives: '',
        links: [],
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const works: Record<'classwork' | 'homework', string | null> = {
      classwork: null,
      homework: null,
    };
    for (const kind of ['classwork', 'homework'] as const) {
      const work = kind === 'classwork' ? item.classwork : item.homework;
      if (work === undefined) continue;
      const [code, title] = work;
      works[kind] = (
        await t.database.migrator
          .insertInto('lesson_plan_works')
          .values({
            branch_id: s.branch,
            item_id: row.id,
            kind,
            position: 1,
            title,
            work_code: code,
            description: '',
          })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
    }
    await t.database.migrator
      .insertInto('lesson_plan_places')
      .values({
        branch_id: s.branch,
        plan_id: s.plan,
        journal_id: s.journal,
        item_id: row.id,
        // Past the last row: "not covered" (`PlansService`: a place past the plan's rows).
        position: lessonId === null ? s.lessons.length + 1 : s.lessons.indexOf(lessonId) + 1,
      })
      .execute();
    return { itemId: row.id, ...works };
  }

  /** The plan export of the first quarter, as the owner: the PDF's HTML and the Excel rows. */
  const planFiles = (s: Scene) =>
    as(s.owner, teacherIn(s), async () => {
      const path = `/api/plans/journals/${s.journal}/export`;
      const made = pdf.htmls.length;
      ok(await fileOf(s.owner, s.branch, path, { quarterId: s.q1, format: 'pdf' }));
      expect(pdf.htmls).toHaveLength(made + 1);
      const html = pdf.last;
      const sheet = await fileOf(s.owner, s.branch, path, { quarterId: s.q1, format: 'xlsx' });
      ok(sheet);
      return { html, rows: await rowsOfFile(sheet.body as Buffer) };
    });

  /** The cells of the row whose topic cell (the third) ends with the topic. */
  const rowOfTopic = (rows: readonly string[][], topic: string) => {
    const found = rows.filter((row) => (row[2] ?? '').endsWith(topic));
    expect(found, `one row of ${topic}`).toHaveLength(1);
    return found[0] ?? [];
  };

  /** A coded scene: a held lesson with a coded topic, classwork (not held) and homework. */
  async function codedScene() {
    const s = await scene();
    await switchCodes(s, true);
    const item = await codedItem(s, s.held, {
      topic: 'Fractions',
      code: 'F1',
      classwork: ['Q1', 'Quiz on fractions'],
      homework: ['H1', 'Exercise 5'],
    });
    await codedItem(s, null, { topic: 'Decimals', code: 'D1' });
    // The classwork marked "not held" on the held lesson: the marks column names it.
    await as(s.owner, teacherIn(s), async () => {
      ok(
        await call(s.owner, s.branch, 'put', `/api/journal/lessons/${s.held}/works/not-held`).send({
          column: { planWorkId: item.classwork, sourceLessonId: s.held },
          notHeld: true,
          version: null,
          confirm: false,
        }),
      );
    });
    return s;
  }

  beforeAll(async () => {
    t = await dayTemplatesKit({ jobs: true, pdfRenderer: pdf, photoStore: store });
    load = new LoadKit(t.database.migrator);
  });

  afterAll(async () => {
    await t.close();
  });

  it('writes "code · name" in the plan export while on, the name alone while off, and the same codes again when on', async () => {
    const s = await codedScene();
    const other = await codedScene();
    expect(other.subject).not.toBe(s.subject);

    const on = {
      topic: 'F1 · Fractions',
      classworks: 'Q1 · Quiz on fractions',
      homeworks: 'H1 · Exercise 5',
      notHeld: 'not held: Q1 · Quiz on fractions',
      notCovered: 'D1 · Decimals',
    };
    const off = {
      topic: 'Fractions',
      classworks: 'Quiz on fractions',
      homeworks: 'Exercise 5',
      notHeld: 'not held: Quiz on fractions',
      notCovered: 'Decimals',
    };
    const shown = async (x: Scene) => {
      const files = await planFiles(x);
      const held = rowOfTopic(files.rows, 'Fractions');
      const notCovered = rowOfTopic(files.rows, 'Decimals');
      return {
        excel: {
          topic: held[2],
          classworks: held[3] ?? '',
          homeworks: held[4],
          notHeld: (held[7] ?? '').split('; ').find((one) => one.startsWith('not held')) ?? '',
          notCovered: notCovered[2],
        },
        pdf: {
          topic: files.html.includes(`<td>${on.topic}</td>`)
            ? on.topic
            : files.html.includes(`<td>${off.topic}</td>`)
              ? off.topic
              : 'neither',
          codes: ['F1', 'Q1', 'H1', 'D1'].filter((code) => files.html.includes(`${code} · `)),
          notCovered: files.html.includes(`<td>${on.notCovered}</td>`)
            ? on.notCovered
            : files.html.includes(`<td>${off.notCovered}</td>`)
              ? off.notCovered
              : 'neither',
        },
      };
    };
    const whileOn = {
      excel: on,
      pdf: { topic: on.topic, codes: ['F1', 'Q1', 'H1', 'D1'], notCovered: on.notCovered },
    };
    expect(await shown(s)).toEqual(whileOn);

    await switchCodes(s, false);
    expect(await shown(s)).toEqual({
      excel: off,
      pdf: { topic: off.topic, codes: [], notCovered: off.notCovered },
    });
    // Another subject is not affected: its codes stay in its export while the first is off.
    expect(await shown(other)).toEqual(whileOn);

    await switchCodes(s, true);
    expect(await shown(s)).toEqual(whileOn);
  });

  it('writes "code · title" in the journal export and print while on, the title alone while off', async () => {
    const s = await codedScene();
    const other = await codedScene();
    const shown = (x: Scene) =>
      as(x.owner, teacherIn(x), async () => {
        const path = `/api/journal/journals/${x.journal}/export`;
        // The grid's own work of the held lesson, the one the file's column is headed by.
        const grid: JournalGrid = journalGridSchema.parse(
          ok(
            await call(
              x.owner,
              x.branch,
              'get',
              `/api/journal/journals/${x.journal}?quarterId=${x.q1}`,
            ),
          ),
        );
        const titles = (grid.lessons.find((one) => one.id === x.held)?.works ?? []).map(
          (one) => one.title,
        );
        expect(titles).toContain('Exercise 5');
        const made = pdf.htmls.length;
        ok(await fileOf(x.owner, x.branch, path, { quarterId: x.q1, format: 'pdf' }));
        expect(pdf.htmls).toHaveLength(made + 1);
        const html = pdf.last;
        const sheet = await fileOf(x.owner, x.branch, path, { quarterId: x.q1, format: 'xlsx' });
        ok(sheet);
        const cells = (await rowsOfFile(sheet.body as Buffer)).flat();
        const headed = (title: string) => cells.filter((cell) => cell.includes(title));
        return {
          // Every cell that names the work names it with its code while on, none while off.
          excel: [...new Set(headed('Exercise 5').map((cell) => cell.includes('H1 · Exercise 5')))],
          excelBare: headed('Exercise 5').some((cell) => !cell.includes('H1')),
          pdfCoded: html.includes('H1 · Exercise 5'),
          pdfAnyCode: html.includes('H1 · '),
          pdfTitle: html.includes('Exercise 5'),
        };
      });
    const whileOn = {
      excel: [true],
      excelBare: false,
      pdfCoded: true,
      pdfAnyCode: true,
      pdfTitle: true,
    };
    expect(await shown(s)).toEqual(whileOn);
    await switchCodes(s, false);
    expect(await shown(s)).toEqual({
      excel: [false],
      excelBare: true,
      pdfCoded: false,
      pdfAnyCode: false,
      pdfTitle: true,
    });
    expect(await shown(other)).toEqual(whileOn);
    await switchCodes(s, true);
    expect(await shown(s)).toEqual(whileOn);
  });

  it('writes "code · title" in the branch export of journals while on, the title alone while off', async () => {
    const s = await codedScene();
    const principal = await account();
    const shown = () =>
      as(principal, [{ role: 'principal', branchId: s.branch }], async () => {
        const asked = await call(principal, s.branch, 'post', '/api/journal/exports')
          .set(REQUEST_KEY_HEADER, randomUUID())
          .send({ format: 'xlsx', quarterId: s.q1 });
        ok(asked);
        const exportId = journalExportRequestedSchema.parse(asked.body).export.id;
        // The job, run as the existing branch-export tests run it.
        await t.app.get(JournalExports).runBranchExport({ exportId }, { branchIds: [s.branch] });
        const file = await call(principal, s.branch, 'get', `/api/journal/exports/${exportId}/file`)
          .buffer(true)
          .parse(binary);
        ok(file);
        // Every sheet (one per journal of the branch), every cell as text.
        const workbook = new ExcelJS.Workbook();
        const content = file.body as Buffer;
        await workbook.xlsx.load(content as unknown as ArrayBuffer);
        const cells: string[] = [];
        for (const sheet of workbook.worksheets) {
          sheet.eachRow((row) => {
            for (const value of (row.values as unknown[]).slice(1)) {
              if (typeof value === 'string') cells.push(value);
            }
          });
        }
        const named = cells.filter((cell) => cell.includes('Exercise 5'));
        return {
          named: named.length > 0,
          coded: [...new Set(named.map((cell) => cell.includes('H1 · Exercise 5')))],
          anyCode: cells.some((cell) => cell.includes('H1 · ')),
        };
      });
    const whileOn = { named: true, coded: [true], anyCode: true };
    expect(await shown()).toEqual(whileOn);
    await switchCodes(s, false);
    expect(await shown()).toEqual({ named: true, coded: [false], anyCode: false });
    await switchCodes(s, true);
    expect(await shown()).toEqual(whileOn);
  });

  it('answers the topic codes of a change in the requests report only while on, and its file names no code', async () => {
    const s = await scene();
    await switchCodes(s, true);
    const item = await codedItem(s, s.held, { topic: 'Fractions', code: 'F1' });
    // The window of the first quarter ended on 20 October; a Text request approved on the 27th.
    await sql`
      insert into lesson_plan_windows
        (branch_id, quarter_id, start_date, end_date, starts_at, ends_at, opened_at, opened_by)
      select q.branch_id, q.id, date '2026-09-01', date '2026-10-20',
        (date '2026-09-01')::timestamp at time zone b.time_zone,
        ((date '2026-10-21')::timestamp at time zone b.time_zone) - interval '1 millisecond',
        now(), (select a.id from accounts a order by a.id limit 1)
      from quarters q join branches b on b.id = q.branch_id
      where q.id = ${s.q1}
    `.execute(t.database.migrator);
    const decider = (await account()).account.id;
    const requested = await t.database.migrator
      .insertInto('lesson_plan_requests')
      .values({
        branch_id: s.branch,
        plan_id: s.plan,
        journal_id: s.journal,
        quarter_id: s.q1,
        kind: 'text',
        status: 'approved',
        reason: 'A wrong code',
        requested_by: s.owner.account.id,
        sent_at: new Date('2026-10-27T09:00:00+05:00'),
        decided_by: decider,
        decided_at: new Date('2026-10-27T10:00:00+05:00'),
        days: 3,
        open_until: new Date('2026-10-30T23:59:59.999+05:00'),
        prepared_at: new Date('2026-10-27T09:00:00+05:00'),
        updated_at: new Date('2026-10-27T10:00:00+05:00'),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await t.database.migrator
      .insertInto('lesson_plan_request_lessons')
      .values({
        branch_id: s.branch,
        request_id: requested.id,
        lesson_id: s.held,
        lesson_date: '2026-10-12',
      })
      .execute();
    const values = { topic: 'Fractions', objectives: '', links: [], classworks: [], homeworks: [] };
    await as(s.owner, teacherIn(s), async () => {
      ok(
        await call(s.owner, s.branch, 'put', `/api/plans/items/${item.itemId}`).send({
          base: { ...values, topicCode: 'F1' },
          values: { ...values, topic: 'Common fractions', topicCode: 'F2' },
        }),
      );
    });

    const vice = await account();
    const read = () =>
      as(vice, viceIn(s), async () => {
        const report = planRequestsReportSchema.parse(
          ok(await call(vice, s.branch, 'get', `/api/plans/reports/requests?quarterId=${s.q1}`)),
        );
        const found = report.teachers
          .flatMap((one) => one.requests)
          .find((one) => one.id === requested.id);
        const changes = (found?.changes ?? []).map((one) => [
          one.topicBefore,
          one.topicCodeBefore,
          one.topicAfter,
          one.topicCodeAfter,
        ]);
        const file = await fileOf(vice, s.branch, '/api/plans/reports/export', {
          report: 'requests',
          quarterId: s.q1,
        });
        ok(file);
        const cells = (await rowsOfFile(file.body as Buffer)).flat();
        return { changes, fileCodes: cells.filter((cell) => /\bF[12]\b/.test(cell)) };
      });

    // The requests file counts the changes and names no topic (`09`, Reports, Edit requests;
    // `requestsSheet`), so it names no code either way.
    expect(await read()).toEqual({
      changes: [['Fractions', 'F1', 'Common fractions', 'F2']],
      fileCodes: [],
    });
    await switchCodes(s, false);
    expect(await read()).toEqual({
      changes: [['Fractions', null, 'Common fractions', null]],
      fileCodes: [],
    });
    await switchCodes(s, true);
    expect(await read()).toEqual({
      changes: [['Fractions', 'F1', 'Common fractions', 'F2']],
      fileCodes: [],
    });
  });

  it('keeps every plan report file free of codes, on and off (they name no topic or work)', async () => {
    const s = await codedScene();
    const vice = await account();
    const files = () =>
      as(vice, viceIn(s), async () => {
        const found: string[] = [];
        for (const report of ['completeness', 'progress'] as const) {
          const file = await fileOf(vice, s.branch, '/api/plans/reports/export', {
            report,
            quarterId: s.q1,
          });
          ok(file);
          const rows = await rowsOfFile(file.body as Buffer);
          const cells = rows.flat();
          // The report lists plans (rows past its title, moment and headings) …
          expect(rows.length).toBeGreaterThan(3);
          // … and none of its codes or names.
          found.push(
            ...cells.filter((cell) => /\b(F1|Q1|H1|D1)\b|Fractions|Exercise 5/.test(cell)),
          );
        }
        return found;
      });
    expect(await files()).toEqual([]);
    await switchCodes(s, false);
    expect(await files()).toEqual([]);
  });
});
