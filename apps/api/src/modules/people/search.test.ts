import {
  relativeNameKey,
  relativeSearchSchema,
  SEARCH_QUERY_MAX_LENGTH,
  staffSearchSchema,
  studentNameKey,
  studentSearchSchema,
} from '@sodiq/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ClassesKit } from '../../testing/classes-kit.js';
import { dayTemplatesKit, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { MembersKit } from '../../testing/members-kit.js';
import { errorCode } from '../../testing/sign-in-kit.js';

// All names are invented. docs/spec/12-ux-standards.md, One pattern
// everywhere, Search: "Ctrl+K opens a search across students, staff, classes,
// groups and pages"; edge/people-roles-accounts, the Ctrl+K row: "Search
// returns only records the person may open. Search by phone or document
// number is for the Super Admin and Academic Vice Principal"; edge/journal:
// "Search ignores which apostrophe was typed and matches Cyrillic with Latin
// ... The paternal name is added ... The UID is always shown in pickers and
// search". Task 3.2d, pull request #94, with the corrections of its review.
// The clock stands at 23:55 on 10 October 2026 in Tashkent.
describe('Ctrl+K over students and staff', () => {
  let t: DayTemplatesKit;
  let classes: ClassesKit;
  let members: MembersKit;
  let oxford: string;
  let cambridge: string;
  /** The Tutor of 7 Oxford, and readers of the branch who are not class-scoped. */
  let tutor: string;
  let headTeacher: string;
  let headTutor: string;
  let spiritual: string;
  let own: string;
  let planned: string;
  let former: string;
  let other: string;
  let inactive: string;
  let notStarted: string;
  let southern: string;
  let ownUid: string;
  /** Staff of North: one with a paternal name, a phone and a JSHSHIR, one who left, one of both branches. */
  let karimov: { id: string; staffId: string };
  let leftPerson: string;
  let laterPerson: string;
  let inactivePerson: string;
  let bothBranches: string;
  let southPerson: string;
  let vacancy: string;

  const FROM = new Date('2026-09-01T00:00:00+05:00');

  async function signedIn(
    first: string,
    last: string,
    role: string,
  ): Promise<{ cookie: string; assignment: string }> {
    const browser = await t.kit.completeSession(first, last);
    if (role === 'tutor') {
      await classes.person(t.north, ['uz'], { accountId: browser.account.id, first, last });
    }
    const given = await t.kit.giveRole(browser.account.id, {
      role: role as never,
      branchId: t.north,
      ...(role === 'tutor' ? { validFrom: FROM } : {}),
    });
    return { cookie: browser.cookie, assignment: given.id };
  }

  /** A student of the branch with the names and identity fields given; the fold as the service stores it. */
  async function student(
    branch: string,
    names: { last: string; first: string; paternal?: string },
    input: { startsOn?: string; document?: string; jshshir?: string; phone?: string } = {},
  ): Promise<string> {
    const id = await members.student(
      branch,
      input.startsOn === undefined ? {} : { startsOn: input.startsOn },
    );
    await t.database.migrator
      .updateTable('students')
      .set({
        last_name: names.last,
        first_name: names.first,
        paternal_name: names.paternal ?? null,
        name_key: studentNameKey(names.last, names.first),
        document_type: input.document === undefined ? null : 'passport',
        document_number: input.document ?? null,
        jshshir: input.jshshir ?? null,
        phone: input.phone ?? null,
      })
      .where('id', '=', id)
      .execute();
    return id;
  }

  const inClass = (
    branch: string,
    classId: string,
    studentId: string,
    from = '2026-09-01',
    ownUntil?: string,
  ) =>
    members.member({
      branch,
      classId,
      studentId,
      from,
      ...(ownUntil === undefined ? {} : { ownUntil }),
    });

  /** A person of the branch with the fields given. */
  async function person(
    branch: string,
    first: string,
    last: string,
    input: { father?: string; jshshir?: string; phone?: string; further?: readonly string[] } = {},
  ): Promise<{ id: string; staffId: string }> {
    const made = await classes.person(branch, ['uz'], {
      first,
      last,
      ...(input.further === undefined ? {} : { further: input.further }),
    });
    const row = await t.database.migrator
      .updateTable('staff')
      .set({
        father_name: input.father ?? null,
        jshshir: input.jshshir ?? null,
        ...(input.phone === undefined ? {} : { phone: input.phone }),
      })
      .where('id', '=', made.staffId)
      .returning(['id', 'staff_id'])
      .executeTakeFirstOrThrow();
    return { id: row.id, staffId: row.staff_id ?? '' };
  }

  const searching = (kind: string, q: string, cookie: string, branch = t.north) =>
    t.get(`/api/search/${kind}?q=${encodeURIComponent(q)}`, branch, cookie);

  const students = async (q: string, cookie: string = t.admin, branch = t.north) => {
    const response = await searching('students', q, cookie, branch);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return studentSearchSchema.parse(response.body);
  };
  const studentIds = async (q: string, cookie: string = t.admin) =>
    (await students(q, cookie)).items.map((item) => item.id).sort();

  const staff = async (q: string, cookie: string = t.admin, branch = t.north) => {
    const response = await searching('staff', q, cookie, branch);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return staffSearchSchema.parse(response.body);
  };
  const staffIds = async (q: string, cookie: string = t.admin) =>
    (await staff(q, cookie)).items.map((item) => item.id).sort();

  const sorted = (...ids: string[]) => [...ids].sort();

  beforeAll(async () => {
    t = await dayTemplatesKit();
    classes = new ClassesKit(t.database.migrator);
    members = new MembersKit(t.database.migrator, await classes.account());
    const year = await classes.year(t.north);
    const southYear = await classes.year(t.south);
    oxford = await classes.schoolClass(t.north, year, { name: 'Oxford' });
    cambridge = await classes.schoolClass(t.north, year, { name: 'Cambridge' });
    const southClass = await classes.schoolClass(t.south, southYear, { name: 'Oxford' });

    const first = await signedIn('Gulnora', 'Tursunova', 'tutor');
    tutor = first.cookie;
    await classes.tutorRow(t.north, oxford, first.assignment, { from: FROM });
    headTeacher = (await signedIn('Sardor', 'Ergashev', 'head_teacher')).cookie;
    headTutor = (await signedIn('Zarina', 'Olimova', 'head_tutor')).cookie;
    spiritual = (await signedIn('Kamola', 'Saidova', 'spiritual_vice_principal')).cookie;

    own = await student(
      t.north,
      { last: 'Qodirova', first: 'Gʻulnora', paternal: 'Rustamovna' },
      { document: 'AB1234567', jshshir: '31234567890123', phone: '+998901234567' },
    );
    await inClass(t.north, oxford, own);
    // Planned for 7 Oxford from 20 October: of the class already (decision 7 of #90).
    planned = await student(t.north, { last: 'Qodirova', first: 'Nodira' });
    await inClass(t.north, cambridge, planned, '2026-09-01', '2026-10-20');
    await inClass(t.north, oxford, planned, '2026-10-20');
    former = await student(t.north, { last: 'Qodirova', first: 'Sevara' });
    await inClass(t.north, oxford, former, '2026-09-01', '2026-10-01');
    await inClass(t.north, cambridge, former, '2026-10-01');
    other = await student(t.north, { last: 'Qodirova', first: 'Zilola' });
    await inClass(t.north, cambridge, other);
    inactive = await student(t.north, { last: 'Qodirova', first: 'Iroda' });
    await members.leaving(t.database.migrator, t.north, inactive, '2026-10-05');
    notStarted = await student(
      t.north,
      { last: 'Qodirova', first: 'Lola' },
      { startsOn: '2026-10-20' },
    );
    southern = await student(t.south, { last: 'Qodirova', first: 'Gʻulnora' });
    await inClass(t.south, southClass, southern);
    ownUid = (
      await t.database.migrator
        .selectFrom('students')
        .select('uid')
        .where('id', '=', own)
        .executeTakeFirstOrThrow()
    ).uid;

    karimov = await person(t.north, 'Dilshod', 'Karimov', {
      father: 'Rustamovich',
      jshshir: '41234567890123',
      phone: '+998935554433',
    });
    leftPerson = (await person(t.north, 'Botir', 'Karimov')).id;
    await t.database.migrator
      .updateTable('staff_statuses')
      .set({ valid_until: '2026-10-01' })
      .where('staff_id', '=', leftPerson)
      .execute();
    await t.database.migrator
      .insertInto('staff_statuses')
      .values({ staff_id: leftPerson, status: 'left', valid_from: '2026-10-01' })
      .execute();
    bothBranches = (await person(t.south, 'Anvar', 'Karimov', { further: [t.north] })).id;
    // One who begins in November (no status in force: "not started") and one inactive.
    laterPerson = (await person(t.north, 'Elyor', 'Karimov')).id;
    // Its first row withdrawn (an empty range) and a new one from November.
    await t.database.migrator
      .updateTable('staff_statuses')
      .set({ valid_until: '2026-09-01' })
      .where('staff_id', '=', laterPerson)
      .execute();
    await t.database.migrator
      .insertInto('staff_statuses')
      .values({ staff_id: laterPerson, status: 'active', valid_from: '2026-11-01' })
      .execute();
    inactivePerson = (await person(t.north, 'Fozil', 'Karimov')).id;
    await t.database.migrator
      .updateTable('staff_statuses')
      .set({ valid_until: '2026-10-01' })
      .where('staff_id', '=', inactivePerson)
      .execute();
    await t.database.migrator
      .insertInto('staff_statuses')
      .values({ staff_id: inactivePerson, status: 'inactive', valid_from: '2026-10-01' })
      .execute();
    southPerson = (await person(t.south, 'Jamshid', 'Karimov')).id;
    vacancy = await t.database.migrator.transaction().execute(async (transaction) => {
      const row = await transaction
        .insertInto('staff')
        .values({ kind: 'vacancy', vacancy_name: 'Karimov vacancy' })
        .returning('id')
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto('staff_branches')
        .values({ staff_id: row.id, branch_id: t.north, is_main: true })
        .execute();
      const academic = await transaction
        .selectFrom('divisions')
        .select('id')
        .where('name_en', '=', 'Academic')
        .executeTakeFirstOrThrow();
      const steam = await transaction
        .selectFrom('departments')
        .select('id')
        .where('name_en', '=', 'STEAM')
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto('staff_divisions')
        .values({
          staff_id: row.id,
          division_id: academic.id,
          department_id: steam.id,
          is_main: true,
        })
        .execute();
      await transaction
        .insertInto('staff_languages')
        .values({ staff_id: row.id, language: 'uz' })
        .execute();
      await transaction
        .insertInto('staff_statuses')
        .values({ staff_id: row.id, status: 'open', valid_from: '2026-09-01' })
        .execute();
      return row.id;
    });
  });

  afterAll(async () => {
    await t.close();
  });

  describe('students (decision 1, Look first: only records the reader may open)', () => {
    it('lists for the Tutor the students of own class, in force and planned, and no other', async () => {
      // The student list shows the Tutor every student of the branch; the
      // record opens only own class's (decision 7 of #90), and so does Ctrl+K.
      expect(await studentIds('Qodirova', tutor)).toEqual(sorted(own, planned));
    });

    it('lists for the class-wide readers every student of the branch, of every status', async () => {
      const branch = sorted(own, planned, former, other, inactive, notStarted);
      for (const cookie of [
        headTeacher,
        headTutor,
        spiritual,
        t.principal,
        t.vicePrincipal,
        t.admin,
      ]) {
        expect(await studentIds('Qodirova', cookie)).toEqual(branch);
      }
    });

    it("never lists another branch's student of the same name", async () => {
      expect(await studentIds('Gʻulnora', t.admin)).toEqual([own]);
      expect((await students('Gʻulnora', t.admin, t.south)).items.map((item) => item.id)).toEqual([
        southern,
      ]);
    });

    it('shows the UID, the class today and the status today, through every status', async () => {
      const found = await students('Qodirova');
      const byId = new Map(found.items.map((item) => [item.id, item]));
      expect(byId.get(own)).toEqual({
        id: own,
        uid: ownUid,
        firstName: 'Gʻulnora',
        lastName: 'Qodirova',
        paternalName: 'Rustamovna',
        class: { grade: 7, name: 'Oxford' },
        status: 'active',
        startsOn: expect.any(String) as string,
      });
      // Issue #105, H13: the start date and today, so a later start reads "From <date>".
      expect(found.today).toBe('2026-10-10');
      expect(byId.get(notStarted)?.startsOn).toBe('2026-10-20');
      expect(byId.get(planned)?.class).toEqual({ grade: 7, name: 'Cambridge' });
      expect(byId.get(inactive)?.status).toBe('inactive');
      // Before the start date the first row, which is active, as the list shows it.
      expect(byId.get(notStarted)?.status).toBe('active');
      expect(byId.get(notStarted)?.class).toBeNull();
    });

    it('finds by every typed word, in either order, by the paternal name, in Cyrillic and with any apostrophe', async () => {
      for (const q of [
        'Qodirova Gʻulnora',
        'gulnora qodirova',
        "G'ulnora",
        'G`ulnora',
        'Қодирова Ғулнора',
        'Rustamovna',
      ]) {
        expect(await studentIds(q), q).toEqual([own]);
      }
      expect(await studentIds('Qodirova Rustam')).toEqual([own]);
      expect(await studentIds('Qodirova Bahodir')).toEqual([]);
    });

    it('finds by the UID and by its start from 3 digits', async () => {
      expect(await studentIds(ownUid, tutor)).toEqual([own]);
      expect(await studentIds(ownUid.slice(0, 3))).toContain(own);
      // Fewer than 3 digits look at no UID.
      expect(await studentIds(ownUid.slice(0, 2))).toEqual([]);
      // Not a part from the middle.
      expect(await studentIds(ownUid.slice(2))).not.toContain(own);
    });

    it('finds a UID of letters in any case and with spaces, whole or from 3 characters (task 9.4c)', async () => {
      /** A student of the branch whose UID is given letters, as a correction writes it. */
      const lettered = async (uid: string) => {
        const id = await student(t.north, { last: 'Yoqubova', first: 'Shoira' });
        await t.database.migrator.transaction().execute(async (transaction) => {
          await transaction
            .insertInto('student_uids')
            .values({
              uid,
              student_id: id,
              branch_id: t.north,
              held_from: new Date('2026-10-10T09:00:00+05:00'),
            })
            .execute();
          await transaction.updateTable('students').set({ uid }).where('id', '=', id).execute();
        });
        return id;
      };
      const si = await lettered('SI2607001');
      const short = await lettered('A1');
      const cyrillic = await lettered('ЎТ001');
      for (const q of ['SI2607001', 'si2607001', 'si 2607 001', 'si26', 'si 26', 'SI2']) {
        expect(await studentIds(q), q).toContain(si);
      }
      // A short UID is found when typed whole; 2 characters are no start.
      expect(await studentIds('a1')).toContain(short);
      expect(await studentIds('si')).not.toContain(si);
      expect(await studentIds('ўт0')).toContain(cyrillic);
      // Not a part from the middle.
      expect(await studentIds('2607001')).not.toContain(si);
      // Only for a reader of the record, in its branch (permission review).
      expect(await studentIds('si2607001', tutor)).toEqual([]);
      expect((await students('si2607001', t.admin, t.south)).items).toEqual([]);
    });

    it('orders by the stored fold of the name, then the id', async () => {
      const found = await students('Qodirova');
      expect(found.items.map((item) => item.firstName)).toEqual([
        'Gʻulnora',
        'Iroda',
        'Lola',
        'Nodira',
        'Sevara',
        'Zilola',
      ]);
      expect(found.more).toBe(false);
    });
  });

  describe('students by document, JSHSHIR and phone (decision 2, Look first)', () => {
    const IDENTITY = [
      'AB1234567',
      'ab-1234567',
      'AB 1234567',
      '31234567890123',
      '1234567',
      '+998 90 123 45 67',
      '9012',
    ];

    it('finds them for the Super Admin and the Academic Vice Principal', async () => {
      for (const cookie of [t.admin, t.vicePrincipal]) {
        for (const q of IDENTITY) {
          expect(await studentIds(q, cookie), q).toEqual([own]);
        }
      }
    });

    it('never compares them for the Principal, a Head Teacher, the Head Tutor or a Tutor', async () => {
      for (const cookie of [t.principal, headTeacher, headTutor, spiritual, tutor]) {
        for (const q of IDENTITY.filter((typed) => !ownUid.startsWith(typed))) {
          expect(await studentIds(q, cookie), q).toEqual([]);
        }
      }
    });

    it('finds a document number and a JSHSHIR only as a whole, and a phone from 4 digits', async () => {
      for (const q of ['AB12345', '3123456789012', '901']) {
        expect(await studentIds(q), q).toEqual([]);
      }
    });
  });

  describe('the limit, after the scope (decision 6)', () => {
    it('keeps a Tutor finding own students behind more than 9 others that sort first', async () => {
      for (let index = 0; index < 10; index += 1) {
        const id = await student(t.north, {
          last: 'Aaronova',
          first: `Shahzoda${'a'.repeat(index)}`,
        });
        await inClass(t.north, cambridge, id);
      }
      for (let index = 0; index < 9; index += 1) {
        const id = await student(t.north, {
          last: 'Zokirova',
          first: `Malika${'a'.repeat(index)}`,
        });
        await inClass(t.north, oxford, id);
      }
      // "ova" is in every surname: the vice principal's first 8 are the Aaronova ones.
      const vice = await students('ova', t.vicePrincipal);
      expect(vice.items.map((item) => item.lastName)).toEqual(Array<string>(8).fill('Aaronova'));
      expect(vice.more).toBe(true);
      const own8 = await students('ova', tutor);
      expect(own8.items.map((item) => item.lastName)).toEqual([
        'Qodirova',
        'Qodirova',
        ...Array<string>(6).fill('Zokirova'),
      ]);
      expect(own8.more).toBe(true);
      // Two of own match: no more.
      expect((await students('Qodirova', tutor)).more).toBe(false);
    });
  });

  describe('staff', () => {
    it('finds by the names in either order and the paternal name', async () => {
      for (const q of ['Dilshod Karimov', 'karimov dilshod', 'Rustamovich', 'Дилшод']) {
        expect(await staffIds(q), q).toEqual([karimov.id]);
      }
    });

    it('finds by the staff ID, with or without the dash, from its letter and 3 digits', async () => {
      const typed = [
        karimov.staffId,
        karimov.staffId.replace('-', '').toLowerCase(),
        karimov.staffId.slice(0, 5),
      ];
      for (const q of typed) {
        expect(await staffIds(q), q).toContain(karimov.id);
      }
      expect(await staffIds(karimov.staffId)).toEqual([karimov.id]);
      expect(await staffIds(karimov.staffId.slice(0, 4))).toEqual([]);
    });

    it('lists the people linked to the branch, of every status with the status, and never a vacancy', async () => {
      const found = await staff('Karimov');
      expect(found.items.map((item) => item.id).sort()).toEqual(
        sorted(karimov.id, leftPerson, bothBranches, laterPerson, inactivePerson),
      );
      expect(found.items.map((item) => item.id)).not.toContain(vacancy);
      expect(found.items.map((item) => item.id)).not.toContain(southPerson);
      const byId = new Map(found.items.map((item) => [item.id, item]));
      expect(byId.get(leftPerson)?.status).toBe('left');
      expect(byId.get(inactivePerson)?.status).toBe('inactive');
      // No status in force yet: "not started", as the staff list shows it.
      expect(byId.get(laterPerson)?.status).toBeNull();
      expect(byId.get(karimov.id)).toEqual({
        id: karimov.id,
        staffId: karimov.staffId,
        firstName: 'Dilshod',
        lastName: 'Karimov',
        status: 'active',
      });
      // Ordered by surname, then first name.
      expect(found.items.map((item) => item.firstName)).toEqual([
        'Anvar',
        'Botir',
        'Dilshod',
        'Elyor',
        'Fozil',
      ]);
      expect(
        (await staff('Karimov', t.admin, t.south)).items.map((item) => item.id).sort(),
      ).toEqual(sorted(bothBranches, southPerson));
    });

    it('finds by the phone and the JSHSHIR for the Academic Vice Principal and the Super Admin only', async () => {
      for (const q of ['41234567890123', '935554433', '+998 93 555']) {
        expect(await staffIds(q, t.vicePrincipal), q).toEqual([karimov.id]);
        expect(await staffIds(q, t.admin), q).toEqual([karimov.id]);
        // The Principal views staff and searches names and staff IDs only.
        expect(await staffIds(q, t.principal), q).toEqual([]);
      }
      expect(await staffIds('4123456789012', t.vicePrincipal)).toEqual([]);
    });

    it('is refused to a Tutor, who does not view staff', async () => {
      const response = await searching('staff', 'Karimov', tutor);
      expect(response.status).toBe(403);
      expect(errorCode(response)).toBe('permission_denied');
    });
  });

  // The permission review of the build: the identity search is decided by
  // the Academic Vice Principal of the branch of the request (`viceOf`), so
  // one of another branch who reads this one in another role never has it.
  describe('the identity search across branches', () => {
    it('is not given by an Academic Vice Principal of another branch', async () => {
      const browser = await t.kit.completeSession('Ulugbek', 'Hamidov');
      await t.kit.giveRole(browser.account.id, {
        role: 'academic_vice_principal',
        branchId: t.south,
      });
      await t.kit.giveRole(browser.account.id, { role: 'principal', branchId: t.north });
      // The name finds the student: the account reads North.
      expect(await studentIds('Rustamovna', browser.cookie)).toEqual([own]);
      for (const q of ['AB1234567', '31234567890123', '901234567']) {
        expect(await studentIds(q, browser.cookie), q).toEqual([]);
      }
      for (const q of ['41234567890123', '935554433']) {
        expect(await staffIds(q, browser.cookie), q).toEqual([]);
      }
    });

    it('lists for the Senior Head Teacher the students of the branch of the request only', async () => {
      const browser = await t.kit.completeSession('Nodira', 'Usmonova');
      await t.kit.giveRole(browser.account.id, { role: 'senior_head_teacher' });
      expect(await studentIds('Gʻulnora', browser.cookie)).toEqual([own]);
      expect(
        (await students('Gʻulnora', browser.cookie, t.south)).items.map((item) => item.id),
      ).toEqual([southern]);
    });
  });

  // Task 3.5b, H33 of issue #105; edge/people-roles-accounts, the Ctrl+K row:
  // "Relatives' phones are searched too, for the Super Admin, the Principal
  // and the Academic Vice Principal, and a relative found by phone lists the
  // relative's children"; the owner's answer L157 on issue #42.
  describe("relatives and the children found by a relative's phone (H33)", () => {
    let father: string;
    let elsewhere: string;

    /** A relative with the links given, written in one transaction (a relative needs a link). */
    async function relative(fullName: string, phone: string, links: [string, string][]) {
      return t.database.migrator.transaction().execute(async (transaction) => {
        const row = await transaction
          .insertInto('relatives')
          .values({ full_name: fullName, name_key: relativeNameKey(fullName), phone })
          .returning('id')
          .executeTakeFirstOrThrow();
        await transaction
          .insertInto('relative_accounts')
          .values({ relative_id: row.id, created_at: new Date('2026-09-01T08:00:00Z') })
          .execute();
        for (const [studentId, branchId] of links) {
          await transaction
            .insertInto('student_relatives')
            .values({
              student_id: studentId,
              branch_id: branchId,
              relative_id: row.id,
              relationship: 'father',
              main_contact: false,
              linked_at: new Date('2026-09-01T08:00:00Z'),
            })
            .execute();
        }
        return row.id;
      });
    }

    const relatives = async (q: string, cookie: string) => {
      const response = await searching('relatives', q, cookie);
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      return relativeSearchSchema.parse(response.body);
    };

    beforeAll(async () => {
      father = await relative('Qodirov Rustam', '+998977771122', [
        [own, t.north],
        [southern, t.south],
      ]);
      elsewhere = await relative('Halimova Sabina', '+998977773344', [[southern, t.south]]);
    });

    it('finds the relatives of the branch by name and by main phone for their readers', async () => {
      for (const cookie of [t.admin, t.principal, t.vicePrincipal]) {
        for (const q of ['Qodirov Rustam', '977771122', '+998 97 777']) {
          const found = await relatives(q, cookie);
          expect(found.items, q).toEqual([
            { id: father, fullName: 'Qodirov Rustam', phone: '+998977771122', students: 1 },
          ]);
        }
        // Linked to a student of another branch only: not found here.
        expect((await relatives('Halimova', cookie)).items).toEqual([]);
        expect((await relatives('977773344', cookie)).items).toEqual([]);
      }
      expect(elsewhere).not.toBe(father);
    });

    it('is refused to every other role of the branch', async () => {
      for (const cookie of [tutor, headTeacher, headTutor, spiritual, t.teacher]) {
        const response = await searching('relatives', 'Qodirov', cookie);
        expect(response.status).toBe(403);
        expect(errorCode(response)).toBe('permission_denied');
      }
    });

    it("finds the child by the relative's phone for the readers of relatives, naming the relative", async () => {
      for (const cookie of [t.admin, t.principal, t.vicePrincipal]) {
        const found = await students('977771122', cookie);
        expect(found.items.map((item) => [item.id, item.relative])).toEqual([
          [own, 'Qodirov Rustam'],
        ]);
      }
      // Found by the name, no relative is named.
      expect(
        (await students('Rustamovna')).items.find((item) => item.id === own)?.relative,
      ).toBeUndefined();
    });

    it("never finds the child by the relative's phone for another reader of students", async () => {
      const senior = await t.kit.completeSession('Nodira', 'Rahimova');
      await t.kit.giveRole(senior.account.id, { role: 'senior_head_teacher' });
      for (const cookie of [tutor, headTeacher, headTutor, spiritual, senior.cookie]) {
        expect(await studentIds('977771122', cookie)).toEqual([]);
      }
      // Task 3.6a: a Teacher searches students, and never by a relative's phone.
      expect(await studentIds('977771122', t.teacher)).toEqual([]);
    });

    it('never finds the child by the phone for a Principal of another branch who is a Tutor here', async () => {
      const browser = await t.kit.completeSession('Jasur', 'Karimov');
      await classes.person(t.north, ['uz'], {
        accountId: browser.account.id,
        first: 'Jasur',
        last: 'Karimov',
      });
      const given = await t.kit.giveRole(browser.account.id, {
        role: 'tutor',
        branchId: t.north,
        validFrom: FROM,
      });
      await classes.tutorRow(t.north, cambridge, given.id, { from: FROM });
      await t.kit.giveRole(browser.account.id, { role: 'principal', branchId: t.south });
      await relative('Ergashev Bobur', '+998977775566', [[other, t.north]]);
      // The Tutor finds own student by name in North, not by the parent's phone.
      expect(await studentIds('Zilola', browser.cookie)).toEqual([other]);
      expect(await studentIds('977775566', browser.cookie)).toEqual([]);
      // The Principal of North does.
      expect(await studentIds('977775566', t.principal)).toEqual([other]);
      expect((await searching('relatives', 'Qodirov', browser.cookie)).status).toBe(403);
    });
  });

  describe('every search route', () => {
    it('refuses an empty text, one of spaces, a missing one and one that is too long', async () => {
      for (const kind of ['students', 'staff']) {
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
      await students('Qodirova');
      await staff('Karimov');
      await students('AB1234567', t.vicePrincipal);
      expect(await t.auditCount()).toBe(before);
    });

    // Task 3.6a (L48): a Teacher searches the students taught, here none
    // (no published load); the staff search stays refused.
    it('finds no student for a Teacher with no load, and refuses the staff search', async () => {
      expect((await students('Qodirova', t.teacher)).items).toEqual([]);
      const response = await searching('staff', 'Qodirova', t.teacher);
      expect(response.status).toBe(403);
      expect(errorCode(response)).toBe('permission_denied');
    });
  });
});
