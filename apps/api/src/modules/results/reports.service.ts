import { Injectable } from '@nestjs/common';
import {
  dailyAttendance,
  GRADE_BANDS,
  shownPercent,
  type AttendanceCell,
  type DailyAttendance,
  type StudentQuarterOutcome,
} from '@sodiq/calc';
import {
  attendanceReportSchema,
  classDisplayName,
  fillText,
  isLanguage,
  REPORT_DAYS_MAX,
  REPORT_EXPORT_ASCII_NAMES,
  REPORT_EXPORT_TEXTS,
  resultsReportChoicesSchema,
  resultsTableSchema,
  schoolDateOf,
  subjectMasterySchema,
  type AttendanceCountsShown,
  type AttendanceFigure,
  type AttendanceReport,
  type AttendanceReportQuery,
  type Language,
  type ReportClass,
  type ReportExportTexts,
  type ResultsReportChoices,
  type ResultsReportChoicesQuery,
  type ResultsReportExport,
  type ResultsTable,
  type ResultsTableQuery,
  type Role,
  type SubjectMastery,
  type SubjectMasteryQuery,
} from '@sodiq/shared';
import { addDays, tutorAt, type TutorRow } from '@sodiq/timetable-rules';
import { sql } from 'kysely';
import { Transactions, transactionMoment } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import { writeSheets, XlsxFile, type Cell, type Sheet } from '../../http/xlsx.js';
import type { Access } from '../access/permission.guard.js';
import { Audit } from '../audit/audit.service.js';
import { branchOf } from '../classes/classes.service.js';
import {
  journalRows,
  staffNames,
  switchesIn,
  type JournalRow,
} from '../journal/journal-grid.query.js';
import { lessonsCounted } from '../journal/lesson-counted.js';
import { ownerIdOn } from '../plans/plan-scope.js';
import { notFound } from '../setup/setup-refusals.js';
import { readTutorRows } from '../timetable/load-facts.js';
import { momentText } from '../timetable/views-export.service.js';
import { dateText } from '../timetable/views-file.js';
import type { QuarterRow as DatedQuarter } from './early-warning.service.js';
import { NO_COUNTS, type AttendanceCounts, type AttendanceLesson } from './prepared/attendance.js';
import { Freshness, preparedAttendance, preparedOutcomes } from './prepared/read.js';
import {
  byName,
  isManagement,
  listStateOf,
  membersOn,
  namesOf,
  permitting,
  quarterOf,
  quarterStateOf,
  referenceDateOf,
  SUBJECT_ROLES,
  tutorClasses,
  type Context,
  type QuarterRow,
} from './rating.service.js';

/**
 * The reports of `08`, Analytics in Release 1, over the journal (task 9.3b-2, pull request #260):
 * Attendance, Results table and Subject mastery, with their Excel files. Each reads the prepared
 * totals of 9.3b-1 (`preparedAttendance`, `preparedOutcomes`) and says how fresh they are; every
 * figure comes from `packages/calc` (`dailyAttendance`, `shownPercent`, the outcome's grade).
 *
 * Who reads (decision 1, approved by the owner on the pull request), from the assignments that
 * permit the route, never `access.role`:
 *
 * | Report | Readers |
 * | --- | --- |
 * | attendance | Super Admin, Principal, Academic Vice Principal, Spiritual Vice Principal, Head Tutor: the branch; Tutor: the students of own classes |
 * | results table | management and the Head Tutor: every class; Head Teacher, Senior Head Teacher: every class, own-subject columns only; Tutor: own classes |
 * | subject mastery | management: every journal; Head Teachers: own subjects; Tutor: the class journals of own classes and the group journals whose every class is own (9.3a decision 4); the Head Tutor none |
 *
 * A read writes no audit entry; an export writes one in the transaction of its read.
 */

/** The roles that read the attendance of every class of the branch. */
const ATTENDANCE_WHOLE: readonly Role[] = [
  'super_admin',
  'principal',
  'academic_vice_principal',
  'spiritual_vice_principal',
  'head_tutor',
];

const lower = (id: string) => id.toLowerCase();

/** A rounded share, `null` with nothing to divide by (`packages/calc`, `shownPercent`). */
const share = (part: number, whole: number): number | null =>
  whole === 0 ? null : Number(shownPercent(part, whole));

const add = (into: Record<keyof AttendanceCounts, number>, counts: AttendanceCounts): void => {
  into.present += counts.present;
  into.late += counts.late;
  into.absent += counts.absent;
  into.skipped += counts.skipped;
  into.unmarked += counts.unmarked;
  into.exempt += counts.exempt;
};

