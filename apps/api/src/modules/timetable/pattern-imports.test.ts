import {
  BRANCH_HEADER,
  STUDENT_IMPORT_TYPES,
  gridSchema,
  patternImportConfirmResultSchema,
  patternImportPreviewSchema,
  type GridAnswer,
  type PatternImportConfirmResult,
  type PatternImportPreview,
  type PatternImportPreviewRow,
} from '@sodiq/shared';
import { sql } from 'kysely';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { dayTemplatesKit, UNKNOWN, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { filledLoadTemplate } from '../../testing/load-import-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import {
  filledPatternTemplate,
  type PatternTemplateRow,
} from '../../testing/pattern-import-kit.js';
import { errorCode } from '../../testing/sign-in-kit.js';

const XLSX = STUDENT_IMPORT_TYPES[0] ?? '';

const refusedWith = (response: Response, status: number, code: string) => {
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  expect(errorCode(response)).toBe(code);
};

const rowOf = (preview: PatternImportPreview, rowNumber: number): PatternImportPreviewRow => {
  const found = preview.rows.find((row) => row.rowNumber === rowNumber);
  if (found === undefined) throw new Error(`No row ${String(rowNumber)}.`);
  return found;
};

/** The codes of every problem of the preview's row of `rowNumber`. */
const codesOf = (preview: PatternImportPreview, rowNumber: number): string[] =>
  rowOf(preview, rowNumber).problems.map((problem) => problem.code);

/** The row numbers of a file whose rows start at sheet row 3. */
const sheetRow = (index: number) => index + 3;

