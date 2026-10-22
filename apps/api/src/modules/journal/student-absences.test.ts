import { absenceReasonSchema, studentAbsencesSchema } from '@sodiq/shared';
import { randomUUID } from 'node:crypto';
import type { Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dayTemplatesKit, START, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { MembersKit } from '../../testing/members-kit.js';
import { publishedScene } from '../../testing/published-scene.js';

/** Tuesday 27 October 2026, noon in Tashkent: the Mondays 12, 19 and 26 October are held. */
const MOMENT = '2026-10-27T12:00:00+05:00';

const codeOf = (response: Response): string =>
  (response.body as { error?: { code?: string } }).error?.code ?? `status ${response.status}`;

// All names are invented. Task 6.3, pull request #211: the reasons of a student's absence
// and the Student absences page (docs/spec/edge-cases/journal.md, "A Tutor records why a
// student was absent", "Mark 0 ... is typed for a student who was present earlier that
// day"; decisions 6 to 9 and 13).
describe('the reasons of absence', () => {
  let t: DayTemplatesKit;
  let load: LoadKit;
  let names = 0;

  const account = async () => {
    names += 1;
    return t.kit.completeSession('Nodira', `Karimova${'a'.repeat(names % 7)}`);
  };

  type Held = Parameters<DayTemplatesKit['kit']['giveRole']>[1];
  type Browser = { cookie: string; account: { id: string } };
  interface Calls {
    get(path: string): Promise<Response>;
    put(path: string, body: object): Promise<Response>;
    post(path: string, body?: object): Promise<Response>;
  }

  async function as<T>(
    branch: string,
    browser: Browser,
    roles: readonly Omit<Held, 'validFrom'>[],
    work: (calls: Calls) => Promise<T>,
  ): Promise<T> {
    for (const held of roles) {
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
      return await work({
        get: (path) => t.get(path, branch, browser.cookie),
        put: (path, body) => t.put(path, branch, body, browser.cookie),
        post: (path, body) => t.post(path, branch, body ?? {}, browser.cookie),
      });
    } finally {
      t.clock.set(START);
    }
  }

  const student = async (branch: string, classId: string, last: string): Promise<string> => {
    const members = new MembersKit(t.database.migrator, await load.classes.account());
    const id = await members.student(branch, { startsOn: '2026-09-01', grade: 7 });
    await t.database.migrator
      .updateTable('students')
      .set({ first_name: 'Olim', last_name: last })
      .where('id', '=', id)
      .execute();
    await members.member({ branch, classId, studentId: id, from: '2026-09-01' });
    return id;
  };

  /** The Tutor of the class: an account with the Tutor role and a Tutor row from 1 September. */
  async function tutorOf(branch: string, classId: string): Promise<Browser> {
    const browser = await account();
    const assignment = await t.kit.giveRole(browser.account.id, {
      role: 'tutor',
      branchId: branch,
      validFrom: new Date('2026-09-01T00:00:00+05:00'),
    });
    await load.classes.person(branch, ['uz'], { accountId: browser.account.id });
    await load.classes.tutorRow(branch, classId, assignment.id);
    return browser;
  }

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
        .where('lesson_date', '<=', '2026-10-31')
        .orderBy('starts_at')
        .execute()
    ).map((row) => row.id);
    return {
      ...s,
      owner,
      lessons,
      ahmedov: await student(s.branch, s.classId, 'Ahmedov'),
      boboyev: await student(s.branch, s.classId, 'Boboyev'),
      other: await student(s.branch, s.otherClass, 'Sobirov'),
    };
  }

  const reasonsOf = (branch: string) =>
    t.database.migrator
      .selectFrom('student_absence_reasons')
      .selectAll()
      .where('branch_id', '=', branch)
      .orderBy('id')
      .execute();

  const reasonEntries = () => t.entries('absence_reason.set');

  beforeAll(async () => {
    t = await dayTemplatesKit({ jobs: true });
    load = new LoadKit(t.database.migrator);
  });

  afterAll(async () => {
    await t.close();
  });

  it('lets the class Tutor set, change and clear a reason, with the old and new value in the audit log', async () => {
    const s = await scene();
    const tutor = await tutorOf(s.branch, s.classId);
    await as(s.branch, tutor, [], async ({ put }) => {
      const path = `/api/journal/student-absences/${s.ahmedov}/2026-10-19`;
      const set = await put(path, { category: 'illness', note: 'Fever' });
      expect(set.status, JSON.stringify(set.body)).toBe(200);
      expect(absenceReasonSchema.parse(set.body)).toMatchObject({
        studentId: s.ahmedov,
        date: '2026-10-19',
        category: 'illness',
        note: 'Fever',
        changedBy: { accountId: tutor.account.id },
      });
      await put(path, { category: 'family', note: '' });
      const cleared = absenceReasonSchema.parse(
        (await put(path, { category: null, note: '' })).body,
      );
      expect(cleared.category).toBeNull();
    });
    const entries = (await reasonEntries()).filter((one) => one.record_id === s.ahmedov);
    expect(entries.map((one) => [one.old_value, one.new_value])).toEqual([
      [null, { date: '2026-10-19', category: 'illness', note: 'Fever' }],
      [
        { date: '2026-10-19', category: 'illness', note: 'Fever' },
        { date: '2026-10-19', category: 'family', note: '' },
      ],
      [
        { date: '2026-10-19', category: 'family', note: '' },
        { date: '2026-10-19', category: null, note: '' },
      ],
    ]);
    // The row stays, cleared (archive, do not delete).
    expect((await reasonsOf(s.branch)).map((row) => row.category)).toEqual([null]);
  });

  it('lets the Academic Vice Principal and the Super Admin write any class, and refuses a Tutor of another class and every other role', async () => {
    const s = await scene();
    const otherTutor = await tutorOf(s.branch, s.otherClass);
    const path = `/api/journal/student-absences/${s.ahmedov}/2026-10-12`;
    const before = await reasonsOf(s.branch);
    const entriesBefore = (await reasonEntries()).length;
    await as(s.branch, otherTutor, [], async ({ put }) => {
      const refused = await put(path, { category: 'unknown', note: '' });
      expect(refused.status).toBe(403);
      expect(codeOf(refused)).toBe('absence_scope');
    });
    for (const role of [
      'principal',
      'head_tutor',
      'spiritual_vice_principal',
      'teacher',
    ] as const) {
      const browser = await account();
      await as(s.branch, browser, [{ role, branchId: s.branch }], async ({ put }) => {
        expect((await put(path, { category: 'unknown', note: '' })).status, role).toBe(403);
      });
    }
    expect(await reasonsOf(s.branch)).toEqual(before);
    expect(await reasonEntries()).toHaveLength(entriesBefore);
    const vice = await account();
    await as(
      s.branch,
      vice,
      [{ role: 'academic_vice_principal', branchId: s.branch }],
      async ({ put }) => {
        expect((await put(path, { category: 'school_permitted', note: 'Olympiad' })).status).toBe(
          200,
        );
      },
    );
    const admin = await account();
    await as(s.branch, admin, [{ role: 'super_admin' }], async ({ put }) => {
      expect(
        (
          await put(`/api/journal/student-absences/${s.other}/2026-10-12`, {
            category: 'unexcused',
            note: '',
          })
        ).status,
      ).toBe(200);
    });
  });

  it('refuses a date with no class membership, another branch’s student and an unknown one', async () => {
    const s = await scene();
    const elsewhere = await scene();
    const tutor = await tutorOf(s.branch, s.classId);
    const before = [await reasonsOf(s.branch), await reasonsOf(elsewhere.branch)];
    const entriesBefore = (await reasonEntries()).length;
    await as(s.branch, tutor, [], async ({ put }) => {
      const early = await put(`/api/journal/student-absences/${s.ahmedov}/2026-08-20`, {
        category: 'illness',
        note: '',
      });
      expect(early.status).toBe(409);
      expect(codeOf(early)).toBe('absence_not_member');
      for (const id of [elsewhere.ahmedov, randomUUID()]) {
        const missing = await put(`/api/journal/student-absences/${id}/2026-10-12`, {
          category: 'illness',
          note: '',
        });
        expect(missing.status).toBe(404);
      }
      expect(
        (
          await put(`/api/journal/student-absences/${s.ahmedov}/2026-10-12`, {
            category: null,
            note: 'x',
          })
        ).status,
      ).toBe(400);
    });
    expect([await reasonsOf(s.branch), await reasonsOf(elsewhere.branch)]).toEqual(before);
    expect(await reasonEntries()).toHaveLength(entriesBefore);
  });

  it('lists the days with a 0 or 3 or a reason, marks a 0 after being at school, and limits a Tutor to own classes', async () => {
    const s = await scene();
    const tutor = await tutorOf(s.branch, s.classId);
    const [first, second] = s.lessons;
    await as(s.branch, s.owner, [{ role: 'teacher', branchId: s.branch }], async ({ post }) => {
      expect(
        (
          await post(`/api/journal/lessons/${first ?? ''}/attendance`, {
            saves: [
              { studentId: s.ahmedov, mark: 0, version: null },
              { studentId: s.boboyev, mark: 1, version: null },
            ],
          })
        ).status,
      ).toBe(200);
      await post(`/api/journal/lessons/${second ?? ''}/attendance`, {
        saves: [{ studentId: s.ahmedov, mark: 1, version: null }],
      });
    });
    await as(s.branch, tutor, [], async ({ get, put }) => {
      await put(`/api/journal/student-absences/${s.boboyev}/2026-10-21`, {
        category: 'family',
        note: 'Wedding',
      });
      const answer = await get(
        `/api/journal/student-absences?classId=${s.classId}&from=2026-10-01&to=2026-10-31`,
      );
      expect(answer.status, JSON.stringify(answer.body)).toBe(200);
      const list = studentAbsencesSchema.parse(answer.body);
      expect(list.classes.map((one) => one.id)).toEqual([s.classId]);
      expect(
        list.days.map((day) => [
          day.student.id,
          day.date,
          day.lessons.length,
          day.reason?.category ?? null,
        ]),
      ).toEqual([
        [s.boboyev, '2026-10-21', 0, 'family'],
        [s.ahmedov, '2026-10-12', 1, null],
      ]);
      expect(list.days.every((day) => day.canEdit)).toBe(true);
      const refused = await get(`/api/journal/student-absences?classId=${s.otherClass}`);
      expect(refused.status).toBe(403);
      expect(codeOf(refused)).toBe('absence_scope');
      // At most 31 days.
      expect(
        (
          await get(
            `/api/journal/student-absences?classId=${s.classId}&from=2026-10-01&to=2026-11-01`,
          )
        ).status,
      ).toBe(400);
    });
    // The Head Tutor reads every class, writes none.
    const headTutor = await account();
    await as(s.branch, headTutor, [{ role: 'head_tutor', branchId: s.branch }], async ({ get }) => {
      const list = studentAbsencesSchema.parse(
        (
          await get(
            `/api/journal/student-absences?classId=${s.classId}&from=2026-10-01&to=2026-10-31`,
          )
        ).body,
      );
      expect(list.classes.map((one) => one.id).sort()).toEqual([s.classId, s.otherClass].sort());
      expect(list.days.every((day) => !day.canEdit)).toBe(true);
    });
    for (const role of ['teacher', 'head_teacher'] as const) {
      const browser = await account();
      await as(
        s.branch,
        browser,
        [
          {
            role,
            branchId: s.branch,
            ...(role === 'head_teacher' ? { subjectIds: [s.subject] } : {}),
          },
        ],
        async ({ get }) => {
          expect((await get('/api/journal/student-absences')).status, role).toBe(403);
        },
      );
    }
    const elsewhere = await scene();
    await as(s.branch, headTutor, [], async ({ get }) => {
      for (const classId of [elsewhere.classId, randomUUID()]) {
        expect((await get(`/api/journal/student-absences?classId=${classId}`)).status).toBe(404);
      }
    });
  });

  it('marks the day of a 0 typed after a 1 earlier that day (decision 9)', async () => {
    const owner = await account();
    const s = await publishedScene(t, load, {
      graded: true,
      double: true,
      accounts: { teacher: owner.account.id },
    });
    const [early, late] = (
      await t.database.migrator
        .selectFrom('lessons')
        .select('id')
        .where('class_id', '=', s.classId)
        .where('lesson_date', '=', '2026-10-12')
        .orderBy('starts_at')
        .execute()
    ).map((row) => row.id);
    const ahmedov = await student(s.branch, s.classId, 'Ahmedov');
    await as(s.branch, owner, [{ role: 'teacher', branchId: s.branch }], async ({ post }) => {
      await post(`/api/journal/lessons/${early ?? ''}/attendance`, {
        saves: [{ studentId: ahmedov, mark: 2, version: null }],
      });
      await post(`/api/journal/lessons/${late ?? ''}/attendance`, {
        saves: [{ studentId: ahmedov, mark: 0, version: null }],
      });
    });
    const vice = await account();
    await as(
      s.branch,
      vice,
      [{ role: 'academic_vice_principal', branchId: s.branch }],
      async ({ get }) => {
        const list = studentAbsencesSchema.parse(
          (
            await get(
              `/api/journal/student-absences?classId=${s.classId}&from=2026-10-12&to=2026-10-12`,
            )
          ).body,
        );
        expect(list.days).toHaveLength(1);
        expect(list.days[0]).toMatchObject({
          date: '2026-10-12',
          presentEarlier: true,
          canEdit: true,
        });
        expect(list.days[0]?.lessons.map((one) => one.mark)).toEqual([0]);
      },
    );
  });
});