/** The counts with their percents (decision 2): of the expected cells; exempt of all cells. */
function shownCounts(counts: AttendanceCounts): AttendanceCountsShown {
  const expected = counts.present + counts.late + counts.absent + counts.skipped + counts.unmarked;
  return {
    ...counts,
    expected,
    percents: {
      present: share(counts.present, expected),
      late: share(counts.late, expected),
      absent: share(counts.absent, expected),
      skipped: share(counts.skipped, expected),
      unmarked: share(counts.unmarked, expected),
      exempt: share(counts.exempt, expected + counts.exempt),
    },
  };
}

/**
 * The daily attendance of the counted cells (`edge/journal`, "Daily attendance percent of a
 * class"): `dailyAttendance` over the cells the counts stand for, one ratio over the range.
 */
function dailyOf(counts: AttendanceCounts): AttendanceFigure {
  const cells: AttendanceCell[] = [];
  const push = (count: number, cell: AttendanceCell) => {
    for (let index = 0; index < count; index += 1) cells.push(cell);
  };
  push(counts.present, { mark: 1, exempt: false });
  push(counts.late, { mark: 2, exempt: false });
  push(counts.absent, { mark: 0, exempt: false });
  push(counts.skipped, { mark: 3, exempt: false });
  push(counts.unmarked, { mark: null, exempt: false });
  push(counts.exempt, { mark: null, exempt: true });
  const figure: DailyAttendance = dailyAttendance(cells);
  return {
    attended: figure.attended,
    marked: figure.marked,
    unmarked: figure.unmarked,
    exempt: figure.exempt,
    percent: figure.percent === null ? null : Number(figure.percent.roundHalfUp()),
  };
}

const freshCounts = (): Record<keyof AttendanceCounts, number> => ({ ...NO_COUNTS });

interface ClassRow extends ReportClass {
  readonly academicYearId: string;
  readonly archived: boolean;
}

async function classesOfBranch(context: Context): Promise<Map<string, ClassRow>> {
  const rows = await context.transaction
    .selectFrom('classes')
    .select(['id', 'grade', 'name', 'academic_year_id', 'archived_at'])
    .where('branch_id', '=', context.branchId)
    .execute();
  return new Map(
    rows.map((row) => [
      row.id,
      {
        id: row.id,
        name: classDisplayName(row.grade, row.name),
        grade: row.grade,
        academicYearId: row.academic_year_id,
        archived: row.archived_at !== null,
      },
    ]),
  );
}

/** The academic year of the branch holding `day`, closed ones too. */
async function yearHolding(
  context: Context,
  day: string,
): Promise<{ id: string; startDate: string; endDate: string } | null> {
  const year = await context.transaction
    .selectFrom('academic_years')
    .select([
      'id',
      sql<string>`start_date::text`.as('start'),
      sql<string>`end_date::text`.as('end'),
    ])
    .where('branch_id', '=', context.branchId)
    .where('start_date', '<=', day)
    .where('end_date', '>=', day)
    .executeTakeFirst();
  return year === undefined ? null : { id: year.id, startDate: year.start, endDate: year.end };
}

/** The dated quarters of a year that meet the range. */
async function quartersMeeting(
  context: Context,
  yearId: string,
  from: string,
  to: string,
): Promise<DatedQuarter[]> {
  const rows = await context.transaction
    .selectFrom('quarters')
    .select([
      'id',
      'number',
      sql<string | null>`start_date::text`.as('start_date'),
      sql<string | null>`end_date::text`.as('end_date'),
    ])
    .where('academic_year_id', '=', yearId)
    .orderBy('number')
    .execute();
  return rows.flatMap((row) =>
    row.start_date === null || row.end_date === null || row.end_date < from || row.start_date > to
      ? []
      : [
          {
            id: row.id,
            number: row.number,
            academicYearId: yearId,
            startDate: row.start_date,
            endDate: row.end_date,
            closed: false,
          },
        ],
  );
}

const hasRole = (context: Context, roles: readonly string[]) =>
  permitting(context, roles).length > 0;

/** Whether the reader may read the results table of a class (decision 1). */
const mayTable = (context: Context, classId: string): boolean =>
  isManagement(context) ||
  hasRole(context, ['head_tutor', ...SUBJECT_ROLES]) ||
  tutorClasses(context).has(lower(classId));

/** The subjects of the results table's columns the reader may read; `null` for every subject. */
function tableSubjects(context: Context, classId: string): Set<string> | null {
  if (
    isManagement(context) ||
    hasRole(context, ['head_tutor']) ||
    tutorClasses(context).has(lower(classId))
  ) {
    return null;
  }
  return new Set(permitting(context, SUBJECT_ROLES).flatMap((one) => one.subjectIds));
}