// All names are invented. Task 5.14, the owner's spec change of 15 November 2026 with the
// owner's answer of 16 November 2026: docs/spec/06-timetable.md, Importing the load and the
// timetable (the template, chosen never created, the timetable import, preview and checks,
// audit); Editing in the grid; Rules; edge/timetable, Structure. The clock stands at 23:55 on
// Saturday 10 October 2026 in Tashkent; the drafts start on Monday 19 October. The North's day is
// lesson, break, lesson, break, lesson: lesson numbers 1, 2, 3 at positions 1, 3, 5.
describe('the timetable import', () => {
  let t: DayTemplatesKit;
  let load: LoadKit;
  let year: string;
  let southYear: string;
  let maths: string;
  let pe: string;
  let english: string;
  let science: string;
  let tutorSubject: string;
  let oxford: string;
  let princeton: string;
  let roomO: string;
  let roomP: string;
  let mathsTeacher: string;
  let otherTeacher: string;
  let pe1: string;
  let pe2: string;
  let e1: string;
  let e2: string;
  let e3: string;
  let tutor: string;
  let sciTeacher: string;
  let groups: Map<string, string>;
  let label: Map<string, string>;
  let southDraft = '';
  let southImport = '';
  let southTeacher = '';
  let southRoom = '';
  let closedRoom = '';
  const MATHS = 'Algebra Plum';
  const PE = 'Movement Plum';
  const ENGLISH = 'Language Plum';
  const SCIENCE = 'Nature Plum';
  let TUTOR = '';

  const asBytes = (req: request.Test) =>
    req.buffer(true).parse((res, callback) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        callback(null, Buffer.concat(chunks));
      });
    });

  const templateOf = (version: string, cookie = t.vicePrincipal, branch = '') =>
    asBytes(
      request(t.kit.server)
        .get(`/api/timetable/versions/${version}/pattern/import-template?language=en`)
        .set('Cookie', cookie)
        .set(BRANCH_HEADER, branch || t.north),
    );

  const template = async (version: string): Promise<Buffer> => {
    const response = await templateOf(version);
    expect(response.status).toBe(200);
    return response.body as Buffer;
  };

  const upload = (version: string, bytes: Buffer, cookie = t.vicePrincipal, branch = '') =>
    request(t.kit.server)
      .put(`/api/timetable/versions/${version}/pattern/imports`)
      .set('Cookie', cookie)
      .set(BRANCH_HEADER, branch || t.north)
      .set('Content-Type', XLSX)
      .send(bytes);

  async function uploaded(
    version: string,
    rows: readonly PatternTemplateRow[],
  ): Promise<PatternImportPreview> {
    const bytes = await filledPatternTemplate(await template(version), rows);
    const response = await upload(version, bytes);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return patternImportPreviewSchema.parse(response.body);
  }

  const previewOf = (version: string, id: string, cookie = t.vicePrincipal, branch = '') =>
    t.post(
      `/api/timetable/versions/${version}/pattern/imports/${id}/preview`,
      branch || t.north,
      {},
      cookie,
    );

  const confirm = (
    version: string,
    id: string,
    removes: readonly string[] = [],
    cookie = t.vicePrincipal,
    branch = '',
  ) =>
    t.post(
      `/api/timetable/versions/${version}/pattern/imports/${id}/confirm`,
      branch || t.north,
      { removes },
      cookie,
    );

  async function confirmed(
    version: string,
    preview: PatternImportPreview,
  ): Promise<PatternImportConfirmResult> {
    const response = await confirm(version, preview.importId, preview.removes);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return patternImportConfirmResultSchema.parse(response.body);
  }

  const gridOf = async (version: string): Promise<GridAnswer> => {
    const response = await t.get(
      `/api/timetable/versions/${version}/grid`,
      t.north,
      t.vicePrincipal,
    );
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return gridSchema.parse(response.body);
  };

  const place = (version: string, loadRowId: string, weekday: number, slotPosition: number) =>
    t.post(
      `/api/timetable/versions/${version}/pattern`,
      t.north,
      { loadRowId, weekday, slotPosition },
      t.vicePrincipal,
    );

  const entriesOf = (version: string) =>
    t.database.migrator
      .selectFrom('pattern_entries')
      .selectAll()
      .where('version_id', '=', version)
      .orderBy('id')
      .execute();

  const loadRowsOf = (version: string) =>
    t.database.migrator
      .selectFrom('teaching_load_rows')
      .selectAll()
      .where('version_id', '=', version)
      .orderBy('id')
      .execute();

  /** Every row of the tables the routes write, in both branches, and the audit count. */
  const rowsOf = () =>
    Promise.all([
      t.database.migrator.selectFrom('pattern_blocks').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('pattern_entries').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('timetable_locks').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('pattern_imports').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('timetable_versions').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('teaching_load_rows').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('notifications').selectAll().orderBy('id').execute(),
      t.auditCount(),
    ]);

  /** Hours of a person in the branch from 1 September, on the weekdays named, all day. */
  async function hours(branch: string, staffId: string, weekdays: readonly number[]) {
    const entry = await t.database.migrator
      .insertInto('staff_availability')
      .values({ branch_id: branch, staff_id: staffId, valid_from: '2026-09-01' })
      .returning(['id', 'valid_until'])
      .executeTakeFirstOrThrow();
    for (const weekday of weekdays) {
      await t.database.migrator
        .insertInto('staff_availability_ranges')
        .values({
          entry_id: entry.id,
          branch_id: branch,
          staff_id: staffId,
          weekday,
          start_minutes: 0,
          end_minutes: 1440,
          valid_from: '2026-09-01',
          valid_until: entry.valid_until,
        })
        .execute();
    }
  }

  /** A teacher of the North with hours Monday to Friday (or `weekdays`), and their label. */
  async function teacher(subject: string, weekdays: readonly number[] = [1, 2, 3, 4, 5]) {
    const made = await load.teacher(t.north, { subjects: [{ subject, grades: [7] }] });
    await hours(t.north, made.staffId, weekdays);
    const row = await t.database.migrator
      .selectFrom('staff')
      .select(['first_name', 'last_name', 'staff_id'])
      .where('id', '=', made.staffId)
      .executeTakeFirstOrThrow();
    label.set(
      made.staffId,
      `${row.last_name ?? ''} ${row.first_name ?? ''} (${row.staff_id ?? ''})`,
    );
    return made;
  }

  const name = (id: string): string => {
    const found = label.get(id);
    if (found === undefined) throw new Error('No label.');
    return found;
  };

  const group = (groupName: string): string => {
    const found = groups.get(groupName);
    if (found === undefined) throw new Error('No group.');
    return found;
  };

  /**
   * A draft of the North with the load of the invented branch of 5.13 (the Done-when): Oxford's
   * maths with doubles, Princeton's maths by the same teacher, the PE split of Oxford, three
   * English groups across both classes, and Oxford's Tutor row (the Homework slot).
   */
  async function draft(): Promise<{ version: string; rows: Map<string, string> }> {
    const version = await load.version(t.north, year, { startsOn: '2026-10-19' });
    const rows = new Map<string, string>();
    const row = async (key: string, values: object) => {
      rows.set(
        key,
        await load.row({
          branch_id: t.north,
          version_id: version,
          subject_id: maths,
          teacher_id: mathsTeacher,
          ...values,
        }),
      );
    };
    await row('maths-o', { class_id: oxford, lessons_per_week: 4, double_lessons: true });
    await row('maths-p', { class_id: princeton, lessons_per_week: 3 });
    await row('pe-1', {
      group_id: group('7O-PE-1'),
      subject_id: pe,
      teacher_id: pe1,
      lessons_per_week: 2,
    });
    await row('pe-2', {
      group_id: group('7O-PE-2'),
      subject_id: pe,
      teacher_id: pe2,
      lessons_per_week: 2,
    });
    for (const [key, teacherId] of [
      ['7-E-1', e1],
      ['7-E-2', e2],
      ['7-E-3', e3],
    ] as const) {
      await row(key, {
        group_id: group(key),
        subject_id: english,
        teacher_id: teacherId,
        lessons_per_week: 3,
      });
    }
    await row('tutor', {
      class_id: oxford,
      subject_id: tutorSubject,
      teacher_id: tutor,
      lessons_per_week: 1,
    });
    return { version, rows };
  }

  const at = (
    weekday: string,
    lessonNumber: number,
    unit: string,
    subject: string,
    teacherLabel?: string,
    room?: string,
  ): PatternTemplateRow => ({
    weekday,
    lessonNumber: String(lessonNumber),
    unit,
    subject,
    ...(teacherLabel === undefined ? {} : { teacher: teacherLabel }),
    ...(room === undefined ? {} : { room }),
  });

  /** The clean file of the invented branch: a split, a group block, a double, a Homework slot. */
  const cleanRows = (): PatternTemplateRow[] => [
    // Oxford's maths: two doubles (Monday and Tuesday, lessons 1 and 2).
    at('Monday', 1, '7 Oxford', MATHS, name(mathsTeacher)),
    at('Monday', 2, '7 Oxford', MATHS, name(mathsTeacher)),
    at('Tuesday', 1, '7 Oxford', MATHS, name(mathsTeacher)),
    at('Tuesday', 2, '7 Oxford', MATHS, name(mathsTeacher)),
    // Princeton's maths: twice on Friday (a warning: the same subject twice in one day).
    at('Thursday', 2, '7 Princeton', MATHS, name(mathsTeacher)),
    at('Friday', 1, '7 Princeton', MATHS, name(mathsTeacher)),
    at('Friday', 2, '7 Princeton', MATHS, name(mathsTeacher)),
    // The PE split of Oxford: both halves together.
    at('Monday', 3, '7O-PE-1', PE, name(pe1)),
    at('Monday', 3, '7O-PE-2', PE, name(pe2)),
    at('Wednesday', 3, '7O-PE-1', PE, name(pe1)),
    at('Wednesday', 3, '7O-PE-2', PE, name(pe2)),
    // The three English groups across both classes.
    ...['Tuesday', 'Wednesday', 'Thursday'].flatMap((weekday) =>
      [
        ['7-E-1', e1],
        ['7-E-2', e2],
        ['7-E-3', e3],
      ].map(([unit, teacherId]) =>
        at(weekday, weekday === 'Tuesday' ? 3 : 1, unit ?? '', ENGLISH, name(teacherId ?? '')),
      ),
    ),
    // The Homework slot: the Tutor row, the teacher left empty.
    at('Friday', 3, '7 Oxford', TUTOR),
  ];

  beforeAll(async () => {
    t = await dayTemplatesKit();
    load = new LoadKit(t.database.migrator);
    label = new Map();
    groups = new Map();
    year = await load.classes.year(t.north);
    southYear = await load.classes.year(t.south);
    const long = await t.createSlotType(t.north, 'Lesson', 'lesson', 45);
    const pause = await t.createSlotType(t.north, 'Break', 'break', 10);
    const regular = await t.createTemplate(t.north, 'Regular', [long, pause, long, pause, long]);
    await t.assign(t.north, regular);
    maths = await load.classes.subject({ grades: [7], name: MATHS });
    pe = await load.classes.subject({ grades: [7], name: PE });
    english = await load.classes.subject({ grades: [7], name: ENGLISH, languageRule: false });
    science = await load.classes.subject({ grades: [7], name: SCIENCE });
    tutorSubject = await load.tutorSubject({ grades: [7] });
    TUTOR = (
      await t.database.migrator
        .selectFrom('subjects')
        .select('name_en')
        .where('id', '=', tutorSubject)
        .executeTakeFirstOrThrow()
    ).name_en;
    roomO = await load.classes.room(t.north);
    roomP = await load.classes.room(t.north);
    closedRoom = await load.classes.room(t.north, 'closed');
    oxford = await load.classes.schoolClass(t.north, year, {
      grade: 7,
      name: 'Oxford',
      room: roomO,
    });
    princeton = await load.classes.schoolClass(t.north, year, {
      grade: 7,
      name: 'Princeton',
      room: roomP,
    });
    // An archived class: never chosen.
    const gone = await load.classes.schoolClass(t.north, year, { grade: 7, name: 'Gone' });
    await t.database.migrator
      .updateTable('classes')
      .set({ archived_at: new Date('2026-09-20T10:00:00+05:00') })
      .where('id', '=', gone)
      .execute();
    groups.set(
      '7O-PE-1',
      await load.classes.group(t.north, year, pe, [oxford], { name: '7O-PE-1' }),
    );
    groups.set(
      '7O-PE-2',
      await load.classes.group(t.north, year, pe, [oxford], { name: '7O-PE-2' }),
    );
    for (const one of ['7-E-1', '7-E-2', '7-E-3']) {
      groups.set(
        one,
        await load.classes.group(t.north, year, english, [oxford, princeton], { name: one }),
      );
    }
    // An archived group (group names are unique, archived ones too).
    const goneGroup = await load.classes.group(t.north, year, english, [oxford, princeton], {
      name: 'Gone-E',
    });
    await t.database.migrator
      .updateTable('groups')
      .set({ archived_at: new Date('2026-09-20T10:00:00+05:00') })
      .where('id', '=', goneGroup)
      .execute();
    mathsTeacher = (await teacher(maths)).staffId;
    otherTeacher = (await teacher(maths)).staffId;
    pe1 = (await teacher(pe)).staffId;
    pe2 = (await teacher(pe)).staffId;
    e1 = (await teacher(english)).staffId;
    e2 = (await teacher(english)).staffId;
    e3 = (await teacher(english)).staffId;
    // Hours Monday to Thursday only.
    sciTeacher = (await teacher(science, [1, 2, 3, 4])).staffId;
    const tutorMade = await load.teacher(t.north);
    await hours(t.north, tutorMade.staffId, [1, 2, 3, 4, 5]);
    tutor = tutorMade.staffId;
    await load.tutorOf(t.north, oxford, tutorMade.accountId, {
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
      await filledPatternTemplate(southTemplate.body as Buffer, [
        at('Monday', 1, '7 Cambridge', MATHS, southTeacher),
      ]),
      t.admin,
      t.south,
    );
    expect(southUpload.status, JSON.stringify(southUpload.body)).toBe(200);
    southImport = patternImportPreviewSchema.parse(southUpload.body).importId;
  }, 120_000);

  afterAll(async () => {
    await t.close();
  });

  describe('the Done-when', () => {
    it('fills an empty draft in one confirm with no blocked rule, the panel showing what the preview listed', async () => {
      const { version, rows } = await draft();
      const loadBefore = await loadRowsOf(version);
      const preview = await uploaded(version, cleanRows());
      expect(
        preview.clean,
        JSON.stringify(preview.rows.filter((row) => row.problems.length > 0)),
      ).toBe(true);
      expect(preview.removes).toEqual([]);
      expect(preview.lessons).toBe(21);
      expect(preview.warnings.length).toBeGreaterThan(0);
      const result = await confirmed(version, preview);
      expect(result).toEqual({ outcome: 'saved', removed: 0, placed: 21 });
      const grid = await gridOf(version);
      expect(grid.results.filter((one) => one.severity === 'blocked')).toEqual([]);
      // The conflict panel shows what the preview listed: the same rules on the same days and rows.
      const entries = await entriesOf(version);
      const audit = await t.database.migrator
        .selectFrom('audit_log')
        .select(['details'])
        .where('action', '=', 'pattern.import')
        .where('record_id', '=', preview.importId)
        .execute();
      expect(audit).toHaveLength(1);
      const details = audit[0]?.details as {
        removed: unknown[];
        written: {
          id: string;
          doublePairId?: string;
          lessons: { id: string; loadRowId: string; teacherId: string; rowNumber: number }[];
        }[];
      };
      const rowNumberOf = new Map(
        details.written.flatMap((block) =>
          block.lessons.map((lesson) => [lesson.id, lesson.rowNumber]),
        ),
      );
      const shown = (list: { rule: string; weekday: number | null; rows: number[] }[]) =>
        list
          .map((one) => `${one.rule}|${String(one.weekday)}|${[...one.rows].sort().join(',')}`)
          .sort();
      expect(
        shown(
          grid.results.map((one) => ({
            rule: one.rule,
            weekday: one.weekday,
            rows: one.lessonIds.map((id) => rowNumberOf.get(id) ?? -1),
          })),
        ),
      ).toEqual(shown(preview.warnings));
      expect(entries).toHaveLength(21);
      expect(details.removed).toEqual([]);
      // The double: Oxford's maths on Monday, lessons 1 and 2, one pair.
      const blocks = await t.database.migrator
        .selectFrom('pattern_blocks')
        .selectAll()
        .where('version_id', '=', version)
        .execute();
      const oxfordMaths = blocks.filter((block) =>
        entries.some(
          (entry) => entry.block_id === block.id && entry.load_row_id === rows.get('maths-o'),
        ),
      );
      expect(oxfordMaths).toHaveLength(4);
      expect(new Set(oxfordMaths.map((block) => block.double_pair_id)).size).toBe(2);
      expect(oxfordMaths.every((block) => block.double_pair_id !== null)).toBe(true);
      // The split and the group block are one block each at their times.
      const pe1Entry = entries.filter((entry) => entry.load_row_id === rows.get('pe-1'));
      for (const one of pe1Entry) {
        const together = entries.filter((entry) => entry.block_id === one.block_id);
        expect(together.map((entry) => entry.load_row_id).sort()).toEqual(
          [rows.get('pe-1'), rows.get('pe-2')].sort(),
        );
      }
      const englishEntry = entries.find((entry) => entry.load_row_id === rows.get('7-E-1'));
      expect(entries.filter((entry) => entry.block_id === englishEntry?.block_id)).toHaveLength(3);
      // The Homework slot has the class's Tutor, in the class's main classroom.
      const homework = entries.find((entry) => entry.load_row_id === rows.get('tutor'));
      expect(homework?.teacher_id).toBe(tutor);
      expect(homework?.room_id).toBe(roomO);
      // Princeton's maths with no room named: Princeton's main classroom.
      expect(
        entries.filter((entry) => entry.load_row_id === rows.get('maths-p')).map((e) => e.room_id),
      ).toEqual([roomP, roomP, roomP]);
      // The load is not changed.
      expect(await loadRowsOf(version)).toEqual(loadBefore);
    });

    it('saves nothing for a teacher in two places, a block given in part and a lesson with no load row', async () => {
      const { version } = await draft();
      const rows = cleanRows();
      // Princeton's Thursday lesson moved to Monday lesson 1: the maths teacher is in Oxford then.
      rows[4] = at('Monday', 1, '7 Princeton', MATHS, name(mathsTeacher));
      // The Tuesday English block without its third group.
      const third = rows.findIndex((one) => one.weekday === 'Tuesday' && one.unit === '7-E-3');
      rows.splice(third, 1);
      // Science for Princeton: no row of the draft's load.
      rows.push(at('Wednesday', 2, '7 Princeton', SCIENCE, name(sciTeacher)));
      const preview = await uploaded(version, rows);
      expect(preview.clean).toBe(false);
      expect(codesOf(preview, sheetRow(0))).toEqual(['teacher_double']);
      expect(rowOf(preview, sheetRow(0)).problems[0]?.rows).toEqual([sheetRow(4)]);
      expect(codesOf(preview, sheetRow(4))).toEqual(['teacher_double']);
      const tuesday = rows
        .map((one, index) => ({ one, index }))
        .filter(({ one }) => one.weekday === 'Tuesday' && one.subject === ENGLISH);
      for (const { index } of tuesday) {
        expect(codesOf(preview, sheetRow(index))).toEqual(['pattern_import_block_part']);
        expect(rowOf(preview, sheetRow(index)).problems[0]?.units).toEqual(['7-E-3']);
      }
      expect(codesOf(preview, sheetRow(rows.length - 1))).toEqual(['pattern_import_no_load_row']);
      const answer = patternImportConfirmResultSchema.parse(
        (await confirm(version, preview.importId, [])).body,
      );
      expect(answer.outcome).toBe('not_clean');
      expect(await entriesOf(version)).toEqual([]);
    });

    it('keeps the placements made by hand until the person confirms their removal', async () => {
      const { version, rows } = await draft();
      const placed = await place(version, rows.get('maths-p') ?? '', 3, 1);
      expect(placed.status, JSON.stringify(placed.body)).toBe(201);
      const handMade = await entriesOf(version);
      expect(handMade).toHaveLength(1);
      const preview = await uploaded(version, cleanRows());
      expect(preview.removes).toEqual(handMade.map((one) => one.id));
      // A confirm that names none of them: nothing changes.
      refusedWith(
        await confirm(version, preview.importId, []),
        409,
        'pattern_import_draft_changed',
      );
      expect(await entriesOf(version)).toEqual(handMade);
      // One removed and another placed after the preview: the same count, another lesson.
      const blockId = handMade[0]?.block_id ?? '';
      const dropped = await request(t.kit.server)
        .delete(`/api/timetable/versions/${version}/pattern/${blockId}`)
        .set('Cookie', t.vicePrincipal)
        .set(BRANCH_HEADER, t.north);
      expect(dropped.status, JSON.stringify(dropped.body)).toBe(200);
      expect((await place(version, rows.get('maths-p') ?? '', 3, 3)).status).toBe(201);
      const now = await entriesOf(version);
      expect(now).toHaveLength(1);
      refusedWith(
        await confirm(version, preview.importId, preview.removes),
        409,
        'pattern_import_draft_changed',
      );
      expect(await entriesOf(version)).toEqual(now);
      // Read again and confirmed: the hand lesson is gone, the file's lessons are there.
      const again = patternImportPreviewSchema.parse(
        (await previewOf(version, preview.importId)).body,
      );
      expect(again.removes).toEqual(now.map((one) => one.id));
      expect((await confirmed(version, again)).outcome).toBe('saved');
      const after = await entriesOf(version);
      expect(after).toHaveLength(21);
      expect(after.some((one) => one.id === now[0]?.id)).toBe(false);
      const entry = await t.database.migrator
        .selectFrom('audit_log')
        .select('details')
        .where('action', '=', 'pattern.import')
        .where('record_id', '=', preview.importId)
        .executeTakeFirstOrThrow();
      const removed = (entry.details as { removed: { lessons: { id: string }[] }[] }).removed;
      expect(removed.flatMap((block) => block.lessons.map((lesson) => lesson.id))).toEqual(
        now.map((one) => one.id),
      );
      // No entry per block: the import is one entry.
      const written = (entry.details as { written: { id: string }[] }).written.map((one) => one.id);
      const perBlock = await t.database.migrator
        .selectFrom('audit_log')
        .select('id')
        .where((eb) =>
          eb.or([
            eb.and([eb('action', '=', 'pattern_block.create'), eb('record_id', 'in', written)]),
            eb.and([
              eb('action', '=', 'pattern_block.delete'),
              eb('record_id', '=', now[0]?.block_id ?? UNKNOWN),
            ]),
          ]),
        )
        .execute();
      expect(perBlock).toEqual([]);
    });

    it('never writes a published version', async () => {
      const { version } = await draft();
      const bytes = await filledPatternTemplate(await template(version), cleanRows());
      const preview = await uploaded(version, cleanRows());
      await load.setVersion(version, 'published');
      const before = await rowsOf();
      refusedWith(await confirm(version, preview.importId, []), 409, 'version_not_draft');
      expect((await templateOf(version)).status).toBe(409);
      refusedWith(await upload(version, bytes), 409, 'version_not_draft');
      expect(await rowsOf()).toEqual(before);
    });
  });
});
