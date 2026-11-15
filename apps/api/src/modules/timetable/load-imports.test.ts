import {
  BRANCH_HEADER,
  LOAD_IMPORT_WORDS,
  STUDENT_IMPORT_TYPES,
  draftReadinessSchema,
  loadImportConfirmResultSchema,
  loadImportPreviewSchema,
  type LoadImportConfirmResult,
  type LoadImportPreview,
  type LoadImportPreviewRow,
} from '@sodiq/shared';
import { sql } from 'kysely';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { dayTemplatesKit, UNKNOWN, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import {
  filledLoadTemplate,
  templateList,
  type LoadTemplateRow,
} from '../../testing/load-import-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { errorCode } from '../../testing/sign-in-kit.js';

const XLSX = STUDENT_IMPORT_TYPES[0] ?? '';
const EN = LOAD_IMPORT_WORDS.en;

const refusedWith = (response: Response, status: number, code: string) => {
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  expect(errorCode(response)).toBe(code);
};

/** The codes of every problem of the preview's row of `rowNumber`. */
const codesOf = (preview: LoadImportPreview, rowNumber: number): string[] =>
  (preview.rows.find((row) => row.rowNumber === rowNumber)?.problems ?? []).map(
    (problem) => problem.code,
  );

const rowOf = (preview: LoadImportPreview, rowNumber: number): LoadImportPreviewRow => {
  const found = preview.rows.find((row) => row.rowNumber === rowNumber);
  if (found === undefined) throw new Error(`No row ${String(rowNumber)}.`);
  return found;
};

// All names are invented. Task 5.13, the owner's spec change of 15 November 2026:
// docs/spec/06-timetable.md, Importing the load and the timetable (who, the template, chosen never
// created, the load import's rules, preview and checks, audit); 05, Teaching load; edge/timetable,
// Structure. The clock stands at 23:55 on Saturday 10 October 2026 in Tashkent.
describe('the teaching load import', () => {
  let t: DayTemplatesKit;
  let load: LoadKit;
  let year: string;
  let southYear: string;
  let maths: string;
  let pe: string;
  let english: string;
  let tutorSubject: string;
  let oxford: string;
  let princeton: string;
  let mathsTeacher: string;
  let ruTeacher: string;
  let pe1: string;
  let pe2: string;
  let e1: string;
  let e2: string;
  let e3: string;
  let label: Map<string, string>;
  let southDraft = '';
  let southImport = '';
  let southTeacher = '';
  let southRoom = '';
  const MATHS = 'Algebra Lime';
  const PE = 'Movement Lime';
  const ENGLISH = 'Language Lime';
  let TUTOR = '';

  const templateOf = async (version: string, cookie = t.vicePrincipal, branch = '') => {
    const response = await request(t.kit.server)
      .get(`/api/timetable/versions/${version}/load/import-template?language=en`)
      .set('Cookie', cookie)
      .set(BRANCH_HEADER, branch || t.north)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          callback(null, Buffer.concat(chunks));
        });
      });
    return response;
  };

  const template = async (version: string): Promise<Buffer> => {
    const response = await templateOf(version);
    expect(response.status).toBe(200);
    return response.body as Buffer;
  };

  const upload = (version: string, bytes: Buffer, cookie = t.vicePrincipal, branch = '') =>
    request(t.kit.server)
      .put(`/api/timetable/versions/${version}/load/imports`)
      .set('Cookie', cookie)
      .set(BRANCH_HEADER, branch || t.north)
      .set('Content-Type', XLSX)
      .send(bytes);

  async function uploaded(
    version: string,
    rows: readonly LoadTemplateRow[],
    meta: { versionId?: string } = {},
  ): Promise<LoadImportPreview> {
    const bytes = await filledLoadTemplate(await template(version), rows, meta);
    const response = await upload(version, bytes);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return loadImportPreviewSchema.parse(response.body);
  }

  const previewOf = (version: string, id: string, cookie = t.vicePrincipal, branch = '') =>
    t.post(
      `/api/timetable/versions/${version}/load/imports/${id}/preview`,
      branch || t.north,
      {},
      cookie,
    );

  const confirm = (version: string, id: string, cookie = t.vicePrincipal, branch = '') =>
    t.post(
      `/api/timetable/versions/${version}/load/imports/${id}/confirm`,
      branch || t.north,
      {},
      cookie,
    );

  async function confirmed(version: string, id: string): Promise<LoadImportConfirmResult> {
    const response = await confirm(version, id);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return loadImportConfirmResultSchema.parse(response.body);
  }

  const rowsOfDraft = (version: string) =>
    t.database.migrator
      .selectFrom('teaching_load_rows')
      .selectAll()
      .where('version_id', '=', version)
      .orderBy('id')
      .execute();

  /** Every row of the tables the routes write, in both branches, and the audit count. */
  const rowsOf = () =>
    Promise.all([
      t.database.migrator.selectFrom('teaching_load_rows').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('load_imports').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('timetable_versions').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('notifications').selectAll().orderBy('id').execute(),
      t.auditCount(),
    ]);

  const draft = (input: { startsOn?: string } = {}) =>
    load.version(t.north, year, { startsOn: input.startsOn ?? '2026-10-19' });

  /** A teacher of the North and their label in the template. */
  async function teacher(
    subjects: { subject: string; grades: number[] }[],
    languages: ('uz' | 'ru')[] = ['uz'],
  ): Promise<string> {
    const made = await load.teacher(t.north, { languages, subjects });
    const row = await t.database.migrator
      .selectFrom('staff')
      .select(['first_name', 'last_name', 'staff_id'])
      .where('id', '=', made.staffId)
      .executeTakeFirstOrThrow();
    label.set(
      made.staffId,
      `${row.last_name ?? ''} ${row.first_name ?? ''} (${row.staff_id ?? ''})`,
    );
    return made.staffId;
  }

  const name = (id: string): string => {
    const found = label.get(id);
    if (found === undefined) throw new Error('No label.');
    return found;
  };

  /** The clean file of the invented branch (the Done-when): a split, three groups, a Tutor row. */
  const cleanRows = (): LoadTemplateRow[] => [
    { unit: '7 Oxford', subject: MATHS, teacher: name(mathsTeacher), lessonsPerWeek: '5' },
    { unit: '7O-PE-1', subject: PE, teacher: name(pe1), lessonsPerWeek: '2' },
    { unit: '7O-PE-2', subject: PE, teacher: name(pe2), lessonsPerWeek: '2' },
    { unit: '7-E-1', subject: ENGLISH, teacher: name(e1), lessonsPerWeek: '3' },
    { unit: '7-E-2', subject: ENGLISH, teacher: name(e2), lessonsPerWeek: '3' },
    { unit: '7-E-3', subject: ENGLISH, teacher: name(e3), lessonsPerWeek: '3' },
    { unit: '7 Oxford', subject: TUTOR, lessonsPerWeek: '1', doubleLessons: EN.answers.no },
  ];

  beforeAll(async () => {
    t = await dayTemplatesKit();
    load = new LoadKit(t.database.migrator);
    label = new Map();
    year = await load.classes.year(t.north);
    southYear = await load.classes.year(t.south);
    const long = await t.createSlotType(t.north, 'Lesson', 'lesson', 45);
    const short = await t.createSlotType(t.north, 'Short lesson', 'lesson', 40);
    const pause = await t.createSlotType(t.north, 'Break', 'break', 10);
    const regular = await t.createTemplate(t.north, 'Regular', [long, pause, long, pause, long]);
    const junior = await t.createTemplate(t.north, 'Junior', [short, pause, short, pause, short]);
    await t.assign(t.north, regular);
    await t.assign(t.north, junior, { level: 'grades', gradeFrom: 1, gradeTo: 4 });
    maths = await load.classes.subject({ grades: [7, 8], name: MATHS });
    pe = await load.classes.subject({ grades: [7], name: PE });
    english = await load.classes.subject({ grades: [7], name: ENGLISH, languageRule: false });
    tutorSubject = await load.tutorSubject({ grades: [7] });
    TUTOR = (
      await t.database.migrator
        .selectFrom('subjects')
        .select('name_en')
        .where('id', '=', tutorSubject)
        .executeTakeFirstOrThrow()
    ).name_en;
    oxford = await load.classes.schoolClass(t.north, year, { grade: 7, name: 'Oxford' });
    princeton = await load.classes.schoolClass(t.north, year, { grade: 7, name: 'Princeton' });
    await load.classes.group(t.north, year, pe, [oxford], { name: '7O-PE-1' });
    await load.classes.group(t.north, year, pe, [oxford], { name: '7O-PE-2' });
    for (const one of ['7-E-1', '7-E-2', '7-E-3']) {
      await load.classes.group(t.north, year, english, [oxford, princeton], { name: one });
    }
    mathsTeacher = await teacher([{ subject: maths, grades: [7] }]);
    ruTeacher = await teacher([{ subject: maths, grades: [7] }], ['ru']);
    pe1 = await teacher([{ subject: pe, grades: [7] }]);
    pe2 = await teacher([{ subject: pe, grades: [7] }]);
    e1 = await teacher([{ subject: english, grades: [7] }]);
    e2 = await teacher([{ subject: english, grades: [7] }], ['ru']);
    e3 = await teacher([{ subject: english, grades: [7] }]);
    const tutor = await load.teacher(t.north);
    await load.tutorOf(t.north, oxford, tutor.accountId, {
      from: new Date('2026-09-01T00:00:00+05:00'),
    });
    // The South has records of its own; none of them is ever listed or found in the North.
    const cambridge = await load.classes.schoolClass(t.south, southYear, {
      grade: 7,
      name: 'Cambridge',
    });
    const room = await load.classes.room(t.south);
    southRoom = (
      await t.database.migrator
        .selectFrom('rooms')
        .select('name')
        .where('id', '=', room)
        .executeTakeFirstOrThrow()
    ).name;
    const south = await load.teacher(t.south, { subjects: [{ subject: maths, grades: [7] }] });
    const southRow = await t.database.migrator
      .selectFrom('staff')
      .select(['first_name', 'last_name', 'staff_id'])
      .where('id', '=', south.staffId)
      .executeTakeFirstOrThrow();
    southTeacher = `${southRow.last_name ?? ''} ${southRow.first_name ?? ''} (${southRow.staff_id ?? ''})`;
    // A South draft with a load row and a kept import, so a stray write to them would show.
    southDraft = await load.version(t.south, southYear);
    await load.row({
      branch_id: t.south,
      version_id: southDraft,
      class_id: cambridge,
      subject_id: maths,
      teacher_id: south.staffId,
    });
    const southTemplate = await templateOf(southDraft, t.admin, t.south);
    expect(southTemplate.status).toBe(200);
    const southUpload = await upload(
      southDraft,
      await filledLoadTemplate(southTemplate.body as Buffer, [
        { unit: '7 Cambridge', subject: MATHS, teacher: southTeacher, lessonsPerWeek: '3' },
      ]),
      t.admin,
      t.south,
    );
    expect(southUpload.status, JSON.stringify(southUpload.body)).toBe(200);
    southImport = loadImportPreviewSchema.parse(southUpload.body).importId;
  }, 120_000);

  afterAll(async () => {
    await t.close();
  });

  describe('the Done-when', () => {
    it('adds the invented branch to an empty draft in one confirm, and step 2 of the builder reads it', async () => {
      const version = await draft();
      const preview = await uploaded(version, cleanRows());
      expect(preview.clean, JSON.stringify(preview.rows)).toBe(true);
      expect(preview.rowsInDraft).toBe(0);
      const result = await confirmed(version, preview.importId);
      expect(result.outcome).toBe('saved');
      const rows = await rowsOfDraft(version);
      expect(rows).toHaveLength(7);
      // The Tutor row holds the class's Tutor, written by the server.
      const tutorRow = rows.find((row) => row.subject_id === tutorSubject);
      expect(tutorRow?.class_id).toBe(oxford);
      expect(tutorRow?.teacher_id).not.toBeNull();
      const readiness = draftReadinessSchema.parse(
        (await t.get(`/api/timetable/versions/${version}/readiness`, t.north, t.vicePrincipal))
          .body,
      );
      expect(readiness.load.rows).toBe(7);
      expect(readiness.load.problemRows).toEqual([]);
      // One entry with every row written.
      const entries = await t.database.migrator
        .selectFrom('audit_log')
        .select(['action', 'details'])
        .where('action', '=', 'teaching_load.import')
        .where('record_id', '=', preview.importId)
        .execute();
      expect(entries).toHaveLength(1);
      const details = entries[0]?.details as { rows: { id: string }[]; created: number };
      expect(details.created).toBe(7);
      expect(details.rows.map((row) => row.id).sort()).toEqual(rows.map((row) => row.id).sort());
      const creates = await t.database.migrator
        .selectFrom('audit_log')
        .select('id')
        .where('action', '=', 'teaching_load.create')
        .where(
          'record_id',
          'in',
          rows.map((row) => row.id),
        )
        .execute();
      expect(creates).toEqual([]);
    });

    it('saves nothing for an unknown teacher, a split given to one half only and a teacher without the language, and lists the three rows', async () => {
      const version = await draft();
      const before = await rowsOfDraft(version);
      const preview = await uploaded(version, [
        {
          unit: '7 Princeton',
          subject: MATHS,
          teacher: 'Nobody Unknown (S-999999)',
          lessonsPerWeek: '4',
        },
        { unit: '7O-PE-1', subject: PE, teacher: name(pe1), lessonsPerWeek: '2' },
        { unit: '7 Oxford', subject: MATHS, teacher: name(ruTeacher), lessonsPerWeek: '5' },
      ]);
      expect(preview.clean).toBe(false);
      expect(codesOf(preview, 3)).toEqual(['load_import_unknown']);
      expect(rowOf(preview, 3).problems[0]?.column).toBe('teacher');
      expect(codesOf(preview, 4)).toEqual(['load_import_block_part']);
      expect(rowOf(preview, 4).problems[0]?.groups).toEqual(['7O-PE-2']);
      expect(codesOf(preview, 5)).toEqual(['load_teacher_language']);
      const result = await confirmed(version, preview.importId);
      expect(result.outcome).toBe('not_clean');
      expect(await rowsOfDraft(version)).toEqual(before);
    });

    it('adds nothing when the same clean file is uploaded again', async () => {
      const version = await draft();
      const bytes = await filledLoadTemplate(await template(version), cleanRows());
      const first = loadImportPreviewSchema.parse((await upload(version, bytes)).body);
      expect((await confirmed(version, first.importId)).outcome).toBe('saved');
      const rows = await rowsOfDraft(version);
      const again = await upload(version, bytes);
      expect(again.status).toBe(200);
      const second = loadImportPreviewSchema.parse(again.body);
      expect(second.alreadyImportedOn).toBe('2026-10-10');
      refusedWith(await confirm(version, second.importId), 409, 'import_already_done');
      refusedWith(await confirm(version, first.importId), 409, 'load_import_already_confirmed');
      expect(await rowsOfDraft(version)).toEqual(rows);
    });

    it('never writes a published version: the template, the upload and a confirm after the publish are refused', async () => {
      const version = await draft();
      const bytes = await filledLoadTemplate(await template(version), cleanRows());
      const kept = loadImportPreviewSchema.parse((await upload(version, bytes)).body);
      await load.setVersion(version, 'published');
      const before = await rowsOf();
      refusedWith(await confirm(version, kept.importId), 409, 'version_not_draft');
      refusedWith(await previewOf(version, kept.importId), 409, 'version_not_draft');
      refusedWith(await upload(version, bytes), 409, 'version_not_draft');
      expect((await templateOf(version)).status).toBe(409);
      expect(await rowsOf()).toEqual(before);
    });

    it('refuses a confirm into a draft archived after the upload', async () => {
      const version = await draft();
      const kept = await uploaded(version, cleanRows());
      await load.setVersion(version, 'archived');
      refusedWith(await confirm(version, kept.importId), 409, 'version_not_draft');
      expect(await rowsOfDraft(version)).toEqual([]);
    });
  });

  describe('chosen, never created', () => {
    it('lists only the branch records of the draft in service, a teacher with surname, name and staff ID', async () => {
      const version = await draft();
      const bytes = await template(version);
      const units = await templateList(bytes, EN.lists.units);
      expect(units).toEqual(
        expect.arrayContaining(['7 Oxford', '7 Princeton', '7O-PE-1', '7-E-3']),
      );
      expect(units).not.toContain('7 Cambridge');
      const teachers = await templateList(bytes, EN.lists.teachers);
      expect(teachers).toContain(name(mathsTeacher));
      // Nothing of the South: its teacher and its room.
      expect(teachers).not.toContain(southTeacher);
      expect(await templateList(bytes, EN.lists.rooms)).not.toContain(southRoom);
      expect(await templateList(bytes, EN.lists.subjects)).toContain(MATHS);
      const entries = await t.database.migrator
        .selectFrom('audit_log')
        .select('action')
        .where('action', '=', 'load_import.template')
        .where('record_id', '=', version)
        .execute();
      expect(entries).toHaveLength(1);
    });

    it('refuses a file made for another draft', async () => {
      const version = await draft();
      const other = await draft();
      const bytes = await filledLoadTemplate(await template(other), cleanRows());
      const before = await rowsOf();
      const response = await upload(version, bytes);
      refusedWith(response, 422, 'load_import_other_draft');
      // Refused before anything is kept: no import row and no audit entry.
      expect(await rowsOf()).toEqual(before);
    });

    it('folds look-alike letters, matches the subject in the template language only, and names unknown values', async () => {
      const version = await draft();
      const preview = await uploaded(version, [
        // A Cyrillic "О" in Oxford.
        { unit: '7 Оxford', subject: MATHS, teacher: name(mathsTeacher), lessonsPerWeek: '5' },
        {
          unit: '7 Princeton',
          subject: `${MATHS} ru`,
          teacher: name(mathsTeacher),
          lessonsPerWeek: '5',
        },
        { unit: '7 Cambridge', subject: MATHS, teacher: name(mathsTeacher), lessonsPerWeek: '5' },
        { unit: '7 Princeton', subject: MATHS, teacher: southTeacher, lessonsPerWeek: '5' },
        {
          unit: '7 Oxford',
          subject: MATHS,
          teacher: name(mathsTeacher),
          lessonsPerWeek: '5',
          room: southRoom,
        },
      ]);
      expect(codesOf(preview, 3)).toEqual([]);
      expect(codesOf(preview, 4)).toEqual(['load_import_unknown']);
      expect(rowOf(preview, 4).problems[0]?.column).toBe('subject');
      // Another branch's class, teacher and room are never found.
      expect(codesOf(preview, 5)).toEqual(['load_import_unknown']);
      expect(rowOf(preview, 6).problems).toEqual([
        { column: 'teacher', code: 'load_import_unknown' },
      ]);
      expect(rowOf(preview, 7).problems).toEqual([{ column: 'room', code: 'load_import_unknown' }]);
    });

    it('tells two live vacancies of one name ambiguous, and an archived namesake of a live subject not', async () => {
      const version = await draft();
      const a = await load.vacancy(t.north, { subjects: [{ subject: maths, grades: [7] }] });
      const b = await load.vacancy(t.north, { subjects: [{ subject: maths, grades: [7] }] });
      await t.database.migrator
        .updateTable('staff')
        .set({ vacancy_name: 'Algebra wanted' })
        .where('id', 'in', [a, b])
        .execute();
      const twin = await load.classes.subject({ grades: [7], name: 'Geometry Lime' });
      await t.database.migrator
        .updateTable('subjects')
        .set({ archived_at: new Date('2026-09-15T10:00:00+05:00') })
        .where('id', '=', twin)
        .execute();
      const live = await load.classes.subject({ grades: [7], name: 'Geometry Lime' });
      const geometer = await teacher([{ subject: live, grades: [7] }]);
      const preview = await uploaded(version, [
        {
          unit: '7 Princeton',
          subject: MATHS,
          teacher: 'Algebra wanted (vacancy)',
          lessonsPerWeek: '5',
        },
        {
          unit: '7 Oxford',
          subject: 'Geometry Lime',
          teacher: name(geometer),
          lessonsPerWeek: '2',
        },
      ]);
      expect(codesOf(preview, 3)).toEqual(['name_ambiguous']);
      expect(codesOf(preview, 4)).toEqual([]);
    });
  });

  describe('every rule of a load row typed by hand', () => {
    /** The codes of one row put alone (or with `others` first) into a fresh draft. */
    async function codesFor(
      row: LoadTemplateRow,
      others: LoadTemplateRow[] = [],
      version = '',
    ): Promise<string[]> {
      const into = version || (await draft());
      const preview = await uploaded(into, [...others, row]);
      return codesOf(preview, 3 + others.length);
    }

    it('an archived class: load_unit_archived', async () => {
      const gone = await load.classes.schoolClass(t.north, year, { grade: 7, name: 'Yale' });
      await t.database.migrator
        .updateTable('classes')
        .set({ archived_at: new Date('2026-10-01T10:00:00+05:00') })
        .where('id', '=', gone)
        .execute();
      expect(
        await codesFor({
          unit: '7 Yale',
          subject: MATHS,
          teacher: name(mathsTeacher),
          lessonsPerWeek: '5',
        }),
      ).toEqual(['load_unit_archived']);
    });

    it('a group of another subject: load_group_subject', async () => {
      expect(
        await codesFor({
          unit: '7-E-1',
          subject: MATHS,
          teacher: name(mathsTeacher),
          lessonsPerWeek: '3',
        }),
      ).toContain('load_group_subject');
    });

    it('an archived subject: load_subject_archived', async () => {
      const old = await load.classes.subject({ grades: [7], name: 'Drawing Lime' });
      const drawer = await teacher([{ subject: old, grades: [7] }]);
      await t.database.migrator
        .updateTable('subjects')
        .set({ archived_at: new Date('2026-09-20T10:00:00+05:00') })
        .where('id', '=', old)
        .execute();
      expect(
        await codesFor({
          unit: '7 Princeton',
          subject: 'Drawing Lime',
          teacher: name(drawer),
          lessonsPerWeek: '1',
        }),
      ).toEqual(['load_subject_archived']);
    });

    it('a subject not taught in the grade: load_subject_grade', async () => {
      await load.classes.subject({ grades: [8], name: 'Chemistry Lime' });
      const chemist = await teacher([]);
      const codes = await codesFor({
        unit: '7 Princeton',
        subject: 'Chemistry Lime',
        teacher: name(chemist),
        lessonsPerWeek: '2',
      });
      expect(codes[0]).toBe('load_subject_grade');
    });

    it('a two-grade group with no shared slot: load_group_no_shared_slot', async () => {
      const both = await load.classes.subject({ grades: [4, 5], name: 'Swimming Lime' });
      const four = await load.classes.schoolClass(t.north, year, { grade: 4, name: 'Harvard' });
      const five = await load.classes.schoolClass(t.north, year, { grade: 5, name: 'Harvard' });
      await load.classes.group(t.north, year, both, [four, five], { name: 'SW-45' });
      const swimmer = await teacher([{ subject: both, grades: [4, 5] }]);
      expect(
        await codesFor({
          unit: 'SW-45',
          subject: 'Swimming Lime',
          teacher: name(swimmer),
          lessonsPerWeek: '1',
        }),
      ).toContain('load_group_no_shared_slot');
    });

    it('a class row and a group row of it for one subject: load_split_and_whole', async () => {
      const codes = await codesFor(
        { unit: '7 Oxford', subject: PE, teacher: name(pe1), lessonsPerWeek: '2' },
        [
          { unit: '7O-PE-1', subject: PE, teacher: name(pe1), lessonsPerWeek: '2' },
          { unit: '7O-PE-2', subject: PE, teacher: name(pe2), lessonsPerWeek: '2' },
        ],
      );
      expect(codes).toContain('load_split_and_whole');
    });

    it('a mixed mark on a group across classes: load_mixed_not_split', async () => {
      const preview = await uploaded(await draft(), [
        {
          unit: '7-E-1',
          subject: ENGLISH,
          teacher: name(e1),
          lessonsPerWeek: '3',
          mixedBlock: 'Yes',
        },
        { unit: '7-E-2', subject: ENGLISH, teacher: name(e2), lessonsPerWeek: '3' },
        { unit: '7-E-3', subject: ENGLISH, teacher: name(e3), lessonsPerWeek: '3' },
      ]);
      expect(codesOf(preview, 3)).toEqual(['load_mixed_not_split']);
    });

    it('halves that disagree on the mixed mark: load_block_mixed', async () => {
      const preview = await uploaded(await draft(), [
        {
          unit: '7O-PE-1',
          subject: PE,
          teacher: name(pe1),
          lessonsPerWeek: '2',
          mixedBlock: 'Yes',
        },
        { unit: '7O-PE-2', subject: PE, teacher: name(pe2), lessonsPerWeek: '2', mixedBlock: 'No' },
      ]);
      expect(codesOf(preview, 3)).toEqual(['load_block_mixed']);
      expect(codesOf(preview, 4)).toEqual(['load_block_mixed']);
    });

    it('halves with other lessons per week: load_block_lessons, on both rows', async () => {
      const preview = await uploaded(await draft(), [
        { unit: '7O-PE-1', subject: PE, teacher: name(pe1), lessonsPerWeek: '2' },
        { unit: '7O-PE-2', subject: PE, teacher: name(pe2), lessonsPerWeek: '3' },
      ]);
      expect(codesOf(preview, 3)).toEqual(['load_block_lessons']);
      expect(rowOf(preview, 3).problems[0]?.column).toBe('lessonsPerWeek');
      expect(codesOf(preview, 4)).toEqual(['load_block_lessons']);
    });

    it('one teacher for both halves, not mixed: load_block_teacher; mixed: allowed', async () => {
      const refused = await uploaded(await draft(), [
        { unit: '7O-PE-1', subject: PE, teacher: name(pe1), lessonsPerWeek: '2' },
        { unit: '7O-PE-2', subject: PE, teacher: name(pe1), lessonsPerWeek: '2' },
      ]);
      expect(codesOf(refused, 3)).toEqual(['load_block_teacher']);
      const mixed = await uploaded(await draft(), [
        {
          unit: '7O-PE-1',
          subject: PE,
          teacher: name(pe1),
          lessonsPerWeek: '2',
          mixedBlock: 'Yes',
        },
        {
          unit: '7O-PE-2',
          subject: PE,
          teacher: name(pe1),
          lessonsPerWeek: '2',
          mixedBlock: 'Yes',
        },
      ]);
      expect(mixed.clean, JSON.stringify(mixed.rows)).toBe(true);
    });

    it('a Tutor row of a class with no Tutor: load_no_tutor; with a teacher typed: load_tutor_row_teacher', async () => {
      expect(await codesFor({ unit: '7 Princeton', subject: TUTOR, lessonsPerWeek: '1' })).toEqual([
        'load_no_tutor',
      ]);
      expect(
        await codesFor({
          unit: '7 Oxford',
          subject: TUTOR,
          teacher: name(mathsTeacher),
          lessonsPerWeek: '1',
        }),
      ).toEqual(['load_tutor_row_teacher']);
    });

    it('a row with no teacher: load_teacher_needed', async () => {
      expect(await codesFor({ unit: '7 Princeton', subject: MATHS, lessonsPerWeek: '4' })).toEqual([
        'load_teacher_needed',
      ]);
    });

    it('a teacher out on the start date, without the subject, without the grade: their codes', async () => {
      const out = await teacher([{ subject: maths, grades: [7] }]);
      await load.status(out, 'inactive', '2026-10-01');
      expect(
        await codesFor({
          unit: '7 Princeton',
          subject: MATHS,
          teacher: name(out),
          lessonsPerWeek: '4',
        }),
      ).toEqual(['load_teacher_status']);
      const other = await teacher([{ subject: pe, grades: [7] }]);
      expect(
        await codesFor({
          unit: '7 Princeton',
          subject: MATHS,
          teacher: name(other),
          lessonsPerWeek: '4',
        }),
      ).toEqual(['load_teacher_subject']);
      const eighth = await teacher([{ subject: maths, grades: [8] }]);
      expect(
        await codesFor({
          unit: '7 Princeton',
          subject: MATHS,
          teacher: name(eighth),
          lessonsPerWeek: '4',
        }),
      ).toEqual(['load_teacher_grade']);
    });

    it('reads "in service" on today when the start date of the draft is behind it', async () => {
      // A draft that started on Monday 5 October; the teacher left on Thursday 8 October.
      const version = await draft({ startsOn: '2026-10-05' });
      const left = await teacher([{ subject: maths, grades: [7] }]);
      await load.status(left, 'inactive', '2026-10-08');
      expect(
        await codesFor(
          { unit: '7 Princeton', subject: MATHS, teacher: name(left), lessonsPerWeek: '4' },
          [],
          version,
        ),
      ).toEqual(['load_teacher_status']);
    });

    it('a closed room: load_room_closed; a room and a room type: load_import_room_and_type', async () => {
      const room = await load.classes.room(t.north, 'closed');
      const roomName = (
        await t.database.migrator
          .selectFrom('rooms')
          .select('name')
          .where('id', '=', room)
          .executeTakeFirstOrThrow()
      ).name;
      expect(
        await codesFor({
          unit: '7 Princeton',
          subject: MATHS,
          teacher: name(mathsTeacher),
          lessonsPerWeek: '4',
          room: roomName,
        }),
      ).toEqual(['load_room_closed']);
      expect(
        await codesFor({
          unit: '7 Princeton',
          subject: MATHS,
          teacher: name(mathsTeacher),
          lessonsPerWeek: '4',
          room: roomName,
          roomType: EN.roomTypes.laboratory,
        }),
      ).toEqual(['load_import_room_and_type']);
    });

    it('a row the draft holds: load_row_exists; a row twice in the file: load_import_row_twice', async () => {
      const version = await draft();
      await load.row({
        branch_id: t.north,
        version_id: version,
        class_id: princeton,
        subject_id: maths,
        teacher_id: mathsTeacher,
      });
      expect(
        await codesFor(
          { unit: '7 Princeton', subject: MATHS, teacher: name(mathsTeacher), lessonsPerWeek: '4' },
          [],
          version,
        ),
      ).toEqual(['load_row_exists']);
      const twice = await uploaded(await draft(), [
        { unit: '7 Oxford', subject: MATHS, teacher: name(mathsTeacher), lessonsPerWeek: '4' },
        { unit: '7 Oxford', subject: MATHS, teacher: name(mathsTeacher), lessonsPerWeek: '5' },
      ]);
      expect(codesOf(twice, 3)).toEqual(['load_import_row_twice']);
      expect(rowOf(twice, 3).problems[0]?.rows).toEqual([4]);
      expect(codesOf(twice, 4)).toEqual(['load_import_row_twice']);
    });

    it('a cell that cannot be read: required and invalid', async () => {
      const preview = await uploaded(await draft(), [
        {
          unit: '7 Oxford',
          subject: MATHS,
          teacher: name(mathsTeacher),
          lessonsPerWeek: 'five',
          doubleLessons: 'maybe',
        },
        { subject: MATHS, teacher: name(mathsTeacher), lessonsPerWeek: '41' },
      ]);
      expect(rowOf(preview, 3).problems).toEqual([
        { column: 'lessonsPerWeek', code: 'invalid' },
        { column: 'doubleLessons', code: 'invalid' },
      ]);
      expect(rowOf(preview, 4).problems).toEqual([
        { column: 'unit', code: 'required' },
        { column: 'lessonsPerWeek', code: 'invalid' },
      ]);
    });
  });

  describe('the confirm and other changes at the same moment', () => {
    /** Starts `run` now (a supertest request runs only once awaited). */
    const started = <T>(run: () => Promise<T>): Promise<T> =>
      new Promise((resolve, reject) => {
        run().then(resolve, reject);
      });

    async function heldVersion(version: string) {
      let release: () => void = () => undefined;
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      let pid = 0;
      let ready: () => void = () => undefined;
      const isReady = new Promise<void>((resolve) => {
        ready = resolve;
      });
      const done = t.app.get(Transactions).run([t.north], async (transaction: Transaction) => {
        pid =
          (await sql<{ pid: number }>`select pg_backend_pid() as pid`.execute(transaction)).rows[0]
            ?.pid ?? 0;
        await transaction
          .selectFrom('timetable_versions')
          .select('id')
          .where('id', '=', version)
          .forUpdate()
          .execute();
        ready();
        await released;
      });
      await isReady;
      return { release, done, pid: () => pid };
    }

    /**
     * Waits until `count` connections of this database wait behind the held transaction: the
     * first is blocked by its own pid; a later one queues behind the held pid or a waiter before it.
     */
    async function blockedBy(pid: number, count: number): Promise<void> {
      for (let tries = 0; tries < 200; tries += 1) {
        const found = await sql<{ direct: number; waiting: number }>`
          select
            count(*) filter (where ${pid}::int = any(pg_blocking_pids(a.pid)))::int as direct,
            count(*) filter (where cardinality(pg_blocking_pids(a.pid)) > 0)::int as waiting
          from pg_stat_activity a
          where a.datname = current_database()
        `.execute(t.database.migrator);
        const row = found.rows[0];
        if ((row?.direct ?? 0) >= 1 && (row?.waiting ?? 0) >= count) return;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error('Nothing waited.');
    }

    const handCreate = (version: string) =>
      t.post(
        `/api/timetable/versions/${version}/load`,
        t.north,
        {
          classId: oxford,
          groupId: null,
          subjectId: maths,
          teacherId: mathsTeacher,
          lessonsPerWeek: 5,
          roomId: null,
          roomType: null,
          doubleLessons: false,
        },
        t.vicePrincipal,
      );

    it('the hand create first: the confirm then finds the row and saves nothing', async () => {
      const version = await draft();
      const kept = await uploaded(version, cleanRows());
      const held = await heldVersion(version);
      const create = started(() => handCreate(version));
      await blockedBy(held.pid(), 1);
      const confirming = started(() => confirm(version, kept.importId));
      await blockedBy(held.pid(), 2);
      held.release();
      await held.done;
      expect((await create).status).toBe(201);
      const answer = loadImportConfirmResultSchema.parse((await confirming).body);
      expect(answer.outcome).toBe('not_clean');
      if (answer.outcome === 'not_clean') {
        expect(codesOf(answer.preview, 3)).toEqual(['load_row_exists']);
      }
      expect(await rowsOfDraft(version)).toHaveLength(1);
    });

    it('the confirm first: the hand create is then refused load_row_exists', async () => {
      const version = await draft();
      const kept = await uploaded(version, cleanRows());
      const held = await heldVersion(version);
      const confirming = started(() => confirm(version, kept.importId));
      await blockedBy(held.pid(), 1);
      const create = started(() => handCreate(version));
      await blockedBy(held.pid(), 2);
      held.release();
      await held.done;
      expect(loadImportConfirmResultSchema.parse((await confirming).body).outcome).toBe('saved');
      refusedWith(await create, 409, 'load_row_exists');
      expect(await rowsOfDraft(version)).toHaveLength(7);
    });

    it('two confirms of one file: the second waits on the draft and finds it imported', async () => {
      const version = await draft();
      const bytes = await filledLoadTemplate(await template(version), cleanRows());
      const one = loadImportPreviewSchema.parse((await upload(version, bytes)).body);
      const two = loadImportPreviewSchema.parse((await upload(version, bytes)).body);
      const held = await heldVersion(version);
      const first = started(() => confirm(version, one.importId));
      await blockedBy(held.pid(), 1);
      const second = started(() => confirm(version, two.importId));
      await blockedBy(held.pid(), 2);
      held.release();
      await held.done;
      expect((await first).status).toBe(200);
      refusedWith(await second, 409, 'import_already_done');
      expect(await rowsOfDraft(version)).toHaveLength(7);
    });

    it('a confirm while another person holds the draft edit lock: draft_edit_locked', async () => {
      const version = await draft();
      const kept = await uploaded(version, cleanRows());
      expect(
        (await t.post(`/api/timetable/versions/${version}/edit-lock`, t.north, {}, t.admin)).status,
      ).toBeLessThan(300);
      refusedWith(await confirm(version, kept.importId), 409, 'draft_edit_locked');
      expect(await rowsOfDraft(version)).toEqual([]);
    });
  });

  describe('permissions and ids', () => {
    it('refuses the Principal, who views the timetable, on every route, writing nothing', async () => {
      const version = await draft();
      const kept = await uploaded(version, cleanRows());
      const bytes = await filledLoadTemplate(await template(version), cleanRows());
      const before = await rowsOf();
      expect((await templateOf(version, t.principal)).status).toBe(403);
      refusedWith(await upload(version, bytes, t.principal), 403, 'permission_denied');
      refusedWith(await previewOf(version, kept.importId, t.principal), 403, 'permission_denied');
      refusedWith(await confirm(version, kept.importId, t.principal), 403, 'permission_denied');
      expect(await rowsOf()).toEqual(before);
    });

    it('answers 404 for another branch, an unknown or another draft id, writing nothing in either branch', async () => {
      const version = await draft();
      const kept = await uploaded(version, cleanRows());
      const otherDraft = await draft();
      const south = await load.version(t.south, southYear);
      const bytes = await filledLoadTemplate(await template(version), cleanRows());
      const before = await rowsOf();
      for (const id of [south, UNKNOWN]) {
        const file = await templateOf(id);
        expect(file.status).toBe(404);
        // The template is read as bytes: the refusal is the JSON error shape in them.
        expect(
          (JSON.parse((file.body as Buffer).toString('utf8')) as { error: { code: string } }).error
            .code,
        ).toBe('not_found');
        refusedWith(await upload(id, bytes), 404, 'not_found');
        refusedWith(await previewOf(id, kept.importId), 404, 'not_found');
        refusedWith(await confirm(id, kept.importId), 404, 'not_found');
      }
      // The import named under another draft of the branch, and an unknown import.
      refusedWith(await previewOf(otherDraft, kept.importId), 404, 'not_found');
      refusedWith(await confirm(otherDraft, kept.importId), 404, 'not_found');
      refusedWith(await previewOf(version, UNKNOWN), 404, 'not_found');
      refusedWith(await confirm(version, UNKNOWN), 404, 'not_found');
      // An import of the South named under a North draft, also as the Super Admin.
      for (const cookie of [t.vicePrincipal, t.admin]) {
        refusedWith(await previewOf(version, southImport, cookie), 404, 'not_found');
        refusedWith(await confirm(version, southImport, cookie), 404, 'not_found');
      }
      // The South's import under its own draft, with the North header.
      refusedWith(await confirm(southDraft, southImport, t.admin), 404, 'not_found');
      // The draft named with the South's header: another branch's draft.
      refusedWith(await confirm(version, kept.importId, t.admin, t.south), 404, 'not_found');
      const after = await rowsOf();
      // The confirms that reached the draft's lock took it and rolled back: nothing stays.
      expect(after).toEqual(before);
    });

    it('refuses a file that is not a workbook of the template, and one too large', async () => {
      const version = await draft();
      refusedWith(await upload(version, Buffer.from('not a workbook')), 422, 'import_not_template');
      refusedWith(
        await upload(version, Buffer.alloc(5 * 1024 * 1024 + 1, 1)),
        413,
        'import_file_too_large',
      );
      const text = await request(t.kit.server)
        .put(`/api/timetable/versions/${version}/load/imports`)
        .set('Cookie', t.vicePrincipal)
        .set(BRANCH_HEADER, t.north)
        .set('Content-Type', 'text/plain')
        .send('rows');
      refusedWith(text, 415, 'unsupported_media_type');
    });
  });
});