/** Whether the reader may read a journal in subject mastery (decision 1; 9.3a decision 4). */
function mayMaster(context: Context, journal: JournalRow): boolean {
  if (isManagement(context)) return true;
  const subject = lower(journal.subjectId);
  if (permitting(context, SUBJECT_ROLES).some((one) => one.subjectIds.includes(subject))) {
    return true;
  }
  const own = tutorClasses(context);
  if (journal.classId !== null) return own.has(lower(journal.classId));
  return (
    journal.groupClassIds.length > 0 && journal.groupClassIds.every((id) => own.has(lower(id)))
  );
}

/** The journal draws on the class: its class, or a group drawing from it. */
const ofClass = (journal: JournalRow, classId: string): boolean =>
  journal.classId === classId || journal.groupClassIds.includes(classId);

const graded = (journal: JournalRow, quarterId: string): boolean =>
  switchesIn(journal, quarterId)?.attendanceOnly === false;

@Injectable()
export class ResultsReportsService {
  constructor(
    private readonly transactions: Transactions,
    private readonly audit: Audit,
  ) {}

  attendance(access: Access, query: AttendanceReportQuery): Promise<AttendanceReport> {
    return this.run(access, (context) => attendanceIn(context, query));
  }

  choices(access: Access, query: ResultsReportChoicesQuery): Promise<ResultsReportChoices> {
    return this.run(access, (context) => choicesIn(context, query));
  }

  table(access: Access, query: ResultsTableQuery): Promise<ResultsTable> {
    return this.run(access, (context) => tableIn(context, query));
  }

  mastery(access: Access, query: SubjectMasteryQuery): Promise<SubjectMastery> {
    return this.run(access, (context) => masteryIn(context, query));
  }

  /** The attendance report as Excel, stamped with its range and the moment (decision 12). */
  async attendanceExport(
    access: Access,
    input: AttendanceReportQuery,
    requestId: string,
  ): Promise<XlsxFile> {
    const read = await this.run(access, async (context) => {
      const report = await attendanceIn(context, input);
      await this.audit.record(context.transaction, {
        branchId: context.branchId,
        actorId: access.accountId,
        assignmentId: access.assignmentId,
        action: 'attendance_report.export',
        details: { ...input, asOf: context.now.toISOString(), rows: report.rows.length },
        requestId,
      });
      return { report, ...(await this.fileContext(context)) };
    });
    const texts = REPORT_EXPORT_TEXTS[read.language];
    const sheet = attendanceSheet(read.report, texts, read.stamp);
    return file(texts, 'attendance', [sheet]);
  }

  /** The results table or subject mastery as Excel, stamped as the rating's file. */
  async export(access: Access, input: ResultsReportExport, requestId: string): Promise<XlsxFile> {
    const read = await this.run(access, async (context) => {
      const report =
        input.kind === 'table'
          ? ({ kind: 'table', list: await tableIn(context, input) } as const)
          : ({ kind: 'mastery', list: await masteryIn(context, input) } as const);
      await this.audit.record(context.transaction, {
        branchId: context.branchId,
        actorId: access.accountId,
        assignmentId: access.assignmentId,
        action: 'results_report.export',
        details: {
          ...input,
          asOf: context.now.toISOString(),
          final: report.list.final === null ? null : report.list.final.version,
        },
        requestId,
      });
      return { report, ...(await this.fileContext(context)) };
    });
    const texts = REPORT_EXPORT_TEXTS[read.language];
    const { list } = read.report;
    const stamp =
      list.final === null
        ? fillText(texts.provisional, { moment: read.stamp })
        : fillText(texts.final, {
            date: dateText(schoolDateOf(new Date(list.final.closedAt), read.timeZone)),
            version: String(list.final.version),
          });
    const preamble = [
      ...(list.quarter.notOfficial ? [texts.notOfficial] : []),
      fillText(texts.quarter, { number: String(list.quarter.number) }),
      stamp,
    ];
    const sheet =
      read.report.kind === 'table'
        ? tableSheet(read.report.list, texts, read.language, preamble)
        : masterySheet(read.report.list, texts, read.language, preamble);
    return file(texts, read.report.kind, [sheet]);
  }

  private async fileContext(
    context: Context,
  ): Promise<{ language: Language; stamp: string; timeZone: string }> {
    const account = await context.transaction
      .selectFrom('accounts')
      .select('language')
      .where('id', '=', context.access.accountId)
      .executeTakeFirstOrThrow();
    return {
      language: isLanguage(account.language) ? account.language : 'uz',
      stamp: momentText(context.now, context.timeZone),
      timeZone: context.timeZone,
    };
  }

