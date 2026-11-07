import {
  BRANCH_HEADER,
  PERMISSIONS,
  STUDENT_IMPORT_TYPES,
  subjectImportConfirmResultSchema,
  subjectImportPreviewSchema,
  type SubjectImportConfirmResult,
  type SubjectImportPreview,
  type SubjectImportPreviewRow,
} from '@sodiq/shared';
import ExcelJS from 'exceljs';
import { sql } from 'kysely';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions } from '../../database/transactions.js';
import { UploadedFile } from '../../http/file-routes.js';
import { closeQuarter } from '../../testing/closing-kit.js';
import { dayTemplatesKit, UNKNOWN, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { permissionRows } from '../../testing/permission-sample.controller.js';
import { errorCode } from '../../testing/sign-in-kit.js';
import {
  filledSubjectTemplate,
  subjectRow,
  type SubjectTemplateRow,
} from '../../testing/subject-import-kit.js';
import type { Access } from '../access/permission.guard.js';
import { Audit } from '../audit/audit.service.js';
import { SubjectImports } from './subject-imports.service.js';
import { Subjects } from './subjects.service.js';

const XLSX = STUDENT_IMPORT_TYPES[0] ?? '';

const DATED = [
  ['2026-09-02', '2026-10-31'],
  ['2026-11-09', '2026-12-28'],
  ['2027-01-11', '2027-03-19'],
  ['2027-03-29', '2027-05-25'],
] as const;

// All names are invented. The owner's change of 7 November 2026 (pull request
// #316): docs/spec/05-classes-groups-subjects.md, "Excel import of subjects"
// (who, what a row holds, preview first, all rows or none, the same file not
// twice, a name already used is a problem), with the review's corrections.
// The clock stands at 23:55 on 10 October 2026 in Tashkent.
describe('the subject import', () => {
  let t: DayTemplatesKit;
  let closer: string;
  /** The north: a current year whose quarter 1 is closed, and a planned year after it. */
  let northCurrent: { yearId: string; quarterIds: string[] };
  let northPlanned: { yearId: string; quarterIds: string[] };
  /** The south: a current year with a subject's distributions of its own. */
  let southCurrent: { yearId: string; quarterIds: string[] };

  const upload = (bytes: Buffer, cookie = t.admin, branch = '') =>
    request(t.kit.server)
      .put('/api/setup/subjects/imports')
      .set('Cookie', cookie)
      .set(BRANCH_HEADER, branch || t.north)
      .set('Content-Type', XLSX)
      .send(bytes);

  async function uploaded(rows: readonly SubjectTemplateRow[], branch = '', cookie = t.admin) {
    const response = await upload(await filledSubjectTemplate(rows), cookie, branch);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return subjectImportPreviewSchema.parse(response.body);
  }

  const preview = (id: string, cookie = t.admin, branch = '') =>
    t.post(`/api/setup/subjects/imports/${id}/preview`, branch || t.north, {}, cookie);

  const confirm = (id: string, cookie = t.admin, branch = '') =>
    t.post(`/api/setup/subjects/imports/${id}/confirm`, branch || t.north, {}, cookie);

  async function confirmed(id: string, branch = '', cookie = t.admin) {
    const response = await confirm(id, cookie, branch);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return subjectImportConfirmResultSchema.parse(response.body);
  }

  async function saved(id: string, branch = '', cookie = t.admin) {
    const result: SubjectImportConfirmResult = await confirmed(id, branch, cookie);
    if (result.outcome !== 'saved') {
      throw new Error(`Not saved: ${JSON.stringify(result.preview.rows)}`);
    }
    return result;
  }

  const refusedWith = (response: Response, status: number, code: string) => {
    expect(response.status, JSON.stringify(response.body)).toBe(status);
    expect(errorCode(response)).toBe(code);
  };

  const rowAt = (answer: SubjectImportPreview, rowNumber: number): SubjectImportPreviewRow => {
    const row = answer.rows.find((one) => one.rowNumber === rowNumber);
    if (row === undefined) {
      throw new Error(`Row ${String(rowNumber)} is in the preview.`);
    }
    return row;
  };

  const codesAt = (answer: SubjectImportPreview, rowNumber: number) =>
    rowAt(answer, rowNumber).problems.map((one) => `${String(one.column)}:${one.code}`);

  /** Every row of the tables an import writes, in both branches, and the logs: what a refused one leaves. */
  const rowsOf = () =>
    Promise.all(
      [
        'subjects',
        'subject_switches',
        'subject_daily_weights',
        'subject_quarter_weights',
        'subject_imports',
        'notifications',
        'audit_log',
        'audit_log_school',
      ].map(
        async (table) =>
          (await sql`select * from ${sql.table(table)} order by 1`.execute(t.database.migrator))
            .rows,
      ),
    );

  /** The school-wide entries of an action of one record (a subject is the school's). */
  const schoolEntries = (action: string, recordId: string) =>
    t.database.migrator
      .selectFrom('audit_log_school')
      .selectAll()
      .where('action', '=', action)
      .where('record_id', '=', recordId)
      .orderBy('occurred_at')
      .orderBy('id')
      .execute();

  const subjectNamed = async (en: string) =>
    (
      await t.database.migrator
        .selectFrom('subjects')
        .select(['id', 'archived_at'])
        .where('name_en', '=', en)
        .where('archived_at', 'is', null)
        .executeTakeFirstOrThrow()
    ).id;

  const departmentId = async (en: string) =>
    (
      await t.database.migrator
        .selectFrom('departments')
        .select('id')
        .where('name_en', '=', en)
        .executeTakeFirstOrThrow()
    ).id;

  /** A year of four dated quarters, written by the migrator; planned, current or closed. */
  async function insertYear(
    branch: string,
    startDate: string,
    status: 'planned' | 'current' | 'closed' = 'planned',
  ): Promise<{ yearId: string; quarterIds: string[] }> {
    const startYear = Number(startDate.slice(0, 4));
    const endDate = `${String(startYear + 1)}-06-30`;
    const shift = (date: string) =>
      `${String(Number(date.slice(0, 4)) + startYear - 2026)}${date.slice(4)}`;
    return t.database.migrator.transaction().execute(async (transaction) => {
      const year = await transaction
        .insertInto('academic_years')
        .values({ branch_id: branch, start_date: startDate, end_date: endDate })
        .returning('id')
        .executeTakeFirstOrThrow();
      const quarterIds: string[] = [];
      for (const [index, dates] of DATED.entries()) {
        const quarter = await transaction
          .insertInto('quarters')
          .values({
            branch_id: branch,
            academic_year_id: year.id,
            number: index + 1,
            start_date: shift(dates[0]),
            end_date: shift(dates[1]),
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        quarterIds.push(quarter.id);
      }
      for (const next of ['current', 'closed'] as const) {
        if (status === 'planned' || (status === 'current' && next === 'closed')) {
          break;
        }
        await transaction
          .updateTable('academic_years')
          .set({ status: next })
          .where('id', '=', year.id)
          .execute();
      }
      return { yearId: year.id, quarterIds };
    });
  }

  /** The quarters a subject has a quarterly distribution in, with the branch, as ids. */
  const quartersOf = async (subjectId: string) =>
    (
      await t.database.migrator
        .selectFrom('subject_quarter_weights')
        .select(['branch_id', 'quarter_id', 'attendance', 'classwork', 'homework', 'rating_exam'])
        .where('subject_id', '=', subjectId)
        .execute()
    )
      .map((row) => row.quarter_id)
      .sort();

  beforeAll(async () => {
    t = await dayTemplatesKit();
    closer = (
      await t.database.migrator
        .selectFrom('accounts')
        .select('id')
        .orderBy('id')
        .executeTakeFirstOrThrow()
    ).id;
    northCurrent = await insertYear(t.north, '2026-09-02', 'current');
    northPlanned = await insertYear(t.north, '2027-09-01');
    await closeQuarter(t.database, {
      branchId: t.north,
      quarterId: northCurrent.quarterIds[0] ?? '',
      accountId: closer,
    });
    southCurrent = await insertYear(t.south, '2026-09-02', 'current');
    // A subject of the school with distributions in the south, which a north import leaves alone.
    const south = await t.database.migrator
      .insertInto('subjects')
      .values({
        name_uz: 'Janubiy fan',
        name_ru: 'Южный предмет',
        name_en: 'Southern subject',
        department_id: await departmentId('STEAM'),
        grades: [5],
        colour: 'red',
        journal_type: 'graded',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await t.database.migrator
      .insertInto('subject_daily_weights')
      .values({
        branch_id: t.south,
        subject_id: south.id,
        attendance: 20,
        classwork: 40,
        homework: 40,
      })
      .execute();
    await t.database.migrator
      .insertInto('subject_quarter_weights')
      .values(
        southCurrent.quarterIds.map((quarterId) => ({
          branch_id: t.south,
          subject_id: south.id,
          quarter_id: quarterId,
          attendance: 20,
          classwork: 40,
          homework: 40,
          rating_exam: null,
        })),
      )
      .execute();
  });

  afterAll(async () => {
    await t.close();
  });

  describe('a clean file', () => {
    it('saves every row with the daily distribution of the branch and the quarterly one on every open quarter of the current and later years, with no notice', async () => {
      const southBefore =
        await sql`select * from subject_daily_weights where branch_id = ${t.south} order by subject_id`.execute(
          t.database.migrator,
        );
      const southQuartersBefore =
        await sql`select * from subject_quarter_weights where branch_id = ${t.south} order by subject_id, quarter_id`.execute(
          t.database.migrator,
        );
      const notices = await sql`select count(*)::int as n from notifications`.execute(
        t.database.migrator,
      );
      const answer = await uploaded([
        subjectRow({ nameEn: 'Robotics', nameUz: 'Robototexnika', nameRu: 'Робототехника' }),
        subjectRow({
          nameEn: 'Choir',
          journalType: 'Attendance only',
          ratingExam: 'No',
          dailyAttendance: '',
          dailyClasswork: '',
          dailyHomework: '',
          quarterAttendance: '',
          quarterClasswork: '',
          quarterHomework: '',
          quarterRatingExam: '',
        }),
      ]);
      expect(answer.clean, JSON.stringify(answer.rows)).toBe(true);
      // Quarters 2 to 4 of the current year and the four of the planned one.
      expect(answer.quarterCount).toBe(7);
      const result = await saved(answer.importId);
      expect(result.created).toBe(2);

      const robotics = await subjectNamed('Robotics');
      const subject = await t.database.migrator
        .selectFrom('subjects')
        .selectAll()
        .where('id', '=', robotics)
        .executeTakeFirstOrThrow();
      expect(subject).toMatchObject({
        name_uz: 'Robototexnika',
        name_ru: 'Робототехника',
        grades: [5, 6, 7],
        colour: 'blue',
        journal_type: 'graded',
        rating_exam: true,
        group_subject: false,
        language_rule: true,
        demanding: false,
        archived_at: null,
      });
      const daily = await t.database.migrator
        .selectFrom('subject_daily_weights')
        .select(['branch_id', 'attendance', 'classwork', 'homework'])
        .where('subject_id', '=', robotics)
        .execute();
      expect(daily).toEqual([{ branch_id: t.north, attendance: 10, classwork: 50, homework: 40 }]);
      // Every open quarter of the current and the planned year; not the closed quarter 1.
      expect(await quartersOf(robotics)).toEqual(
        [...northCurrent.quarterIds.slice(1), ...northPlanned.quarterIds].sort(),
      );
      const weights = await t.database.migrator
        .selectFrom('subject_quarter_weights')
        .select(['branch_id', 'attendance', 'classwork', 'homework', 'rating_exam'])
        .where('subject_id', '=', robotics)
        .execute();
      expect(
        weights.every(
          (row) =>
            row.branch_id === t.north &&
            row.attendance === 10 &&
            row.classwork === 30 &&
            row.homework === 20 &&
            row.rating_exam === 40,
        ),
      ).toBe(true);
      // The attendance-only subject has no weights.
      const choir = await subjectNamed('Choir');
      expect(await quartersOf(choir)).toEqual([]);
      // Another branch's distributions are unchanged.
      expect(
        await sql`select * from subject_daily_weights where branch_id = ${t.south} order by subject_id`.execute(
          t.database.migrator,
        ),
      ).toEqual(southBefore);
      expect(
        await sql`select * from subject_quarter_weights where branch_id = ${t.south} order by subject_id, quarter_id`.execute(
          t.database.migrator,
        ),
      ).toEqual(southQuartersBefore);
      // Review correction 2: first settings, so no notice and no reason (`afterWrite`).
      expect(
        await sql`select count(*)::int as n from notifications`.execute(t.database.migrator),
      ).toEqual(notices);
    });

    it('writes the entries of the hand path, each naming the import, and the upload and confirm entries', async () => {
      const answer = await uploaded([subjectRow({ nameEn: 'Astronomy' })]);
      await saved(answer.importId);
      const id = await subjectNamed('Astronomy');
      const created = await schoolEntries('subject.create', id);
      expect(created).toHaveLength(1);
      expect(created[0]).toMatchObject({
        assignment_id: t.adminAssignment,
        details: { importId: answer.importId },
      });
      const daily = await t.entries('subject_daily_weights.set', id);
      expect(daily).toHaveLength(1);
      expect(daily[0]).toMatchObject({
        branch_id: t.north,
        details: { importId: answer.importId },
      });
      const quarters = await t.entries('subject_quarter_weights.set', id);
      expect(quarters).toHaveLength(7);
      for (const entry of quarters) {
        expect(entry).toMatchObject({
          branch_id: t.north,
          details: { importId: answer.importId },
          old_value: { weights: null },
        });
      }
      const upload = await t.entries('subject_import.upload', answer.importId);
      expect(upload).toHaveLength(1);
      expect(upload[0]).toMatchObject({ branch_id: t.north, details: { rowCount: 1 } });
      const confirmEntry = await t.entries('subject_import.confirm', answer.importId);
      expect(confirmEntry).toHaveLength(1);
      expect(confirmEntry[0]).toMatchObject({
        branch_id: t.north,
        details: { created: 1, subjectIds: [id] },
      });
    });

    it('lets the Academic Vice Principal import, naming the assignment in the entries', async () => {
      const answer = await uploaded([subjectRow({ nameEn: 'Geology' })], '', t.vicePrincipal);
      await saved(answer.importId, '', t.vicePrincipal);
      const id = await subjectNamed('Geology');
      expect((await schoolEntries('subject.create', id))[0]?.assignment_id).toBe(t.viceAssignment);
      expect((await t.entries('subject_quarter_weights.set', id))[0]?.assignment_id).toBe(
        t.viceAssignment,
      );
    });

    it('writes no quarter of a year that ended before today, nor of a closed year, whatever their state', async () => {
      // A year that ended in June and was never closed, and the planned year of today.
      const east = await t.newBranch();
      const past = await insertYear(east, '2025-09-01', 'current');
      const eastPlanned = await insertYear(east, '2026-09-02');
      const eastAnswer = await uploaded([subjectRow({ nameEn: 'Ecology' })], east);
      expect(eastAnswer.quarterCount).toBe(4);
      await saved(eastAnswer.importId, east);
      const ecology = await quartersOf(await subjectNamed('Ecology'));
      expect(ecology).toEqual([...eastPlanned.quarterIds].sort());
      expect(ecology.some((id) => past.quarterIds.includes(id))).toBe(false);

      // A closed year that ends after today, and a planned year after it.
      const west = await t.newBranch();
      const closedYear = await insertYear(west, '2026-09-02', 'closed');
      const westPlanned = await insertYear(west, '2027-09-01');
      const westAnswer = await uploaded([subjectRow({ nameEn: 'Botany' })], west);
      expect(westAnswer.quarterCount).toBe(4);
      await saved(westAnswer.importId, west);
      const botany = await quartersOf(await subjectNamed('Botany'));
      expect(botany).toEqual([...westPlanned.quarterIds].sort());
      expect(botany.some((id) => closedYear.quarterIds.includes(id))).toBe(false);
    });
  });

  describe('the rows', () => {
    it('refuses a name an active subject has, and takes one of an archived subject, as by hand', async () => {
      const department = await departmentId('STEAM');
      await t.database.migrator
        .insertInto('subjects')
        .values([
          {
            name_uz: 'Faol fan',
            name_ru: 'Активный предмет',
            name_en: 'Active subject',
            department_id: department,
            grades: [5],
            colour: 'red',
            journal_type: 'graded',
          },
          {
            name_uz: 'Arxiv fan',
            name_ru: 'Архивный предмет',
            name_en: 'Archived subject',
            department_id: department,
            grades: [5],
            colour: 'red',
            journal_type: 'graded',
            archived_at: new Date('2026-09-01T00:00:00Z'),
          },
        ])
        .execute();
      const taken = await uploaded([subjectRow({ nameEn: ' active SUBJECT ' })]);
      expect(codesAt(taken, 3)).toEqual(['nameEn:already_exists']);
      expect(taken.clean).toBe(false);
      const free = await uploaded([subjectRow({ nameEn: 'Archived subject' })]);
      expect(free.clean, JSON.stringify(free.rows)).toBe(true);
    });

    it('refuses a name another row has in the same language, and takes the same word in another', async () => {
      const answer = await uploaded([
        subjectRow({ nameEn: 'Logic', nameUz: 'Mantiq' }),
        subjectRow({ nameEn: 'logic' }),
        subjectRow({ nameEn: 'Mantiq' }),
      ]);
      expect(codesAt(answer, 3)).toEqual(['nameEn:duplicate_in_file']);
      expect(codesAt(answer, 4)).toEqual(['nameEn:duplicate_in_file']);
      expect(codesAt(answer, 5)).toEqual([]);
    });

    it('refuses a department outside Academic and the rating exam cell of the wrong shape', async () => {
      const answer = await uploaded([
        subjectRow({ department: 'Medical' }),
        subjectRow({ ratingExam: 'Yes', quarterRatingExam: '' }),
        subjectRow({ ratingExam: 'No', quarterClasswork: 30, quarterRatingExam: 40 }),
      ]);
      expect(codesAt(answer, 3)).toEqual(['department:department_not_academic']);
      expect(codesAt(answer, 4)).toEqual(['quarterRatingExam:required']);
      expect(codesAt(answer, 5)).toEqual(['quarterRatingExam:rating_exam_weight_unwanted']);
    });
  });

  describe('all rows or none', () => {
    it('saves nothing when one row has a problem, and answers the preview again', async () => {
      const answer = await uploaded([
        subjectRow({ nameEn: 'Calligraphy' }),
        subjectRow({ nameEn: 'Pottery', dailyHomework: 41 }),
      ]);
      const before = await rowsOf();
      const result = await confirmed(answer.importId);
      expect(result.outcome).toBe('not_clean');
      if (result.outcome === 'not_clean') {
        expect(codesAt(result.preview, 4)).toEqual(['dailyAttendance:weights_total']);
      }
      expect(await rowsOf()).toEqual(before);
    });

    it('creates nothing when the same clean file is uploaded again', async () => {
      const bytes = await filledSubjectTemplate([subjectRow({ nameEn: 'Rhetoric' })]);
      const first = subjectImportPreviewSchema.parse((await upload(bytes)).body);
      expect(first.alreadyImportedOn).toBeNull();
      await saved(first.importId);
      const again = subjectImportPreviewSchema.parse((await upload(bytes)).body);
      expect(again.alreadyImportedOn).toBe('2026-10-10');
      const before = await rowsOf();
      refusedWith(await confirm(again.importId), 409, 'import_already_done');
      refusedWith(await confirm(first.importId), 409, 'import_already_confirmed');
      expect(await rowsOf()).toEqual(before);
    });
  });

  describe('no effect of a preview', () => {
    it('leaves no subject, distribution, entry or notice behind, in either branch', async () => {
      const answer = await uploaded([
        subjectRow({ nameEn: 'Sculpture' }),
        subjectRow({
          nameEn: 'Drama',
          ratingExam: 'No',
          quarterRatingExam: '',
          quarterClasswork: 70,
        }),
      ]);
      expect(answer.clean, JSON.stringify(answer.rows)).toBe(true);
      const before = await rowsOf();
      const again = await preview(answer.importId);
      expect(again.status).toBe(200);
      expect(subjectImportPreviewSchema.parse(again.body).clean).toBe(true);
      expect(await rowsOf()).toEqual(before);
    });
  });

  describe('refusals', () => {
    it('refuses a file that is not the template, and a body on the preview', async () => {
      refusedWith(
        await upload(
          await filledSubjectTemplate([subjectRow()], (sheet) => {
            sheet.getRow(1).getCell(1).value = 'name';
          }),
        ),
        422,
        'import_not_template',
      );
      const answer = await uploaded([subjectRow()]);
      refusedWith(
        await t.post(`/api/setup/subjects/imports/${answer.importId}/preview`, t.north, {
          other: true,
        }),
        400,
        'validation_failed',
      );
    });

    it('answers 404 for an import of another branch and an unknown one on the preview and the confirm, changing nothing', async () => {
      const south = await uploaded([subjectRow()], t.south);
      const north = await uploaded([subjectRow()]);
      const before = await rowsOf();
      for (const id of [south.importId, UNKNOWN]) {
        refusedWith(await preview(id), 404, 'not_found');
        refusedWith(await confirm(id), 404, 'not_found');
      }
      // The north's import from the south.
      refusedWith(await confirm(north.importId, t.admin, t.south), 404, 'not_found');
      expect(await rowsOf()).toEqual(before);
    });

    it('refuses the Principal and a Teacher of the branch, who do not create subjects', async () => {
      const answer = await uploaded([subjectRow()]);
      const before = await rowsOf();
      for (const cookie of [t.principal, t.teacher]) {
        refusedWith(
          await upload(await filledSubjectTemplate([subjectRow()]), cookie),
          403,
          'permission_denied',
        );
        refusedWith(await preview(answer.importId, cookie), 403, 'permission_denied');
        refusedWith(await confirm(answer.importId, cookie), 403, 'permission_denied');
        refusedWith(
          await t.get('/api/setup/subjects/import-template?language=en', t.north, cookie),
          403,
          'permission_denied',
        );
      }
      expect(await rowsOf()).toEqual(before);
    });
  });

  describe('the edit check of the service', () => {
    it('refuses an access that the guard let in through `subjects` create without `subjects` edit, writing nothing', async () => {
      // A table where the Academic Vice Principal creates subjects but does not edit them: the
      // guard of the routes (create) would let the request in; the service's own check refuses.
      const table = {
        ...PERMISSIONS,
        subjects: permissionRows({
          super_admin: ['view', 'create', 'edit', 'archive', 'export'],
          academic_vice_principal: ['view', 'create'],
        }),
      };
      const imports = new SubjectImports(
        t.app.get(Transactions),
        t.app.get(Audit),
        t.app.get(Subjects),
        table,
      );
      const answer = await uploaded([subjectRow()]);
      const vice = await t.database.migrator
        .selectFrom('assignments')
        .select(['id', 'account_id'])
        .where('id', '=', t.viceAssignment)
        .executeTakeFirstOrThrow();
      const assignment = {
        id: vice.id,
        role: 'academic_vice_principal',
        branchId: t.north,
        subjectIds: [],
        classIds: [],
      };
      const access = {
        accountId: vice.account_id,
        assignmentId: vice.id,
        role: 'academic_vice_principal',
        branchId: t.north,
        branchIds: [t.north],
        assignments: [assignment],
        permitting: [assignment],
      } as unknown as Access;
      const before = await rowsOf();
      for (const run of [
        () => imports.preview(access, answer.importId, 'r1'),
        () => imports.confirm(access, answer.importId, 'r2'),
        () => imports.template(access, 'en'),
        async () =>
          imports.upload(
            access,
            new UploadedFile(await filledSubjectTemplate([subjectRow()]), XLSX),
            'r3',
          ),
      ]) {
        await expect(run()).rejects.toMatchObject({ code: 'permission_denied', status: 403 });
      }
      expect(await rowsOf()).toEqual(before);
      // With the table of the application the same access may import.
      const allowed = new SubjectImports(
        t.app.get(Transactions),
        t.app.get(Audit),
        t.app.get(Subjects),
        PERMISSIONS,
      );
      expect((await allowed.preview(access, answer.importId, 'r4')).importId).toBe(answer.importId);
    });
  });

  describe('the template', () => {
    it('has the keys row, the headings in three languages and the lists', async () => {
      const response = await request(t.kit.server)
        .get('/api/setup/subjects/import-template?language=en')
        .set('Cookie', t.admin)
        .set(BRANCH_HEADER, t.north)
        .buffer(true)
        .parse((res, callback) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            callback(null, Buffer.concat(chunks));
          });
        });
      expect(response.status).toBe(200);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(response.body as ExcelJS.Buffer);
      const sheet = workbook.getWorksheet('Subjects');
      expect(sheet?.getRow(1).getCell(1).value).toBe('nameUz');
      expect(sheet?.getRow(1).hidden).toBe(true);
      expect(sheet?.getRow(2).getCell(1).value).toBe(
        'Nomi (oʻzbekcha) / Название (узбекский) / Name in Uzbek',
      );
      const lists = workbook.getWorksheet('Lists');
      const values: unknown[] = [];
      lists?.eachRow((row) => {
        row.eachCell((cell) => values.push(cell.value));
      });
      expect(values).toContain('STEAM');
      expect(values).toContain('Teal');
      expect(values).toContain('Attendance only');
      expect(values).toContain('Yes');
      // Only the departments of Academic.
      expect(values).not.toContain('Medical');
    });
  });
});
