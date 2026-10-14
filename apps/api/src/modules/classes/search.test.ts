import { classSearchSchema, groupSearchSchema, SEARCH_QUERY_MAX_LENGTH } from '@sodiq/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ClassesKit } from '../../testing/classes-kit.js';
import { dayTemplatesKit, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { errorCode } from '../../testing/sign-in-kit.js';

// All names are invented. docs/spec/12-ux-standards.md, One pattern
// everywhere, Search: "Ctrl+K opens a search across students, staff, classes,
// groups and pages"; `02`, Tutor: "Own class or classes"; Head Teacher: "For
// own subjects in own branch: ... groups"; edge/people-roles-accounts, the
// Ctrl+K row: "Search returns only records the person may open"; edge/journal:
// "Search ignores which apostrophe was typed"; edge/students-classes-groups,
// "The Tutor of a class changes in January". Task 3.2d, pull request #94
// ("Done when: a Tutor finds own class and its groups and no other, with
// allow and refuse tests"). The clock stands at 23:55 on 10 October 2026 in
// Tashkent.
describe('Ctrl+K over classes and groups', () => {
  let t: DayTemplatesKit;
  let classes: ClassesKit;
  let year: string;
  let oxford: string;
  let cambridge: string;
  let galaba: string;
  let physics: string;
  let chemistry: string;
  /** Physics from 7 Oxford, Physics from 7 Oxford and 7 Cambridge, Physics from 7 Cambridge. */
  let oxfordGroup: string;
  let sharedGroup: string;
  let cambridgeGroup: string;
  let chemistryGroup: string;
  let southGroup: string;
  let southClass: string;
  let oxfordTutor: string;
  let cambridgeTutor: string;
  let noClassTutor: string;
  let plannedTutor: string;
  let endedTutor: string;
  let headTeacher: string;
  let seniorHeadTeacher: string;

  const FROM = new Date('2026-09-01T00:00:00+05:00');

  /** A signed-in account with a role in North, school-wide for the Senior Head Teacher. */
  async function signedIn(
    first: string,
    last: string,
    role: string,
    subjectIds?: readonly string[],
  ): Promise<{ cookie: string; assignment: string }> {
    const browser = await t.kit.completeSession(first, last);
    if (role === 'tutor') {
      await classes.person(t.north, ['uz'], { accountId: browser.account.id, first, last });
    }
    const given = await t.kit.giveRole(browser.account.id, {
      role: role as never,
      ...(role === 'senior_head_teacher' ? {} : { branchId: t.north }),
      ...(role === 'tutor' ? { validFrom: FROM } : {}),
      ...(subjectIds === undefined ? {} : { subjectIds }),
    });
    return { cookie: browser.cookie, assignment: given.id };
  }

  /** A Tutor of North with one Tutor row on a class. */
  async function tutorOf(
    first: string,
    last: string,
    classId: string | null,
    row: { from?: Date; until?: Date } = {},
  ): Promise<string> {
    const given = await signedIn(first, last, 'tutor');
    if (classId !== null) {
      await classes.tutorRow(t.north, classId, given.assignment, {
        from: row.from ?? FROM,
        ...(row.until === undefined ? {} : { until: row.until }),
      });
    }
    return given.cookie;
  }

  const searching = (kind: string, q: string, cookie: string, branch = t.north) =>
    t.get(`/api/search/${kind}?q=${encodeURIComponent(q)}`, branch, cookie);

  const classesFound = async (q: string, cookie: string = t.admin, branch = t.north) => {
    const response = await searching('classes', q, cookie, branch);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return classSearchSchema.parse(response.body);
  };
  const classIds = async (q: string, cookie: string = t.admin) =>
    (await classesFound(q, cookie)).items.map((item) => item.id);

  const groupsFound = async (q: string, cookie: string = t.admin, branch = t.north) => {
    const response = await searching('groups', q, cookie, branch);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return groupSearchSchema.parse(response.body);
  };
  const groupIds = async (q: string, cookie: string = t.admin) =>
    (await groupsFound(q, cookie)).items.map((item) => item.id).sort();

  const sorted = (...ids: string[]) => [...ids].sort();

  /** A subject with its names in the three languages. */
  async function subject(uz: string, ru: string, en: string): Promise<string> {
    const id = await classes.subject({ grades: [7, 8] });
    await t.database.migrator
      .updateTable('subjects')
      .set({ name_uz: uz, name_ru: ru, name_en: en })
      .where('id', '=', id)
      .execute();
    return id;
  }

  beforeAll(async () => {
    t = await dayTemplatesKit();
    classes = new ClassesKit(t.database.migrator);
    // A closed year with a class and a group of the same names, before the current one.
    const past = await classes.year(t.north, 'current', '2025-09-01', '2026-05-31');
    physics = await subject('Fizika', 'Физика', 'Physics');
    chemistry = await subject('Kimyo', 'Химия', 'Chemistry');
    const pastOxford = await classes.schoolClass(t.north, past, { name: 'Oxford' });
    await classes.group(t.north, past, physics, [pastOxford], { name: 'Oxford Physics' });
    await classes.setYear(past, 'closed');
    year = await classes.year(t.north);
    const southYear = await classes.year(t.south);

    oxford = await classes.schoolClass(t.north, year, { name: 'Oxford' });
    cambridge = await classes.schoolClass(t.north, year, { name: 'Cambridge' });
    galaba = await classes.schoolClass(t.north, year, { name: 'Gʻalaba', grade: 8 });
    const archived = await classes.schoolClass(t.north, year, { name: 'Oxford Old' });
    southClass = await classes.schoolClass(t.south, southYear, { name: 'Oxford' });

    oxfordGroup = await classes.group(t.north, year, physics, [oxford], { name: 'Oxford Physics' });
    sharedGroup = await classes.group(t.north, year, physics, [oxford, cambridge], {
      name: 'Physics Seven',
    });
    cambridgeGroup = await classes.group(t.north, year, physics, [cambridge], {
      name: 'Cambridge Physics',
    });
    chemistryGroup = await classes.group(t.north, year, chemistry, [oxford], {
      name: 'Oxford Chemistry',
    });
    const archivedGroup = await classes.group(t.north, year, physics, [oxford], {
      name: 'Oxford Physics Old',
    });
    southGroup = await classes.group(t.south, southYear, physics, [southClass], {
      name: 'Oxford Physics',
    });
    await t.database.migrator
      .updateTable('groups')
      .set({ archived_at: new Date('2026-10-01T09:00:00+05:00') })
      .where('id', '=', archivedGroup)
      .execute();
    await t.database.migrator
      .updateTable('classes')
      .set({ archived_at: new Date('2026-10-01T09:00:00+05:00') })
      .where('id', '=', archived)
      .execute();

    // One Tutor of 7 Oxford at a time (`class_tutors_one_tutor`): one who
    // ended on 5 October, the one in force today until 20 October, and the
    // one who begins then.
    const changeOver = new Date('2026-10-05T00:00:00+05:00');
    const handOver = new Date('2026-10-20T00:00:00+05:00');
    endedTutor = await tutorOf('Bobur', 'Nazarov', oxford, { until: changeOver });
    oxfordTutor = await tutorOf('Gulnora', 'Tursunova', oxford, {
      from: changeOver,
      until: handOver,
    });
    plannedTutor = await tutorOf('Jasur', 'Qodirov', oxford, { from: handOver });
    cambridgeTutor = await tutorOf('Zarina', 'Olimova', cambridge);
    noClassTutor = await tutorOf('Kamola', 'Saidova', null);
    headTeacher = (await signedIn('Sardor', 'Ergashev', 'head_teacher', [physics])).cookie;
    seniorHeadTeacher = (await signedIn('Nodira', 'Usmonova', 'senior_head_teacher', [physics]))
      .cookie;
  });

  afterAll(async () => {
    await t.close();
  });

  describe('a Tutor (Done when)', () => {
    it('finds own class and no other, by name and by a Cyrillic look-alike spelling', async () => {
      // "7 Оxford" with a Cyrillic О, "7 Сambridge" with a Cyrillic С.
      for (const q of ['Oxford', '7 Oxford', '7 Оxford', 'oxf', '7']) {
        expect(await classIds(q, oxfordTutor), q).toEqual([oxford]);
      }
      expect(await classIds('Cambridge', oxfordTutor)).toEqual([]);
      expect(await classIds('7 Сambridge', cambridgeTutor)).toEqual([cambridge]);
      expect(await classIds('7 Сambridge', oxfordTutor)).toEqual([]);
    });

    it('finds the groups drawing from own class, and not one drawing from another class only', async () => {
      expect(await groupIds('Physics', oxfordTutor)).toEqual(sorted(oxfordGroup, sharedGroup));
      expect(await groupIds('Physics', cambridgeTutor)).toEqual(
        sorted(sharedGroup, cambridgeGroup),
      );
      // A group of another subject drawing from own class is a group of own class.
      expect(await groupIds('Chemistry', oxfordTutor)).toEqual([chemistryGroup]);
      expect(await groupIds('Cambridge', oxfordTutor)).toEqual([]);
      // By a Cyrillic look-alike spelling of the group's name.
      expect(await groupIds('Оxford Physics', oxfordTutor)).toEqual([oxfordGroup]);
    });

    it('finds nothing without a class, and nothing by a row not yet begun or already ended', async () => {
      for (const cookie of [noClassTutor, plannedTutor, endedTutor]) {
        expect(await classIds('7', cookie)).toEqual([]);
        expect(await groupIds('Physics', cookie)).toEqual([]);
      }
    });

    it("never finds another branch's class or group of the same name", async () => {
      expect(await classIds('Oxford', oxfordTutor)).toEqual([oxford]);
      expect(await groupIds('Oxford Physics', oxfordTutor)).toEqual([oxfordGroup]);
      expect((await classesFound('Oxford', t.admin, t.south)).items.map((item) => item.id)).toEqual(
        [southClass],
      );
      expect(
        (await groupsFound('Oxford Physics', t.admin, t.south)).items.map((item) => item.id),
      ).toEqual([southGroup]);
    });
  });

  describe('the readers of the branch', () => {
    it('find every class of the branch, not archived and of a year that is not closed', async () => {
      for (const cookie of [t.admin, t.principal, t.vicePrincipal, headTeacher]) {
        expect(await classIds('7', cookie)).toEqual([cambridge, oxford]);
      }
      const found = await classesFound('Oxford');
      expect(found.items).toEqual([
        { id: oxford, grade: 7, name: 'Oxford', yearName: '2026–2027' },
      ]);
    });

    it('find a group not archived, of a year that is not closed, with the subject in three languages', async () => {
      const found = await groupsFound('Oxford Physics');
      expect(found.items).toEqual([
        {
          id: oxfordGroup,
          name: 'Oxford Physics',
          subject: { uz: 'Fizika', ru: 'Физика', en: 'Physics' },
          yearName: '2026–2027',
        },
      ]);
    });

    it("find a group by its subject's name in any language", async () => {
      const physicsGroups = sorted(oxfordGroup, sharedGroup, cambridgeGroup);
      for (const q of ['Физика', 'fizika', 'Physics']) {
        expect(await groupIds(q), q).toEqual(physicsGroups);
      }
    });

    it('a Head Teacher and the Senior Head Teacher find the groups of own subjects only', async () => {
      const physicsGroups = sorted(oxfordGroup, sharedGroup, cambridgeGroup);
      for (const cookie of [headTeacher, seniorHeadTeacher]) {
        expect(await groupIds('Oxford', cookie)).toEqual([oxfordGroup]);
        expect(await groupIds('Physics', cookie)).toEqual(physicsGroups);
        expect(await groupIds('Chemistry', cookie)).toEqual([]);
      }
    });

    it('find a name stored with ʻ by the keyboard apostrophe', async () => {
      for (const q of ["8 G'alaba", 'Gʼalaba', 'galaba']) {
        expect(await classIds(q), q).toEqual([galaba]);
      }
    });
  });

  describe('the limit, after the scope (decision 6)', () => {
    it('lists at most 8, says more, and keeps a Tutor finding own groups behind others that sort first', async () => {
      for (let index = 0; index < 10; index += 1) {
        await classes.group(t.north, year, physics, [cambridge], {
          name: `Alpha Omega ${String(index).padStart(2, '0')}`,
        });
      }
      await classes.group(t.north, year, physics, [oxford], { name: 'Omega A' });
      const all = await groupsFound('Omega');
      expect(all.items.map((item) => item.name)).toEqual(
        Array.from({ length: 8 }, (_, index) => `Alpha Omega ${String(index).padStart(2, '0')}`),
      );
      expect(all.more).toBe(true);
      const own = await groupsFound('Omega', oxfordTutor);
      expect(own.items.map((item) => item.name)).toEqual(['Omega A']);
      expect(own.more).toBe(false);
    });

    it('orders classes by grade, then name, and cuts them at 8 with more', async () => {
      for (const name of [
        'Lima',
        'Delta',
        'Echo',
        'Foxtrot',
        'Golf',
        'Hotel',
        'India',
        'Juliett',
      ]) {
        await classes.schoolClass(t.north, year, { name, grade: 9 });
      }
      const named = (found: { items: { grade: number; name: string }[] }) =>
        found.items.map((item) => `${String(item.grade)} ${item.name}`);
      // "a" is in Cambridge, Gʻalaba, Delta, India and Lima.
      expect(named(await classesFound('a'))).toEqual([
        '7 Cambridge',
        '8 Gʻalaba',
        '9 Delta',
        '9 India',
        '9 Lima',
      ]);
      const eight = await classesFound('9');
      expect(eight.items).toHaveLength(8);
      expect(eight.more).toBe(false);
      await classes.schoolClass(t.north, year, { name: 'Kilo', grade: 9 });
      const nine = await classesFound('9');
      expect(named(nine)).toEqual([
        '9 Delta',
        '9 Echo',
        '9 Foxtrot',
        '9 Golf',
        '9 Hotel',
        '9 India',
        '9 Juliett',
        '9 Kilo',
      ]);
      expect(nine.more).toBe(true);
    });
  });

  describe('every search route', () => {
    it('refuses an empty text, one of spaces, a missing one and one that is too long', async () => {
      for (const kind of ['classes', 'groups']) {
        for (const query of [
          '?q=',
          '?q=%20%20',
          '',
          `?q=${'a'.repeat(SEARCH_QUERY_MAX_LENGTH + 1)}`,
        ]) {
          const response = await t.get(`/api/search/${kind}${query}`, t.north);
          expect(response.status, `${kind}${query}`).toBe(400);
          expect(errorCode(response)).toBe('validation_failed');
        }
      }
    });

    it('writes no audit entry (decision 8)', async () => {
      const before = await t.auditCount();
      await classesFound('Oxford', oxfordTutor);
      await groupsFound('Physics', headTeacher);
      expect(await t.auditCount()).toBe(before);
    });

    it('is refused to a Teacher', async () => {
      for (const kind of ['classes', 'groups']) {
        const response = await searching(kind, 'Oxford', t.teacher);
        expect(response.status).toBe(403);
        expect(errorCode(response)).toBe('permission_denied');
      }
    });
  });
});
