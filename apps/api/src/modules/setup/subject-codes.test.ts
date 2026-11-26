import { randomUUID } from 'node:crypto';
import {
  SUBJECT_IMPORT_COLUMNS,
  subjectListSchema,
  subjectSchema,
  type Subject,
} from '@sodiq/shared';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dayTemplatesKit, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { errorCode } from '../../testing/sign-in-kit.js';

// Task 11.27 (pull request #399): `05`, Subject: "codes switch (off by default; set by the Super
// Admin only; `09`, Codes)"; Excel import of subjects: "The codes switch is not in the template";
// `02`, Super Admin: "switches codes on or off for a subject"; Academic Vice Principal: "subjects
// (except the codes switch)". Every name is invented.
describe('the codes switch of a subject (task 11.27)', () => {
  let t: DayTemplatesKit;
  let steam: string;
  let count = 0;

  beforeAll(async () => {
    t = await dayTemplatesKit();
    steam = (
      await t.database.migrator
        .selectFrom('departments')
        .select('id')
        .where('name_en', '=', 'STEAM')
        .executeTakeFirstOrThrow()
    ).id;
  });

  afterAll(async () => {
    await t.close();
  });

  async function create(): Promise<Subject> {
    count += 1;
    const response = await t.post('/api/setup/subjects', t.north, {
      names: {
        uz: `Kod fani ${String(count)}`,
        ru: `Предмет кодов ${String(count)}`,
        en: `Codes ${String(count)}`,
      },
      departmentId: steam,
      grades: [5, 6, 7],
      colour: 'blue',
      journalType: 'graded',
      ratingExam: false,
      groupSubject: false,
      languageRule: true,
      demanding: false,
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return subjectSchema.parse(response.body);
  }

  const switchCodes = (id: string, codesOn: boolean, cookie = t.admin) =>
    t.put(`/api/setup/subjects/${id}/codes`, t.north, { codesOn }, cookie);

  const stored = async (id: string) =>
    (
      await t.database.migrator
        .selectFrom('subjects')
        .select('codes_on')
        .where('id', '=', id)
        .executeTakeFirstOrThrow()
    ).codes_on;

  const entries = (id: string) =>
    t.database.migrator
      .selectFrom('audit_log_school')
      .select(['old_value', 'new_value'])
      .where('action', '=', 'subject.codes')
      .where('record_id', '=', id)
      .orderBy('occurred_at')
      .orderBy('id')
      .execute();

  const auditCount = async () =>
    Number(
      (
        await sql<{ n: string }>`
          select (select count(*) from audit_log) + (select count(*) from audit_log_school) as n
        `.execute(t.database.migrator)
      ).rows[0]?.n,
    );

  it('starts off, and only the Super Admin switches it, audited once per change', async () => {
    const subject = await create();
    expect(subject.codesOn).toBe(false);

    const on = await switchCodes(subject.id, true);
    expect(on.status, JSON.stringify(on.body)).toBe(200);
    expect(subjectSchema.parse(on.body).codesOn).toBe(true);
    // The same value again writes nothing.
    expect((await switchCodes(subject.id, true)).status).toBe(200);
    const off = await switchCodes(subject.id, false);
    expect(subjectSchema.parse(off.body).codesOn).toBe(false);
    expect((await entries(subject.id)).map((one) => [one.old_value, one.new_value])).toEqual([
      [{ codesOn: false }, { codesOn: true }],
      [{ codesOn: true }, { codesOn: false }],
    ]);

    // The Academic Vice Principal edits subjects, but not this switch (`02`).
    const before = await auditCount();
    const refused = await switchCodes(subject.id, true, t.vicePrincipal);
    expect([refused.status, errorCode(refused)]).toEqual([403, 'permission_denied']);
    expect(await stored(subject.id)).toBe(false);
    expect(await auditCount()).toBe(before);
  });

  it('answers whether the reader may switch, and shows the switch to every reader of subjects', async () => {
    const subject = await create();
    expect((await switchCodes(subject.id, true)).status).toBe(200);
    for (const [cookie, may] of [
      [t.admin, true],
      [t.vicePrincipal, false],
      [t.principal, false],
    ] as const) {
      const response = await t.get('/api/setup/subjects', t.north, cookie);
      expect(response.status).toBe(200);
      const list = subjectListSchema.parse(response.body);
      expect(list.maySwitchCodes).toBe(may);
      expect(list.subjects.find((one) => one.id === subject.id)?.codesOn).toBe(true);
    }
  });

  it('answers 404 for an unknown subject, changing nothing', async () => {
    const before = await auditCount();
    const response = await switchCodes(randomUUID(), true);
    expect([response.status, errorCode(response)]).toEqual([404, 'not_found']);
    expect(await auditCount()).toBe(before);
  });

  it('is not changed by the subject edit or carried by the import (05)', async () => {
    const subject = await create();
    const before = await auditCount();
    // The edit's schema drops a field it has no use for (review correction 1): nothing stored.
    const edit = await t.put(
      `/api/setup/subjects/${subject.id}`,
      t.north,
      {
        names: subject.names,
        departmentId: subject.departmentId,
        grades: subject.grades,
        colour: subject.colour,
        journalType: subject.journalType,
        ratingExam: subject.ratingExam,
        groupSubject: subject.groupSubject,
        languageRule: subject.languageRule,
        demanding: subject.demanding,
        codesOn: true,
      },
      t.vicePrincipal,
    );
    expect(edit.status, JSON.stringify(edit.body)).toBe(200);
    expect(await stored(subject.id)).toBe(false);
    expect(await entries(subject.id)).toEqual([]);
    expect(await auditCount()).toBeGreaterThanOrEqual(before);
    // The template and its preview have no such column.
    expect(SUBJECT_IMPORT_COLUMNS.some((column) => /code/i.test(column))).toBe(false);
  });

  it('switches an archived subject too (plan decision 11)', async () => {
    const subject = await create();
    expect((await t.post(`/api/setup/subjects/${subject.id}/archive`, t.north)).status).toBe(200);
    const on = await switchCodes(subject.id, true);
    expect(on.status).toBe(200);
    expect(await stored(subject.id)).toBe(true);
  });
});