  private run<T>(access: Access, work: (context: Context) => Promise<T>): Promise<T> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const branch = await transaction
        .selectFrom('branches')
        .select('time_zone')
        .where('id', '=', branchId)
        .executeTakeFirstOrThrow();
      const now = await transactionMoment(transaction);
      return work({
        transaction,
        access,
        branchId,
        timeZone: branch.time_zone,
        now,
        today: schoolDateOf(now, branch.time_zone),
      });
    });
  }
}

/* ---------------------------------------------------------------- Attendance */

/**
 * The attendance report (`08`, Analytics, Attendance; `07`, Effect on totals; decisions 2, 4, 5
 * and 6): the held lessons of the range in the prepared attendance units, filtered, their cells
 * counted by class or by the class's Tutor in force at each lesson's start.
 */
async function attendanceIn(
  context: Context,
  query: AttendanceReportQuery,
): Promise<AttendanceReport> {
  const year = await yearHolding(context, query.from);
  if (
    year === null ||
    addDays(query.from, REPORT_DAYS_MAX - 1) < query.to ||
    query.to > year.endDate
  ) {
    throw new ApiException('discipline_range', 409);
  }
  const whole = hasRole(context, ATTENDANCE_WHOLE);
  const own = tutorClasses(context);
  const classes = await classesOfBranch(context);
  const readable = (classId: string | null): classId is string =>
    classId !== null && (whole || own.has(lower(classId)));
  // The class filter: unknown or of another branch 404, out of scope 403, then another year.
  if (query.classId !== undefined) {
    const chosen = classes.get(lower(query.classId));
    if (chosen === undefined) throw notFound();
    if (!readable(chosen.id)) throw new ApiException('permission_denied', 403);
    if (chosen.academicYearId !== year.id) throw notFound();
  }
  const journals = await journalRows(context.transaction, context.branchId, { yearId: year.id });
  const freshness = new Freshness();
  const lessons: AttendanceLesson[] = [];
  for (const quarter of await quartersMeeting(context, year.id, query.from, query.to)) {
    const read = await preparedAttendance(
      context,
      quarter,
      journals.map((one) => one.id),
      freshness,
    );
    for (const one of read) {
      if (one.date >= query.from && one.date <= query.to) lessons.push(one);
    }
  }
  // Who each lesson counts for, decided now (decision 4; 8.7 decision 13).
  const counted = await lessonsCounted(
    context.transaction,
    context.branchId,
    lessons.map((one) => ({
      id: one.lessonId,
      journalId: one.journalId,
      date: one.date,
      teacherId: one.recordedTeacherId,
    })),
  );
  const teacherOf = (lesson: AttendanceLesson) => counted.get(lesson.lessonId) ?? null;
  // The choices: every value the reader's own cells of the range hold.
  const inScope = lessons.filter((one) => one.classes.some((entry) => readable(entry.classId)));
  const subjectIds = new Set(inScope.map((one) => one.subjectId));
  const teacherIds = new Set(
    inScope.flatMap((one) => {
      const id = teacherOf(one);
      return id === null ? [] : [id];
    }),
  );
  if (query.subjectId !== undefined && !subjectIds.has(lower(query.subjectId))) {
    const known = await context.transaction
      .selectFrom('subjects')
      .select('id')
      .where('id', '=', query.subjectId)
      .executeTakeFirst();
    if (known === undefined) throw notFound();
  }
  if (query.teacherId !== undefined && !teacherIds.has(lower(query.teacherId))) throw notFound();
  const tutors =
    query.groupBy === 'tutor'
      ? await readTutorRows(context.transaction, [...classes.keys()])
      : new Map<string, TutorRow[]>();
  const total = freshCounts();
  const rows = new Map<string, Record<keyof AttendanceCounts, number>>();
  const days = new Map<string, Record<keyof AttendanceCounts, number>>();
  for (const lesson of inScope) {
    if (query.subjectId !== undefined && lesson.subjectId !== lower(query.subjectId)) continue;
    if (query.teacherId !== undefined && teacherOf(lesson) !== lower(query.teacherId)) continue;
    if (query.start !== undefined && lesson.start !== query.start) continue;
    for (const entry of lesson.classes) {
      if (!readable(entry.classId)) continue;
      const shown = classes.get(entry.classId);
      if (shown === undefined) continue;
      if (query.classId !== undefined && entry.classId !== lower(query.classId)) continue;
      if (query.grade !== undefined && shown.grade !== query.grade) continue;
      add(total, entry);
      const key =
        query.groupBy === 'class'
          ? entry.classId
          : (tutorAt(tutors.get(entry.classId) ?? [], lesson.startsAt) ?? '');
      const row = rows.get(key) ?? freshCounts();
      rows.set(key, row);
      add(row, entry);
      if (query.classId !== undefined) {
        const day = days.get(lesson.date) ?? freshCounts();
        days.set(lesson.date, day);
        add(day, entry);
      }
    }
  }
  const names = await staffNames(context.transaction, [
    ...new Set([
      ...teacherIds,
      ...(query.groupBy === 'tutor' ? [...rows.keys()].filter((key) => key !== '') : []),
    ]),
  ]);
  const readableClasses = [...classes.values()]
    .filter((one) => one.academicYearId === year.id && !one.archived && readable(one.id))
    .sort((a, b) => a.grade - b.grade || a.name.localeCompare(b.name, 'ru'));
  const subjectNames = new Map(journals.map((one) => [one.subjectId, one.subject.names]));
  const shownRows = [...rows].map(([key, counts]) => {
    if (query.groupBy === 'class') {
      const shown = classes.get(key);
      return {
        sort: `${String(shown?.grade ?? 0).padStart(2, '0')}|${shown?.name ?? ''}`,
        row: {
          key: {
            kind: 'class' as const,
            class: { id: key, name: shown?.name ?? '', grade: shown?.grade ?? 1 },
          },
          counts: shownCounts(counts),
          daily: dailyOf(counts),
        },
      };
    }
    const name = key === '' ? null : { id: key, name: names.get(key) ?? '' };
    return {
      sort: name === null ? '￿' : name.name,
      row: {
        key: { kind: 'tutor' as const, tutor: name },
        counts: shownCounts(counts),
        daily: dailyOf(counts),
      },
    };
  });
  shownRows.sort((a, b) => a.sort.localeCompare(b.sort, 'ru'));
  return attendanceReportSchema.parse({
    from: query.from,
    to: query.to,
    groupBy: query.groupBy,
    prepared: freshness.stamp,
    total: { counts: shownCounts(total), daily: dailyOf(total) },
    rows: shownRows.map((one) => one.row),
    days: [...days]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, counts]) => ({ date, daily: dailyOf(counts) })),
    choices: {
      grades: [...new Set(readableClasses.map((one) => one.grade))].sort((a, b) => a - b),
      classes: readableClasses.map(({ id, name, grade }) => ({ id, name, grade })),
      subjects: [...subjectIds]
        .flatMap((id) => {
          const shown = subjectNames.get(id);
          return shown === undefined ? [] : [{ id, names: shown }];
        })
        .sort((a, b) => a.names.en.localeCompare(b.names.en, 'en')),
      teachers: [...teacherIds]
        .map((id) => ({ id, name: names.get(id) ?? '' }))
        .sort((a, b) => a.name.localeCompare(b.name, 'ru') || a.id.localeCompare(b.id)),
      starts: [...new Set(inScope.map((one) => one.start))].sort((a, b) => a - b),
    },
  });
}

