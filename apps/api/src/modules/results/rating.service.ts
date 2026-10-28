import { Injectable } from '@nestjs/common';
import {
  classFigure,
  oneDecimal,
  ratingPlaces,
  storedQuarterOutcome,
  subjectsFigure,
  type Fraction,
  type RatingPlace,
  type StudentQuarterOutcome,
} from '@sodiq/calc';
import {
  classDisplayName,
  fillText,
  isLanguage,
  RATING_EXPORT_ASCII_NAME,
  RATING_EXPORT_TEXTS,
  ratingChoicesSchema,
  ratingClassesListSchema,
  ratingClassListSchema,
  ratingSubjectListSchema,
  schoolDateOf,
  type InstructionLanguage,
  type Language,
  type RatingChoices,
  type RatingChoicesQuery,
  type RatingClass,
  type RatingClassesList,
  type RatingClassesQuery,
  type RatingClassList,
  type RatingClassQuery,
  type RatingExport,
  type RatingExportTexts,
  type RatingState,
  type RatingSubjectList,
  type RatingSubjectQuery,
} from '@sodiq/shared';
import { sql } from 'kysely';
import { Transactions, transactionMoment, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import { writeWorkbook, XlsxFile, type Cell, type Sheet } from '../../http/xlsx.js';
import type { Access } from '../access/permission.guard.js';
import { Audit } from '../audit/audit.service.js';
import { branchOf } from '../classes/classes.service.js';
import { ownStaffOf } from '../journal/attendance-entry.js';
import { journalRows, switchesIn, type JournalRow } from '../journal/journal-grid.query.js';
import { WHOLE_ROLES } from '../journal/journal-scope.js';
import { ownerIdOn } from '../plans/plan-scope.js';
import { closingOf } from '../setup/closed-quarters.js';
import { notFound } from '../setup/setup-refusals.js';
import { momentText } from '../timetable/views-export.service.js';
import { dateText } from '../timetable/views-file.js';
import type { QuarterRef } from './grade-changes.js';
import type { BranchMoment } from './branch-moment.js';
import { Freshness, preparedOutcomes } from './prepared/read.js';
import { quarterOutcomes } from './quarter-outcomes.js';
import { storedRecordsOf } from './stored-records.js';

/**
 * The rating (task 9.3a, pull request #234; `08`, Rating; `07`, Effect on totals, Rating;
 * `edge/calculation`). Worked out on read for one quarter of the branch of the request: the
 * outcome of each student and subject is the one the journal and the student's Results tab give,
 * `quarterOutcomes` while the quarter is open and the stored record in force once it is closed
 * (`storedRecordsOf`; From 9.2b: never calculated again), a journal with an unfinished reopening
 * read live. `packages/calc` places and figures them (`ratingPlaces`, `subjectsFigure`,
 * `classFigure`, `oneDecimal`); nothing is calculated here.
 *
 * Who is counted (plan decisions 5 and 6): the members of the class or group on the reference
 * date (`edge/00-definitions`: the quarter's last day, or today while it is open), each once; a
 * student whose outcome is a result at leaving is left out (`edge/calculation`, "A student left
 * the school"); only a number is ranked, the others are listed after the ranked rows with no
 * place.
 *
 * Who reads (plan decisions 1 and 4, review correction 2), from the assignments that permit the
 * route, never `access.role`:
 *
 * | List | Readers |
 * | --- | --- |
 * | one subject | management: every journal; Head Teacher, Senior Head Teacher: own subjects; Teacher: the owner on the reference date; Tutor: the class journals of own classes and the group journals whose every class is an own class |
 * | a class, all subjects | management, the Head Tutor: every class; Tutor: own classes |
 * | classes | management |
 *
 * Management is the Super Admin, the Principal and the Academic Vice Principal (`WHOLE_ROLES`).
 * A Tutor's own classes are the rows in force at the request, as the journal reads them
 * (`journal-scope.ts`). A read writes no audit entry; an export writes one in the transaction of
 * its read.
 */

export const SUBJECT_ROLES = ['head_teacher', 'senior_head_teacher'] as const;

const lower = (id: string) => id.toLowerCase();

export interface QuarterRow extends QuarterRef {
  readonly yearStatus: string;
}

export interface Context extends BranchMoment {
  readonly access: Access;
}

/** How the quarter's figures are read: provisional, or the close in force (9.2b). */
export interface QuarterState {
  readonly closing: { readonly closedAt: Date; readonly version: number } | null;
  readonly notOfficial: boolean;
}

/** The outcomes of a quarter by subject and student, as the readers of results take them. */
export interface Outcomes {
  /** By journal and student: the outcome as that journal reads it. */
  readonly byJournal: ReadonlyMap<string, ReadonlyMap<string, StudentQuarterOutcome>>;
  /** By subject and student: the outcome of the journal of the last membership. */
  readonly bySubject: ReadonlyMap<string, ReadonlyMap<string, StudentQuarterOutcome>>;
  /** A record listed under a journal with an unfinished reopening was read live. */
  readonly readLive: boolean;
}

export interface StudentName {
  readonly id: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly paternalName: string | null;
}

/** The reference date of a quarter (`edge/00-definitions`). */
export const referenceDateOf = (quarter: QuarterRef, today: string): string =>
  today > quarter.endDate ? quarter.endDate : today < quarter.startDate ? quarter.startDate : today;

const tenths = (value: Fraction | null): number | null =>
  value === null ? null : Number(oneDecimal(value));

const stateOf = (outcome: StudentQuarterOutcome | undefined): RatingState =>
  outcome === undefined ? 'no_result' : outcome.kind;

export const byName = (a: StudentName, b: StudentName): number =>
  a.lastName.localeCompare(b.lastName, 'ru') ||
  a.firstName.localeCompare(b.firstName, 'ru') ||
  (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** The places in order; within a shared place and among the unranked, by name. */
function placed<T>(
  places: readonly RatingPlace[],
  of: ReadonlyMap<string, T>,
  order: (a: T, b: T) => number,
): { place: RatingPlace; item: T }[] {
  const rows = places.flatMap((place) => {
    const item = of.get(place.id);
    return item === undefined ? [] : [{ place, item }];
  });
  const rank = (place: number | null) => place ?? Number.MAX_SAFE_INTEGER;
  return rows.sort((a, b) => rank(a.place.place) - rank(b.place.place) || order(a.item, b.item));
}

@Injectable()
export class RatingService {
  constructor(
    private readonly transactions: Transactions,
    private readonly audit: Audit,
  ) {}

  choices(access: Access, query: RatingChoicesQuery): Promise<RatingChoices> {
    return this.run(access, (context) => choicesIn(context, query));
  }

  subject(access: Access, query: RatingSubjectQuery): Promise<RatingSubjectList> {
    return this.run(access, (context) => subjectIn(context, query));
  }

  classRating(access: Access, query: RatingClassQuery): Promise<RatingClassList> {
    return this.run(access, (context) => classIn(context, query));
  }

  classes(access: Access, query: RatingClassesQuery): Promise<RatingClassesList> {
    return this.run(access, (context) => classesIn(context, query));
  }

  /**
   * One list as Excel, from the reader's own answer, stamped "Provisional" with the moment or
   * "Final" with the close (`edge/journal`, "A results table is exported in week 6"), with one
   * audit entry in the transaction of the read (`CLAUDE.md`: "every export is logged").
   */
  async export(access: Access, input: RatingExport, requestId: string): Promise<XlsxFile> {
    const read = await this.run(access, async (context) => {
      const list =
        input.kind === 'subject'
          ? ({ kind: 'subject', list: await subjectIn(context, input) } as const)
          : input.kind === 'class'
            ? ({ kind: 'class', list: await classIn(context, input) } as const)
            : ({ kind: 'classes', list: await classesIn(context, input) } as const);
      const account = await context.transaction
        .selectFrom('accounts')
        .select('language')
        .where('id', '=', access.accountId)
        .executeTakeFirstOrThrow();
      const language: Language = isLanguage(account.language) ? account.language : 'uz';
      await this.audit.record(context.transaction, {
        branchId: context.branchId,
        actorId: access.accountId,
        assignmentId: access.assignmentId,
        action: 'rating.export',
        details: {
          ...input,
          asOf: context.now.toISOString(),
          final: list.list.final === null ? null : list.list.final.version,
          rows: list.list.rows.length,
        },
        requestId,
      });
      return { ...list, language, timeZone: context.timeZone, now: context.now };
    });
    const texts = RATING_EXPORT_TEXTS[read.language];
    const sheet = sheetOf(read, texts, read.language);
    const content = await writeWorkbook(sheet);
    const name = `${texts.fileName}-${read.kind}-${String(read.list.quarter.number)}.xlsx`;
    return new XlsxFile(
      name,
      `${RATING_EXPORT_ASCII_NAME}-${read.kind}-${String(read.list.quarter.number)}.xlsx`,
      sheet.headings.map((_, index) => `column${String(index + 1)}`),
      content,
    );
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

export const permitting = (context: Context, roles: readonly string[]) =>
  context.access.permitting.filter((assignment) => roles.includes(assignment.role));

export const isManagement = (context: Context): boolean =>
  permitting(context, WHOLE_ROLES).length > 0;

/** The Tutor's own classes, in small letters (rows in force at the request). */
export const tutorClasses = (context: Context): Set<string> =>
  new Set(permitting(context, ['tutor']).flatMap((assignment) => assignment.classIds));

/** Whether the reader may rank the journal in one subject on the reference date. */
export async function mayRankJournal(
  context: Context,
  journal: JournalRow,
  referenceDate: string,
): Promise<boolean> {
  if (isManagement(context)) return true;
  const subject = lower(journal.subjectId);
  if (permitting(context, SUBJECT_ROLES).some((one) => one.subjectIds.includes(subject))) {
    return true;
  }
  const own = tutorClasses(context);
  if (journal.classId !== null && own.has(lower(journal.classId))) return true;
  // Review correction 2: a group whose every class is an own class (a split of one).
  if (
    journal.groupId !== null &&
    journal.groupClassIds.length > 0 &&
    journal.groupClassIds.every((id) => own.has(lower(id)))
  ) {
    return true;
  }
  if (permitting(context, ['teacher']).length === 0) return false;
  const staffId = await ownStaffOf(context.transaction, context.access.accountId);
  if (staffId === null) return false;
  return (
    (await ownerIdOn(context.transaction, context.branchId, journal, referenceDate)) === staffId
  );
}

/** Whether the reader may rank the class across subjects. */
const mayRankClass = (context: Context, classId: string): boolean =>
  isManagement(context) ||
  permitting(context, ['head_tutor']).length > 0 ||
  tutorClasses(context).has(lower(classId));

/** A started quarter of the branch with its dates; 404 when unknown or of another branch. */
export async function quarterOf(context: Context, quarterId: string): Promise<QuarterRow> {
  const row = await context.transaction
    .selectFrom('quarters')
    .innerJoin('academic_years', 'academic_years.id', 'quarters.academic_year_id')
    .select([
      'quarters.id',
      'quarters.number',
      'quarters.academic_year_id',
      'academic_years.status',
      sql<string | null>`quarters.start_date::text`.as('start_date'),
      sql<string | null>`quarters.end_date::text`.as('end_date'),
    ])
    .where('quarters.id', '=', quarterId)
    .where('academic_years.branch_id', '=', context.branchId)
    .executeTakeFirst();
  if (row?.start_date == null || row.end_date == null) throw notFound();
  return {
    id: row.id,
    number: row.number,
    academicYearId: row.academic_year_id,
    startDate: row.start_date,
    endDate: row.end_date,
    yearStatus: row.status,
  };
}

export async function quarterStateOf(
  context: BranchMoment,
  quarter: QuarterRef,
): Promise<QuarterState> {
  const closing = await closingOf(context.transaction, quarter.id);
  return {
    closing:
      closing === undefined ? null : { closedAt: closing.closed_at, version: closing.version },
    notOfficial: closing?.start_quarter === 'not_official',
  };
}

/**
 * The outcome of every member of the graded journals of the subjects named (every subject when
 * `null`), by subject and student: the journal's (`quarterOutcomes`), replaced in a closed quarter
 * by the stored record in force unless its journal was reopened.
 */
export async function outcomesOf(
  context: BranchMoment,
  quarter: QuarterRef,
  state: QuarterState,
  subjectIds: readonly string[] | null,
): Promise<Outcomes> {
  const { journals } = await quarterOutcomes(context.transaction, {
    branchId: context.branchId,
    timeZone: context.timeZone,
    now: context.now,
    quarter,
    subjectIds,
    quarterClosed: state.closing !== null,
  });
  const stored =
    state.closing === null
      ? new Map<string, { record: unknown; reopened: boolean }>()
      : await storedRecordsOf(
          context.transaction,
          quarter.id,
          subjectIds?.length === 1 && subjectIds[0] !== undefined
            ? { subjectId: subjectIds[0] }
            : {},
        );
  let readLive = false;
  const byJournal = new Map<string, Map<string, StudentQuarterOutcome>>();
  const bySubject = new Map<string, Map<string, StudentQuarterOutcome>>();
  for (const one of journals.values()) {
    const subjectId = one.journal.subjectId;
    const inJournal = new Map<string, StudentQuarterOutcome>();
    byJournal.set(one.journal.id, inJournal);
    const own = bySubject.get(subjectId) ?? new Map<string, StudentQuarterOutcome>();
    bySubject.set(subjectId, own);
    for (const [studentId, member] of one.members) {
      const found = stored.get(`${subjectId}|${studentId}`);
      if (found?.reopened === true) readLive = true;
      const outcome =
        found?.record === undefined ? member.outcome : storedQuarterOutcome(found.record);
      if (outcome === null) continue;
      inJournal.set(studentId, outcome);
      // Across subjects the outcome of the journal of the student's last membership in the
      // quarter, as the student's Results tab reads it: journals of one subject may differ in
      // their rating exam switch (spec review of the code, should-fix 2).
      const spans = member.found?.spans ?? [];
      const last = spans.reduce<(typeof spans)[number] | undefined>(
        (latest, span) => (latest === undefined || span.until > latest.until ? span : latest),
        undefined,
      );
      if (last === undefined || last.journalId === one.journal.id || !own.has(studentId)) {
        own.set(studentId, outcome);
      }
    }
  }
  return { byJournal, bySubject, readLive };
}

/** The members of a class, or of a group in its subject, on a day, each once. */
export async function membersOn(
  transaction: Transaction,
  unit: {
    readonly classId: string | null;
    readonly groupId: string | null;
    readonly subjectId?: string;
  },
  day: string,
): Promise<string[]> {
  const rows =
    unit.classId !== null
      ? await transaction
          .selectFrom('class_memberships')
          .select('student_id')
          .distinct()
          .where('class_id', '=', unit.classId)
          .whereRef('valid_from', '<', 'valid_until')
          .where('valid_from', '<=', day)
          .where('valid_until', '>', day)
          .execute()
      : await transaction
          .selectFrom('group_memberships')
          .select('student_id')
          .distinct()
          .where('group_id', '=', unit.groupId ?? '')
          .where('subject_id', '=', unit.subjectId ?? '')
          .whereRef('valid_from', '<', 'valid_until')
          .where('valid_from', '<=', day)
          .where('valid_until', '>', day)
          .execute();
  return rows.map((row) => row.student_id).sort();
}

export async function namesOf(
  transaction: Transaction,
  ids: readonly string[],
): Promise<Map<string, StudentName>> {
  if (ids.length === 0) return new Map();
  const rows = await transaction
    .selectFrom('students')
    .select(['id', 'first_name', 'last_name', 'paternal_name'])
    .where('id', 'in', [...ids])
    .execute();
  return new Map(
    rows.map((row) => [
      row.id,
      {
        id: row.id,
        firstName: row.first_name,
        lastName: row.last_name,
        paternalName: row.paternal_name,
      },
    ]),
  );
}

/** The languages of the classes and groups of the journals given, by journal. */
async function languagesOf(
  transaction: Transaction,
  journals: readonly JournalRow[],
): Promise<Map<string, InstructionLanguage>> {
  const classIds = journals.flatMap((one) => (one.classId === null ? [] : [one.classId]));
  const groupIds = journals.flatMap((one) => (one.groupId === null ? [] : [one.groupId]));
  const [classes, groups] = await Promise.all([
    classIds.length === 0
      ? []
      : transaction
          .selectFrom('classes')
          .select(['id', 'language'])
          .where('id', 'in', classIds)
          .execute(),
    groupIds.length === 0
      ? []
      : transaction
          .selectFrom('groups')
          .select(['id', 'language'])
          .where('id', 'in', groupIds)
          .execute(),
  ]);
  const of = new Map([...classes, ...groups].map((row) => [row.id, row.language]));
  return new Map(
    journals.flatMap((one) => {
      const language = of.get(one.classId ?? one.groupId ?? '');
      return language === 'uz' || language === 'ru' ? [[one.id, language] as const] : [];
    }),
  );
}

function journalShown(journal: JournalRow, language: InstructionLanguage) {
  return {
    id: journal.id,
    subject: {
      id: journal.subjectId,
      names: journal.subject.names,
      colour: journal.subject.colour,
    },
    unit: {
      kind: journal.classId === null ? 'group' : 'class',
      id: journal.classId ?? journal.groupId ?? '',
      name: journal.unitName,
    },
    grades: [...journal.grades],
    language,
  };
}

/** The classes of the year in the branch, not archived. */
export async function classesOfYear(context: Context, yearId: string): Promise<RatingClass[]> {
  const rows = await context.transaction
    .selectFrom('classes')
    .select(['id', 'grade', 'name', 'language'])
    .where('branch_id', '=', context.branchId)
    .where('academic_year_id', '=', yearId)
    .where('archived_at', 'is', null)
    .orderBy('grade')
    .orderBy('name')
    .execute();
  return rows.flatMap((row) =>
    row.language === 'uz' || row.language === 'ru'
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
}

export const listStateOf = (
  quarter: QuarterRow,
  state: QuarterState,
  readLive: boolean,
  freshness: Freshness,
) => {
  const final = state.closing !== null && !readLive ? state.closing : null;
  return {
    prepared: freshness.stamp,
    quarter: {
      id: quarter.id,
      number: quarter.number,
      startDate: quarter.startDate,
      endDate: quarter.endDate,
      closed: state.closing !== null,
      notOfficial: state.notOfficial,
    },
    provisional: final === null,
    final:
      final === null ? null : { closedAt: final.closedAt.toISOString(), version: final.version },
  };
};

/** The years and started quarters of the branch and the lists the reader may open. */
async function choicesIn(context: Context, query: RatingChoicesQuery): Promise<RatingChoices> {
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
  let year: (typeof years)[number] | null;
  if (query.yearId !== undefined) {
    year = years.find((one) => one.id === lower(query.yearId ?? '')) ?? null;
    if (year === null) throw notFound();
  } else {
    year =
      years.find((one) => one.status === 'current') ??
      years.find((one) => one.startDate <= context.today) ??
      null;
  }
  if (year === null) {
    return ratingChoicesSchema.parse({
      year,
      years,
      quarters: [],
      journals: [],
      classes: [],
      classesList: false,
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
  const quarters: QuarterRow[] = quarterRows.flatMap((row) =>
    row.start_date === null || row.end_date === null || row.start_date > context.today
      ? []
      : [
          {
            id: row.id,
            number: row.number,
            academicYearId: year.id,
            startDate: row.start_date,
            endDate: row.end_date,
            yearStatus: year.status,
          },
        ],
  );
  const states = new Map<string, QuarterState>();
  for (const quarter of quarters) states.set(quarter.id, await quarterStateOf(context, quarter));
  // A journal graded in a started quarter, which the reader may rank on that quarter's
  // reference date.
  const graded = (await journalRows(transaction, context.branchId, { yearId: year.id })).filter(
    (journal) =>
      quarters.some((quarter) => switchesIn(journal, quarter.id)?.attendanceOnly === false),
  );
  const languages = await languagesOf(transaction, graded);
  const journals: ReturnType<typeof journalShown>[] = [];
  for (const journal of graded) {
    const language = languages.get(journal.id);
    if (language === undefined) continue;
    let may = false;
    for (const quarter of quarters) {
      if (switchesIn(journal, quarter.id)?.attendanceOnly !== false) continue;
      if (await mayRankJournal(context, journal, referenceDateOf(quarter, context.today))) {
        may = true;
        break;
      }
    }
    if (may) journals.push(journalShown(journal, language));
  }
  journals.sort(
    (a, b) =>
      a.subject.names.en.localeCompare(b.subject.names.en, 'en') ||
      a.unit.name.localeCompare(b.unit.name, 'en'),
  );
  const classes = (await classesOfYear(context, year.id)).filter((one) =>
    mayRankClass(context, one.id),
  );
  return ratingChoicesSchema.parse({
    year,
    years,
    quarters: quarters.map((quarter) => ({
      id: quarter.id,
      number: quarter.number,
      startDate: quarter.startDate,
      endDate: quarter.endDate,
      closed: states.get(quarter.id)?.closing != null,
      notOfficial: states.get(quarter.id)?.notOfficial === true,
    })),
    journals,
    classes,
    classesList: isManagement(context),
  });
}

/** The students of a class or group in one subject, by quarter result. */
async function subjectIn(context: Context, query: RatingSubjectQuery): Promise<RatingSubjectList> {
  const { transaction } = context;
  const quarter = await quarterOf(context, query.quarterId);
  const [journal] = await journalRows(transaction, context.branchId, {
    journalId: query.journalId,
  });
  if (journal === undefined) throw notFound();
  const referenceDate = referenceDateOf(quarter, context.today);
  // The scope first: a refusal after it (another year, attendance only) tells nothing of a
  // journal the reader may not read (permission review, must-fix 1).
  if (!(await mayRankJournal(context, journal, referenceDate))) {
    throw new ApiException('permission_denied', 403);
  }
  if (journal.academicYearId !== quarter.academicYearId) throw notFound();
  // `edge/calculation`, Ma'naviyat soati: an attendance-only subject has no rating.
  if (switchesIn(journal, quarter.id)?.attendanceOnly !== false) throw notFound();
  const state = await quarterStateOf(context, quarter);
  const freshness = new Freshness();
  const outcomes = await preparedOutcomes(context, quarter, state, [journal.subjectId], freshness);
  const own = outcomes.byJournal.get(journal.id) ?? new Map<string, StudentQuarterOutcome>();
  const members = (await membersOn(transaction, journal, referenceDate)).filter(
    (studentId) => own.get(studentId)?.atLeaving == null,
  );
  const names = await namesOf(transaction, members);
  const places = ratingPlaces(
    members.map((studentId) => {
      const outcome = own.get(studentId);
      return { id: studentId, value: outcome?.kind === 'number' ? outcome.result.value : null };
    }),
  );
  const language = (await languagesOf(transaction, [journal])).get(journal.id) ?? 'uz';
  return ratingSubjectListSchema.parse({
    ...listStateOf(quarter, state, outcomes.readLive, freshness),
    journal: journalShown(journal, language),
    rows: placed(places, names, byName).map(({ place, item }) => {
      const outcome = own.get(item.id);
      return {
        student: item,
        place: place.place,
        value: tenths(place.value),
        state: stateOf(outcome),
        flags: outcome?.kind === 'number' && outcome.undecided ? [...outcome.flags] : [],
        leftSubjectOn: outcome?.leftSubjectOn ?? null,
      };
    }),
  });
}

/** Each student's figure across the graded subjects, students with a result at leaving left out. */
function figuresOf(
  outcomes: Outcomes,
  studentIds: readonly string[],
): Map<string, ReturnType<typeof subjectsFigure>> {
  const figures = new Map<string, ReturnType<typeof subjectsFigure>>();
  for (const studentId of studentIds) {
    const own = [...outcomes.bySubject.values()].flatMap((bySubject) => {
      const outcome = bySubject.get(studentId);
      return outcome === undefined ? [] : [outcome];
    });
    if (own.some((outcome) => outcome.atLeaving !== null)) continue;
    figures.set(studentId, subjectsFigure(own));
  }
  return figures;
}

/**
 * The class of the branch (404 when unknown or of another branch), its scope (403), then a class
 * of another year or archived (404): the scope first, so a refusal tells nothing of a class the
 * reader may not read (permission review, must-fix 1 and should-fix 4; archived as the choices).
 */
async function classRowOf(context: Context, classId: string, yearId: string): Promise<RatingClass> {
  const row = await context.transaction
    .selectFrom('classes')
    .select(['id', 'grade', 'name', 'language', 'academic_year_id', 'archived_at'])
    .where('id', '=', classId)
    .where('branch_id', '=', context.branchId)
    .executeTakeFirst();
  if (row === undefined) throw notFound();
  if (!mayRankClass(context, row.id)) throw new ApiException('permission_denied', 403);
  if (
    row.academic_year_id !== yearId ||
    row.archived_at !== null ||
    (row.language !== 'uz' && row.language !== 'ru')
  ) {
    throw notFound();
  }
  return {
    id: row.id,
    name: classDisplayName(row.grade, row.name),
    grade: row.grade,
    language: row.language,
  };
}

/** The students of a class across all subjects, by the mean of their quarter results. */
async function classIn(context: Context, query: RatingClassQuery): Promise<RatingClassList> {
  const { transaction } = context;
  const quarter = await quarterOf(context, query.quarterId);
  const shown = await classRowOf(context, query.classId, quarter.academicYearId);
  const referenceDate = referenceDateOf(quarter, context.today);
  const state = await quarterStateOf(context, quarter);
  const freshness = new Freshness();
  const outcomes = await preparedOutcomes(context, quarter, state, null, freshness);
  const members = await membersOn(transaction, { classId: shown.id, groupId: null }, referenceDate);
  const figures = figuresOf(outcomes, members);
  const names = await namesOf(transaction, [...figures.keys()]);
  const places = ratingPlaces(
    [...figures].map(([studentId, figure]) => ({ id: studentId, value: figure.value })),
  );
  return ratingClassListSchema.parse({
    ...listStateOf(quarter, state, outcomes.readLive, freshness),
    class: shown,
    rows: placed(places, names, byName).map(({ place, item }) => {
      const figure = figures.get(item.id);
      return {
        student: item,
        place: place.place,
        value: tenths(place.value),
        subjects: figure?.subjects ?? 0,
        fewerSubjects: figure?.fewerSubjects ?? false,
      };
    }),
  });
}

/** The classes of a grade or of the branch, by the mean result of their students. */
async function classesIn(context: Context, query: RatingClassesQuery): Promise<RatingClassesList> {
  const { transaction } = context;
  const quarter = await quarterOf(context, query.quarterId);
  if (!isManagement(context)) throw new ApiException('permission_denied', 403);
  const referenceDate = referenceDateOf(quarter, context.today);
  const state = await quarterStateOf(context, quarter);
  const classes = (await classesOfYear(context, quarter.academicYearId)).filter(
    (one) =>
      (query.grade === undefined || one.grade === query.grade) &&
      (query.language === undefined || one.language === query.language),
  );
  const freshness = new Freshness();
  const outcomes = await preparedOutcomes(context, quarter, state, null, freshness);
  const figures = new Map<string, { value: Fraction | null; students: number }>();
  for (const one of classes) {
    const members = await membersOn(transaction, { classId: one.id, groupId: null }, referenceDate);
    const students = [...figuresOf(outcomes, members).values()].map((figure) => figure.value);
    figures.set(one.id, {
      value: classFigure(students),
      students: students.filter((value) => value !== null).length,
    });
  }
  const byId = new Map(classes.map((one) => [one.id, one]));
  const places = ratingPlaces(
    classes.map((one) => ({ id: one.id, value: figures.get(one.id)?.value ?? null })),
  );
  return ratingClassesListSchema.parse({
    ...listStateOf(quarter, state, outcomes.readLive, freshness),
    grade: query.grade ?? null,
    language: query.language ?? null,
    rows: placed(
      places,
      byId,
      (a, b) => a.grade - b.grade || a.name.localeCompare(b.name, 'ru'),
    ).map(({ place, item }) => ({
      class: item,
      place: place.place,
      value: tenths(place.value),
      students: figures.get(item.id)?.students ?? 0,
    })),
  });
}

/** One decimal as a number cell of Excel ("Excel exports contain real numbers"). */
const figureCell = (value: number | null): Cell => (value === null ? null : value / 10);

const nameOf = (student: StudentName): string =>
  [student.lastName, student.firstName, student.paternalName ?? ''].join(' ').trim();

type ExportRead =
  | { kind: 'subject'; list: RatingSubjectList }
  | { kind: 'class'; list: RatingClassList }
  | { kind: 'classes'; list: RatingClassesList };

/** The sheet of a list: title, stamp and "not official" above the heading row. */
function sheetOf(
  read: ExportRead & { timeZone: string; now: Date },
  texts: RatingExportTexts,
  language: Language,
): Sheet {
  const { list } = read;
  const c = texts.columns;
  const stamp =
    list.final === null
      ? fillText(texts.provisional, { moment: momentText(read.now, read.timeZone) })
      : fillText(texts.final, {
          date: dateText(schoolDateOf(new Date(list.final.closedAt), read.timeZone)),
          version: String(list.final.version),
        });
  const quarter = fillText(texts.quarter, { number: String(list.quarter.number) });
  const preamble = [...(list.quarter.notOfficial ? [texts.notOfficial] : []), stamp];
  if (read.kind === 'subject') {
    const journal = read.list.journal;
    return {
      name: texts.sheets.subject,
      preamble: [
        `${journal.subject.names[language]} · ${journal.unit.name} · ${quarter}`,
        ...preamble,
      ],
      headings: [c.place, c.student, c.figure, c.state],
      rows: read.list.rows.map((row) => {
        const notes =
          row.state === 'number'
            ? row.flags.map((flag) =>
                flag === 'left_subject'
                  ? fillText(texts.flags.left_subject, { date: dateText(row.leftSubjectOn ?? '') })
                  : texts.flags[flag],
              )
            : [texts.states[row.state]];
        return [row.place, nameOf(row.student), figureCell(row.value), notes.join('; ') || null];
      }),
    };
  }
  if (read.kind === 'class') {
    return {
      name: texts.sheets.class,
      preamble: [`${read.list.class.name} · ${quarter}`, ...preamble],
      headings: [c.place, c.student, c.figure, c.subjects, c.fewerSubjects],
      rows: read.list.rows.map((row) => [
        row.place,
        nameOf(row.student),
        figureCell(row.value),
        row.subjects,
        row.fewerSubjects ? texts.yes : null,
      ]),
    };
  }
  const filters = [
    read.list.grade === null
      ? texts.allGrades
      : fillText(texts.grade, { grade: String(read.list.grade) }),
    ...(read.list.language === null ? [] : [texts.languages[read.list.language]]),
  ];
  return {
    name: texts.sheets.classes,
    preamble: [[...filters, quarter].join(' · '), ...preamble],
    headings: [c.place, c.class, c.figure, c.students],
    rows: read.list.rows.map((row) => [
      row.place,
      row.class.name,
      figureCell(row.value),
      row.students,
    ]),
  };
}

/**
 * Results by grade for the branch summary (task 9.4b, plan decision 5): per grade 1 to 11 of the
 * year's classes, the mean of its students' figures across subjects by the rule of the class
 * figure (`classFigure`), read as the classes list reads them (`outcomesOf`: the stored records
 * of a closed quarter, never calculated again), students on the reference date.
 */
export async function gradeFiguresOf(
  transaction: Transaction,
  access: Access,
  clock: { branchId: string; timeZone: string; now: Date; today: string },
  quarter: QuarterRef,
  freshness: Freshness,
): Promise<{ grade: number; value: number | null; rated: number; students: number }[]> {
  const context: Context = { transaction, access, ...clock };
  const referenceDate = referenceDateOf(quarter, context.today);
  const state = await quarterStateOf(context, quarter);
  const outcomes = await preparedOutcomes(context, quarter, state, null, freshness);
  const byGrade = new Map<number, string[]>();
  for (const one of await classesOfYear(context, quarter.academicYearId)) {
    const members = await membersOn(transaction, { classId: one.id, groupId: null }, referenceDate);
    byGrade.set(one.grade, [...(byGrade.get(one.grade) ?? []), ...members]);
  }
  return [...byGrade]
    .sort((a, b) => a[0] - b[0])
    .flatMap(([grade, members]) => {
      const unique = [...new Set(members)];
      if (unique.length === 0) return [];
      const values = [...figuresOf(outcomes, unique).values()].map((figure) => figure.value);
      return [
        {
          grade,
          value: tenths(classFigure(values)),
          rated: values.filter((value) => value !== null).length,
          students: unique.length,
        },
      ];
    });
}
