import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Database } from '../../database/database.js';
import type { FixedClock } from '../fixed-clock.js';
import { groupMemberValues } from '../members-kit.js';
import { confirmSteps, placeDraft, type BranchOfRun, type RunKit } from '../real-size.js';
import {
  BRANCHES,
  curriculumOf,
  DAY_OFF,
  LESSONS_PER_TEACHER,
  personName,
  QUARTERS,
  seededRandom,
  STUDENTS_PER_CLASS,
  SUBJECTS,
  TIMETABLE_START,
  YEAR,
  type Department,
  type Sex,
} from './data.js';
import { SignIns, type DemoAccount, type RoleToGive } from './people.js';

/** One line of the seed's report. */
export type Say = (line: string) => void;

export interface DemoClass {
  readonly id: string;
  readonly grade: number;
  readonly name: string;
  readonly students: readonly { id: string; sex: Sex }[];
  /** The staff id of the class's Tutor. */
  tutorStaffId: string | null;
}

export interface DemoTeacher {
  readonly staffId: string;
  readonly account: DemoAccount;
  readonly subjects: string[];
}

export interface DemoBranchBuilt {
  readonly id: string;
  readonly name: string;
  readonly yearId: string;
  readonly quarterIds: readonly string[];
  readonly versionId: string;
  readonly classes: DemoClass[];
  /** Teachers by staff id: whoever teaches a row of the branch. */
  readonly teachers: Map<string, DemoTeacher>;
  readonly vice: DemoAccount;
  readonly principal: DemoAccount;
  readonly others: { role: string; account: DemoAccount }[];
}

export interface DemoSchool {
  readonly superAdmin: DemoAccount;
  readonly seniorHeadTeacher: DemoAccount;
  readonly branches: DemoBranchBuilt[];
  readonly subjects: Map<string, string>;
  /** Every staff id with an account, and its account. */
  readonly accounts: Map<string, DemoAccount>;
}

interface Built {
  id: string;
}

const PHONE_BASE = 990_000_000;

/**
 * The school of the demo, set up in the week before the year (the clock at
 * `SETUP_MOMENT`): the branches, the year and its quarters, buildings and
 * rooms, the bell times, the day off, subjects and weights, the staff with
 * their accounts and roles, the classes and their Tutors, the students with a
 * parent each, groups, the teaching load and a published timetable.
 */