/* ----------------------------------------------------- Results table and mastery */

async function choicesIn(
  context: Context,
  query: ResultsReportChoicesQuery,
): Promise<ResultsReportChoices> {
  const { transaction } = context;
  const yearRows = await transaction
    .selectFrom('academic_years')
    .select([
      'id',
      'status',
      sql<string>`start_date::text`.as('start_date'),
      sql<string>`end_date::text`.as('end_date'),
    ])
    .where('branch_id', '=', context.branchId)
    .orderBy('start_date', 'desc')
    .execute();
  const years = yearRows.map((row) => ({
    id: row.id,
    startDate: row.start_date,
    endDate: row.end_date,
    status:
      row.status === 'closed'
        ? ('closed' as const)
        : row.status === 'current'
          ? ('current' as const)
          : ('planned' as const),
  }));
  const year =
    query.yearId !== undefined
      ? years.find((one) => one.id === lower(query.yearId ?? ''))
      : (years.find((one) => one.status === 'current') ??
        years.find((one) => one.startDate <= context.today));
  if (query.yearId !== undefined && year === undefined) throw notFound();
  if (year === undefined) {
    return resultsReportChoicesSchema.parse({
      year: null,
      years,
      quarters: [],
      classes: [],
      subjects: [],
    });
  }
  const quarterRows = await transaction
    .selectFrom('quarters')
    .select([
      'id',
      'number',
      sql<string | null>`start_date::text`.as('start_date'),
      sql<string | null>`end_date::text`.as('end_date'),
    ])
    .where('academic_year_id', '=', year.id)
    .orderBy('number')
    .execute();
  const quarters: ResultsReportChoices['quarters'] = [];
  for (const row of quarterRows) {
    if (row.start_date === null || row.end_date === null || row.start_date > context.today) {
      continue;
    }
    const quarter: QuarterRow = {
      id: row.id,
      number: row.number,
      academicYearId: year.id,
      startDate: row.start_date,
      endDate: row.end_date,
      yearStatus: year.status,
    };
    const state = await quarterStateOf(context, quarter);
    quarters.push({
      id: quarter.id,
      number: quarter.number,
      startDate: quarter.startDate,
      endDate: quarter.endDate,
      closed: state.closing !== null,
      notOfficial: state.notOfficial,
    });
  }
  const classRows = await transaction
    .selectFrom('classes')
    .select(['id', 'grade', 'name', 'language'])
    .where('branch_id', '=', context.branchId)
    .where('academic_year_id', '=', year.id)
    .where('archived_at', 'is', null)
    .orderBy('grade')
    .orderBy('name')
    .execute();
  const classes = classRows.flatMap((row) =>
    (row.language === 'uz' || row.language === 'ru') && mayTable(context, row.id)
      ? [
          {
            id: row.id,
            name: classDisplayName(row.grade, row.name),
            grade: row.grade,
            language: row.language,
          },
        ]
      : [],
  );
  const journals = (await journalRows(transaction, context.branchId, { yearId: year.id })).filter(
    (journal) =>
      quarters.some((quarter) => graded(journal, quarter.id)) && mayMaster(context, journal),
  );
  const subjects = new Map(journals.map((one) => [one.subjectId, one.subject.names]));
  return resultsReportChoicesSchema.parse({
    year,
    years,
    quarters,
    classes,
    subjects: [...subjects]
      .map(([id, names]) => ({ id, names }))
      .sort((a, b) => a.names.en.localeCompare(b.names.en, 'en')),
  });
}

