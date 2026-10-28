import { Injectable } from '@nestjs/common';
import { shownPercent } from '@sodiq/calc';
import {
  classDisplayName,
  fillText,
  isLanguage,
  loadReportSchema,
  REPORT_EXPORT_ASCII_NAMES,
  REPORT_EXPORT_TEXTS,
  type Language,
  type LoadReport,
  type LoadReportQuery,
} from '@sodiq/shared';
import { addDays, checkedPlacements, checkTimetable, mondayOf } from '@sodiq/timetable-rules';
import { sql } from 'kysely';
import { Transactions, transactionMoment, type Transaction } from '../../database/transactions.js';
import { writeSheets, XlsxFile, type Cell, type Sheet } from '../../http/xlsx.js';
import type { Access } from '../access/permission.guard.js';
import { Audit } from '../audit/audit.service.js';
import { branchOf } from '../classes/classes.service.js';
import { staffNames } from '../journal/journal-grid.query.js';
import { notFound } from '../setup/setup-refusals.js';
import { TimetablePattern } from './pattern.service.js';
import { Timetable } from './timetable.service.js';
import { versionOnDate } from './version-on-date.js';
import { momentText } from './views-export.service.js';
import { dateText } from './views-file.js';

/**
 * The timetable load report (task 9.3b-2, pull request #260; `06`, Views and outputs: "Load
 * report: lessons per week for each teacher against contract, lessons per subject for each class
 * against the load, room use in percent, free periods"; `08`, Analytics, Timetable load; area
 * `timetable_load`, management of the branch). Worked out on read (decision 9): one week of one
 * branch's timetable, not the journal.
 *
 * - A teacher's lessons are the week's dated lessons of this branch, not cancelled, of the
 *   person recorded on each (the substitute in force: From 5.7b-1); a vacancy's are listed under
 *   it (`edge/timetable`). Against them: the load rows of this branch's published version in force
 *   on the week's first school day, the load rows of the other branches (`teacher_load_elsewhere`,
 *   their published versions only) and the contract (`staff.weekly_lessons`; `06`, Weekly load).
 * - Invigilations are counted apart, per teacher, and count for nothing (`edge/timetable`, Exams).
 * - Room use (build decision): the room's lessons of the week over the lesson periods the branch
 *   ran that week (each date and start with a lesson), as a percent from `packages/calc`.
 * - Free periods: the rule engine's `class_free_period` over the version in force (`06`, Rules;
 *   `CLAUDE.md`, one rule engine for the timetable), as the conflict panel counts it.
 *
 * The department filter takes the lessons and load rows of that department's subjects; free
 * periods and rooms are of the whole branch.
 */

const share = (part: number, whole: number): number | null =>
  whole === 0 ? null : Number(shownPercent(Math.min(part, whole), whole));

interface WeekLesson {
  readonly id: string;
  readonly teacher_id: string | null;
  readonly class_id: string | null;
  readonly group_id: string | null;
  readonly subject_id: string;
  readonly room_id: string | null;
  readonly lesson_date: string;
  readonly starts_at: Date;
}

@Injectable()
export class LoadReports {
  constructor(
    private readonly transactions: Transactions,
    private readonly audit: Audit,
    private readonly timetable: Timetable,
    private readonly pattern: TimetablePattern,
  ) {}

  read(access: Access, query: LoadReportQuery): Promise<LoadReport> {
    return this.transactions.run(access.branchIds, (transaction) =>
      this.loadIn(transaction, access, query),
    );
  }

