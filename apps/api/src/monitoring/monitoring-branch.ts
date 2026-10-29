import { addDays } from '@sodiq/timetable-rules';
import { sql } from 'kysely';
import { transactionMoment, type Transactions } from '../database/transactions.js';
import type { Audit } from '../modules/audit/audit.service.js';
import type { MonitoringApi } from './monitoring-api.js';

/**
 * The hidden Monitoring branch of the sign-in-and-save check (task 10.2b; answer 10: "one class,
 * one test teacher and invented students, left out of every school report"), built once on the
 * server by the owner's command (`monitoring-branch.command.ts`) through the real routes, signed
 * in as the owner's Super Admin, so every rule, check and audit entry applies (plan decision 7).
 *
 * One lesson at 06:30 on each of the seven days, in a year whose four quarters touch, so a held
 * lesson of today exists from 07:00 every day (plan decision 3; `edge/system-behaviour`: "every 5
 * minutes from 07:00"). Every record is invented: the UIDs are `MON0001` to `MON0003`, a form no
 * real UID of the school takes, and the teacher's phone is of no operator.
 */

export const MONITORING_BRANCH_NAME = 'Monitoring';
export const MONITORING_CLASS_NAME = 'M-1';
export const MONITORING_UIDS = ['MON0001', 'MON0002', 'MON0003'] as const;
const STUDENTS = [
  { firstName: 'Sinov', lastName: 'Birinchi', sex: 'male' },
  { firstName: 'Sinov', lastName: 'Ikkinchi', sex: 'female' },
  { firstName: 'Sinov', lastName: 'Uchinchi', sex: 'male' },
] as const;
const TEACHER = { firstName: 'Sinov', lastName: 'Oʻqituvchi', phone: '+998000000001' } as const;
/** The lesson of every day: 06:30 to 07:15 in the branch's time. */
export const MONITORING_LESSON_START = '06:30';
const LESSON_MINUTES = 45;

/** The subject the class is taught, found by `monitoringPrecheck`. */
export interface MonitoringSubject {
  readonly id: string;
  readonly grades: readonly number[];
  readonly journalType: string;
  readonly ratingExam: boolean;
  readonly departmentId: string;
  /** The division of that department: the test teacher's main division. */
  readonly divisionId: string;
}

/** What the owner gives the command. */
export interface MonitoringBranchInput {
  readonly subject: MonitoringSubject;
  /** The first day of the Monitoring year: tomorrow or later (a publish starts no earlier). */
  readonly yearStart: string;
  /** The last day of the Monitoring year (plan decision 8: the day before the next year starts). */
  readonly yearEnd: string;
}

/** What the command prints at the end: the ids, and the test teacher's first password once. */
export interface MonitoringBranchBuilt {
  readonly branchId: string;
  readonly classId: string;
  readonly teacherLogin: string;
  readonly teacherFirstPassword: string;
}

export class MonitoringBranchRefused extends Error {}

interface Built {
  readonly id: string;
}

