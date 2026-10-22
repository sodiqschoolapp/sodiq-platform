import { BRANCH_HEADER, listName } from '@sodiq/shared';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PDF_MEDIA_TYPE } from '../../http/pdf.js';
import { XLSX_MEDIA_TYPE } from '../../http/xlsx.js';
import { dayTemplatesKit, UNKNOWN, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { linesOf, RecordingPdf, refusedFile as refused } from '../../testing/pdf-kit.js';
import { hoursOf, publishedScene, type PublishedScene } from '../../testing/published-scene.js';
import { binary } from '../../testing/xlsx-kit.js';

type Body = Readonly<Record<string, string | undefined>>;

/** A two-grade scene: a grade 7 and a grade 8 class on templates that number 08:55 differently. */
interface GradesScene {
  branch: string;
  version: string;
  class7: string;
  class8: string;
  teacher: string;
  vacancy: string;
  markupRoom: string;
}

// All names are invented. Task 5.9c-2, pull request #200: Print, PDF and
// Excel of a version's weekly pattern (edge/timetable, "The wall timetable is
// out of date": "A printed pattern carries the version, 'valid from', the
// print time and 'one-day changes not included'. ... A draft print is marked
// DRAFT"; 06, step 8 "Print and export"). The clock stands at 23:55 on
// Saturday 10 October 2026 in Tashkent; the scene's version runs from Monday
// 12 October on a day of lesson, break, lesson, break, lesson from 08:00:
// maths of each class on Monday in lesson 1, and the teacher's second subject
// to the other class in lesson 2, after the break (slot position 3).
describe('the files of a timetable version', () => {
  const pdf = new RecordingPdf();
  let t: DayTemplatesKit;
  let load: LoadKit;
  let s: PublishedScene;
  let archived: PublishedScene;
  let draft: string;
  let g: GradesScene;

  const send = (version: string, body: Body, cookie = t.admin, branch = s.branch) =>
    request(t.kit.server)
      .post(`/api/timetable/versions/${version}/export`)
      .set('Cookie', cookie)
      .set(BRANCH_HEADER, branch)
      .buffer(true)
      .parse(binary)
      .send({ format: 'pdf', ...body });

  const ok = (response: Response, type = PDF_MEDIA_TYPE) => {
    expect(response.status, String(response.body)).toBe(200);
    expect(response.headers['content-type']).toContain(type);
    return response.body as Buffer;
  };

  /** The HTML of the PDF of a version. */
  const printed = async (version: string, body: Body, branch = s.branch) => {
    ok(await send(version, { ...body, format: 'pdf' }, t.admin, branch));
    return pdf.last;
  };

  /** The preamble and the lesson rows of the Excel file of a version. */
  const sheetOf = async (version: string, body: Body, branch = s.branch) => {
    const content = ok(
      await send(version, { ...body, format: 'xlsx' }, t.admin, branch),
      XLSX_MEDIA_TYPE,
    );
    const { sheet, lines } = await linesOf(content);
    const heading = lines.findIndex((one) => one.values[0] === 'Weekday');
    return {
      sheet,
      preamble: lines.slice(0, heading).map((one) => one.values[0]),
      rows: lines.slice(heading + 1).map((one) => one.values),
    };
  };

  /** The `@page` rule of a printout: the margin boxes repeated on every page. */
  const pageRule = (html: string) => html.slice(html.indexOf('@page'), html.indexOf('* {'));

  const entries = () =>
    t.database.migrator
      .selectFrom('audit_log')
      .select(['details', 'branch_id', 'actor_id'])
      .where('action', '=', 'timetable_version.export')
      .execute();

  /** The name a file prints for a person (5.9a: the list form). */
  const nameOf = async (staffId: string) => {
    const found = await t.database.migrator
      .selectFrom('staff')
      .select(['first_name', 'last_name'])
      .where('id', '=', staffId)
      .executeTakeFirstOrThrow();
    return listName({ firstName: found.first_name ?? '', lastName: found.last_name ?? '' });
  };

  const speak = (language: 'uz' | 'ru' | 'en') =>
    t.database.migrator.updateTable('accounts').set({ language }).execute();

  /** A slot type, a template and its assignment to one grade on every weekday. */
  const gradeTemplate = async (
    branch: string,
    grade: number,
    name: string,
    slotTypes: readonly string[],
  ) => {
    const template = await t.createTemplate(branch, name, slotTypes);
    await t.assign(branch, template, { level: 'grades', gradeFrom: grade, gradeTo: grade });
  };

  const place = async (
    branch: string,
    version: string,
    loadRowId: string,
    weekday: number,
    slotPosition: number,
  ) => {
    const placed = await t.post(`/api/timetable/versions/${version}/pattern`, branch, {
      loadRowId,
      weekday,
      slotPosition,
    });
    expect(placed.status, JSON.stringify(placed.body)).toBe(201);
  };

  /**
   * A branch whose grade 7 day is lesson, break, lesson (08:55 is lesson 2)
   * and whose grade 8 day is lesson, short lesson, lesson (08:55 is lesson 3);
   * a draft with: a group of both classes at 08:55 on Monday, taught by one
   * teacher who also teaches the grade 8 class alone at 08:00 on Monday; a
   * vacancy's lesson to the grade 7 class at 08:00 on Tuesday, in a room
   * whose name is typed as markup.
   */
  const gradesScene = async (): Promise<GradesScene> => {
    const branch = await t.newBranch();
    const year = await load.classes.year(branch);
    const lesson = await t.createSlotType(branch, 'Lesson', 'lesson', 45);
    const short = await t.createSlotType(branch, 'Short lesson', 'lesson', 10);
    const pause = await t.createSlotType(branch, 'Break', 'break', 10);
    await gradeTemplate(branch, 7, 'Grade 7', [lesson, pause, lesson]);
    await gradeTemplate(branch, 8, 'Grade 8', [lesson, short, lesson]);
    const subject = await load.classes.subject({ grades: [7, 8], journalType: 'attendance_only' });
    // A second subject, taught whole: a class takes a subject split or whole, never both.
    const whole = await load.classes.subject({ grades: [7, 8], journalType: 'attendance_only' });
    const markupRoom = await load.classes.room(branch);
    await t.database.migrator
      .updateTable('rooms')
      .set({ name: '<b>Lab</b>' })
      .where('id', '=', markupRoom)
      .execute();
    const class7 = await load.classes.schoolClass(branch, year, { grade: 7 });
    const class8 = await load.classes.schoolClass(branch, year, { grade: 8 });
    const group = await load.classes.group(branch, year, subject, [class7, class8]);
    const teacher = await load.teacher(branch, {
      subjects: [
        { subject, grades: [7, 8] },
        { subject: whole, grades: [7, 8] },
      ],
    });
    await hoursOf(t, branch, teacher.staffId);
    const vacancy = await load.vacancy(branch, { subjects: [{ subject: whole, grades: [7, 8] }] });
    await hoursOf(t, branch, vacancy);
    const created = await t.post('/api/timetable/versions', branch, {
      academicYearId: year,
      startsOn: '2026-10-19',
      copyFrom: null,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const version = (created.body as { id: string }).id;
    const groupRow = await load.row({
      branch_id: branch,
      version_id: version,
      group_id: group,
      subject_id: subject,
      teacher_id: teacher.staffId,
      lessons_per_week: 1,
    });
    await place(branch, version, groupRow, 1, 3);
    const aloneRow = await load.row({
      branch_id: branch,
      version_id: version,
      class_id: class8,
      subject_id: whole,
      teacher_id: teacher.staffId,
      lessons_per_week: 1,
    });
    await place(branch, version, aloneRow, 1, 1);
    const vacancyRow = await load.row({
      branch_id: branch,
      version_id: version,
      class_id: class7,
      subject_id: whole,
      teacher_id: vacancy,
      room_id: markupRoom,
      lessons_per_week: 1,
    });
    await place(branch, version, vacancyRow, 2, 1);
    await load.freeEditLock(version);
    return {
      branch,
      version,
      class7,
      class8,
      teacher: teacher.staffId,
      vacancy,
      markupRoom,
    };
  };

  beforeAll(async () => {
    t = await dayTemplatesKit({ jobs: true, pdfRenderer: pdf });
    load = new LoadKit(t.database.migrator);
    s = await publishedScene(t, load, { branch: t.north, secondSubject: true });
    const copied = await t.post('/api/timetable/versions', s.branch, {
      academicYearId: s.year,
      startsOn: '2026-10-19',
      copyFrom: s.version,
    });
    expect(copied.status, JSON.stringify(copied.body)).toBe(201);
    draft = (copied.body as { id: string }).id;
    await load.freeEditLock(draft);
    archived = await publishedScene(t, load, { branch: t.south });
    // A version withdrawn before it ran is archived (withdraw.service.ts).
    await load.setVersion(archived.version, 'archived');
    g = await gradesScene();
    await speak('en');
  });

  afterAll(async () => {
    await t.close();
  });

  describe('the stamp (edge/timetable, "The wall timetable is out of date")', () => {
    it('prints on every page of a published version its number, "valid from", the print time and "one-day changes not included"', async () => {
      const html = await printed(s.version, { kind: 'branch' });
      const page = pageRule(html);
      expect(page).toContain(
        'Version 1, valid from 12.10.2026 · Printed 10.10.2026 23:55 · One-day changes not included',
      );
      expect(page).not.toContain('DRAFT');
      expect(page).not.toContain('Archived');
      expect(html).toContain('<h1>School timetable · Weekly pattern</h1>');
    });

    it('puts the same four lines above the Excel heading row of a published version', async () => {
      const { preamble, sheet } = await sheetOf(s.version, { kind: 'class', classId: s.classId });
      expect(sheet.name).toBe('Timetable');
      expect(String(preamble[0])).toContain('Class timetable');
      expect(preamble.slice(1)).toEqual([
        'Version 1, valid from 12.10.2026',
        'Printed 10.10.2026 23:55',
        'One-day changes not included',
      ]);
    });

    it('marks a draft DRAFT on every page and first in the Excel file, with its planned start and the other three items', async () => {
      const html = await printed(draft, { kind: 'branch' });
      const page = pageRule(html);
      expect(page).toMatch(/@top-right \{ content: "DRAFT";[^}]*color: #4A5270;/);
      expect(page).toContain(
        'DRAFT · Version 2, planned from 19.10.2026 · Printed 10.10.2026 23:55 · One-day changes not included',
      );
      expect(page).not.toContain('valid from');
      const { preamble } = await sheetOf(draft, { kind: 'branch' });
      expect(preamble[0]).toBe('DRAFT');
      expect(preamble.slice(2)).toEqual([
        'Version 2, planned from 19.10.2026',
        'Printed 10.10.2026 23:55',
        'One-day changes not included',
      ]);
    });

    it('names an archived version "Archived" on every page and first in the Excel file (decision 2)', async () => {
      const html = await printed(archived.version, { kind: 'branch' }, archived.branch);
      const page = pageRule(html);
      expect(page).toContain(
        'Archived · Version 1, valid from 12.10.2026 · Printed 10.10.2026 23:55 · One-day changes not included',
      );
      expect(page).not.toContain('DRAFT');
      const { preamble } = await sheetOf(archived.version, { kind: 'branch' }, archived.branch);
      expect(preamble[0]).toBe('Archived');
    });

    it('writes the stamp in the language of the account', async () => {
      await speak('ru');
      try {
        const html = await printed(draft, { kind: 'branch' });
        expect(pageRule(html)).toContain(
          'ЧЕРНОВИК · Версия 2, планируется с 19.10.2026 · Напечатано 10.10.2026 23:55 · Изменения на один день не учтены',
        );
        await speak('uz');
        const uz = await printed(s.version, { kind: 'branch' });
        expect(pageRule(uz)).toContain(
          '1-versiya, 12.10.2026 dan amal qiladi · Chop etilgan: 10.10.2026 23:55 · Bir kunlik oʻzgarishlar kiritilmagan',
        );
      } finally {
        await speak('en');
      }
    });
  });

  describe('what each kind prints (decision 5)', () => {
    it('prints a class with its lessons only, each lesson numbered among the lesson slots, the break not counted', async () => {
      const own = await sheetOf(s.version, { kind: 'class', classId: s.classId });
      expect(own.rows.map((row) => [row[0], row[1], row[6]])).toEqual([
        ['Monday', 1, await nameOf(s.teacher.staffId)],
      ]);
      const other = await sheetOf(s.version, { kind: 'class', classId: s.otherClass });
      // The second subject sits at slot position 3, after the break: lesson 2 (spec review must-fix 1).
      expect(other.rows.map((row) => [row[0], row[1], row[6]])).toEqual([
        ['Monday', 1, await nameOf(s.otherTeacher.staffId)],
        ['Monday', 2, await nameOf(s.teacher.staffId)],
      ]);
      const second = other.rows[1] ?? [];
      // ExcelJS reads a time cell back as a moment of 30 December 1899.
      expect((second[2] as Date).toISOString()).toBe('1899-12-30T08:55:00.000Z');
      expect((second[3] as Date).toISOString()).toBe('1899-12-30T09:40:00.000Z');
      const html = await printed(s.version, { kind: 'class', classId: s.otherClass });
      // Lesson numbers down: 1, 2 and 3, no row for a break.
      expect(html.match(/<th class="num">\d+<\/th>/g)).toEqual([
        '<th class="num">1</th>',
        '<th class="num">2</th>',
        '<th class="num">3</th>',
      ]);
      expect(html).toContain('<th class="num">2</th><td><div class="slot">08:55–09:40</div>');
    });

    it('prints a teacher with their lessons in every class, a room with its lessons, the school with all', async () => {
      const teacher = await sheetOf(s.version, { kind: 'teacher', staffId: s.teacher.staffId });
      expect(teacher.rows.map((row) => [row[1], row[4]])).toEqual([
        [1, expect.stringContaining('7 ')],
        [2, expect.stringContaining('7 ')],
      ]);
      const name = await nameOf(s.teacher.staffId);
      expect(teacher.rows.every((row) => row[6] === name)).toBe(true);
      const school = await sheetOf(s.version, { kind: 'branch' });
      expect(school.rows).toHaveLength(3);
      const room = await sheetOf(s.version, { kind: 'room', roomId: s.room });
      expect(room.rows.every((row) => row[7] !== '')).toBe(true);
      expect(room.rows.length).toBeLessThan(3);
    });

    it('prints a vacancy as a teacher, with its lessons', async () => {
      const vacancy = await sheetOf(g.version, { kind: 'teacher', staffId: g.vacancy }, g.branch);
      expect(vacancy.rows.map((row) => [row[0], row[1]])).toEqual([['Tuesday', 1]]);
    });

    it('prints a record with no lesson as an empty week', async () => {
      const room = await load.classes.room(s.branch);
      const { rows } = await sheetOf(s.version, { kind: 'room', roomId: room });
      expect(rows).toEqual([]);
      expect(await printed(s.version, { kind: 'room', roomId: room })).toContain(
        '<p class="quiet">No lessons</p>',
      );
    });

    it('prints a name typed as markup as typed', async () => {
      const html = await printed(g.version, { kind: 'class', classId: g.class7 }, g.branch);
      expect(html).toContain('&lt;b&gt;Lab&lt;/b&gt;');
      expect(html).not.toContain('<b>Lab</b>');
    });
  });

  describe('lesson numbers of a two-grade group (approval correction 3)', () => {
    it('numbers a group lesson in the lowest grade of its classes, and a class print in the class’s own grade', async () => {
      const teacher = await sheetOf(g.version, { kind: 'teacher', staffId: g.teacher }, g.branch);
      const group = teacher.rows.find((row) =>
        (row[2] as Date).toISOString().endsWith('08:55:00.000Z'),
      );
      // Grade 7: lesson, break, lesson: 08:55 is lesson 2.
      expect(group?.[1]).toBe(2);
      const class8 = await sheetOf(g.version, { kind: 'class', classId: g.class8 }, g.branch);
      // Grade 8: lesson, short lesson, lesson: 08:55 is lesson 3.
      expect(class8.rows.map((row) => row[1])).toEqual([1, 3]);
      const class7 = await sheetOf(g.version, { kind: 'class', classId: g.class7 }, g.branch);
      expect(class7.rows.map((row) => [row[0], row[1]])).toEqual([
        ['Monday', 2],
        ['Tuesday', 1],
      ]);
    });

    it('lists a teacher by clock time when their lessons come from templates with different times (edge/timetable, Structure)', async () => {
      const html = await printed(g.version, { kind: 'teacher', staffId: g.teacher }, g.branch);
      expect(html).not.toContain('<table class="grid">');
      expect(html).toContain('<h2>Monday</h2></div><table class="list">');
      expect(html).toContain('<td class="time">08:00–08:45</td>');
      expect(html).toContain('<td class="time">08:55–09:40</td>');
      // One template: lesson numbers in a grid.
      const one = await printed(s.version, { kind: 'teacher', staffId: s.teacher.staffId });
      expect(one).toContain('<table class="grid">');
    });

    it('draws the school by clock time on a day whose classes’ templates differ', async () => {
      const html = await printed(g.version, { kind: 'branch' }, g.branch);
      expect(html).toContain('<div class="time">08:55–09:40</div>');
      expect(html).not.toContain('<th>1<div class="slot">');
    });
  });

  describe('the audit log (decision 10)', () => {
    it('writes one entry per file with the version, the kind, the record and the count', async () => {
      const before = (await entries()).length;
      ok(
        await send(draft, { kind: 'class', classId: s.otherClass, format: 'xlsx' }),
        XLSX_MEDIA_TYPE,
      );
      const after = await entries();
      expect(after).toHaveLength(before + 1);
      const entry = after.find(
        (one) =>
          (one.details as { versionId?: string; of?: string }).versionId === draft &&
          (one.details as { of?: string }).of === s.otherClass,
      );
      expect(entry?.branch_id).toBe(s.branch);
      expect(entry?.details).toEqual({
        versionId: draft,
        number: 2,
        status: 'draft',
        kind: 'class',
        of: s.otherClass,
        format: 'xlsx',
        printedAt: '2026-10-10T18:55:00.000Z',
        lessons: 2,
      });
    });

    it('answers 503 pdf_unavailable without a renderer and writes nothing; Excel still works', async () => {
      const before = (await entries()).length;
      pdf.failing = true;
      try {
        refused(await send(s.version, { kind: 'branch' }), 503, 'pdf_unavailable');
        expect(await entries()).toHaveLength(before);
        ok(await send(s.version, { kind: 'branch', format: 'xlsx' }), XLSX_MEDIA_TYPE);
        expect(await entries()).toHaveLength(before + 1);
      } finally {
        pdf.failing = false;
      }
    });
  });

  describe('refusals (.claude/rules/api.md)', () => {
    it('answers 404 for a version of another branch or an unknown one, and writes nothing', async () => {
      const before = (await entries()).length;
      refused(await send(archived.version, { kind: 'branch' }), 404, 'not_found');
      refused(await send(UNKNOWN, { kind: 'branch' }), 404, 'not_found');
      expect(await entries()).toHaveLength(before);
    });

    it('answers 404 for a class, teacher or room of another branch or an unknown one, and writes nothing', async () => {
      const before = (await entries()).length;
      for (const body of [
        { kind: 'class', classId: archived.classId },
        { kind: 'class', classId: UNKNOWN },
        { kind: 'teacher', staffId: archived.teacher.staffId },
        { kind: 'teacher', staffId: UNKNOWN },
        { kind: 'room', roomId: archived.room },
        { kind: 'room', roomId: UNKNOWN },
      ]) {
        refused(await send(s.version, body), 404, 'not_found');
        refused(await send(s.version, { ...body, format: 'xlsx' }), 404, 'not_found');
      }
      expect(await entries()).toHaveLength(before);
    });

    it('refuses a role that does not view the versions, given a role in the branch, and writes nothing', async () => {
      const before = (await entries()).length;
      for (const [role, last] of [
        ['tutor', 'Karimova'],
        ['teacher', 'Saidova'],
        ['head_tutor', 'Nazarova'],
        ['spiritual_vice_principal', 'Olimova'],
      ] as const) {
        const browser = await t.kit.completeSession('Lola', last);
        await t.kit.giveRole(browser.account.id, {
          role,
          branchId: s.branch,
          validFrom: new Date('2026-09-01T00:00:00+05:00'),
        });
        refused(
          await send(s.version, { kind: 'branch' }, browser.cookie),
          403,
          'permission_denied',
        );
      }
      expect(await entries()).toHaveLength(before);
    });

    it('lets the Principal and the Academic Vice Principal print a draft', async () => {
      for (const cookie of [t.principal, t.vicePrincipal]) {
        ok(await send(draft, { kind: 'branch' }, cookie));
        ok(await send(draft, { kind: 'branch', format: 'xlsx' }, cookie), XLSX_MEDIA_TYPE);
      }
    });
  });

  it('names the file by version, kind and record, with an ASCII fallback', async () => {
    const response = await send(s.version, { kind: 'class', classId: s.classId, format: 'xlsx' });
    ok(response, XLSX_MEDIA_TYPE);
    const disposition = String(response.headers['content-disposition']);
    expect(disposition).toContain('filename="version-1-class.xlsx"');
    expect(decodeURIComponent(disposition)).toContain('version-1-class-7-');
    expect(response.headers['x-export-columns']).toBe(
      'weekday,lessonNumber,start,end,unit,subject,teacher,room',
    );
  });
});