/**
 * The results table (`08`, Analytics, "Each student against each subject for a quarter, with
 * result and grade"): the members of the class on the reference date, and for each graded subject
 * of the class's journals the outcome the rating reads (the stored record of a closed quarter);
 * attendance-only subjects are left out (`edge/calculation`).
 */
async function tableIn(context: Context, query: ResultsTableQuery): Promise<ResultsTable> {
  const { transaction } = context;
  const quarter = await quarterOf(context, query.quarterId);
  const classes = await classesOfBranch(context);
  const shown = classes.get(lower(query.classId));
  if (shown === undefined) throw notFound();
  if (!mayTable(context, shown.id)) throw new ApiException('permission_denied', 403);
  if (shown.academicYearId !== quarter.academicYearId || shown.archived) throw notFound();
  const scope = tableSubjects(context, shown.id);
  const journals = (
    await journalRows(transaction, context.branchId, { yearId: quarter.academicYearId })
  ).filter(
    (journal) =>
      ofClass(journal, shown.id) &&
      graded(journal, quarter.id) &&
      (scope === null || scope.has(lower(journal.subjectId))),
  );
  const subjects = new Map<string, JournalRow>();
  for (const journal of journals) {
    if (!subjects.has(journal.subjectId)) subjects.set(journal.subjectId, journal);
  }
  const columns = [...subjects.values()].sort((a, b) =>
    a.subject.names.en.localeCompare(b.subject.names.en, 'en'),
  );
  const referenceDate = referenceDateOf(quarter, context.today);
  const state = await quarterStateOf(context, quarter);
  const freshness = new Freshness();
  const outcomes = await preparedOutcomes(
    context,
    quarter,
    state,
    columns.map((one) => one.subjectId),
    freshness,
  );
  const members = await membersOn(transaction, { classId: shown.id, groupId: null }, referenceDate);
  const names = await namesOf(transaction, members);
  return resultsTableSchema.parse({
    ...listStateOf(quarter, state, outcomes.readLive, freshness),
    class: { id: shown.id, name: shown.name, grade: shown.grade },
    subjects: columns.map((one) => ({
      id: one.subjectId,
      names: one.subject.names,
      colour: one.subject.colour,
    })),
    rows: [...names.values()].sort(byName).map((student) => ({
      student,
      results: columns.map((one) => {
        const outcome = outcomes.bySubject.get(one.subjectId)?.get(student.id);
        return {
          subjectId: one.subjectId,
          state: outcome === undefined ? 'no_result' : outcome.kind,
          value: outcome?.kind === 'number' ? Number(outcome.result.shown) : null,
          grade: outcome?.kind === 'number' ? outcome.result.grade : null,
        };
      }),
    })),
  });
}

