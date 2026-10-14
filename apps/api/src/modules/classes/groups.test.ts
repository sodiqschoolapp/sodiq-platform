import {
  BRANCH_HEADER,
  groupDetailSchema,
  groupListSchema,
  groupSlotCheckSchema,
  type GroupDetail,
} from '@sodiq/shared';
import { sql } from 'kysely';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { ClassesKit } from '../../testing/classes-kit.js';
import { dayTemplatesKit, UNKNOWN, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { errorCode } from '../../testing/sign-in-kit.js';
import { binary, fileOf } from '../../testing/xlsx-kit.js';

const detailOf = (response: Response): GroupDetail => {
  expect(response.status, JSON.stringify(response.body)).toBeLessThan(300);
  return groupDetailSchema.parse(response.body);
};

const refusedWith = (response: Response, status: number, code: string) => {
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  expect(errorCode(response)).toBe(code);
};

// All names are invented. docs/spec/05-classes-groups-subjects.md, Group:
// "Subject, grade or two grades, name (7-M-1), language, ... maximum size";
// "A group across classes takes students from several classes of one grade
// ... or of two grades ... A split divides one class into parts"; Language of
// instruction, Groups; edge/timetable, Structure (a group of two grades);
// edge/academic-year: "Group names are unique per branch and year". Task 3.2a,
// pull request #91, with corrections 1 to 4 of its review. The clock stands at
// 23:55 on Saturday 10 October 2026 in Tashkent.
describe('groups', () => {
  let t: DayTemplatesKit;
  let classes: ClassesKit;
  let year: string;
  let southYear: string;
  let subject: string;
  let subjectOutsideRule: string;
  let otherSubject: string;
  let spiritual: string;
  let headTutor: string;
  let headTeacher: string;
  let seniorHeadTeacher: string;
  let tutor: string;
  let tutorClass: string;
  let noClassTutor: string;
  let count = 0;

  const FROM = new Date('2026-09-01T00:00:00+05:00');

  const get = (path: string, cookie = t.vicePrincipal, branch = t.north) =>
    t.get(path, branch, cookie);
  const post = (path: string, body: object = {}, cookie = t.vicePrincipal, branch = t.north) =>
    t.post(path, branch, body, cookie);
  const put = (path: string, body: object, cookie = t.vicePrincipal, branch = t.north) =>
    t.put(path, branch, body, cookie);

  const schoolClass = (
    input: { grade?: number; language?: 'uz' | 'ru'; branch?: string; year?: string } = {},
  ) =>
    classes.schoolClass(input.branch ?? t.north, input.year ?? year, {
      grade: input.grade ?? 7,
      language: input.language ?? 'uz',
    });

  const body = (classIds: readonly string[], fields: object = {}) => {
    count += 1;
    return {
      academicYearId: year,
      subjectId: subject,
      classIds,
      name: `7-M-${String(count)}`,
      language: null,
      maxSize: 20,
      ...fields,
    };
  };

  async function create(
    classIds: readonly string[],
    fields: object = {},
    cookie = t.vicePrincipal,
  ): Promise<GroupDetail> {
    const response = await post('/api/groups', body(classIds, fields), cookie);
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return groupDetailSchema.parse(response.body);
  }

  const editBody = (group: GroupDetail, fields: object = {}) => ({
    classIds: group.classes.map((one) => one.id),
    name: group.name,
    language: null,
    maxSize: group.maxSize,
    version: group.version,
    ...fields,
  });

  /** Every row of the tables the group routes write, in both branches, and the audit count. */
  const rowsOf = () =>
    Promise.all([
      t.database.migrator.selectFrom('groups').selectAll().orderBy('id').execute(),
      t.database.migrator
        .selectFrom('group_classes')
        .selectAll()
        .orderBy('group_id')
        .orderBy('class_id')
        .execute(),
      t.database.migrator.selectFrom('classes').selectAll().orderBy('id').execute(),
      t.auditCount(),
    ]);

  /** A signed-in account with a role in the North branch, or school-wide for the Senior Head Teacher. */
  async function signedIn(
    first: string,
    last: string,
    role: string,
    subjectIds?: readonly string[],
  ): Promise<{ cookie: string; accountId: string; assignment: string }> {
    const browser = await t.kit.completeSession(first, last);
    const given = await t.kit.giveRole(browser.account.id, {
      role: role as never,
      branchId: role === 'senior_head_teacher' ? null : t.north,
      ...(role === 'tutor' ? { validFrom: FROM } : {}),
      ...(subjectIds === undefined ? {} : { subjectIds }),
    });
    return { cookie: browser.cookie, accountId: browser.account.id, assignment: given.id };
  }

  /** How many connections to the test database wait for a lock right now. */
  async function waitingForALock(): Promise<number> {
    const found = await sql<{ waiting: number }>`
      select count(distinct l.pid)::int as waiting
      from pg_locks l join pg_stat_activity a on a.pid = l.pid
      where a.datname = current_database() and not l.granted
    `.execute(t.database.migrator);
    return found.rows[0]?.waiting ?? 0;
  }

  /** Runs `work` in a transaction of the application that stays open until released. */
  async function holdOpen(work: (transaction: Transaction) => Promise<void>) {
    let release: () => void = () => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let ready: () => void = () => undefined;
    const isReady = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const done = t.app
      .get(Transactions)
      .run([t.north], async (transaction) => {
        await work(transaction);
        ready();
        await released;
      })
      .catch((error: unknown) => error);
    await Promise.race([isReady, done]);
    return { release, done };
  }

  /** The writes of a group create, as the service makes them: the classes locked first. */
  async function writeGroup(
    transaction: Transaction,
    classIds: readonly string[],
    language = 'uz',
  ): Promise<string> {
    await transaction
      .selectFrom('classes')
      .select('id')
      .where('id', 'in', [...classIds].sort())
      .orderBy('id')
      .forShare()
      .execute();
    count += 1;
    const row = await transaction
      .insertInto('groups')
      .values({
        branch_id: t.north,
        academic_year_id: year,
        subject_id: subject,
        name: `Held ${String(count)}`,
        language,
        max_size: 20,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    for (const classId of classIds) {
      await transaction
        .insertInto('group_classes')
        .values({ group_id: row.id, class_id: classId, branch_id: t.north })
        .execute();
    }
    return row.id;
  }

  /** The writes of a class change, as the class edit makes them: the class locked FOR UPDATE first. */
  async function writeClass(
    transaction: Transaction,
    classId: string,
    values: { grade?: number; language?: string; archived_at?: Date },
  ): Promise<void> {
    await transaction
      .selectFrom('classes')
      .select('id')
      .where('id', '=', classId)
      .forUpdate()
      .execute();
    await transaction.updateTable('classes').set(values).where('id', '=', classId).execute();
  }

  beforeAll(async () => {
    t = await dayTemplatesKit();
    classes = new ClassesKit(t.database.migrator);
    year = await classes.year(t.north);
    southYear = await classes.year(t.south);
    subject = await classes.subject({ grades: [4, 5, 7, 8, 9] });
    subjectOutsideRule = await classes.subject({ grades: [7, 8], languageRule: false });
    otherSubject = await classes.subject({ grades: [7, 8] });
    spiritual = (await signedIn('Kamola', 'Rahimova', 'spiritual_vice_principal')).cookie;
    headTutor = (await signedIn('Lola', 'Nazarova', 'head_tutor')).cookie;
    headTeacher = (await signedIn('Otabek', 'Yusupov', 'head_teacher', [subject])).cookie;
    seniorHeadTeacher = (await signedIn('Nodira', 'Usmonova', 'senior_head_teacher', [subject]))
      .cookie;
    const tutorAccount = await signedIn('Malika', 'Qodirova', 'tutor');
    await classes.person(t.north, ['uz'], { accountId: tutorAccount.accountId });
    tutorClass = await schoolClass();
    await classes.tutorRow(t.north, tutorClass, tutorAccount.assignment, { from: FROM });
    tutor = tutorAccount.cookie;
    noClassTutor = (await signedIn('Sevara', 'Toshmatova', 'tutor')).cookie;
    // Lessons of 45 minutes for every grade, of 40 for grades 1 to 4.
    const long = await t.createSlotType(t.north, 'Lesson', 'lesson', 45);
    const short = await t.createSlotType(t.north, 'Short lesson', 'lesson', 40);
    const pause = await t.createSlotType(t.north, 'Break', 'break', 10);
    const regular = await t.createTemplate(t.north, 'Regular', [long, pause, long, pause, long]);
    const junior = await t.createTemplate(t.north, 'Junior', [short, pause, short, pause, short]);
    await t.assign(t.north, regular);
    await t.assign(t.north, junior, { level: 'grades', gradeFrom: 1, gradeTo: 4 });
  });

  afterAll(async () => {
    await t.close();
  });

  describe('the create and the record', () => {
    it('creates a split of one class, which takes its language, and audits it', async () => {
      const oxford = await schoolClass({ language: 'ru' });
      const response = await post('/api/groups', body([oxford], { name: '7-E-1' }));
      const group = detailOf(response);
      expect(group).toMatchObject({
        name: '7-E-1',
        language: 'ru',
        kind: 'split',
        grades: [7],
        classes: [{ id: oxford, grade: 7, language: 'ru', archived: false }],
        archived: false,
        slots: null,
      });
      const [entry] = await t.entries('group.create', group.id);
      expect(entry).toMatchObject({
        assignment_id: t.viceAssignment,
        request_id: response.headers['x-request-id'],
        new_value: {
          academicYearId: year,
          subjectId: subject,
          classIds: [oxford],
          name: '7-E-1',
          language: 'ru',
          maxSize: 20,
        },
      });
    });

    it('shows the shared slots of a group of two grades with the same template', async () => {
      const seven = await schoolClass({ grade: 7 });
      const eight = await schoolClass({ grade: 8 });
      const group = await create([seven, eight]);
      expect(group.kind).toBe('across');
      expect(group.slots?.grades).toEqual([7, 8]);
      const monday = group.slots?.days.find((day) => day.weekday === 1);
      expect(monday?.date).toBe('2026-10-12');
      expect(monday?.slots.map((slot) => [slot.start, slot.end])).toEqual([
        [480, 525],
        [535, 580],
        [590, 635],
      ]);
    });

    // Decision 9: shown, never refused at the save; the load step of 3.4 refuses.
    it('saves a group of two grades that share no slot, and shows none', async () => {
      const four = await schoolClass({ grade: 4 });
      const five = await schoolClass({ grade: 5 });
      const group = await create([four, five]);
      expect(group.slots?.days.every((day) => day.slots.length === 0)).toBe(true);
    });

    it('lets the form ask for the shared slots before the save, and refuses an id outside the branch', async () => {
      const four = await schoolClass({ grade: 4 });
      const seven = await schoolClass({ grade: 7 });
      const eight = await schoolClass({ grade: 8 });
      const check = groupSlotCheckSchema.parse(
        (await get(`/api/groups/slot-check?classIds=${seven},${eight}`).expect(200)).body,
      );
      expect(check.slots?.days[0]?.slots).toHaveLength(3);
      const none = groupSlotCheckSchema.parse(
        (await get(`/api/groups/slot-check?classIds=${four},${seven}`).expect(200)).body,
      );
      expect(none.slots?.days.every((day) => day.slots.length === 0)).toBe(true);
      expect(
        groupSlotCheckSchema.parse(
          (await get(`/api/groups/slot-check?classIds=${seven}`).expect(200)).body,
        ).slots,
      ).toBeNull();
      const southern = await schoolClass({ branch: t.south, year: southYear });
      for (const id of [southern, UNKNOWN]) {
        refusedWith(await get(`/api/groups/slot-check?classIds=${seven},${id}`), 404, 'not_found');
      }
      refusedWith(
        await get(`/api/groups/slot-check?classIds=${seven},${eight}`, t.principal),
        403,
        'permission_denied',
      );
    });

    it('answers another branch’s and an unknown group 404 on every path, changing nothing', async () => {
      const southern = await schoolClass({ branch: t.south, year: southYear });
      const southGroup = await classes.group(t.south, southYear, subject, [southern]);
      const before = await rowsOf();
      for (const id of [southGroup, UNKNOWN]) {
        refusedWith(await get(`/api/groups/${id}`), 404, 'not_found');
        refusedWith(
          await put(`/api/groups/${id}`, {
            classIds: [southern],
            name: 'Moved',
            language: null,
            maxSize: 20,
            version: 0,
          }),
          404,
          'not_found',
        );
        refusedWith(await post(`/api/groups/${id}/archive`), 404, 'not_found');
        refusedWith(await post(`/api/groups/${id}/restore`), 404, 'not_found');
      }
      // The Super Admin, whose transaction may hold every branch, too.
      refusedWith(await get(`/api/groups/${southGroup}`, t.admin), 404, 'not_found');
      expect(await rowsOf()).toEqual(before);
    });

    it('answers a class, a subject or a year of another branch or unknown in the body 404, changing nothing', async () => {
      const own = await schoolClass();
      const southern = await schoolClass({ branch: t.south, year: southYear });
      const group = await create([own]);
      const before = await rowsOf();
      for (const fields of [
        { classIds: [own, southern] },
        { classIds: [own, UNKNOWN] },
        { subjectId: UNKNOWN },
        { academicYearId: southYear },
        { academicYearId: UNKNOWN },
      ]) {
        refusedWith(await post('/api/groups', body([own], fields)), 404, 'not_found');
      }
      for (const id of [southern, UNKNOWN]) {
        refusedWith(
          await put(`/api/groups/${group.id}`, editBody(group, { classIds: [own, id] })),
          404,
          'not_found',
        );
      }
      expect(await rowsOf()).toEqual(before);
    });

    it('refuses a name the schema does not take (correction 3)', async () => {
      const own = await schoolClass();
      for (const name of ['7-M-1²', '-7', '']) {
        refusedWith(await post('/api/groups', body([own], { name })), 400, 'validation_failed');
      }
    });
  });

  describe('who reads and who writes (decisions 2 and 11)', () => {
    it('lets the readers of 02 read every group, the Head Teachers own subjects, the Tutor own classes', async () => {
      const own = await create([tutorClass]);
      const another = await create([await schoolClass()], { subjectId: otherSubject });
      for (const cookie of [t.principal, spiritual, headTutor, t.admin]) {
        const listed = groupListSchema.parse((await get('/api/groups', cookie).expect(200)).body);
        expect(listed.groups.map((one) => one.id)).toEqual(
          expect.arrayContaining([own.id, another.id]),
        );
        detailOf(await get(`/api/groups/${another.id}`, cookie));
      }
      // `02`, Scope: "For own subjects in own branch: … groups"; the Senior
      // Head Teacher in every branch, here in North.
      for (const cookie of [headTeacher, seniorHeadTeacher]) {
        const listed = groupListSchema.parse((await get('/api/groups', cookie).expect(200)).body);
        expect(listed.groups.some((one) => one.id === own.id)).toBe(true);
        expect(listed.groups.some((one) => one.id === another.id)).toBe(false);
        detailOf(await get(`/api/groups/${own.id}`, cookie));
        refusedWith(await get(`/api/groups/${another.id}`, cookie), 403, 'permission_denied');
      }
      // `02`, Tutor: "Own class or classes".
      const listed = groupListSchema.parse((await get('/api/groups', tutor).expect(200)).body);
      expect(listed.groups.map((one) => one.id)).toEqual([own.id]);
      detailOf(await get(`/api/groups/${own.id}`, tutor));
      refusedWith(await get(`/api/groups/${another.id}`, tutor), 403, 'permission_denied');
      expect(
        groupListSchema.parse((await get('/api/groups', noClassTutor).expect(200)).body).groups,
      ).toEqual([]);
      refusedWith(await get('/api/groups', t.teacher), 403, 'permission_denied');
      refusedWith(await get(`/api/groups/${own.id}`, t.teacher), 403, 'permission_denied');
    });

    it('lets the Senior Head Teacher read the groups of own subjects in another branch, in that branch', async () => {
      const southern = await schoolClass({ branch: t.south, year: southYear });
      const southGroup = await classes.group(t.south, southYear, subject, [southern]);
      const listed = groupListSchema.parse(
        (await get('/api/groups', seniorHeadTeacher, t.south).expect(200)).body,
      );
      expect(listed.groups.map((one) => one.id)).toContain(southGroup);
      expect(listed.groups.every((one) => one.subject.id === subject)).toBe(true);
      refusedWith(await get('/api/groups', headTeacher, t.south), 403, 'permission_denied');
    });

    it('refuses every write to the readers, changing nothing', async () => {
      const own = await schoolClass();
      const group = await create([own]);
      const before = await rowsOf();
      for (const cookie of [t.principal, spiritual, headTutor, headTeacher, tutor, t.teacher]) {
        refusedWith(await post('/api/groups', body([own]), cookie), 403, 'permission_denied');
        refusedWith(
          await put(`/api/groups/${group.id}`, editBody(group, { maxSize: 30 }), cookie),
          403,
          'permission_denied',
        );
        refusedWith(
          await post(`/api/groups/${group.id}/archive`, {}, cookie),
          403,
          'permission_denied',
        );
        refusedWith(
          await post(`/api/groups/${group.id}/restore`, {}, cookie),
          403,
          'permission_denied',
        );
      }
      expect(await rowsOf()).toEqual(before);
    });

    it('lets the Principal export the list, logged', async () => {
      const group = await create([await schoolClass()], { name: '7-X-1' });
      const response = await request(t.kit.server)
        .post('/api/groups/export')
        .set('Cookie', t.principal)
        .set(BRANCH_HEADER, t.north)
        .send({
          ids: [group.id],
          columns: ['name', 'subject', 'classes', 'language', 'maxSize', 'status'],
          selection: 'matching',
          search: '',
          filters: {},
        })
        .buffer(true)
        .parse(binary);
      expect(response.status).toBe(200);
      const file = await fileOf(response);
      expect(file.sheet.rows.map((row) => row[0])).toEqual(['7-X-1']);
      expect((await t.entries('group.export')).length).toBeGreaterThan(0);
      refusedWith(
        await post(
          '/api/groups/export',
          { ids: [group.id], columns: ['name'], selection: 'matching', search: '', filters: {} },
          headTeacher,
        ),
        403,
        'permission_denied',
      );
    });
  });

  describe('the rules of the save', () => {
    it('refuses a name taken in the year, also by an archived group, naming the holder', async () => {
      const own = await schoolClass();
      const first = await create([own], { name: 'Ma-1' });
      detailOf(await post(`/api/groups/${first.id}/archive`));
      const response = await post('/api/groups', body([own], { name: 'МА-1' }));
      refusedWith(response, 409, 'already_exists');
      expect(response.body).toMatchObject({
        error: { details: [{ path: 'name', recordId: first.id }] },
      });
    });

    it('refuses a branch with no planned or current year (decision 5)', async () => {
      const branch = await t.newBranch();
      const response = await post(
        '/api/groups',
        body([UNKNOWN], { academicYearId: UNKNOWN }),
        t.admin,
        branch,
      );
      // The classes are read first: none of them is of the branch.
      refusedWith(response, 404, 'not_found');
      const classlessYear = await classes.year(branch, 'planned', '2027-09-01', '2028-05-31');
      const own = await classes.schoolClass(branch, classlessYear);
      await t.database.migrator
        .updateTable('academic_years')
        .set({ status: 'current' })
        .where('id', '=', classlessYear)
        .execute();
      await classes.setYear(classlessYear, 'closed');
      refusedWith(
        await post('/api/groups', body([own], { academicYearId: classlessYear }), t.admin, branch),
        409,
        'group_needs_year',
      );
    });

    it('refuses a closed year on every write', async () => {
      const branch = await t.newBranch();
      const closed = await classes.year(branch, 'current', '2025-09-01', '2026-05-31');
      await classes.year(branch, 'planned', '2026-09-01', '2027-05-31');
      const own = await classes.schoolClass(branch, closed);
      const groupId = await classes.group(branch, closed, subject, [own]);
      await classes.setYear(closed, 'closed');
      refusedWith(
        await post('/api/groups', body([own], { academicYearId: closed }), t.admin, branch),
        409,
        'group_year_closed',
      );
      const group = detailOf(await get(`/api/groups/${groupId}`, t.admin, branch));
      refusedWith(
        await put(`/api/groups/${groupId}`, editBody(group, { maxSize: 30 }), t.admin, branch),
        409,
        'group_year_closed',
      );
      refusedWith(
        await post(`/api/groups/${groupId}/archive`, {}, t.admin, branch),
        409,
        'group_year_closed',
      );
    });

    it('refuses an archived class, a class of another year, three grades and a subject not taught in a grade', async () => {
      const own = await schoolClass();
      const archived = await schoolClass();
      await t.database.migrator
        .updateTable('classes')
        .set({ archived_at: new Date('2026-10-01T09:00:00+05:00') })
        .where('id', '=', archived)
        .execute();
      const nextYear = await classes.year(t.north, 'planned', '2027-09-01', '2028-05-31');
      const ofNextYear = await classes.schoolClass(t.north, nextYear);
      refusedWith(await post('/api/groups', body([own, archived])), 409, 'group_class_year');
      refusedWith(await post('/api/groups', body([own, ofNextYear])), 409, 'group_class_year');
      const eight = await schoolClass({ grade: 8 });
      const nine = await schoolClass({ grade: 9 });
      refusedWith(await post('/api/groups', body([own, eight, nine])), 409, 'group_grades');
      refusedWith(
        await post('/api/groups', body([own, nine], { subjectId: otherSubject })),
        409,
        'group_subject_grade',
      );
      const archivedSubject = await classes.subject({ grades: [7] });
      await t.database.migrator
        .updateTable('subjects')
        .set({ archived_at: new Date('2026-10-01T09:00:00+05:00') })
        .where('id', '=', archivedSubject)
        .execute();
      refusedWith(
        await post('/api/groups', body([own], { subjectId: archivedSubject })),
        409,
        'group_subject_archived',
      );
    });

    // Decision 8: `05`, Language of instruction, Groups.
    it('takes the classes’ language, asks a language and a confirmation for mixed classes', async () => {
      const uzbek = await schoolClass({ language: 'uz' });
      const russian = await schoolClass({ language: 'ru' });
      refusedWith(
        await post('/api/groups', body([uzbek], { language: 'ru' })),
        409,
        'group_language',
      );
      refusedWith(await post('/api/groups', body([uzbek, russian])), 422, 'group_language_needed');
      refusedWith(
        await post('/api/groups', body([uzbek, russian], { language: 'ru' })),
        409,
        'group_mixed_language',
      );
      const response = await post(
        '/api/groups',
        body([uzbek, russian], { language: 'ru', confirmMixedLanguage: true }),
      );
      const mixed = detailOf(response);
      expect(mixed.language).toBe('ru');
      const [entry] = await t.entries('group.create', mixed.id);
      expect(entry).toMatchObject({ new_value: { language: 'ru', confirmMixedLanguage: true } });
      // A subject outside the language rule asks no confirmation.
      const outside = await create([uzbek, russian], {
        subjectId: subjectOutsideRule,
        language: 'uz',
      });
      expect(outside.language).toBe('uz');
    });
  });

  describe('the edit, the archive and the restore', () => {
    it('changes the classes and the fields, raises the version and audits the sets', async () => {
      const oxford = await schoolClass();
      const yale = await schoolClass();
      const group = await create([oxford]);
      const response = await put(
        `/api/groups/${group.id}`,
        editBody(group, { classIds: [oxford, yale], maxSize: 24 }),
      );
      const edited = detailOf(response);
      expect(edited.classes.map((one) => one.id).sort()).toEqual([oxford, yale].sort());
      expect(edited.kind).toBe('across');
      expect(edited.version).toBe(group.version + 1);
      const [entry] = await t.entries('group.edit', group.id);
      expect(entry).toMatchObject({
        assignment_id: t.viceAssignment,
        request_id: response.headers['x-request-id'],
        old_value: { classIds: [oxford], maxSize: 20 },
        new_value: { classIds: [oxford, yale].sort(), maxSize: 24 },
      });
      // Only the classes: the version moves too.
      const again = detailOf(
        await put(`/api/groups/${group.id}`, editBody(edited, { classIds: [yale] })),
      );
      expect(again.version).toBe(edited.version + 1);
      // A stale version is refused.
      refusedWith(await put(`/api/groups/${group.id}`, editBody(edited)), 409, 'group_changed');
    });

    it('archives and restores with an entry each, refuses an edit of an archived group, and checks a restore again', async () => {
      const own = await schoolClass();
      const group = await create([own]);
      const archived = detailOf(await post(`/api/groups/${group.id}/archive`));
      expect(archived.archived).toBe(true);
      expect(await t.entries('group.archive', group.id)).toHaveLength(1);
      refusedWith(await put(`/api/groups/${group.id}`, editBody(archived)), 409, 'group_archived');
      // An archived group lets its class be archived; the restore is then refused.
      expect((await post(`/api/classes/${own}/archive`)).status).toBe(200);
      refusedWith(await post(`/api/groups/${group.id}/restore`), 409, 'group_class_year');
      await post(`/api/classes/${own}/restore`).expect(200);
      const restored = detailOf(await post(`/api/groups/${group.id}/restore`));
      expect(restored.archived).toBe(false);
      expect(await t.entries('group.restore', group.id)).toHaveLength(1);
    });
  });

  describe("the class's and the subject's side (decisions 8 and 16)", () => {
    const classBody = async (classId: string, fields: object) => {
      const read = (await get(`/api/classes/${classId}`).expect(200)).body as {
        grade: number;
        name: string;
        language: string;
        maxSize: number;
        version: number;
      };
      return {
        grade: read.grade,
        name: read.name,
        language: read.language,
        mainRoomId: null,
        maxSize: read.maxSize,
        version: read.version,
        ...fields,
      };
    };

    it('refuses a grade change and an archive of a class that feeds an active group', async () => {
      const own = await schoolClass();
      await create([own]);
      refusedWith(
        await put(`/api/classes/${own}`, await classBody(own, { grade: 8 })),
        409,
        'class_grade_groups',
      );
      refusedWith(await post(`/api/classes/${own}/archive`), 409, 'class_in_groups');
    });

    it('moves a one-language group with its class, and asks a confirmation for a group it makes mixed', async () => {
      const oxford = await schoolClass({ language: 'uz' });
      const yale = await schoolClass({ language: 'uz' });
      const split = await create([oxford]);
      const across = await create([oxford, yale]);
      const response = await put(
        `/api/classes/${oxford}`,
        await classBody(oxford, { language: 'ru' }),
      );
      refusedWith(response, 409, 'class_language_mixes_groups');
      expect(response.body).toMatchObject({
        error: { details: [{ path: `group.${across.id}`, code: 'mixes' }] },
      });
      const confirmed = await put(
        `/api/classes/${oxford}`,
        await classBody(oxford, { language: 'ru', confirmMixedGroups: true }),
      );
      expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
      expect(detailOf(await get(`/api/groups/${split.id}`)).language).toBe('ru');
      expect(detailOf(await get(`/api/groups/${across.id}`)).language).toBe('uz');
      const [entry] = await t.entries('class.edit', oxford);
      expect(entry).toMatchObject({
        details: {
          groupsMoved: [{ id: split.id, from: 'uz', to: 'ru' }],
          groupsMixed: [{ id: across.id }],
        },
      });
    });

    it('refuses a removed grade and an archive of a subject a group needs, naming own groups and counting the others', async () => {
      const own = await classes.subject({ grades: [7, 8, 9], journalType: 'attendance_only' });
      const seven = await schoolClass({ grade: 7 });
      const group = await create([seven], { subjectId: own });
      const southern = await schoolClass({ branch: t.south, year: southYear, grade: 9 });
      await classes.group(t.south, southYear, own, [southern]);
      const steam = await t.database.migrator
        .selectFrom('departments')
        .select('id')
        .where('name_en', '=', 'STEAM')
        .executeTakeFirstOrThrow();
      const read = await t.database.migrator
        .selectFrom('subjects')
        .selectAll()
        .where('id', '=', own)
        .executeTakeFirstOrThrow();
      const subjectBody = (grades: number[]) => ({
        names: { uz: read.name_uz, ru: read.name_ru, en: read.name_en },
        departmentId: steam.id,
        grades,
        colour: 'blue',
        journalType: 'attendance_only',
        ratingExam: false,
        groupSubject: false,
        languageRule: true,
        demanding: false,
        daily: null,
      });
      const removed = await put(`/api/setup/subjects/${own}`, subjectBody([7, 8]), t.admin);
      refusedWith(removed, 409, 'subject_grade_groups');
      expect(removed.body).toMatchObject({
        error: { details: [{ path: 'elsewhere', code: '1' }] },
      });
      const removedSeven = await put(`/api/setup/subjects/${own}`, subjectBody([8, 9]), t.admin);
      refusedWith(removedSeven, 409, 'subject_grade_groups');
      expect(removedSeven.body).toMatchObject({
        error: { details: [{ path: `group.${group.id}`, code: 'needs' }] },
      });
      const archived = await post(`/api/setup/subjects/${own}/archive`, {}, t.admin);
      refusedWith(archived, 409, 'subject_has_groups');
      expect(archived.body).toMatchObject({
        error: {
          details: [
            { path: `group.${group.id}`, code: 'needs' },
            { path: 'elsewhere', code: '1' },
          ],
        },
      });
    });
  });

  // .claude/rules/api.md: two changes at one moment, each pair in both directions.
  describe('at the same moment', () => {
    it('refuses a create that waited for its class to be archived', async () => {
      const own = await schoolClass();
      const open = await holdOpen((transaction) =>
        writeClass(transaction, own, { archived_at: new Date('2026-10-10T23:00:00+05:00') }),
      );
      const response = post('/api/groups', body([own])).then((done) => done);
      await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBe(1);
      open.release();
      expect(await open.done).toBeUndefined();
      refusedWith(await response, 409, 'group_class_year');
    });

    it('refuses an archive of a class that waited for a create of its group', async () => {
      const own = await schoolClass();
      const open = await holdOpen(async (transaction) => {
        await writeGroup(transaction, [own]);
      });
      const response = post(`/api/classes/${own}/archive`).then((done) => done);
      await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBe(1);
      open.release();
      expect(await open.done).toBeUndefined();
      refusedWith(await response, 409, 'class_in_groups');
    });

    it('creates the group of the new grade of a class whose grade change it waited for', async () => {
      const own = await schoolClass();
      const open = await holdOpen((transaction) => writeClass(transaction, own, { grade: 8 }));
      const response = post('/api/groups', body([own], { subjectId: otherSubject })).then(
        (done) => done,
      );
      await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBe(1);
      open.release();
      expect(await open.done).toBeUndefined();
      // Grade 8 is taught in the subject; the group is created for the new grade.
      const created = detailOf(await response);
      expect(created.grades).toEqual([8]);
    });

    it('refuses a grade change of a class that waited for a create of its group', async () => {
      const own = await schoolClass();
      const before = (await get(`/api/classes/${own}`).expect(200)).body as {
        name: string;
        version: number;
      };
      const open = await holdOpen(async (transaction) => {
        await writeGroup(transaction, [own]);
      });
      const response = put(`/api/classes/${own}`, {
        grade: 8,
        name: before.name,
        language: 'uz',
        mainRoomId: null,
        maxSize: 25,
        version: before.version,
      }).then((done) => done);
      await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBe(1);
      open.release();
      expect(await open.done).toBeUndefined();
      refusedWith(await response, 409, 'class_grade_groups');
    });

    it('refuses a create in the old language that waited for a language change of its class', async () => {
      const own = await schoolClass({ language: 'uz' });
      const open = await holdOpen((transaction) =>
        writeClass(transaction, own, { language: 'ru' }),
      );
      const response = post('/api/groups', body([own], { language: 'uz' })).then((done) => done);
      await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBe(1);
      open.release();
      expect(await open.done).toBeUndefined();
      refusedWith(await response, 409, 'group_language');
    });

    // Correction 1: one lock order between a class row and its group rows.
    it('moves the group of a class language change that waited for a group edit', async () => {
      const own = await schoolClass({ language: 'uz' });
      const group = await create([own]);
      const read = (await get(`/api/classes/${own}`).expect(200)).body as {
        name: string;
        version: number;
      };
      const open = await holdOpen(async (transaction) => {
        await transaction
          .selectFrom('classes')
          .select('id')
          .where('id', '=', own)
          .forShare()
          .execute();
        await transaction
          .selectFrom('groups')
          .select('id')
          .where('id', '=', group.id)
          .forUpdate()
          .execute();
        await transaction
          .updateTable('groups')
          .set({ max_size: 25 })
          .where('id', '=', group.id)
          .execute();
      });
      const response = put(`/api/classes/${own}`, {
        grade: 7,
        name: read.name,
        language: 'ru',
        mainRoomId: null,
        maxSize: 25,
        version: read.version,
      }).then((done) => done);
      await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBe(1);
      open.release();
      expect(await open.done).toBeUndefined();
      expect((await response).status, JSON.stringify((await response).body)).toBe(200);
      expect(detailOf(await get(`/api/groups/${group.id}`))).toMatchObject({
        language: 'ru',
        maxSize: 25,
      });
    });

    it('refuses a group edit that waited for a class language change moving the group', async () => {
      const own = await schoolClass({ language: 'uz' });
      const group = await create([own]);
      const open = await holdOpen(async (transaction) => {
        await writeClass(transaction, own, { language: 'ru' });
        await transaction
          .updateTable('groups')
          .set({ language: 'ru' })
          .where('id', '=', group.id)
          .execute();
      });
      const response = put(`/api/groups/${group.id}`, editBody(group, { maxSize: 22 })).then(
        (done) => done,
      );
      await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBe(1);
      open.release();
      expect(await open.done).toBeUndefined();
      refusedWith(await response, 409, 'group_changed');
    });

    it('refuses a create that waited for its subject to lose the grade', async () => {
      const own = await schoolClass({ grade: 8 });
      const shrinking = await classes.subject({ grades: [7, 8] });
      const open = await holdOpen(async (transaction) => {
        await transaction
          .selectFrom('subjects')
          .select('id')
          .where('id', '=', shrinking)
          .forUpdate()
          .execute();
        await transaction
          .updateTable('subjects')
          .set({ grades: [7] })
          .where('id', '=', shrinking)
          .execute();
      });
      const response = post('/api/groups', body([own], { subjectId: shrinking })).then(
        (done) => done,
      );
      await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBe(1);
      open.release();
      expect(await open.done).toBeUndefined();
      refusedWith(await response, 409, 'group_subject_grade');
    });

    it('refuses a grade removal of a subject that waited for a create of its group', async () => {
      const own = await schoolClass({ grade: 8 });
      const shrinking = await classes.subject({ grades: [7, 8], journalType: 'attendance_only' });
      const open = await holdOpen(async (transaction) => {
        await transaction
          .selectFrom('classes')
          .select('id')
          .where('id', '=', own)
          .forShare()
          .execute();
        count += 1;
        const row = await transaction
          .insertInto('groups')
          .values({
            branch_id: t.north,
            academic_year_id: year,
            subject_id: shrinking,
            name: `Held ${String(count)}`,
            language: 'uz',
            max_size: 20,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        await transaction
          .insertInto('group_classes')
          .values({ group_id: row.id, class_id: own, branch_id: t.north })
          .execute();
      });
      const read = await t.database.migrator
        .selectFrom('subjects')
        .selectAll()
        .where('id', '=', shrinking)
        .executeTakeFirstOrThrow();
      const steam = await t.database.migrator
        .selectFrom('departments')
        .select('id')
        .where('name_en', '=', 'STEAM')
        .executeTakeFirstOrThrow();
      const response = put(
        `/api/setup/subjects/${shrinking}`,
        {
          names: { uz: read.name_uz, ru: read.name_ru, en: read.name_en },
          departmentId: steam.id,
          grades: [7],
          colour: 'blue',
          journalType: 'attendance_only',
          ratingExam: false,
          groupSubject: false,
          languageRule: true,
          demanding: false,
          daily: null,
        },
        t.admin,
      ).then((done) => done);
      // The subject edit locks the subject FOR UPDATE, which waits for the key
      // share lock the group's foreign key took.
      await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBe(1);
      open.release();
      expect(await open.done).toBeUndefined();
      refusedWith(await response, 409, 'subject_grade_groups');
    });

    it('refuses the second of two edits of one group made on one version, also of the classes only', async () => {
      const oxford = await schoolClass();
      const yale = await schoolClass();
      const group = await create([oxford]);
      const open = await holdOpen(async (transaction) => {
        await transaction
          .selectFrom('classes')
          .select('id')
          .where('id', 'in', [oxford, yale].sort())
          .orderBy('id')
          .forShare()
          .execute();
        await transaction
          .selectFrom('groups')
          .select('id')
          .where('id', '=', group.id)
          .forUpdate()
          .execute();
        await transaction
          .updateTable('groups')
          .set({ name: group.name })
          .where('id', '=', group.id)
          .execute();
        await transaction
          .insertInto('group_classes')
          .values({ group_id: group.id, class_id: yale, branch_id: t.north })
          .execute();
      });
      const response = put(`/api/groups/${group.id}`, editBody(group, { classIds: [yale] })).then(
        (done) => done,
      );
      await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBe(1);
      open.release();
      expect(await open.done).toBeUndefined();
      refusedWith(await response, 409, 'group_changed');
    });
  });
});
