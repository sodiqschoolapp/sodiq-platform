import {
  BRANCH_HEADER,
  STUDENT_IMPORT_TYPES,
  studentImportConfirmResultSchema,
  studentImportPreviewSchema,
  type StudentImportPreview,
  type StudentImportPreviewRow,
} from '@sodiq/shared';
import { sql } from 'kysely';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions } from '../../database/transactions.js';
import { ClassesKit } from '../../testing/classes-kit.js';
import { dayTemplatesKit, UNKNOWN, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { errorCode } from '../../testing/sign-in-kit.js';
import { filledTemplate, studentRow, type TemplateRow } from '../../testing/student-import-kit.js';
import { binary } from '../../testing/xlsx-kit.js';
import { staffIdOf } from './staff-numbers.js';

const XLSX = STUDENT_IMPORT_TYPES[0] ?? '';

// All names are invented. Task 9.4g (the owner's spec change of 3 November
// 2026); docs/spec/04-people.md, Student record: Excel import, Close
// relatives: Always connected; docs/spec/edge-cases/students-classes-groups.md
// (the bulk placement row, the two import rows, a class is full, the duplicate
// check); the plan approved on pull request #278 with its corrections. The
// clock stands at 23:55 on 10 October 2026 in Tashkent; north has the year
// 2026–2027.
describe('the student import', () => {
  let t: DayTemplatesKit;
  let classes: ClassesKit;
  let year: string;
  let southYear: string;
  let count = 0;

  const letters = (value: number): string =>
    value < 26
      ? String.fromCharCode(97 + value)
      : letters(Math.floor(value / 26)) + String.fromCharCode(97 + (value % 26));

  /** A grade 7 class of the north with a name of its own. */
  async function newClass(maxSize = 25, branch = '', inYear = '') {
    count += 1;
    const name = `Kembrij ${letters(count + 30)}`;
    const id = await classes.schoolClass(branch || t.north, inYear || year, {
      grade: 7,
      name,
      maxSize,
    });
    return { id, name };
  }

  const upload = (bytes: Buffer, cookie = t.vicePrincipal, branch = '') =>
    request(t.kit.server)
      .put('/api/people/students/imports')
      .set('Cookie', cookie)
      .set(BRANCH_HEADER, branch || t.north)
      .set('Content-Type', XLSX)
      .send(bytes);

  async function uploaded(rows: readonly TemplateRow[], cookie = t.vicePrincipal) {
    const response = await upload(await filledTemplate(rows), cookie);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return studentImportPreviewSchema.parse(response.body);
  }

  const preview = (id: string, decisions: object = {}, cookie = t.vicePrincipal, branch = '') =>
    t.post(`/api/people/students/imports/${id}/preview`, branch || t.north, decisions, cookie);

  const confirm = (id: string, decisions: object = {}, cookie = t.vicePrincipal, branch = '') =>
    t.post(`/api/people/students/imports/${id}/confirm`, branch || t.north, decisions, cookie);

  async function confirmed(id: string, decisions: object = {}) {
    const response = await confirm(id, decisions);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return studentImportConfirmResultSchema.parse(response.body);
  }

  const refusedWith = (response: Response, status: number, code: string) => {
    expect(response.status, JSON.stringify(response.body)).toBe(status);
    expect(errorCode(response)).toBe(code);
  };

  const rowAt = (answer: StudentImportPreview, rowNumber: number): StudentImportPreviewRow => {
    const row = answer.rows.find((one) => one.rowNumber === rowNumber);
    if (row === undefined) {
      throw new Error(`Row ${String(rowNumber)} is in the preview.`);
    }
    return row;
  };

  const codesAt = (answer: StudentImportPreview, rowNumber: number) =>
    rowAt(answer, rowNumber).problems.map((one) => `${String(one.column)}:${one.code}`);

  /** Every row of the tables a confirm writes, in both branches, and the log: what a refused one leaves. */
  const rowsOf = () =>
    Promise.all(
      [
        'students',
        'student_uids',
        'student_contracts',
        'student_statuses',
        'student_accounts',
        'relatives',
        'relative_accounts',
        'student_relatives',
        'class_memberships',
        'group_memberships',
        'audit_log',
      ].map(
        async (table) =>
          (await sql`select * from ${sql.table(table)} order by 1`.execute(t.database.migrator))
            .rows,
      ),
    );

  const importRows = () =>
    t.database.migrator
      .selectFrom('student_imports')
      .select(['id', 'confirmed_at', 'confirmed_by'])
      .orderBy('id')
      .execute();

  const studentOf = (uid: unknown) =>
    t.database.migrator
      .selectFrom('students')
      .select(['id', 'branch_id'])
      .where('uid', '=', String(uid))
      .executeTakeFirst();

  beforeAll(async () => {
    t = await dayTemplatesKit();
    classes = new ClassesKit(t.database.migrator);
    year = await classes.year(t.north);
    southYear = await classes.year(t.south);
  });

  afterAll(async () => {
    await t.close();
  });

  describe('the template', () => {
    it('downloads the system template for the roles that create a student', async () => {
      const response = await t
        .get('/api/people/students/import-template?language=uz', t.north)
        .buffer(true)
        .parse(binary);
      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain(XLSX);
      expect(String(response.headers['content-disposition'])).toContain('student-import.xlsx');
      // No data, so no export entry.
      expect(await t.entries('student.export')).toEqual([]);
      refusedWith(
        await t.get('/api/people/students/import-template?language=uz', t.north, t.principal),
        403,
        'permission_denied',
      );
      refusedWith(
        await t.get('/api/people/students/import-template?language=uz&x=1', t.north),
        400,
        'validation_failed',
      );
    });
  });

  describe('the Done-when cases', () => {
    it('saves 30 students in three classes, with two relatives shared by siblings, in one confirm, each in its class and in a group of a split subject', async () => {
      const english = await classes.subject({ grades: [7] });
      const made = [await newClass(), await newClass(), await newClass()];
      const groups = new Map<string, string[]>();
      for (const one of made) {
        groups.set(one.id, [
          await classes.group(t.north, year, english, [one.id], { size: 20 }),
          await classes.group(t.north, year, english, [one.id], { size: 20 }),
        ]);
      }
      const motherPhone = 998951110001;
      const fatherPhone = 998951110002;
      const rows: TemplateRow[] = Array.from({ length: 30 }, (_, index) => {
        const target = made[index % 3];
        return studentRow(target?.name ?? '', {});
      });
      // A class name typed with a Cyrillic letter (edge: look-alike letters are the same).
      const first = made[0];
      if (first === undefined) {
        throw new Error('Three classes.');
      }
      rows[0] = { ...rows[0], className: first.name.replace('K', 'К') };
      // Siblings: rows 1 and 2 share the mother, rows 4 and 5 the father.
      rows[1] = {
        ...rows[1],
        relative1FullName: 'Malohat Ergasheva',
        relative1Phone: motherPhone,
      };
      rows[2] = {
        ...rows[2],
        relative1FullName: 'Malohat  ERGASHEVA',
        relative1Phone: motherPhone,
      };
      rows[4] = {
        ...rows[4],
        relative2FullName: 'Jasur Ergashev',
        relative2Relationship: 'Father',
        relative2Phone: fatherPhone,
      };
      rows[5] = {
        ...rows[5],
        relative2FullName: 'Jasur Ergashev',
        relative2Relationship: 'Otasi',
        relative2Phone: `+998 95 111 00 02`,
      };
      const answer = await uploaded(rows);
      expect(answer.rows.filter((row) => row.problems.length > 0).map((row) => [row.rowNumber, row.problems])).toEqual([]);
      expect(answer.clean).toBe(true);
      expect(answer.alreadyImportedOn).toBeNull();
      // The preview saved nothing.
      expect(await studentOf(rows[0]?.uid)).toBeUndefined();
      const result = await confirmed(answer.importId);
      if (result.outcome !== 'saved') {
        throw new Error(JSON.stringify(result));
      }
      expect(result.created).toBe(30);
      for (const [index, row] of rows.entries()) {
        const student = await studentOf(row.uid);
        expect(student?.branch_id).toBe(t.north);
        const target = made[index % 3];
        const membership = await t.database.migrator
          .selectFrom('class_memberships')
          .select(['class_id', 'valid_from'])
          .where('student_id', '=', student?.id ?? '')
          .execute();
        expect(membership).toEqual([{ class_id: target?.id, valid_from: '2026-09-02' }]);
        const inGroups = await t.database.migrator
          .selectFrom('group_memberships')
          .select(['group_id', 'valid_from', 'cause', 'review'])
          .where('student_id', '=', student?.id ?? '')
          .execute();
        expect(inGroups).toHaveLength(1);
        expect(groups.get(target?.id ?? '')).toContain(inGroups[0]?.group_id);
        // "Placed automatically, review", as bulk placement does.
        expect(inGroups[0]).toMatchObject({
          valid_from: '2026-09-02',
          cause: 'automatic',
          review: true,
        });
      }
      const sharedOf = async (phone: string) => {
        const relatives = await t.database.migrator
          .selectFrom('relatives')
          .select('id')
          .where('phone', '=', phone)
          .execute();
        expect(relatives).toHaveLength(1);
        return t.database.migrator
          .selectFrom('student_relatives')
          .select(['student_id', 'relationship', 'main_contact'])
          .where('relative_id', '=', relatives[0]?.id ?? '')
          .execute();
      };
      const mother = await sharedOf('+998951110001');
      expect(mother).toHaveLength(2);
      expect(mother.every((link) => link.relationship === 'mother' && link.main_contact)).toBe(
        true,
      );
      const father = await sharedOf('+998951110002');
      expect(father).toHaveLength(2);
      expect(father.every((link) => link.relationship === 'father' && !link.main_contact)).toBe(
        true,
      );
      // One create entry per student with the import's id, and the confirm's own entry.
      const creates = await t.database.migrator
        .selectFrom('audit_log')
        .select(['record_id', 'new_value', 'assignment_id'])
        .where('action', '=', 'student.create')
        .where(sql<boolean>`new_value->>'importId' = ${answer.importId}`)
        .execute();
      expect(creates).toHaveLength(30);
      expect(new Set(creates.map((entry) => entry.record_id))).toEqual(new Set(result.studentIds));
      const [entry] = await t.entries('student_import.confirm', answer.importId);
      expect(entry?.assignment_id).toBe(t.viceAssignment);
      expect(entry?.details).toMatchObject({ created: 30 });
      // No row data in the import's entries.
      expect(JSON.stringify(entry)).not.toContain(String(rows[0]?.lastName));
    });

    it('a file with a duplicate UID, a phone held under another name and an unknown class saves nothing and lists the rows with their reasons; linking the phone clears that row', async () => {
      const target = await newClass();
      const holderPhone = 998951110010;
      // A relative already in the system under another name.
      const held = await uploaded([
        studentRow(target.name, {
          relative1FullName: 'Shoira Nazarova',
          relative1Phone: holderPhone,
        }),
      ]);
      expect((await confirmed(held.importId)).outcome).toBe('saved');
      const holder = await t.database.migrator
        .selectFrom('relatives')
        .select('id')
        .where('phone', '=', '+998951110010')
        .executeTakeFirstOrThrow();
      const clean = [studentRow(target.name), studentRow(target.name), studentRow(target.name)];
      const duplicate = studentRow(target.name, { uid: clean[0]?.uid });
      const phoneRow = studentRow(target.name, {
        relative1FullName: 'Nilufar Saidova',
        relative1Phone: holderPhone,
      });
      const unknownClass = studentRow('Nowhere');
      const before = await rowsOf();
      const answer = await uploaded([...clean, duplicate, phoneRow, unknownClass]);
      expect(answer.clean).toBe(false);
      expect(codesAt(answer, 3)).toEqual(['uid:duplicate_in_file']);
      expect(codesAt(answer, 6)).toEqual(['uid:duplicate_in_file']);
      expect(codesAt(answer, 7)).toEqual(['relative1Phone:phone_held']);
      expect(rowAt(answer, 7).held).toEqual([
        {
          position: 1,
          holder: { id: holder.id, fullName: 'Shoira Nazarova', students: 1 },
          linked: false,
        },
      ]);
      expect(codesAt(answer, 8)).toEqual(['className:class_unknown']);
      // The bad rows come after clean rows the run wrote: the confirm undoes rows really written.
      const refused = await confirmed(answer.importId);
      expect(refused.outcome).toBe('not_clean');
      if (refused.outcome === 'not_clean') {
        expect(codesAt(refused.preview, 8)).toEqual(['className:class_unknown']);
      }
      const after = await rowsOf();
      // The upload's own entry is the only change.
      expect(after.map((rows, index) => (index === 10 ? rows.length - 1 : rows))).toEqual(
        before.map((rows, index) => (index === 10 ? rows.length : rows)),
      );
      // "Link to the existing person, whose stored name is kept" clears that row.
      const linked = studentImportPreviewSchema.parse(
        (
          await preview(answer.importId, {
            relativeLinks: [{ rowNumber: 7, position: 1, relativeId: holder.id }],
          })
        ).body,
      );
      expect(rowAt(linked, 7).held[0]?.linked).toBe(true);
      expect(codesAt(linked, 7)).toEqual([]);
    });

    it('the same clean file uploaded again creates nothing; a copy saved again fails every row on its UID', async () => {
      const target = await newClass();
      const rows = [studentRow(target.name), studentRow(target.name)];
      const bytes = await filledTemplate(rows);
      const first = studentImportPreviewSchema.parse((await upload(bytes)).body);
      expect((await confirmed(first.importId)).outcome).toBe('saved');
      const before = await rowsOf();
      const again = studentImportPreviewSchema.parse((await upload(bytes)).body);
      expect(again.alreadyImportedOn).toBe('2026-10-10');
      refusedWith(await confirm(again.importId), 409, 'import_already_done');
      // A copy with another hash (saved again in Excel): every row's UID is taken.
      const copyResponse = await upload(
        await filledTemplate(rows, (sheet) => {
          sheet.getRow(2).height = 30;
        }),
      );
      const copy = studentImportPreviewSchema.parse(copyResponse.body);
      expect(copy.alreadyImportedOn).toBeNull();
      // The first unique value the save meets refuses each row.
      for (const rowNumber of [3, 4]) {
        expect(rowAt(copy, rowNumber).problems.map((one) => one.code)).toEqual([
          'student_value_taken',
        ]);
      }
      const refused = await confirmed(copy.importId);
      expect(refused.outcome).toBe('not_clean');
      const after = await rowsOf();
      // Only the two uploads' entries were added.
      expect(after.slice(0, 10)).toEqual(before.slice(0, 10));
      expect((after[10] ?? []).length).toBe((before[10] ?? []).length + 2);
      refusedWith(await confirm(first.importId), 409, 'import_already_confirmed');
    });
  });

  describe('every check of the hand-made create', () => {
    it('a class with room for 2 takes two rows and refuses the third (the rows above count)', async () => {
      const small = await newClass(2);
      const answer = await uploaded([
        studentRow(small.name),
        studentRow(small.name),
        studentRow(small.name),
      ]);
      expect(codesAt(answer, 3)).toEqual([]);
      expect(codesAt(answer, 4)).toEqual([]);
      expect(codesAt(answer, 5)).toEqual(['className:class_full']);
      expect((await confirmed(answer.importId)).outcome).toBe('not_clean');
    });

    it('a row refused only at the save (a contract number taken meanwhile) rolls the whole confirm back', async () => {
      const target = await newClass();
      const rows = [studentRow(target.name), studentRow(target.name)];
      const answer = await uploaded(rows);
      expect(answer.clean).toBe(true);
      // Meanwhile a student is created by hand with the second row's contract number.
      const meanwhile = await uploaded([
        studentRow(target.name, { contractNumber: rows[1]?.contractNumber }),
      ]);
      expect((await confirmed(meanwhile.importId)).outcome).toBe('saved');
      const before = await rowsOf();
      const refused = await confirmed(answer.importId);
      expect(refused.outcome).toBe('not_clean');
      if (refused.outcome === 'not_clean') {
        expect(codesAt(refused.preview, 4)).toEqual(['contractNumber:student_value_taken']);
      }
      expect((await rowsOf()).slice(0, 10)).toEqual(before.slice(0, 10));
      expect(await studentOf(rows[0]?.uid)).toBeUndefined();
    });

    it('the name and date of birth warning: a student of the branch is named, the row waits until confirmed', async () => {
      const target = await newClass();
      const stored = studentRow(target.name);
      expect((await confirmed((await uploaded([stored])).importId)).outcome).toBe('saved');
      const storedId = (await studentOf(stored.uid))?.id;
      const twin = studentRow(target.name, {
        lastName: stored.lastName,
        firstName: stored.firstName,
        birthDate: stored.birthDate,
      });
      const answer = await uploaded([twin]);
      expect(codesAt(answer, 3)).toEqual([]);
      expect(rowAt(answer, 3).warning).toEqual({
        students: [{ id: storedId, uid: stored.uid }],
        elsewhere: false,
        rows: [],
        confirmed: false,
      });
      expect(answer.clean).toBe(false);
      expect((await confirmed(answer.importId)).outcome).toBe('not_clean');
      const result = await confirmed(answer.importId, { confirmedWarnings: [3] });
      expect(result.outcome).toBe('saved');
    });

    it('a match of another branch only is said to exist, nothing named; a JSHSHIR and a document number of another branch block, named as another branch', async () => {
      const south = await newClass(25, t.south, southYear);
      const elsewhere = studentRow(south.name);
      const inSouth = await upload(await filledTemplate([elsewhere]), t.admin, t.south);
      expect(inSouth.status, JSON.stringify(inSouth.body)).toBe(200);
      const southId = studentImportPreviewSchema.parse(inSouth.body).importId;
      expect(
        studentImportConfirmResultSchema.parse((await confirm(southId, {}, t.admin, t.south)).body)
          .outcome,
      ).toBe('saved');
      const target = await newClass();
      const answer = await uploaded([
        studentRow(target.name, {
          lastName: elsewhere.lastName,
          firstName: elsewhere.firstName,
          birthDate: elsewhere.birthDate,
        }),
        studentRow(target.name, { jshshir: elsewhere.jshshir }),
        studentRow(target.name, { documentNumber: elsewhere.documentNumber }),
      ]);
      expect(rowAt(answer, 3).warning).toEqual({
        students: [],
        elsewhere: true,
        rows: [],
        confirmed: false,
      });
      for (const [rowNumber, column] of [
        [4, 'jshshir'],
        [5, 'documentNumber'],
      ] as const) {
        expect(rowAt(answer, rowNumber).problems).toEqual([
          { column, code: 'student_value_taken', elsewhere: true },
        ]);
      }
    });

    it('a relative phone of a staff member of the branch makes the relative the same person, as by hand', async () => {
      const academic = await t.database.migrator
        .selectFrom('divisions')
        .select('id')
        .where('name_en', '=', 'Academic')
        .executeTakeFirstOrThrow();
      const steam = await t.database.migrator
        .selectFrom('departments')
        .select('id')
        .where('name_en', '=', 'STEAM')
        .executeTakeFirstOrThrow();
      const staffPhone = '+998947000777';
      const staffId = await t.database.migrator.transaction().execute(async (transaction) => {
        const row = await transaction
          .insertInto('staff')
          .values({
            kind: 'person',
            staff_id: staffIdOf(2026, 9777),
            first_name: 'Rustam',
            last_name: 'Nazarov',
            father_name: 'Akmalovich',
            sex: 'male',
            birth_date: '1985-03-04',
            phone: staffPhone,
            email: 'r.nazarov@example.uz',
            admission_date: '2026-09-01',
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        await transaction
          .insertInto('staff_branches')
          .values({ staff_id: row.id, branch_id: t.north, is_main: true })
          .execute();
        await transaction
          .insertInto('staff_divisions')
          .values({ staff_id: row.id, division_id: academic.id, department_id: steam.id, is_main: true })
          .execute();
        await transaction
          .insertInto('staff_statuses')
          .values({ staff_id: row.id, status: 'active', valid_from: '2026-09-01' })
          .execute();
        return row.id;
      });
      const target = await newClass();
      const answer = await uploaded([
        studentRow(target.name, { relative1FullName: 'Rustam Nazarov', relative1Phone: staffPhone }),
      ]);
      expect(answer.clean).toBe(true);
      expect((await confirmed(answer.importId)).outcome).toBe('saved');
      const relative = await t.database.migrator
        .selectFrom('relatives')
        .select(['id', 'full_name'])
        .where('phone', '=', staffPhone)
        .executeTakeFirstOrThrow();
      const mark = await sql<{ staff_id: string }>`
        select staff_id from same_person_staff(${[relative.id]}::uuid[])
      `.execute(t.database.migrator);
      expect(mark.rows[0]?.staff_id).toBe(staffId);
    });
  });

  describe('decisions', () => {
    it('refuses a link to an unknown relative or one that does not hold the phone, and a decision on a row or position not offered, changing nothing', async () => {
      const target = await newClass();
      const other = await uploaded([studentRow(target.name)]);
      expect((await confirmed(other.importId)).outcome).toBe('saved');
      const otherRelative = await t.database.migrator
        .selectFrom('relatives')
        .select('id')
        .orderBy('id', 'desc')
        .executeTakeFirstOrThrow();
      const answer = await uploaded([studentRow(target.name)]);
      const before = await rowsOf();
      for (const relativeId of [UNKNOWN, otherRelative.id]) {
        const result = await confirmed(answer.importId, {
          relativeLinks: [{ rowNumber: 3, position: 1, relativeId }],
        });
        expect(result.outcome).toBe('not_clean');
        if (result.outcome === 'not_clean') {
          expect(codesAt(result.preview, 3)).toEqual(['relative1Phone:relative_phone_changed']);
        }
      }
      refusedWith(
        await confirm(answer.importId, {
          relativeLinks: [{ rowNumber: 3, position: 2, relativeId: otherRelative.id }],
        }),
        422,
        'import_decision_unknown',
      );
      refusedWith(
        await confirm(answer.importId, {
          relativeLinks: [{ rowNumber: 9, position: 1, relativeId: otherRelative.id }],
        }),
        422,
        'import_decision_unknown',
      );
      refusedWith(
        await preview(answer.importId, { confirmedWarnings: [9] }),
        422,
        'import_decision_unknown',
      );
      refusedWith(await preview(answer.importId, { other: true }), 400, 'validation_failed');
      expect(await rowsOf()).toEqual(before);
    });
  });

  describe('nothing outside a confirm', () => {
    it('a preview of a clean file leaves every table of the confirm and the log as they were, in both branches', async () => {
      const target = await newClass();
      const answer = await uploaded([studentRow(target.name), studentRow(target.name)]);
      expect(answer.clean).toBe(true);
      const before = await rowsOf();
      const again = await preview(answer.importId);
      expect(again.status).toBe(200);
      expect(studentImportPreviewSchema.parse(again.body).clean).toBe(true);
      expect(await rowsOf()).toEqual(before);
    });

    it('refuses a file that is not the template and one over 5 MB, keeping nothing', async () => {
      const before = await importRows();
      const target = await newClass();
      refusedWith(
        await upload(
          await filledTemplate([studentRow(target.name)], (sheet) => {
            sheet.name = 'Pupils';
          }),
        ),
        422,
        'import_not_template',
      );
      refusedWith(await upload(Buffer.alloc(5 * 1024 * 1024 + 1, 1)), 413, 'import_file_too_large');
      refusedWith(
        await t.put('/api/people/students/imports', t.north, { rows: [] }),
        422,
        'import_not_template',
      );
      expect(await importRows()).toEqual(before);
    });

    it('answers 404 for an import of another branch and an unknown one on the preview and the confirm, changing nothing', async () => {
      const south = await newClass(25, t.south, southYear);
      const inSouth = await upload(
        await filledTemplate([studentRow(south.name)]),
        t.admin,
        t.south,
      );
      const southId = studentImportPreviewSchema.parse(inSouth.body).importId;
      const before = [await rowsOf(), await importRows()];
      for (const id of [southId, UNKNOWN]) {
        refusedWith(await preview(id), 404, 'not_found');
        refusedWith(await confirm(id), 404, 'not_found');
        // Also to the Super Admin, in the north.
        refusedWith(await confirm(id, {}, t.admin), 404, 'not_found');
      }
      expect([await rowsOf(), await importRows()]).toEqual(before);
    });
  });

  describe('two confirms at the same moment', () => {
    /** Runs a transaction of the application that holds `lock` until released. */
    async function holding(
      lock: (transaction: Parameters<Parameters<Transactions['run']>[1]>[0]) => Promise<void>,
    ) {
      let release: () => void = () => undefined;
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      let ready: () => void = () => undefined;
      const isReady = new Promise<void>((resolve) => {
        ready = resolve;
      });
      const done = t.app.get(Transactions).run([t.north], async (transaction) => {
        await lock(transaction);
        ready();
        await released;
      });
      await isReady;
      return { release, done };
    }

    async function waiting(count: number) {
      for (let attempt = 0; attempt < 200; attempt += 1) {
        const found = await sql<{ waiting: number }>`
          select count(distinct l.pid)::int as waiting
          from pg_locks l join pg_stat_activity a on a.pid = l.pid
          where a.datname = current_database() and not l.granted
        `.execute(t.database.migrator);
        if ((found.rows[0]?.waiting ?? 0) >= count) {
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error(`${String(count)} requests never waited.`);
    }

    const started = (work: () => PromiseLike<Response>) =>
      new Promise<Response>((resolve, reject) => {
        work().then(resolve, reject);
      });

    it('of one import: one saves, the other is refused as confirmed already', async () => {
      const target = await newClass();
      const answer = await uploaded([studentRow(target.name)]);
      const held = await holding(async (transaction) => {
        await transaction
          .selectFrom('student_imports')
          .select('id')
          .where('id', '=', answer.importId)
          .forUpdate()
          .execute();
      });
      const one = started(() => confirm(answer.importId));
      const two = started(() => confirm(answer.importId));
      await waiting(2);
      held.release();
      await held.done;
      const answers = await Promise.all([one, two]);
      const outcomes = answers.map((response) =>
        response.status === 200
          ? studentImportConfirmResultSchema.parse(response.body).outcome
          : errorCode(response),
      );
      expect(outcomes.sort()).toEqual(['import_already_confirmed', 'saved']);
    });

    it('of two uploads of one file: the second waits for the first and finds it imported', async () => {
      const target = await newClass();
      const bytes = await filledTemplate([studentRow(target.name)]);
      const first = studentImportPreviewSchema.parse((await upload(bytes)).body);
      const second = studentImportPreviewSchema.parse((await upload(bytes)).body);
      const hash = (
        await t.database.migrator
          .selectFrom('student_imports')
          .select('file_sha256')
          .where('id', '=', first.importId)
          .executeTakeFirstOrThrow()
      ).file_sha256;
      // The lock both confirms take before they look for an earlier import of the file.
      const held = await holding(async (transaction) => {
        await sql`select pg_advisory_xact_lock(hashtextextended(${`student_import:${t.north}:${hash}`}, 0))`.execute(
          transaction,
        );
      });
      const one = started(() => confirm(first.importId));
      const two = started(() => confirm(second.importId));
      await waiting(2);
      held.release();
      await held.done;
      const answers = await Promise.all([one, two]);
      const outcomes = answers.map((response) =>
        response.status === 200
          ? studentImportConfirmResultSchema.parse(response.body).outcome
          : errorCode(response),
      );
      expect(outcomes.sort()).toEqual(['import_already_done', 'saved']);
    });
  });
});