/**
 * Subject mastery (`08`, Analytics, "Share of students in each grade band for a subject";
 * decision 3): the members on the reference date of the subject's graded journals the reader may
 * read, filtered by grade, class and teacher (the journal's owner on the reference date); a
 * student with a number counts in the band of its grade, the others beside the bands.
 */
async function masteryIn(context: Context, query: SubjectMasteryQuery): Promise<SubjectMastery> {
  const { transaction } = context;
  const quarter = await quarterOf(context, query.quarterId);
  const subject = await transaction
    .selectFrom('subjects')
    .select('id')
    .where('id', '=', query.subjectId)
    .executeTakeFirst();
  if (subject === undefined) throw notFound();
  const ofSubject = (
    await journalRows(transaction, context.branchId, { yearId: quarter.academicYearId })
  ).filter((journal) => journal.subjectId === subject.id);
  // The scope first, so a refusal after it tells nothing of journals the reader may not read.
  const readable = ofSubject.filter((journal) => mayMaster(context, journal));
  if (readable.length === 0) {
    // Only a reader of every journal learns that the subject has none in the branch this year
    // (permission review, should-fix 5); any other reader is refused the same either way.
    if (ofSubject.length === 0 && isManagement(context)) throw notFound();
    throw new ApiException('permission_denied', 403);
  }
  const gradedJournals = readable.filter((journal) => graded(journal, quarter.id));
  // An attendance-only subject has no result, so no mastery (`edge/calculation`).
  const first = gradedJournals[0];
  if (first === undefined) throw notFound();
  const classes = await classesOfBranch(context);
  if (query.classId !== undefined) {
    const chosen = classes.get(lower(query.classId));
    if (chosen === undefined) throw notFound();
    if (!gradedJournals.some((journal) => ofClass(journal, chosen.id))) {
      throw new ApiException('permission_denied', 403);
    }
  }
  const referenceDate = referenceDateOf(quarter, context.today);
  const owners = new Map<string, string | null>();
  for (const journal of gradedJournals) {
    owners.set(journal.id, await ownerIdOn(transaction, context.branchId, journal, referenceDate));
  }
  const teacherIds = [...new Set([...owners.values()].flatMap((id) => (id === null ? [] : [id])))];
  if (query.teacherId !== undefined && !teacherIds.includes(lower(query.teacherId))) {
    throw notFound();
  }
  const chosen = gradedJournals.filter(
    (journal) =>
      (query.classId === undefined || ofClass(journal, lower(query.classId))) &&
      (query.grade === undefined || journal.grades.includes(query.grade)) &&
      (query.teacherId === undefined || owners.get(journal.id) === lower(query.teacherId)),
  );
  const state = await quarterStateOf(context, quarter);
  const freshness = new Freshness();
  const outcomes = await preparedOutcomes(context, quarter, state, [subject.id], freshness);
  const counted = new Map<string, StudentQuarterOutcome | undefined>();
  for (const journal of chosen) {
    const own = outcomes.byJournal.get(journal.id);
    for (const studentId of await membersOn(transaction, journal, referenceDate)) {
      if (!counted.has(studentId)) counted.set(studentId, own?.get(studentId));
    }
  }
  const byGrade = new Map<number, number>();
  let numbers = 0;
  let exempt = 0;
  let notAssessed = 0;
  let noResult = 0;
  for (const outcome of counted.values()) {
    if (outcome?.atLeaving != null) continue;
    if (outcome?.kind === 'number') {
      numbers += 1;
      byGrade.set(outcome.result.grade, (byGrade.get(outcome.result.grade) ?? 0) + 1);
    } else if (outcome?.kind === 'exempt') exempt += 1;
    else if (outcome?.kind === 'not_assessed') notAssessed += 1;
    else noResult += 1;
  }
  const names = await staffNames(transaction, teacherIds);
  const classIds = [
    ...new Set(
      gradedJournals.flatMap((journal) =>
        journal.classId === null ? journal.groupClassIds : [journal.classId],
      ),
    ),
  ];
  return subjectMasterySchema.parse({
    ...listStateOf(quarter, state, outcomes.readLive, freshness),
    subject: { id: first.subjectId, names: first.subject.names, colour: first.subject.colour },
    bands: [...GRADE_BANDS]
      .sort((a, b) => b.grade - a.grade)
      .map((band) => {
        const students = byGrade.get(band.grade) ?? 0;
        return {
          grade: band.grade,
          from: band.from,
          to: band.to,
          students,
          percent: share(students, numbers),
        };
      }),
    counted: numbers,
    exempt,
    notAssessed,
    noResult,
    choices: {
      grades: [...new Set(gradedJournals.flatMap((journal) => journal.grades))].sort(
        (a, b) => a - b,
      ),
      classes: classIds
        .flatMap((id) => {
          const one = classes.get(id);
          return one === undefined ? [] : [{ id: one.id, name: one.name, grade: one.grade }];
        })
        .sort((a, b) => a.grade - b.grade || a.name.localeCompare(b.name, 'ru')),
      teachers: teacherIds
        .map((id) => ({ id, name: names.get(id) ?? '' }))
        .sort((a, b) => a.name.localeCompare(b.name, 'ru') || a.id.localeCompare(b.id)),
      journals: gradedJournals.map((journal) => ({
        id: journal.id,
        unit: {
          kind: journal.classId === null ? 'group' : 'class',
          id: journal.classId ?? journal.groupId ?? '',
          name: journal.unitName,
        },
      })),
    },
  });
}