/** Four quarters that touch, as even as the days allow, from the first day to the last. */
export function touchingQuarters(
  first: string,
  last: string,
): { startDate: string; endDate: string }[] {
  const days =
    Math.round((Date.parse(`${last}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / 86_400_000) +
    1;
  if (days < 4) throw new MonitoringBranchRefused('The year needs four days or more.');
  const quarters: { startDate: string; endDate: string }[] = [];
  let start = first;
  for (let index = 0; index < 4; index += 1) {
    const length = Math.floor(days / 4) + (index < days % 4 ? 1 : 0);
    const end = addDays(start, length - 1);
    quarters.push({ startDate: start, endDate: end });
    start = addDays(end, 1);
  }
  return quarters;
}

/**
 * What is checked before anything is written: no Monitoring branch yet, an active subject of
 * that English name taught to whole classes, and none of the invented UIDs taken by any student
 * of any branch, archived and corrected-away ones included (task 9.4c: compared as the database
 * keys them). Read as the application user, the students through every branch's filter.
 */
export async function monitoringPrecheck(
  transactions: Transactions,
  subjectName: string,
): Promise<MonitoringSubject> {
  const branchIds = await transactions.run([], async (transaction) => {
    const marked = await transaction
      .selectFrom('branches')
      .select('id')
      .where('purpose', '=', 'monitoring')
      .executeTakeFirst();
    if (marked !== undefined) {
      throw new MonitoringBranchRefused(`The Monitoring branch exists already (${marked.id}).`);
    }
    return (await transaction.selectFrom('branches').select('id').execute()).map((row) => row.id);
  });
  return transactions.run(branchIds, async (transaction) => {
    const subject = await transaction
      .selectFrom('subjects')
      .select(['id', 'grades', 'journal_type', 'rating_exam', 'department_id', 'group_subject'])
      .where(sql<string>`lower(btrim(name_en))`, '=', subjectName.trim().toLowerCase())
      .where('archived_at', 'is', null)
      .executeTakeFirst();
    if (subject === undefined) {
      throw new MonitoringBranchRefused(`No active subject is named "${subjectName}" in English.`);
    }
    if (subject.group_subject) {
      throw new MonitoringBranchRefused(
        `"${subjectName}" is taught in groups; choose a subject of whole classes.`,
      );
    }
    const keys = MONITORING_UIDS.map((uid) => sql<string>`student_uid_key(${uid})`);
    const taken = await sql<{ n: number }>`
      select count(*)::int as n from (
        select uid_key from students where uid_key in (${sql.join(keys)})
        union all
        select uid_key from student_uids where uid_key in (${sql.join(keys)})
      ) found
    `.execute(transaction);
    if ((taken.rows[0]?.n ?? 0) > 0) {
      throw new MonitoringBranchRefused(
        `A student of the school already has one of the UIDs ${MONITORING_UIDS.join(', ')}. Nothing was written.`,
      );
    }
    return {
      id: subject.id,
      grades: subject.grades,
      journalType: subject.journal_type,
      ratingExam: subject.rating_exam,
      departmentId: subject.department_id,
      divisionId: (
        await transaction
          .selectFrom('departments')
          .select('division_id')
          .where('id', '=', subject.department_id)
          .executeTakeFirstOrThrow()
      ).division_id,
    };
  });
}

/**
 * Marks the branch the command has just created, through `monitoring_branch_mark` (0142: only a
 * new, empty branch, once), with the audit entry of the Super Admin who runs the command.
 */
export async function markMonitoringBranch(
  transactions: Transactions,
  audit: Audit,
  input: { login: string; branchId: string },
): Promise<void> {
  await transactions.run([], async (transaction) => {
    const now = await transactionMoment(transaction);
    const admin = await transaction
      .selectFrom('assignments')
      .innerJoin('accounts', 'accounts.id', 'assignments.account_id')
      .select(['assignments.id', 'accounts.id as accountId'])
      .where('accounts.login', '=', input.login)
      .where('assignments.role', '=', 'super_admin')
      .where('assignments.branch_id', 'is', null)
      .where('assignments.valid_from', '<=', now)
      .where((where) =>
        where.or([
          where('assignments.valid_until', 'is', null),
          where('assignments.valid_until', '>', now),
        ]),
      )
      .orderBy('assignments.id')
      .executeTakeFirst();
    if (admin === undefined) {
      throw new MonitoringBranchRefused('The account that signed in is not a Super Admin now.');
    }
    await sql`select monitoring_branch_mark(${input.branchId}::uuid)`.execute(transaction);
    await audit.record(transaction, {
      branchId: null,
      actorId: admin.accountId,
      assignmentId: admin.id,
      action: 'branch.monitoring',
      record: { type: 'branch', id: input.branchId },
      newValue: { purpose: 'monitoring' },
    });
  });
}

/**
 * The branch built through the routes, signed in already as the Super Admin. `mark` marks it
 * right after its create (`markMonitoringBranch`). Stops at the first refusal; the steps done are
 * named by `say`, so the Super Admin can finish in the screens or archive what was made.
 */
export async function buildMonitoringBranch(
  api: MonitoringApi,
  input: MonitoringBranchInput,
  mark: (branchId: string) => Promise<void>,
  say: (line: string) => void,
): Promise<MonitoringBranchBuilt> {
  const subject = input.subject;
  const grade = Math.min(...subject.grades);

  const branch = await api.post<Built>('/api/setup/branches', {
    name: MONITORING_BRANCH_NAME,
    address: '',
    phone: '',
    email: '',
    workingWeekdays: [1, 2, 3, 4, 5, 6, 7],
  });
  await mark(branch.id);
  say(`The branch ${MONITORING_BRANCH_NAME} (${branch.id}), marked as the Monitoring branch`);
  const at = branch.id;

  const year = await api.post<Built>(
    '/api/setup/academic-years',
    { startDate: input.yearStart, endDate: input.yearEnd },
    at,
  );
  await api.put(
    `/api/setup/academic-years/${year.id}/quarters`,
    { quarters: touchingQuarters(input.yearStart, input.yearEnd) },
    at,
  );
  await api.post(`/api/setup/academic-years/${year.id}/start`, {}, at);
  say(`The year ${input.yearStart} to ${input.yearEnd}, four quarters that touch, started`);

  const building = await api.post<Built>('/api/setup/buildings', { name: 'Monitoring' }, at);
  const floor = await api.post<Built>(
    `/api/setup/buildings/${building.id}/floors`,
    { name: '1' },
    at,
  );
  const room = await api.post<Built>(
    '/api/setup/rooms',
    {
      name: 'M-1',
      floorId: floor.id,
      type: 'classroom',
      capacity: 10,
      status: 'in_use',
      shared: false,
      maxSimultaneousLessons: null,
    },
    at,
  );

  if (subject.journalType !== 'attendance') {
    await api.put(
      `/api/setup/subjects/${subject.id}/daily-weights`,
      { attendance: 20, classwork: 40, homework: 40 },
      at,
    );
    const quarters = await api.get<{ quarters: { quarterId: string }[] }>(
      `/api/setup/subjects/${subject.id}/quarter-weights?yearId=${year.id}`,
      at,
    );
    for (const quarter of quarters.quarters) {
      await api.put(
        `/api/setup/subjects/${subject.id}/quarter-weights/${quarter.quarterId}`,
        subject.ratingExam
          ? { attendance: 20, classwork: 30, homework: 30, ratingExam: 20 }
          : { attendance: 20, classwork: 40, homework: 40, ratingExam: null },
        at,
      );
    }
  }

  const lesson = await api.post<Built>(
    '/api/setup/slot-types',
    { name: 'Lesson', kind: 'lesson', lengthMinutes: LESSON_MINUTES },
    at,
  );
  const template = await api.post<Built>(
    '/api/setup/day-templates',
    { name: 'Monitoring day', startTime: MONITORING_LESSON_START, slotTypeIds: [lesson.id] },
    at,
  );
  await api.post(
    '/api/setup/day-template-assignments',
    {
      level: 'default',
      weekday: null,
      gradeFrom: null,
      gradeTo: null,
      dayTemplateId: template.id,
      from: input.yearStart,
    },
    at,
  );
  say(`A room and one lesson at ${MONITORING_LESSON_START} on each of the seven days`);

  const schoolClass = await api.post<Built>(
    '/api/classes',
    {
      grade,
      name: MONITORING_CLASS_NAME,
      language: 'uz',
      mainRoomId: room.id,
      maxSize: 10,
      academicYearId: year.id,
    },
    at,
  );
  for (const [index, student] of STUDENTS.entries()) {
    await api.post(
      '/api/people/students',
      {
        uid: MONITORING_UIDS[index],
        firstName: student.firstName,
        lastName: student.lastName,
        paternalName: '',
        sex: student.sex,
        birthDate: `${String(Number(input.yearStart.slice(0, 4)) - grade - 6)}-01-0${String(index + 1)}`,
        grade,
        startsOn: input.yearStart,
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
        consentSignedOn: null,
        contract: { number: `MONITORING-${String(index + 1)}`, signedOn: input.yearStart },
        classId: schoolClass.id,
        // A student needs a relative (`04`); invented, with a phone of no operator.
        relatives: [
          {
            kind: 'new',
            relative: {
              fullName: ['Sinov Otabek', 'Sinov Bahodir', 'Sinov Jamshid'][index] ?? 'Sinov Otabek',
              phone: `+9980000000${String(11 + index)}`,
              workplace: null,
              email: null,
            },
            relationship: 'father',
            mainContact: true,
            portalAccess: false,
            receivesNotices: false,
          },
        ],
      },
      at,
    );
  }
  say(
    `The class ${MONITORING_CLASS_NAME} (grade ${String(grade)}) with ${String(STUDENTS.length)} invented students`,
  );

  const record = await api.post<Built>(
    '/api/people/staff',
    {
      firstName: TEACHER.firstName,
      lastName: TEACHER.lastName,
      fatherName: '',
      sex: 'female',
      birthDate: '1990-01-01',
      educationLevel: 'bachelor',
      phone: TEACHER.phone,
      email: '',
      jshshir: '',
      admissionDate: input.yearStart,
      contractType: 'full_time',
      contractDate: input.yearStart,
      weeklyLessons: 7,
      dailyLessons: 1,
      divisions: [
        { divisionId: subject.divisionId, departmentId: subject.departmentId, main: true },
      ],
    },
    at,
  );
  await api.put(
    `/api/people/staff/${record.id}/teaching`,
    { subjects: [{ subjectId: subject.id, grades: [grade] }], languages: ['uz'] },
    at,
  );
  const suggestion = await api.get<{ login: string }>(
    `/api/people/staff/${record.id}/account/suggestion`,
    at,
  );
  const slip = await api.post<{ login: string; password: string }>(
    `/api/people/staff/${record.id}/account`,
    { login: suggestion.login },
    at,
  );
  await api.post(
    `/api/people/staff/${record.id}/roles`,
    { role: 'teacher', branchId: at, from: input.yearStart },
    at,
  );
  // Available all day on every day, from the first day of the year.
  await api.put(
    `/api/people/staff/${record.id}/availability`,
    {
      from: input.yearStart,
      ranges: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start: '00:00', end: '24:00' })),
    },
    at,
  );
  say(`The test teacher ${slip.login}, Teacher of the Monitoring branch only`);

  const version = await api.post<Built>(
    '/api/timetable/versions',
    { academicYearId: year.id, startsOn: input.yearStart, copyFrom: null },
    at,
  );
  const row = await api.post<Built>(
    `/api/timetable/versions/${version.id}/load`,
    {
      classId: schoolClass.id,
      groupId: null,
      subjectId: subject.id,
      teacherId: record.id,
      lessonsPerWeek: 7,
      roomId: room.id,
      roomType: null,
      doubleLessons: false,
    },
    at,
  );
  for (let weekday = 1; weekday <= 7; weekday += 1) {
    await api.post(
      `/api/timetable/versions/${version.id}/pattern`,
      { loadRowId: row.id, weekday, slotPosition: 1 },
      at,
    );
  }
  await api.post(`/api/timetable/versions/${version.id}/templates/confirm`, {}, at);
  const readiness = await api.get<{ rules?: { ready: boolean; weights?: unknown } }>(
    `/api/timetable/versions/${version.id}/readiness`,
    at,
  );
  if (readiness.rules !== undefined && !readiness.rules.ready) {
    await api.post(
      `/api/timetable/versions/${version.id}/rules/confirm`,
      { weights: readiness.rules.weights, pins: [] },
      at,
    );
  }
  await api.post(
    `/api/timetable/versions/${version.id}/publish`,
    { startsOn: input.yearStart },
    at,
  );
  say(`The timetable published from ${input.yearStart}: the check is green from that day`);

  return {
    branchId: at,
    classId: schoolClass.id,
    teacherLogin: slip.login,
    teacherFirstPassword: slip.password,
  };
}