  /** The report as Excel, stamped with its week and the moment (decision 12), logged. */
  async export(access: Access, input: LoadReportQuery, requestId: string): Promise<XlsxFile> {
    const read = await this.transactions.run(access.branchIds, async (transaction) => {
      const report = await this.loadIn(transaction, access, input);
      const branchId = branchOf(access);
      await this.audit.record(transaction, {
        branchId,
        actorId: access.accountId,
        assignmentId: access.assignmentId,
        action: 'load_report.export',
        details: { ...input, rows: report.teachers.length },
        requestId,
      });
      const account = await transaction
        .selectFrom('accounts')
        .select('language')
        .where('id', '=', access.accountId)
        .executeTakeFirstOrThrow();
      const branch = await transaction
        .selectFrom('branches')
        .select('time_zone')
        .where('id', '=', branchId)
        .executeTakeFirstOrThrow();
      const language: Language = isLanguage(account.language) ? account.language : 'uz';
      return {
        report,
        language,
        moment: momentText(await transactionMoment(transaction), branch.time_zone),
      };
    });
    const texts = REPORT_EXPORT_TEXTS[read.language];
    const c = texts.columns;
    const { report } = read;
    const preamble = [
      fillText(texts.week, { date: dateText(report.week) }),
      fillText(texts.exportedAt, { moment: read.moment }),
    ];
    const sheets: Sheet[] = [
      {
        name: texts.sheets.load,
        preamble,
        headings: [
          c.teacher,
          c.lessons,
          c.planned,
          c.elsewhere,
          c.contract,
          c.invigilations,
          c.vacancy,
        ],
        rows: report.teachers.map((row): Cell[] => [
          row.teacher.name,
          row.lessons,
          row.planned,
          row.elsewhere,
          row.contract,
          row.invigilations,
          row.vacancy ? c.vacancy : null,
        ]),
      },
      {
        name: texts.sheets.classes,
        preamble,
        headings: [c.class, c.subject, c.lessons, c.load],
        rows: report.classes.map((row): Cell[] => [
          row.unit.name,
          row.subject.names[read.language],
          row.lessons,
          row.load,
        ]),
      },
      {
        name: texts.sheets.rooms,
        preamble,
        headings: [c.room, c.lessons, c.periods, c.percent],
        rows: report.rooms.map((row): Cell[] => [
          row.room.name,
          row.lessons,
          row.periods,
          row.percent === null ? null : row.percent / 100,
        ]),
      },
      {
        name: texts.sheets.freePeriods,
        preamble,
        headings: [c.class, c.weekday, c.time],
        rows: report.freePeriods.map((row): Cell[] => [
          row.class.name,
          row.weekday,
          { time: row.start },
        ]),
      },
    ];
    return new XlsxFile(
      `${texts.fileNames.load}.xlsx`,
      `${REPORT_EXPORT_ASCII_NAMES.load}.xlsx`,
      (sheets[0]?.headings ?? []).map((_, index) => `column${String(index + 1)}`),
      await writeSheets(sheets),
    );
  }