/* ---------------------------------------------------------------- Files */

const percentCell = (value: number | null): Cell => (value === null ? null : value / 100);

function file(
  texts: ReportExportTexts,
  kind: keyof ReportExportTexts['fileNames'],
  sheets: readonly Sheet[],
): Promise<XlsxFile> {
  return writeSheets(sheets).then(
    (content) =>
      new XlsxFile(
        `${texts.fileNames[kind]}.xlsx`,
        `${REPORT_EXPORT_ASCII_NAMES[kind]}.xlsx`,
        (sheets[0]?.headings ?? []).map((_, index) => `column${String(index + 1)}`),
        content,
      ),
  );
}

function attendanceSheet(
  report: AttendanceReport,
  texts: ReportExportTexts,
  moment: string,
): Sheet {
  const c = texts.columns;
  const counts = (one: AttendanceCountsShown, daily: AttendanceFigure): Cell[] => [
    one.present,
    one.late,
    one.absent,
    one.skipped,
    one.unmarked,
    one.exempt,
    one.expected,
    percentCell(one.percents.present),
    percentCell(daily.percent),
  ];
  return {
    name: texts.sheets.attendance,
    preamble: [
      fillText(texts.range, { from: dateText(report.from), to: dateText(report.to) }),
      fillText(texts.exportedAt, { moment }),
    ],
    headings: [
      report.groupBy === 'class' ? c.class : c.tutor,
      c.present,
      c.late,
      c.absent,
      c.skipped,
      c.unmarked,
      c.exempt,
      c.expected,
      `${c.present} ${c.percentOfExpected}`,
      c.daily,
    ],
    rows: [
      ...report.rows.map((row) => [
        row.key.kind === 'class' ? row.key.class.name : (row.key.tutor?.name ?? texts.noTutor),
        ...counts(row.counts, row.daily),
      ]),
      [texts.total, ...counts(report.total.counts, report.total.daily)],
    ],
  };
}

const studentName = (student: ResultsTable['rows'][number]['student']): string =>
  [student.lastName, student.firstName, student.paternalName ?? ''].join(' ').trim();

function tableSheet(
  table: ResultsTable,
  texts: ReportExportTexts,
  language: Language,
  preamble: readonly string[],
): Sheet {
  return {
    name: texts.sheets.table,
    preamble: [table.class.name, ...preamble],
    headings: [
      texts.columns.student,
      ...table.subjects.flatMap((one) => [one.names[language], texts.columns.grade]),
    ],
    rows: table.rows.map((row) => [
      studentName(row.student),
      ...row.results.flatMap((one): Cell[] =>
        one.state === 'number' ? [one.value, one.grade] : [texts.states[one.state], null],
      ),
    ]),
  };
}

function masterySheet(
  mastery: SubjectMastery,
  texts: ReportExportTexts,
  language: Language,
  preamble: readonly string[],
): Sheet {
  const c = texts.columns;
  return {
    name: texts.sheets.mastery,
    preamble: [mastery.subject.names[language], ...preamble],
    headings: [c.grade, c.band, c.students, c.percent],
    rows: [
      ...mastery.bands.map((band): Cell[] => [
        band.grade,
        `${String(band.from)}–${String(band.to)}`,
        band.students,
        percentCell(band.percent),
      ]),
      [texts.states.exempt, null, mastery.exempt, null],
      [texts.states.not_assessed, null, mastery.notAssessed, null],
      [texts.states.no_result, null, mastery.noResult, null],
    ],
  };
}
