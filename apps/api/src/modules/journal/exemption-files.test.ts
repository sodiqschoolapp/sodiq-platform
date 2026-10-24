import { randomUUID } from 'node:crypto';
import {
  BRANCH_HEADER,
  REQUEST_KEY_HEADER,
  absenceReasonSchema,
  exemptionCreatedSchema,
  exemptionReasonSchema,
  exemptionSchema,
  type ExemptionCreate,
} from '@sodiq/shared';
import request, { type Response, type Test } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  dayTemplatesKit,
  START,
  UNKNOWN,
  type DayTemplatesKit,
} from '../../testing/day-templates-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { MembersKit } from '../../testing/members-kit.js';
import { publishedScene } from '../../testing/published-scene.js';
import { MemoryPhotoStore } from '../people/photo-store.js';

/** Tuesday 27 October 2026, noon in Tashkent: the Mondays 12, 19 and 26 October are held. */
const MOMENT = '2026-10-27T12:00:00+05:00';

const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(64, 0x20)]);
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 0),
]);

const codeOf = (response: Response): string =>
  (response.body as { error?: { code?: string } }).error?.code ?? `status ${response.status}`;

// All names are invented. Task 8.5, pull request #223: the files of the reasons (the reason of
// an absence, From 6.3, decision 10, Look first; the document of an exemption and the reason of
// a move offer, `edge/exemptions`, row 10: "each opening is logged"), with the refusals of
// `.claude/rules/api.md` (the permission review of the code, findings 1 to 3 and 12).
describe('the files of the reasons', () => {
  let t: DayTemplatesKit;
  let load: LoadKit;
  let names = 0;
  const store = new MemoryPhotoStore();

  const account = async () => {
    names += 1;
    return t.kit.completeSession('Nodira', `Karimova${'a'.repeat(names % 7)}`);
  };

  type Held = Parameters<DayTemplatesKit['kit']['giveRole']>[1];
  type Browser = { cookie: string; account: { id: string } };
  interface Calls {
    get: (path: string) => Test;
    put: (path: string, body: object) => Test;
    post: (path: string, body?: object) => Test;
    del: (path: string) => Test;
    upload: (path: string, type: string, bytes: Buffer) => Test;
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
        post: (path, body) =>
          t.post(path, branch, body ?? {}, browser.cookie).set(REQUEST_KEY_HEADER, randomUUID()),
        del: (path) =>
          request(t.kit.server)
            .delete(path)
            .set('Cookie', browser.cookie)
            .set(BRANCH_HEADER, branch),
        upload: (path, type, bytes) =>
          request(t.kit.server)
            .put(path)
            .set('Cookie', browser.cookie)
            .set(BRANCH_HEADER, branch)
            .set('Content-Type', type)
            .send(bytes),
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
  async function tutorOf(
    branch: string,
    classId: string,
  ): Promise<Browser & { assignmentId: string }> {
    const browser = await account();
    const assignment = await t.kit.giveRole(browser.account.id, {
      role: 'tutor',
      branchId: branch,
      validFrom: new Date('2026-09-01T00:00:00+05:00'),
    });
    await load.classes.person(branch, ['uz'], { accountId: browser.account.id });
    await load.classes.tutorRow(branch, classId, assignment.id);
    return { ...browser, assignmentId: assignment.id };
  }

  async function scene() {
    const owner = await account();
    const s = await publishedScene(t, load, {
      graded: true,
      accounts: { teacher: owner.account.id },
    });
    const vice = await account();
    await t.kit.giveRole(vice.account.id, {
      role: 'academic_vice_principal',
      branchId: s.branch,
      validFrom: new Date('2026-09-01T00:00:00+05:00'),
    });
    return {
      ...s,
      owner,
      vice,
      ahmedov: await student(s.branch, s.classId, 'Ahmedov'),
      other: await student(s.branch, s.otherClass, 'Sobirov'),
    };
  }

  let admin = '';
  const accountOfAdmin = async () => {
    if (admin === '') {
      const row = await t.database.migrator
        .selectFrom('assignments')
        .select('account_id')
        .where('id', '=', t.adminAssignment)
        .executeTakeFirstOrThrow();
      admin = row.account_id;
    }
    return admin;
  };

  /** The clock at the moment, with the Super Admin's session in use then. */
  const adminAt = async (moment: string) => {
    t.clock.set(moment);
    await t.database.migrator
      .updateTable('sessions')
      .set({ created_at: new Date(moment), last_used_at: new Date(moment) })
      .where('account_id', '=', await accountOfAdmin())
      .execute();
  };

  const body = (input: Partial<ExemptionCreate> & { studentIds: string[] }): ExemptionCreate => ({
    kind: 'temporary',
    subjectIds: null,
    startDate: '2026-10-28',
    endDate: '2026-11-20',
    slots: null,
    category: 'illness',
    detail: 'A certificate from the clinic',
    choices: [],
    ...input,
  });

  const reasonsOf = (branch: string) =>
    t.database.migrator
      .selectFrom('student_absence_reasons')
      .selectAll()
      .where('branch_id', '=', branch)
      .orderBy('id')
      .execute();

  const exemptionsIn = (branch: string) =>
    t.database.migrator
      .selectFrom('exemptions')
      .selectAll()
      .where('branch_id', '=', branch)
      .orderBy('id')
      .execute();

  const fileOf = (studentId: string, date: string) =>
    `/api/journal/student-absences/${studentId}/${date}/file`;

  beforeAll(async () => {
    t = await dayTemplatesKit({ jobs: true, photoStore: store });
    load = new LoadKit(t.database.migrator);
  });

  afterAll(async () => {
    await t.close();
  });

  describe('the file of a reason of absence (From 6.3, decision 10)', () => {
    it('lets the class Tutor add, open and remove it, each audited, the opening naming the Tutor assignment', async () => {
      const s = await scene();
      const tutor = await tutorOf(s.branch, s.classId);
      // The account is Head Tutor too: the opening of an own class names the Tutor assignment.
      const head = await t.kit.giveRole(tutor.account.id, {
        role: 'head_tutor',
        branchId: s.branch,
        validFrom: new Date('2026-09-01T00:00:00+05:00'),
      });
      expect(head.id).not.toBe(tutor.assignmentId);
      await as(s.branch, tutor, [], async ({ get, put, del, upload }) => {
        expect(
          (
            await put(`/api/journal/student-absences/${s.ahmedov}/2026-10-19`, {
              category: 'illness',
              note: 'Fever',
            })
          ).status,
        ).toBe(200);
        const added = await upload(
          `${fileOf(s.ahmedov, '2026-10-19')}?name=Certificate.pdf`,
          'application/pdf',
          PDF,
        );
        expect(added.status, JSON.stringify(added.body)).toBe(200);
        expect(absenceReasonSchema.parse(added.body).file).toEqual({
          name: 'Certificate.pdf',
          type: 'application/pdf',
        });
        for (let opening = 0; opening < 2; opening += 1) {
          const read = await get(fileOf(s.ahmedov, '2026-10-19'));
          expect(read.status).toBe(200);
          expect(read.headers['content-type']).toBe('application/pdf');
        }
        const removed = await del(fileOf(s.ahmedov, '2026-10-19'));
        expect(removed.status, JSON.stringify(removed.body)).toBe(200);
        expect(absenceReasonSchema.parse(removed.body).file).toBeNull();
        expect(codeOf(await get(fileOf(s.ahmedov, '2026-10-19')))).toBe('not_found');
      });
      const add = await t.entries('absence_reason.file_add', s.ahmedov);
      expect(add).toHaveLength(1);
      expect(add[0]).toMatchObject({ assignment_id: tutor.assignmentId });
      const opened = await t.entries('absence_reason.file_open', s.ahmedov);
      expect(opened).toHaveLength(2);
      expect(opened.map((one) => one.assignment_id)).toEqual([
        tutor.assignmentId,
        tutor.assignmentId,
      ]);
      expect(await t.entries('absence_reason.file_remove', s.ahmedov)).toHaveLength(1);
    });

    it('refuses a Tutor of another class, a Teacher and a Principal', async () => {
      const s = await scene();
      const tutor = await tutorOf(s.branch, s.classId);
      await as(s.branch, tutor, [], async ({ put, upload }) => {
        await put(`/api/journal/student-absences/${s.ahmedov}/2026-10-19`, {
          category: 'illness',
          note: '',
        });
        await upload(`${fileOf(s.ahmedov, '2026-10-19')}?name=a.pdf`, 'application/pdf', PDF);
      });
      const before = await reasonsOf(s.branch);
      const fileEntries = async () =>
        Promise.all(
          ['absence_reason.file_add', 'absence_reason.file_remove', 'absence_reason.file_open'].map(
            async (action) => (await t.entries(action, s.ahmedov)).length,
          ),
        );
      const entries = await fileEntries();
      const otherTutor = await tutorOf(s.branch, s.otherClass);
      await as(s.branch, otherTutor, [], async ({ get, del, upload }) => {
        for (const refused of [
          await get(fileOf(s.ahmedov, '2026-10-19')),
          await del(fileOf(s.ahmedov, '2026-10-19')),
          await upload(`${fileOf(s.ahmedov, '2026-10-19')}?name=b.pdf`, 'application/pdf', PDF),
        ]) {
          expect(refused.status).toBe(403);
          expect(codeOf(refused)).toBe('absence_scope');
        }
      });
      // The Tutor of another class who is a Teacher too: the Teacher role gives no reading of it.
      await as(s.branch, otherTutor, [{ role: 'teacher', branchId: s.branch }], async ({ get }) => {
        expect((await get(fileOf(s.ahmedov, '2026-10-19'))).status).toBe(403);
      });
      // The Principal reads every class and writes none (decision 6).
      const principal = await account();
      await as(
        s.branch,
        principal,
        [{ role: 'principal', branchId: s.branch }],
        async ({ get, del, upload }) => {
          expect(
            (await upload(`${fileOf(s.ahmedov, '2026-10-19')}?name=c.pdf`, 'application/pdf', PDF))
              .status,
          ).toBe(403);
          expect((await del(fileOf(s.ahmedov, '2026-10-19'))).status).toBe(403);
          expect((await get(fileOf(s.ahmedov, '2026-10-19'))).status).toBe(200);
        },
      );
      expect(await reasonsOf(s.branch)).toEqual(before);
      // Only the Principal's opening was written.
      const [added = 0, removed = 0, opened = 0] = entries;
      expect(await fileEntries()).toEqual([added, removed, opened + 1]);
    });

    it('answers 404 for another branch’s student, an unknown student or date, a day with no reason or no category, and a file not there', async () => {
      const s = await scene();
      const elsewhere = await scene();
      const tutor = await tutorOf(s.branch, s.classId);
      const elsewhereTutor = await tutorOf(elsewhere.branch, elsewhere.classId);
      await as(elsewhere.branch, elsewhereTutor, [], async ({ put, upload }) => {
        await put(`/api/journal/student-absences/${elsewhere.ahmedov}/2026-10-19`, {
          category: 'illness',
          note: '',
        });
        await upload(
          `${fileOf(elsewhere.ahmedov, '2026-10-19')}?name=a.pdf`,
          'application/pdf',
          PDF,
        );
      });
      await as(s.branch, tutor, [], async ({ put }) => {
        await put(`/api/journal/student-absences/${s.ahmedov}/2026-10-19`, {
          category: null,
          note: '',
        });
        await put(`/api/journal/student-absences/${s.ahmedov}/2026-10-20`, {
          category: 'family',
          note: '',
        });
      });
      const before = [await reasonsOf(s.branch), await reasonsOf(elsewhere.branch)];
      const entries = await t.auditCount();
      const keys = store.keys().length;
      await as(s.branch, tutor, [], async ({ get, del, upload }) => {
        for (const path of [
          fileOf(elsewhere.ahmedov, '2026-10-19'),
          fileOf(UNKNOWN, '2026-10-19'),
          // Before the student's membership.
          fileOf(s.ahmedov, '2026-08-20'),
          // No reason that day, and a reason with no category.
          fileOf(s.ahmedov, '2026-10-21'),
          fileOf(s.ahmedov, '2026-10-19'),
        ]) {
          const put = await upload(`${path}?name=a.pdf`, 'application/pdf', PDF);
          expect(put.status, path).toBe(404);
          expect((await get(path)).status, path).toBe(404);
          expect((await del(path)).status, path).toBe(404);
        }
        // A reason with a category and no file: nothing to open or remove.
        expect(codeOf(await get(fileOf(s.ahmedov, '2026-10-20')))).toBe('not_found');
        expect(codeOf(await del(fileOf(s.ahmedov, '2026-10-20')))).toBe('not_found');
      });
      expect([await reasonsOf(s.branch), await reasonsOf(elsewhere.branch)]).toEqual(before);
      expect(await t.auditCount()).toBe(entries);
      expect(store.keys()).toHaveLength(keys);
    });

    it('drops the file when the category is cleared', async () => {
      const s = await scene();
      const tutor = await tutorOf(s.branch, s.classId);
      await as(s.branch, tutor, [], async ({ get, put, upload }) => {
        const path = `/api/journal/student-absences/${s.ahmedov}/2026-10-19`;
        await put(path, { category: 'illness', note: '' });
        expect(
          (await upload(`${fileOf(s.ahmedov, '2026-10-19')}?name=a.png`, 'image/png', PNG)).status,
        ).toBe(200);
        const cleared = await put(path, { category: null, note: '' });
        expect(absenceReasonSchema.parse(cleared.body).file).toBeNull();
        expect(codeOf(await get(fileOf(s.ahmedov, '2026-10-19')))).toBe('not_found');
      });
      const [row] = await reasonsOf(s.branch);
      expect(row).toMatchObject({ file_key: null, file_type: null, file_name: null });
    });
  });

  describe('the document of an exemption (edge/exemptions, row 10)', () => {
    const create = async (branch: string, vice: Browser, studentId: string) =>
      as(branch, vice, [], async ({ post }) => {
        const made = await post('/api/exemptions', body({ studentIds: [studentId] }));
        expect(made.status, JSON.stringify(made.body)).toBe(200);
        return exemptionCreatedSchema.parse(made.body).exemptions[0]?.id ?? '';
      });

    it('lets the vice add, open (each opening logged) and remove it; the Principal opens it and changes nothing', async () => {
      const s = await scene();
      const id = await create(s.branch, s.vice, s.ahmedov);
      await as(s.branch, s.vice, [], async ({ get, upload }) => {
        const added = await upload(
          `/api/exemptions/${id}/document?name=Certificate.pdf`,
          'application/pdf',
          PDF,
        );
        expect(added.status, JSON.stringify(added.body)).toBe(200);
        expect(exemptionSchema.parse(added.body).document).toMatchObject({
          name: 'Certificate.pdf',
        });
        const read = await get(`/api/exemptions/${id}/document`);
        expect(read.status).toBe(200);
        expect(read.headers['content-type']).toBe('application/pdf');
      });
      const principal = await account();
      await as(
        s.branch,
        principal,
        [{ role: 'principal', branchId: s.branch }],
        async ({ get, del, upload }) => {
          expect((await get(`/api/exemptions/${id}/document`)).status).toBe(200);
          expect(
            (await upload(`/api/exemptions/${id}/document?name=b.pdf`, 'application/pdf', PDF))
              .status,
          ).toBe(403);
          expect((await del(`/api/exemptions/${id}/document`)).status).toBe(403);
        },
      );
      await as(s.branch, s.vice, [], async ({ get, del }) => {
        const removed = await del(`/api/exemptions/${id}/document`);
        expect(removed.status, JSON.stringify(removed.body)).toBe(200);
        expect(exemptionSchema.parse(removed.body).document).toBeNull();
        expect(codeOf(await get(`/api/exemptions/${id}/document`))).toBe('not_found');
        expect(codeOf(await del(`/api/exemptions/${id}/document`))).toBe('not_found');
      });
      expect(await t.entries('exemption.document_add', s.ahmedov)).toHaveLength(1);
      expect(await t.entries('exemption.document_open', s.ahmedov)).toHaveLength(2);
      expect(await t.entries('exemption.document_remove', s.ahmedov)).toHaveLength(1);
    });

    it('refuses a type it does not take and a file over 10 MB', async () => {
      const s = await scene();
      const id = await create(s.branch, s.vice, s.ahmedov);
      const keys = store.keys().length;
      await as(s.branch, s.vice, [], async ({ upload }) => {
        // A PDF sent as a PNG: the bytes are not of the type named.
        const wrong = await upload(`/api/exemptions/${id}/document?name=a.png`, 'image/png', PDF);
        expect(codeOf(wrong)).toBe('exemption_file_type');
        const large = await upload(
          `/api/exemptions/${id}/document?name=big.pdf`,
          'application/pdf',
          Buffer.concat([PDF, Buffer.alloc(10_000_001 - PDF.length)]),
        );
        expect(large.status).toBe(413);
        expect(codeOf(large)).toBe('exemption_file_too_large');
      });
      expect(store.keys()).toHaveLength(keys);
      expect(await t.entries('exemption.document_add', s.ahmedov)).toHaveLength(0);
    });

    it('answers 404 for another branch’s and an unknown exemption, and 409 for a voided one', async () => {
      const s = await scene();
      const elsewhere = await scene();
      const theirs = await create(elsewhere.branch, elsewhere.vice, elsewhere.ahmedov);
      await as(elsewhere.branch, elsewhere.vice, [], async ({ upload }) => {
        await upload(`/api/exemptions/${theirs}/document?name=a.pdf`, 'application/pdf', PDF);
      });
      const voided = await create(s.branch, s.vice, s.ahmedov);
      await as(s.branch, s.vice, [], async ({ post }) => {
        const gone = await post(`/api/exemptions/${voided}/void`, {
          reason: 'Entered for the wrong student',
          version: 1,
        });
        expect(gone.status, JSON.stringify(gone.body)).toBe(200);
      });
      const before = [await exemptionsIn(s.branch), await exemptionsIn(elsewhere.branch)];
      const entries = await t.auditCount();
      const keys = store.keys().length;
      await as(s.branch, s.vice, [], async ({ get, del, upload }) => {
        for (const id of [theirs, UNKNOWN]) {
          const path = `/api/exemptions/${id}/document`;
          expect(codeOf(await upload(`${path}?name=a.pdf`, 'application/pdf', PDF))).toBe(
            'not_found',
          );
          expect(codeOf(await get(path))).toBe('not_found');
          expect(codeOf(await del(path))).toBe('not_found');
        }
        const refused = await upload(
          `/api/exemptions/${voided}/document?name=a.pdf`,
          'application/pdf',
          PDF,
        );
        expect(refused.status).toBe(409);
        expect(codeOf(refused)).toBe('exemption_voided');
      });
      expect([await exemptionsIn(s.branch), await exemptionsIn(elsewhere.branch)]).toEqual(before);
      expect(await t.auditCount()).toBe(entries);
      expect(store.keys()).toHaveLength(keys);
    });
  });

  describe('the reason of a move offer (permission review 1 and 7; 0125)', () => {
    /** A student moved from `s` to `target` with an exemption running past the move: one offer. */
    async function offered() {
      const s = await scene();
      const target = await scene();
      await as(s.branch, s.vice, [], async ({ post }) => {
        const made = await post(
          '/api/exemptions',
          body({ studentIds: [s.other], startDate: '2026-10-19', endDate: '2026-11-20' }),
        );
        expect(made.status, JSON.stringify(made.body)).toBe(200);
      });
      await adminAt(MOMENT);
      try {
        const read = await t.get(`/api/people/students/${s.other}`, s.branch, t.admin);
        const released = await t.post(
          `/api/people/students/${s.other}/branch-move`,
          s.branch,
          {
            toBranchId: target.branch,
            from: '2026-10-27',
            version: (read.body as { version: number }).version,
          },
          t.admin,
        );
        expect(released.status, JSON.stringify(released.body)).toBe(200);
        const move = await t.database.migrator
          .selectFrom('student_branch_moves')
          .select('id')
          .where('student_id', '=', s.other)
          .executeTakeFirstOrThrow();
        const accepted = await t.post(
          `/api/people/branch-moves/${move.id}/accept`,
          target.branch,
          { classId: target.otherClass, groups: [] },
          t.admin,
        );
        expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
      } finally {
        await adminAt(START);
      }
      const offer = await t.database.migrator
        .selectFrom('exemption_move_offers')
        .select('id')
        .where('student_id', '=', s.other)
        .executeTakeFirstOrThrow();
      return { s, target, offer: offer.id };
    }

    const offerRow = (id: string) =>
      t.database.migrator
        .selectFrom('exemption_move_offers')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirstOrThrow();

    it('leaves the detail out of the list, logs each opening, and keeps nothing of it once dropped', async () => {
      const { s, target, offer } = await offered();
      await as(target.branch, target.vice, [], async ({ get, post }) => {
        const list = await get('/api/exemptions/move-offers');
        expect(list.status).toBe(200);
        expect(JSON.stringify(list.body)).not.toContain('A certificate from the clinic');
        for (let opening = 0; opening < 2; opening += 1) {
          const read = await get(`/api/exemptions/move-offers/${offer}/reason`);
          expect(read.status, JSON.stringify(read.body)).toBe(200);
          expect(exemptionReasonSchema.parse(read.body)).toEqual({
            id: offer,
            category: 'illness',
            detail: 'A certificate from the clinic',
          });
        }
        const dropped = await post(`/api/exemptions/move-offers/${offer}/drop`);
        expect(dropped.status, JSON.stringify(dropped.body)).toBe(200);
        const after = await get(`/api/exemptions/move-offers/${offer}/reason`);
        expect(after.status).toBe(409);
        expect(codeOf(after)).toBe('exemption_offer_decided');
      });
      expect(await t.entries('exemption.offer_reason_open', s.other)).toHaveLength(2);
      expect(await offerRow(offer)).toMatchObject({
        decision: 'drop',
        detail: null,
        document_key: null,
        document_type: null,
        document_name: null,
      });
    });

    it('answers 404 for another branch’s and an unknown offer, writing nothing', async () => {
      const { s, offer } = await offered();
      // The sending branch's vice: the offer belongs to the receiving branch.
      const before = await offerRow(offer);
      const entries = await t.auditCount();
      await as(s.branch, s.vice, [], async ({ get }) => {
        for (const id of [offer, UNKNOWN]) {
          const refused = await get(`/api/exemptions/move-offers/${id}/reason`);
          expect(refused.status).toBe(404);
        }
      });
      expect(await offerRow(offer)).toEqual(before);
      expect(await t.auditCount()).toBe(entries);
    });
  });
});