export async function buildDemoSchool(input: {
  app: NestExpressApplication;
  migrator: Database;
  clock: FixedClock;
  password: string;
  say: Say;
}): Promise<DemoSchool> {
  const { app, migrator, clock, say } = input;
  const random = seededRandom(20260902);
  const signIns = new SignIns(app, clock, input.password);
  let phones = 0;
  const phone = () => {
    phones += 1;
    return `+998${String(PHONE_BASE + phones * 7)}`;
  };
  let uids = 0;
  const accounts = new Map<string, DemoAccount>();

  const superAdmin = await signIns.superAdmin('Sardor', 'Mirzayev');
  const admin = superAdmin.caller;
  say(`Super Admin ${superAdmin.login}`);

  // School-wide: the departments of the Academic division (0015) and the subjects.
  const departments = await migrator
    .selectFrom('departments')
    .innerJoin('divisions', 'divisions.id', 'departments.division_id')
    .select(['departments.id', 'departments.name_en', 'divisions.name_en as division'])
    .execute();
  const departmentId = (name: string, division = 'Academic') => {
    const found = departments.find((one) => one.name_en === name && one.division === division);
    if (found === undefined) throw new Error(`No department ${name}.`);
    return found.id;
  };
  const academic = (
    await migrator
      .selectFrom('divisions')
      .select('id')
      .where('name_en', '=', 'Academic')
      .executeTakeFirstOrThrow()
  ).id;

  // The branches, each with its year, quarters, rooms and bell times.
  const made: {
    id: string;
    yearId: string;
    quarterIds: string[];
    rooms: { id: string; type: string }[];
  }[] = [];
  for (const branch of BRANCHES) {
    const created = await admin.post<Built>('/api/setup/branches', {
      name: branch.name,
      address: branch.address,
      phone: '',
      email: '',
      workingWeekdays: [1, 2, 3, 4, 5],
    });
    const there = admin.in(created.id);
    const year = await there.post<Built>('/api/setup/academic-years', YEAR);
    await there.put(`/api/setup/academic-years/${year.id}/quarters`, {
      quarters: QUARTERS.map((one) => ({ startDate: one.startDate, endDate: one.endDate })),
    });
    // "Start year": the year is current from now (`edge/academic-year`, "In August…").
    await there.post(`/api/setup/academic-years/${year.id}/start`);
    const quarterIds = (
      await migrator
        .selectFrom('quarters')
        .select('id')
        .where('academic_year_id', '=', year.id)
        .orderBy('number')
        .execute()
    ).map((one) => one.id);

    const building = await there.post<Built>('/api/setup/buildings', { name: 'Main building' });
    const floors = [];
    for (const name of ['1', '2']) {
      floors.push(await there.post<Built>(`/api/setup/buildings/${building.id}/floors`, { name }));
    }
    const roomRows: { name: string; type: string; floor: number; capacity: number }[] = [
      ...Array.from({ length: branch.classes.length + 3 }, (_, index) => ({
        name: String(101 + index + (index >= 5 ? 95 : 0)),
        type: 'classroom',
        floor: index >= 5 ? 1 : 0,
        capacity: 26,
      })),
      { name: 'Chemistry lab', type: 'laboratory', floor: 1, capacity: 24 },
      { name: 'Biology lab', type: 'laboratory', floor: 1, capacity: 24 },
      { name: 'Sports hall', type: 'sports_hall', floor: 0, capacity: 60 },
      { name: 'Small gym', type: 'sports_hall', floor: 0, capacity: 30 },
      { name: 'Workshop 1', type: 'other', floor: 0, capacity: 20 },
      { name: 'Workshop 2', type: 'other', floor: 0, capacity: 20 },
      { name: 'Assembly hall', type: 'hall', floor: 0, capacity: 200 },
    ];
    const rooms: { id: string; type: string }[] = [];
    for (const room of roomRows) {
      const saved = await there.post<Built>('/api/setup/rooms', {
        name: room.name,
        floorId: floors[room.floor]?.id,
        type: room.type,
        capacity: room.capacity,
        status: 'in_use',
        shared: false,
        maxSimultaneousLessons: null,
      });
      rooms.push({ id: saved.id, type: room.type });
    }
    made.push({ id: created.id, yearId: year.id, quarterIds, rooms });
    say(`Branch ${branch.name}: year, quarters, ${String(rooms.length)} rooms`);
  }
  const branchIds = made.map((one) => one.id);
  const firstBranch = branchIds[0] ?? '';

  // Subjects, school-wide, with the daily weights of the first branch; then
  // the weights of every branch and quarter, as the publish needs them.
  const subjects = new Map<string, string>();
  for (const subject of SUBJECTS) {
    const saved = await admin.in(firstBranch).post<Built>('/api/setup/subjects', {
      names: { uz: subject.uz, ru: subject.ru, en: subject.en },
      departmentId: departmentId(subject.department),
      grades: subject.grades,
      colour: subject.colour,
      journalType: 'graded',
      ratingExam: false,
      groupSubject: subject.en === 'English',
      languageRule: true,
      demanding: subject.en === 'Mathematics' || subject.en === 'Physics',
      daily: { attendance: 20, classwork: 40, homework: 40 },
    });
    subjects.set(subject.en, saved.id);
  }
  const subjectId = (name: string) => {
    const id = subjects.get(name);
    if (id === undefined) throw new Error(`No subject ${name}.`);
    return id;
  };
  for (const [index, branch] of made.entries()) {
    const there = admin.in(branch.id);
    for (const id of subjects.values()) {
      if (index > 0) {
        await there.put(`/api/setup/subjects/${id}/daily-weights`, {
          attendance: 20,
          classwork: 40,
          homework: 40,
        });
      }
      for (const quarter of branch.quarterIds) {
        await there.put(`/api/setup/subjects/${id}/quarter-weights/${quarter}`, {
          attendance: 20,
          classwork: 40,
          homework: 40,
          ratingExam: null,
        });
      }
    }
  }
  say(`${String(subjects.size)} subjects with their weights`);

  // Bell times: seven lessons of 45 minutes from 08:30, and the day off.
  for (const branch of made) {
    const there = admin.in(branch.id);
    const lesson = await there.post<Built>('/api/setup/slot-types', {
      name: 'Lesson',
      kind: 'lesson',
      lengthMinutes: 45,
    });
    const short = await there.post<Built>('/api/setup/slot-types', {
      name: 'Break',
      kind: 'break',
      lengthMinutes: 10,
    });
    const long = await there.post<Built>('/api/setup/slot-types', {
      name: 'Lunch break',
      kind: 'break',
      lengthMinutes: 30,
    });
    const template = await there.post<Built>('/api/setup/day-templates', {
      name: 'Regular day',
      startTime: '08:30',
      slotTypeIds: [
        lesson.id,
        short.id,
        lesson.id,
        short.id,
        lesson.id,
        long.id,
        lesson.id,
        short.id,
        lesson.id,
        short.id,
        lesson.id,
        short.id,
        lesson.id,
      ],
    });
    await there.post('/api/setup/day-template-assignments', {
      level: 'default',
      weekday: null,
      gradeFrom: null,
      gradeTo: null,
      dayTemplateId: template.id,
      from: '2026-08-25',
    });
    await there.post('/api/setup/calendar-entries', {
      kind: 'day_off',
      name: DAY_OFF.name,
      firstDate: DAY_OFF.date,
      lastDate: DAY_OFF.date,
      gradeFrom: null,
      gradeTo: null,
      dayTemplateId: null,
      followsWeekday: null,
      examWeek: null,
    });
  }
  // Travel time between the branches, for a teacher of both.
  for (const [index, branch] of made.entries()) {
    for (const other of made.slice(index + 1)) {
      await admin.in(branch.id).put('/api/setup/travel-times', {
        otherBranchId: other.id,
        minutes: 30,
      });
    }
  }
  say('Bell times, the day off and the travel time');

  // Staff. A record through the people routes, an account, the first sign-in
  // and the roles, as the Super Admin does it.
  const person = async (
    branch: string,
    department: { division: string; department: string },
    roles: readonly RoleToGive[],
    teaching: readonly string[] = [],
    named?: { first: string; last: string; sex: Sex },
  ): Promise<{ staffId: string; account: DemoAccount }> => {
    const name = named ?? personName(random);
    const there = admin.in(branch);
    const record = await there.post<Built>('/api/people/staff', {
      firstName: name.first,
      lastName: name.last,
      fatherName: '',
      sex: name.sex,
      birthDate: `19${String(75 + Math.floor(random() * 23))}-0${String(1 + Math.floor(random() * 9))}-1${String(Math.floor(random() * 9))}`,
      educationLevel: random() < 0.5 ? 'bachelor' : 'master',
      phone: phone(),
      email: '',
      jshshir: '',
      admissionDate: '2026-08-15',
      contractType: 'full_time',
      contractDate: '2026-08-15',
      weeklyLessons: teaching.length > 0 ? 24 : null,
      dailyLessons: teaching.length > 0 ? 6 : null,
      divisions: [
        { divisionId: department.division, departmentId: department.department, main: true },
      ],
    });
    if (teaching.length > 0) {
      await there.put(`/api/people/staff/${record.id}/teaching`, {
        subjects: teaching.map((one) => ({ subjectId: subjectId(one), grades: [5, 6, 7, 8, 9] })),
        languages: ['uz'],
      });
    }
    const suggestion = await there.get<{ login: string }>(
      `/api/people/staff/${record.id}/account/suggestion`,
    );
    const slip = await there.post<{ login: string; password: string }>(
      `/api/people/staff/${record.id}/account`,
      { login: suggestion.login },
    );
    const accountRow = await migrator
      .selectFrom('accounts')
      .select('id')
      .where('login', '=', slip.login)
      .executeTakeFirstOrThrow();
    for (const role of roles) {
      await there.post(`/api/people/staff/${record.id}/roles`, {
        role: role.role,
        branchId: role.branchId,
        from: '2026-08-24',
        ...(role.subjectIds === undefined ? {} : { subjectIds: role.subjectIds }),
      });
    }
    const strict = roles.some(
      (one) => one.role === 'academic_vice_principal' || one.role === 'super_admin',
    );
    const account = await signIns.first(
      accountRow.id,
      slip.login,
      slip.password,
      `${name.first} ${name.last}`,
      strict,
    );
    accounts.set(record.id, account);
    return { staffId: record.id, account };
  };

  const steam = { division: academic, department: departmentId('STEAM') };
  const general = { division: academic, department: departmentId('General') };
  const tutorsDepartment = { division: academic, department: departmentId('Tutors') };

  const senior = await person(
    firstBranch,
    steam,
    [
      {
        role: 'senior_head_teacher',
        branchId: null,
        subjectIds: [subjectId('Mathematics'), subjectId('Physics'), subjectId('Informatics')],
      },
    ],
    [],
    { first: 'Nigora', last: 'Saidova', sex: 'female' },
  );

  // Each branch: its leaders, its teachers, classes, students, groups and load.
  const built: DemoBranchBuilt[] = [];
  /** Teachers of each subject by branch, for the teacher shared with the next branch. */
  const poolsOf: Map<string, string[]>[] = [];
  const teachersEverywhere = new Map<string, DemoTeacher>();
  const hours: { branch: string; staffId: string }[] = [];

  for (const [branchIndex, branch] of BRANCHES.entries()) {
    const at = made[branchIndex];
    if (at === undefined) continue;
    const there = admin.in(at.id);
    const leader = async (role: RoleToGive['role'], department = general, subjectIds?: string[]) =>
      (
        await person(at.id, department, [
          { role, branchId: at.id, ...(subjectIds === undefined ? {} : { subjectIds }) },
        ])
      ).account;
    const principal = await leader('principal');
    const vice = await leader('academic_vice_principal');
    const others: { role: string; account: DemoAccount }[] = [];
    if (branchIndex === 0) {
      others.push({
        role: 'spiritual_vice_principal',
        account: await leader('spiritual_vice_principal'),
      });
      others.push({ role: 'head_tutor', account: await leader('head_tutor', tutorsDepartment) });
      others.push({
        role: 'head_teacher',
        account: await leader(
          'head_teacher',
          { division: academic, department: departmentId('Foreign languages') },
          [subjectId('English'), subjectId('Russian')],
        ),
      });
    }
    say(`${branch.name}: Principal ${principal.login}, Academic Vice Principal ${vice.login}`);

    // Classes in their home rooms.
    const classes: DemoClass[] = [];
    const classrooms = at.rooms.filter((room) => room.type === 'classroom');
    for (const [index, one] of branch.classes.entries()) {
      const saved = await there.post<Built>('/api/classes', {
        grade: one.grade,
        name: one.name,
        language: 'uz',
        mainRoomId: classrooms[index]?.id ?? null,
        maxSize: 26,
        academicYearId: at.yearId,
      });
      classes.push({
        id: saved.id,
        grade: one.grade,
        name: one.name,
        students: [],
        tutorStaffId: null,
      });
    }

    // Students, each with a parent, joining the class on the first school day.
    for (const one of classes) {
      const students: { id: string; sex: Sex }[] = [];
      const batch: Promise<void>[] = [];
      for (let index = 0; index < STUDENTS_PER_CLASS; index += 1) {
        const name = personName(random);
        const parent = personName(random);
        uids += 1;
        const uid = String(26_100_000 + uids * 13);
        const born = 2026 - one.grade - 6;
        const body = {
          uid,
          firstName: name.first,
          lastName: name.last,
          paternalName: '',
          sex: name.sex,
          birthDate: `${String(born)}-${String(1 + Math.floor(random() * 12)).padStart(2, '0')}-${String(1 + Math.floor(random() * 28)).padStart(2, '0')}`,
          grade: one.grade,
          startsOn: YEAR.startDate,
          documentType: null,
          documentNumber: '',
          jshshir: '',
          phone: '',
          email: '',
          address: '',
          region: 'tashkent_city',
          previousSchool: '',
          diagnosticScore: null,
          scholarship: { type: 'none', coverage: null, amount: null },
          consentSignedOn: '2026-08-20',
          contract: { number: `DEMO-2026/${String(uids)}`, signedOn: '2026-08-20' },
          classId: one.id,
          relatives: [
            {
              kind: 'new',
              relative: {
                fullName: `${parent.first} ${name.sex === parent.sex ? name.last : parent.sex === 'male' ? name.last.replace(/a$/, '') : `${name.last}a`}`,
                phone: phone(),
                workplace: null,
                email: null,
              },
              relationship: parent.sex === 'male' ? 'father' : 'mother',
              mainContact: true,
              portalAccess: true,
              receivesNotices: true,
            },
          ],
        };
        batch.push(
          there.post<Built>('/api/people/students', body).then((saved) => {
            students.push({ id: saved.id, sex: name.sex });
          }),
        );
        if (batch.length >= 6) await Promise.all(batch.splice(0));
      }
      await Promise.all(batch);
      students.sort((a, b) => (a.id < b.id ? -1 : 1));
      Object.assign(one, { students });
    }
    say(
      `${branch.name}: ${String(classes.length)} classes, ${String(classes.reduce((sum, one) => sum + one.students.length, 0))} students with a parent each`,
    );

    // The load: whole classes, English in groups across a pair of classes of
    // a grade, physical education and technology in halves.
    interface Planned {
      classId: string | null;
      groupId: string | null;
      subject: string;
      perWeek: number;
      roomType: string | null;
      mixed: boolean;
      blockKey: string;
    }
    const planned: Planned[] = [];
    const group = async (subject: string, classIds: string[], students: string[], name: string) =>
      migrator.transaction().execute(async (transaction) => {
        const row = await transaction
          .insertInto('groups')
          .values({
            branch_id: at.id,
            academic_year_id: at.yearId,
            subject_id: subjectId(subject),
            name,
            language: 'uz',
            max_size: 26,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        for (const classId of classIds) {
          await transaction
            .insertInto('group_classes')
            .values({ group_id: row.id, class_id: classId, branch_id: at.id })
            .execute();
        }
        if (students.length > 0) {
          await transaction
            .insertInto('group_memberships')
            .values(
              students.map((studentId) =>
                groupMemberValues({
                  branch: at.id,
                  groupId: row.id,
                  subjectId: subjectId(subject),
                  studentId,
                  from: YEAR.startDate,
                  // The day after the year ends, as a placement writes it.
                  ownUntil: '2027-05-26',
                }),
              ),
            )
            .execute();
        }
        return row.id;
      });
    for (const grade of [...new Set(classes.map((one) => one.grade))]) {
      const ofGrade = classes.filter((one) => one.grade === grade);
      for (const line of curriculumOf(grade)) {
        if (line.way === 'whole') {
          for (const one of ofGrade) {
            planned.push({
              classId: one.id,
              groupId: null,
              subject: line.subject,
              perWeek: line.perWeek,
              roomType: line.roomType ?? null,
              mixed: false,
              blockKey: `class:${one.id}:${line.subject}`,
            });
          }
        } else if (line.way === 'groups') {
          for (let index = 0; index < ofGrade.length; index += 2) {
            const unit = ofGrade.slice(index, index + 2);
            const students = unit.flatMap((one) => one.students.map((student) => student.id));
            const parts = unit.length === 2 ? 3 : 2;
            for (let part = 0; part < parts; part += 1) {
              const groupId = await group(
                line.subject,
                unit.map((one) => one.id),
                students.filter((_, position) => position % parts === part),
                `${String(grade)} English ${['A', 'B', 'C'][part] ?? 'D'}`,
              );
              planned.push({
                classId: null,
                groupId,
                subject: line.subject,
                perWeek: line.perWeek,
                roomType: 'classroom',
                mixed: false,
                blockKey: `groups:${unit.map((one) => one.id).join('+')}:${line.subject}`,
              });
            }
          }
        } else {
          for (const one of ofGrade) {
            const boys = one.students.filter((student) => student.sex === 'male').map((s) => s.id);
            const girls = one.students
              .filter((student) => student.sex === 'female')
              .map((s) => s.id);
            for (const [part, students] of [boys, girls].entries()) {
              const groupId = await group(
                line.subject,
                [one.id],
                students,
                `${String(grade)} ${one.name} ${line.subject} ${part === 0 ? 'boys' : 'girls'}`,
              );
              planned.push({
                classId: null,
                groupId,
                subject: line.subject,
                perWeek: line.perWeek,
                roomType: line.roomType ?? null,
                mixed: true,
                blockKey: `split:${one.id}:${line.subject}`,
              });
            }
          }
        }
      }
    }

    // Teachers per subject: enough for about `LESSONS_PER_TEACHER` a week and
    // for the widest block; in the second branch, one subject is taught by a
    // teacher of the first (a teacher of two branches, with the travel time).
    const pools = new Map<string, string[]>();
    const loadOf = new Map<string, number>();
    const assigned = new Map<Planned, string>();
    const previous = poolsOf[branchIndex - 1];
    const teachers = new Map<string, DemoTeacher>();
    let shared = false;
    for (const subject of SUBJECTS.map((one) => one.en)) {
      const rows = planned.filter((row) => row.subject === subject);
      if (rows.length === 0) continue;
      const total = rows.reduce((sum, row) => sum + row.perWeek, 0);
      const widest = Math.max(
        ...[...new Set(rows.map((row) => row.blockKey))].map(
          (key) => rows.filter((row) => row.blockKey === key && !row.mixed).length,
        ),
        1,
      );
      const count = Math.max(widest, Math.ceil(total / LESSONS_PER_TEACHER));
      const pool: string[] = [];
      const department = SUBJECTS.find((one) => one.en === subject)?.department ?? 'General';
      for (let index = 0; index < count; index += 1) {
        const hired = await person(
          at.id,
          { division: academic, department: departmentId(department satisfies Department) },
          [{ role: 'teacher', branchId: at.id }],
          [subject],
        );
        pool.push(hired.staffId);
        loadOf.set(hired.staffId, 0);
        const teacher = { staffId: hired.staffId, account: hired.account, subjects: [subject] };
        teachers.set(hired.staffId, teacher);
        teachersEverywhere.set(hired.staffId, teacher);
      }
      pools.set(subject, pool);
      // Mathematics of the second branch's first class: the first branch's teacher.
      const from = previous?.get(subject)?.[0];
      const firstWhole = rows.find((row) => row.classId !== null);
      if (!shared && subject === 'Mathematics' && from !== undefined && firstWhole !== undefined) {
        shared = true;
        await admin.in(made[0]?.id ?? '').put(`/api/people/staff/${from}/branches`, {
          mainBranchId: made[0]?.id,
          furtherBranchIds: [at.id],
        });
        // The Teacher role in this branch too: a role counts in its own branch only.
        await there.post(`/api/people/staff/${from}/roles`, {
          role: 'teacher',
          branchId: at.id,
          from: '2026-08-24',
        });
        assigned.set(firstWhole, from);
        const teacher = teachersEverywhere.get(from);
        if (teacher !== undefined) teachers.set(from, teacher);
      }
      const order = rows
        .filter((row) => !assigned.has(row))
        .sort((a, b) => b.perWeek - a.perWeek || (a.blockKey < b.blockKey ? -1 : 1));
      for (const row of order) {
        const taken = new Set(
          rows
            .filter((other) => other.blockKey === row.blockKey && !other.mixed)
            .map((other) => assigned.get(other))
            .filter((id): id is string => id !== undefined),
        );
        const choice = [...pool]
          .filter((id) => !taken.has(id))
          .sort((a, b) => (loadOf.get(a) ?? 0) - (loadOf.get(b) ?? 0))[0];
        if (choice === undefined) throw new Error(`No teacher of ${subject} for a row.`);
        assigned.set(row, choice);
        loadOf.set(choice, (loadOf.get(choice) ?? 0) + row.perWeek);
      }
    }
    poolsOf.push(pools);
    for (const staffId of new Set(assigned.values())) hours.push({ branch: at.id, staffId });
    say(
      `${branch.name}: ${String(teachers.size)} teachers, ${String(planned.length)} rows of the load`,
    );

    // A Tutor for each class: a teacher of the branch who teaches it.
    const tutors = new Set<string>();
    for (const one of classes) {
      // A teacher of the class's own rows, one class each.
      const staffId = planned
        .filter((candidate) => candidate.classId === one.id)
        .map((candidate) => assigned.get(candidate) ?? '')
        .find(
          (id) =>
            teachers.has(id) &&
            !tutors.has(id) &&
            [...pools.values()].some((pool) => pool.includes(id)),
        );
      if (staffId === undefined) continue;
      tutors.add(staffId);
      await there.post(`/api/people/staff/${staffId}/roles`, {
        role: 'tutor',
        branchId: at.id,
        from: '2026-08-24',
      });
      const assignment = await migrator
        .selectFrom('assignments')
        .innerJoin('staff', 'staff.account_id', 'assignments.account_id')
        .select('assignments.id')
        .where('staff.id', '=', staffId)
        .where('assignments.role', '=', 'tutor')
        .where('assignments.branch_id', '=', at.id)
        .orderBy('assignments.id', 'desc')
        .executeTakeFirstOrThrow();
      await there.post(`/api/classes/${one.id}/tutors`, {
        assignmentId: assignment.id,
        kind: 'tutor',
        from: YEAR.startDate,
        until: null,
      });
      one.tutorStaffId = staffId;
    }

    // The draft from the first school day, and its rows.
    const version = await vice.caller.in(at.id).post<Built>('/api/timetable/versions', {
      academicYearId: at.yearId,
      startsOn: TIMETABLE_START,
      copyFrom: null,
    });
    await migrator
      .insertInto('teaching_load_rows')
      .values(
        planned.map((row) => ({
          branch_id: at.id,
          version_id: version.id,
          class_id: row.classId,
          group_id: row.groupId,
          subject_id: subjectId(row.subject),
          teacher_id: assigned.get(row) ?? '',
          lessons_per_week: row.perWeek,
          room_type: row.roomType,
          mixed_block: row.mixed,
        })),
      )
      .execute();

    built.push({
      id: at.id,
      name: branch.name,
      yearId: at.yearId,
      quarterIds: at.quarterIds,
      versionId: version.id,
      classes,
      teachers,
      vice,
      principal,
      others,
    });
  }

  // Working hours from 1 September, Monday to Friday, all day; the teacher of
  // two branches until 11:45 in the first and from 11:45 in the second.
  const homeOf = new Map<string, string>();
  const branchesOf = new Map<string, number>();
  for (const one of hours) branchesOf.set(one.staffId, (branchesOf.get(one.staffId) ?? 0) + 1);
  for (const { branch, staffId } of hours) {
    if (!homeOf.has(staffId)) homeOf.set(staffId, branch);
    const [start, end] =
      (branchesOf.get(staffId) ?? 0) < 2
        ? [0, 1440]
        : homeOf.get(staffId) === branch
          ? [0, 705]
          : [705, 1440];
    const entry = await migrator
      .insertInto('staff_availability')
      .values({ branch_id: branch, staff_id: staffId, valid_from: '2026-09-01' })
      .returning(['id', 'valid_until'])
      .executeTakeFirstOrThrow();
    await migrator
      .insertInto('staff_availability_ranges')
      .values(
        [1, 2, 3, 4, 5].map((weekday) => ({
          entry_id: entry.id,
          branch_id: branch,
          staff_id: staffId,
          weekday,
          start_minutes: start,
          end_minutes: end,
          valid_from: '2026-09-01',
          valid_until: entry.valid_until,
        })),
      )
      .execute();
  }

  // Each branch's week placed by the seed placer of the real-size run,
  // checked by the rule engine, confirmed and published.
  for (const branch of built) {
    const run: BranchOfRun = {
      id: branch.id,
      name: branch.name,
      year: branch.yearId,
      version: branch.versionId,
      cookie: branch.vice.caller.cookies,
      classes: branch.classes.map((one) => ({ id: one.id, grade: one.grade })),
      teachers: [...branch.teachers.keys()],
      rows: 0,
      groups: 0,
      rooms: 0,
    };
    const kit: RunKit = { kit: { server: signIns.kit.server }, database: { migrator } };
    const placed = await placeDraft(kit, run);
    if (placed.notPlaced.length > 0) {
      throw new Error(`${branch.name}: lessons not placed: ${JSON.stringify(placed.notPlaced)}`);
    }
    await confirmSteps(kit, run);
    await branch.vice.caller
      .in(branch.id)
      .post(`/api/timetable/versions/${branch.versionId}/publish`, { startsOn: TIMETABLE_START });
    say(
      `${branch.name}: ${String(placed.lessons)} lessons a week placed and published from ${TIMETABLE_START}`,
    );
  }

  return {
    superAdmin,
    seniorHeadTeacher: senior.account,
    branches: built,
    subjects,
    accounts,
  };
}