  private async loadIn(
    transaction: Transaction,
    access: Access,
    query: LoadReportQuery,
  ): Promise<LoadReport> {
    const branchId = branchOf(access);
    const week = mondayOf(query.week);
    const last = addDays(week, 6);
    const subjects = await transaction
      .selectFrom('subjects')
      .innerJoin('departments', 'departments.id', 'subjects.department_id')
      .select([
        'subjects.id',
        'subjects.name_uz',
        'subjects.name_ru',
        'subjects.name_en',
        'subjects.department_id',
        'departments.name_uz as department_uz',
        'departments.name_ru as department_ru',
        'departments.name_en as department_en',
        'departments.position',
        'departments.archived_at',
      ])
      .execute();
    if (
      query.departmentId !== undefined &&
      !subjects.some((one) => one.department_id === query.departmentId?.toLowerCase())
    ) {
      throw notFound();
    }
    const inDepartment = (subjectId: string) =>
      query.departmentId === undefined ||
      subjects.some(
        (one) => one.id === subjectId && one.department_id === query.departmentId?.toLowerCase(),
      );
    const subjectOf = new Map(
      subjects.map((one) => [one.id, { uz: one.name_uz, ru: one.name_ru, en: one.name_en }]),
    );
    const departments = [
      ...new Map(
        subjects
          .filter((one) => one.archived_at === null)
          .map((one) => [
            one.department_id,
            {
              position: one.position,
              names: { uz: one.department_uz, ru: one.department_ru, en: one.department_en },
            },
          ]),
      ),
    ]
      .sort((a, b) => a[1].position - b[1].position)
      .map(([id, one]) => ({ id, names: one.names }));
    const lessons: WeekLesson[] = await transaction
      .selectFrom('lessons')
      .select([
        'id',
        'teacher_id',
        'class_id',
        'group_id',
        'subject_id',
        'room_id',
        sql<string>`lesson_date::text`.as('lesson_date'),
        'starts_at',
      ])
      .where('branch_id', '=', branchId)
      .where('lesson_date', '>=', week)
      .where('lesson_date', '<=', last)
      .where('cancel_cause', 'is', null)
      .execute();
    const year = await transaction
      .selectFrom('academic_years')
      .select(['id', sql<string>`start_date::text`.as('start')])
      .where('branch_id', '=', branchId)
      .where('start_date', '<=', last)
      .where('end_date', '>=', week)
      .orderBy('start_date', 'desc')
      .executeTakeFirst();
    const firstDay = year === undefined ? week : year.start > week ? year.start : week;
    const version =
      year === undefined ? null : await versionOnDate(transaction, branchId, year.id, firstDay);
    const loadRows =
      version === null
        ? []
        : await transaction
            .selectFrom('teaching_load_rows')
            .select(['teacher_id', 'class_id', 'group_id', 'subject_id', 'lessons_per_week'])
            .where('version_id', '=', version.id)
            .execute();
    const ownLessons = lessons.filter((one) => inDepartment(one.subject_id));
    const ownRows = loadRows.filter((one) => inDepartment(one.subject_id));
    // Teachers.
    const taught = new Map<string, number>();
    for (const one of ownLessons) {
      if (one.teacher_id !== null)
        taught.set(one.teacher_id, (taught.get(one.teacher_id) ?? 0) + 1);
    }
    const planned = new Map<string, number>();
    for (const one of ownRows) {
      planned.set(one.teacher_id, (planned.get(one.teacher_id) ?? 0) + one.lessons_per_week);
    }
    const teacherIds = [...new Set([...taught.keys(), ...planned.keys()])];
    const elsewhere = new Map<string, number>();
    if (teacherIds.length > 0) {
      const rows = await sql<{ teacher_id: string; lessons: number }>`
        select teacher_id, sum(lessons)::int as lessons
        from teacher_load_elsewhere(${branchId}::uuid, ${teacherIds}::uuid[], ${firstDay}::date)
        where not draft
        group by teacher_id
      `.execute(transaction);
      for (const row of rows.rows) elsewhere.set(row.teacher_id, row.lessons);
    }
    const staff =
      teacherIds.length === 0
        ? []
        : await transaction
            .selectFrom('staff')
            .select(['id', 'kind', 'weekly_lessons'])
            .where('id', 'in', teacherIds)
            .execute();
    const staffOf = new Map(staff.map((one) => [one.id, one]));
    const invigilations = new Map<string, number>();
    if (teacherIds.length > 0) {
      const rows = await sql<{ staff_id: string; count: number }>`
        select i.staff_id, count(distinct i.exam_id)::int as count
        from exam_invigilators i
        join exams e on e.id = i.exam_id
        where e.branch_id = ${branchId}::uuid and e.cancel_cause is null
          and e.exam_date between ${week}::date and ${last}::date
          and i.staff_id = any(${teacherIds}::uuid[])
        group by i.staff_id
      `.execute(transaction);
      for (const row of rows.rows) invigilations.set(row.staff_id, row.count);
    }
    const names = await staffNames(transaction, teacherIds);
    // Classes and groups against the load.
    const classRows = await transaction
      .selectFrom('classes')
      .select(['id', 'grade', 'name'])
      .where('branch_id', '=', branchId)
      .execute();
    const classOf = new Map(
      classRows.map((one) => [
        one.id,
        { id: one.id, name: classDisplayName(one.grade, one.name), grade: one.grade },
      ]),
    );
    const groupRows = await transaction
      .selectFrom('groups')
      .select(['id', 'name'])
      .where('branch_id', '=', branchId)
      .execute();
    const groupOf = new Map(groupRows.map((one) => [one.id, one.name]));
    const unitKey = (one: {
      class_id: string | null;
      group_id: string | null;
      subject_id: string;
    }) => `${one.class_id ?? ''}|${one.group_id ?? ''}|${one.subject_id}`;
    const units = new Map<
      string,
      {
        classId: string | null;
        groupId: string | null;
        subjectId: string;
        lessons: number;
        load: number;
      }
    >();
    const unit = (one: {
      class_id: string | null;
      group_id: string | null;
      subject_id: string;
    }) => {
      const key = unitKey(one);
      const found = units.get(key) ?? {
        classId: one.class_id,
        groupId: one.group_id,
        subjectId: one.subject_id,
        lessons: 0,
        load: 0,
      };
      units.set(key, found);
      return found;
    };
    for (const one of ownLessons) unit(one).lessons += 1;
    for (const one of ownRows) unit(one).load += one.lessons_per_week;
    // Rooms over the lesson periods of the week.
    const periods = new Set(lessons.map((one) => new Date(one.starts_at).toISOString())).size;
    const roomUse = new Map<string, number>();
    for (const one of lessons) {
      if (one.room_id !== null) roomUse.set(one.room_id, (roomUse.get(one.room_id) ?? 0) + 1);
    }
    const rooms =
      roomUse.size === 0
        ? []
        : await transaction
            .selectFrom('rooms')
            .select(['id', 'name'])
            .where('id', 'in', [...roomUse.keys()])
            .execute();
    // Free periods: the engine's results over the version in force.
    const freePeriods: LoadReport['freePeriods'] = [];
    if (version !== null) {
      const row = await this.timetable.versionRow(transaction, version.id);
      const { pattern, blocks } = await this.pattern.stateOf(transaction, row, access.accountId);
      const results = checkTimetable(
        checkedPlacements(pattern.model, blocks),
        pattern.model.facts,
      ).filter((one) => one.rule === 'class_free_period');
      for (const one of results) {
        const classId = String(one.detail?.['classId'] ?? '');
        const shown = classOf.get(classId);
        const weekday = Number(one.day);
        if (shown === undefined || !Number.isInteger(weekday) || weekday < 1 || weekday > 7) {
          continue;
        }
        freePeriods.push({
          class: shown,
          weekday,
          start: Number(one.detail?.['start'] ?? 0),
          end: Number(one.detail?.['end'] ?? 0),
        });
      }
    }
    freePeriods.sort(
      (a, b) =>
        a.class.grade - b.class.grade ||
        a.class.name.localeCompare(b.class.name, 'ru') ||
        a.weekday - b.weekday ||
        a.start - b.start,
    );
    return loadReportSchema.parse({
      week,
      departments,
      teachers: teacherIds
        .map((id) => ({
          teacher: { id, name: names.get(id) ?? '' },
          vacancy: staffOf.get(id)?.kind === 'vacancy',
          lessons: taught.get(id) ?? 0,
          planned: planned.get(id) ?? 0,
          elsewhere: elsewhere.get(id) ?? 0,
          contract: staffOf.get(id)?.weekly_lessons ?? null,
          invigilations: invigilations.get(id) ?? 0,
        }))
        .sort(
          (a, b) =>
            Number(a.vacancy) - Number(b.vacancy) ||
            a.teacher.name.localeCompare(b.teacher.name, 'ru') ||
            a.teacher.id.localeCompare(b.teacher.id),
        ),
      classes: [...units.values()]
        .map((one) => ({
          unit:
            one.classId !== null
              ? { kind: 'class', id: one.classId, name: classOf.get(one.classId)?.name ?? '' }
              : {
                  kind: 'group',
                  id: one.groupId ?? '',
                  name: groupOf.get(one.groupId ?? '') ?? '',
                },
          subject: {
            id: one.subjectId,
            names: subjectOf.get(one.subjectId) ?? { uz: '', ru: '', en: '' },
          },
          lessons: one.lessons,
          load: one.load,
        }))
        .sort(
          (a, b) =>
            a.unit.name.localeCompare(b.unit.name, 'ru') ||
            a.subject.names.en.localeCompare(b.subject.names.en, 'en'),
        ),
      rooms: rooms
        .map((one) => {
          const used = roomUse.get(one.id) ?? 0;
          return {
            room: { id: one.id, name: one.name },
            lessons: used,
            periods,
            percent: share(used, periods),
          };
        })
        .sort((a, b) => a.room.name.localeCompare(b.room.name, 'ru')),
      freePeriods,
    });
  }
}

