import { staffDetailSchema, type ClassesTaught } from '@sodiq/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions } from '../../database/transactions.js';
import { dayTemplatesKit, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { taughtAt } from '../access/taught-scope.js';

/** A Monday before the kit's today, when the first version starts. */
const EARLY = '2026-09-07';
/** A Monday after the kit's today. */
const LATER = '2026-10-12';
/** The first day of the planned year, when its first version starts. */
const PLANNED_START = '2027-09-01';

// "Classes taught, filled from the teaching load" (04, Teacher and staff
// record, Academic; task 5.5c-2b, pull request #157, decisions 5 to 7): the
// classes and groups of the person's rows in the published version in force
// of each year not closed, read in the branch of the request by the same
// query as a Teacher's students (`taughtRows`). The tests run in order on one
// chain of the North's year. The clock stands at 23:55 on Saturday 10 October
// 2026 in Tashkent. All names are invented.
describe('classes taught on the staff record', () => {
  let t: DayTemplatesKit;
  let load: LoadKit;
  let year: string;
  let planned: string;
  let southYear: string;
  let subject: string;
  let other: string;
  let teacher: { staffId: string; accountId: string };
  let oxford: string;
  let yale: string;
  let group: string;

  const taughtOf = async (cookie: string): Promise<ClassesTaught> =>
    staffDetailSchema.parse(
      (await t.get(`/api/people/staff/${teacher.staffId}`, t.north, cookie).expect(200)).body,
    ).classesTaught;

  /** A version of `of` in `branch` with the rows given, published unless said. */
  async function version(
    branch: string,
    of: string,
    startsOn: string,
    rows: readonly { classId?: string; groupId?: string; subjectId: string }[],
    status: 'draft' | 'published' = 'published',
  ): Promise<string> {
    const id = await load.version(branch, of, { startsOn });
    for (const row of rows) {
      await load.row({
        branch_id: branch,
        version_id: id,
        class_id: row.classId ?? null,
        group_id: row.groupId ?? null,
        subject_id: row.subjectId,
        teacher_id: teacher.staffId,
      });
    }
    if (status === 'published') {
      await load.setVersion(id, 'published');
    }
    return id;
  }

  beforeAll(async () => {
    t = await dayTemplatesKit();
    load = new LoadKit(t.database.migrator);
    year = await load.classes.year(t.north);
    planned = await load.classes.year(t.north, 'planned', PLANNED_START, '2028-05-31');
    southYear = await load.classes.year(t.south);
    subject = await load.classes.subject({ grades: [7, 8] });
    other = await load.classes.subject({ grades: [7, 8] });
    teacher = await load.teacher(t.north, {
      subjects: [
        { subject, grades: [7, 8] },
        { subject: other, grades: [7, 8] },
      ],
      further: [t.south],
    });
    oxford = await load.classes.schoolClass(t.north, year, { grade: 7, name: 'Oxford' });
    yale = await load.classes.schoolClass(t.north, year, { grade: 7, name: 'Yale' });
    group = await load.classes.group(t.north, year, other, [yale], { name: '7-E-1' });
  });

  afterAll(async () => {
    await t.close();
  });

  it('is empty while the rows are in a draft only', async () => {
    await version(t.north, year, EARLY, [{ classId: oxford, subjectId: subject }], 'draft');
    expect(await taughtOf(t.vicePrincipal)).toEqual([]);
  });

  it('lists the classes and groups of the published version in force with their subjects', async () => {
    await version(t.north, year, EARLY, [
      { classId: yale, subjectId: subject },
      { classId: oxford, subjectId: subject },
      { classId: oxford, subjectId: other },
      { groupId: group, subjectId: other },
    ]);
    const expected = [
      {
        academicYearId: year,
        startDate: '2026-09-01',
        endDate: '2027-05-31',
        entries: [
          {
            kind: 'class',
            id: oxford,
            grade: 7,
            name: 'Oxford',
            subjectIds: [subject, other].sort(),
          },
          { kind: 'class', id: yale, grade: 7, name: 'Yale', subjectIds: [subject] },
          { kind: 'group', id: group, grade: null, name: '7-E-1', subjectIds: [other] },
        ],
      },
    ];
    expect(await taughtOf(t.vicePrincipal)).toEqual(expected);
    // Every reader of the record reads the same list (decision 6).
    expect(await taughtOf(t.principal)).toEqual(expected);
    expect(await taughtOf(t.admin)).toEqual(expected);
  });

  it('is not changed by a published version that has not started', async () => {
    const before = await taughtOf(t.vicePrincipal);
    await version(t.north, year, LATER, [{ classId: yale, subjectId: subject }]);
    expect(await taughtOf(t.vicePrincipal)).toEqual(before);
  });

  it('lists a planned year from its first day, under that year', async () => {
    const next = await load.classes.schoolClass(t.north, planned, { grade: 8, name: 'Oxford' });
    await version(t.north, planned, PLANNED_START, [{ classId: next, subjectId: subject }]);
    const taught = await taughtOf(t.vicePrincipal);
    expect(taught.map((one) => one.academicYearId)).toEqual([year, planned]);
    expect(taught[1]?.entries).toEqual([
      { kind: 'class', id: next, grade: 8, name: 'Oxford', subjectIds: [subject] },
    ]);
  });

  it('leaves out the rows of another branch', async () => {
    const southClass = await load.classes.schoolClass(t.south, southYear, { grade: 7 });
    await version(t.south, southYear, EARLY, [{ classId: southClass, subjectId: subject }]);
    // The Super Admin's transaction holds every branch (permission review of
    // the code): only the branch of the request keeps the South's rows out.
    for (const cookie of [t.vicePrincipal, t.admin]) {
      const taught = await taughtOf(cookie);
      expect(taught.map((one) => one.academicYearId)).not.toContain(southYear);
      expect(taught.flatMap((one) => one.entries.map((entry) => entry.id))).not.toContain(
        southClass,
      );
    }
    // The same record read in the South lists the South's class.
    const south = staffDetailSchema.parse(
      (await t.get(`/api/people/staff/${teacher.staffId}`, t.south, t.admin).expect(200)).body,
    ).classesTaught;
    expect(south.map((one) => one.academicYearId)).toEqual([southYear]);
    expect(south[0]?.entries.map((entry) => entry.id)).toEqual([southClass]);
  });

  it('gives the same classes and groups as the scope of a Teacher', async () => {
    const taught = await taughtOf(t.vicePrincipal);
    const scope = await new Transactions(t.database.app, t.clock).run([t.north], (transaction) =>
      taughtAt(transaction, teacher.accountId, t.north),
    );
    const entries = taught.flatMap((one) => one.entries);
    expect(scope).toEqual({
      classIds: entries
        .filter((entry) => entry.kind === 'class')
        .map((entry) => entry.id.toLowerCase())
        .sort(),
      groupIds: entries
        .filter((entry) => entry.kind === 'group')
        .map((entry) => entry.id.toLowerCase())
        .sort(),
    });
  });
});
