import { Inject, Injectable } from '@nestjs/common';
import {
  classDisplayName,
  isLanguage,
  PATTERN_EXPORT_TEXTS,
  VIEW_EXPORT_ASCII_NAMES,
  VIEW_EXPORT_TEXTS,
  viewAxisOf,
  type Clock,
  type Language,
  type VersionExportRequest,
} from '@sodiq/shared';
import { CLOCK } from '../../clock/clock.module.js';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { PDF_RENDERER, PdfFile, type PdfRenderer } from '../../http/pdf.js';
import { writeWorkbook, XlsxFile } from '../../http/xlsx.js';
import type { Access } from '../access/permission.guard.js';
import { Audit } from '../audit/audit.service.js';
import { branchOf } from '../classes/classes.service.js';
import { notFound } from '../setup/setup-refusals.js';
import {
  PATTERN_SHEET_COLUMNS,
  patternFileName,
  patternHtml,
  patternSheet,
  type PatternDay,
  type PatternFileTexts,
  type PatternLesson,
  type PatternPrint,
  type PatternSlot,
  type Weekday,
} from './pattern-file.js';
import { TimetablePattern, type PatternState } from './pattern.service.js';
import { Timetable } from './timetable.service.js';
import { momentText } from './views-export.service.js';
import { lowestGrade, staffOfBranch } from './views.service.js';

const WEEKDAYS: readonly Weekday[] = [1, 2, 3, 4, 5, 6, 7];

const isWeekday = (value: number): value is Weekday => WEEKDAYS.some((one) => one === value);

const STATUSES = ['draft', 'published', 'archived'] as const;

/** The record a kind prints, checked against the branch before the pattern is read (decision 6). */
type Named = { id: string; name: string } | null;

/**
 * Print, PDF and Excel of a version's weekly pattern (task 5.9c-2, pull
 * request #200; `edge/timetable`, "The wall timetable is out of date"; `06`,
 * step 8 "Print and export"), in the three steps of 5.9c-1 (its decision 14):
 *
 * 1. the version, the record of the body and the pattern are read in one
 *    transaction with the board's own read (`stateOf`, decision 9), with no
 *    lock and no write; another branch's or an unknown id is 404 before the
 *    pattern is read;
 * 2. the file is written, and a PDF rendered, outside any transaction;
 * 3. one audit entry `timetable_version.export` is written in a transaction
 *    of its own before the file is sent; a refusal or a failed render writes
 *    none (decision 10).
 */
@Injectable()
export class TimetableVersionExports {
  constructor(
    private readonly transactions: Transactions,
    private readonly timetable: Timetable,
    private readonly pattern: TimetablePattern,
    private readonly audit: Audit,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(PDF_RENDERER) private readonly pdf: PdfRenderer,
  ) {}

  async export(
    access: Access,
    versionId: string,
    request: VersionExportRequest,
    requestId: string,
  ): Promise<XlsxFile | PdfFile> {
    const branchId = branchOf(access);
    // Taken before the read, so the file never shows a pattern newer than its print time (decision 7).
    const moment = this.clock.now();
    const read = await this.transactions.run(access.branchIds, async (transaction) => {
      const version = await this.timetable.findVersion(transaction, branchId, versionId);
      const named = await this.namedOf(transaction, branchId, request);
      const state = await this.pattern.stateOf(transaction, version, access.accountId);
      const print = await printOf(transaction, state, request, named);
      const account = await transaction
        .selectFrom('accounts')
        .select('language')
        .where('id', '=', access.accountId)
        .executeTakeFirstOrThrow();
      const language: Language = isLanguage(account.language) ? account.language : 'uz';
      return { print, language, timeZone: version.time_zone };
    });
    const { print, language } = read;
    const stamp = { printed: momentText(moment, read.timeZone) };
    const texts: PatternFileTexts = {
      view: VIEW_EXPORT_TEXTS[language],
      pattern: PATTERN_EXPORT_TEXTS[language],
    };
    const content =
      request.format === 'pdf'
        ? await this.pdf.render(patternHtml(print, texts, language, stamp))
        : await writeWorkbook(patternSheet(print, texts, language, stamp));
    await this.transactions.run(access.branchIds, (transaction) =>
      this.audit.record(transaction, {
        branchId,
        actorId: access.accountId,
        assignmentId: access.assignmentId,
        action: 'timetable_version.export',
        details: {
          versionId,
          number: print.version.number,
          status: print.version.status,
          kind: request.kind,
          of: print.subject?.id ?? null,
          format: request.format,
          printedAt: moment.toISOString(),
          lessons: print.lessons.length,
        },
        requestId,
      }),
    );
    const names = patternFileName(
      print,
      texts,
      VIEW_EXPORT_ASCII_NAMES[print.kind],
      request.format,
    );
    return request.format === 'pdf'
      ? new PdfFile(names.fileName, names.asciiName, content)
      : new XlsxFile(names.fileName, names.asciiName, PATTERN_SHEET_COLUMNS, content);
  }

  /** The class, teacher or room of the body, of the branch; 404 otherwise (`.claude/rules/api.md`). */
  private async namedOf(
    transaction: Transaction,
    branchId: string,
    request: VersionExportRequest,
  ): Promise<Named> {
    switch (request.kind) {
      case 'branch':
        return null;
      case 'class': {
        const found = await transaction
          .selectFrom('classes')
          .select(['id', 'grade', 'name'])
          .where('id', '=', request.classId)
          .where('branch_id', '=', branchId)
          .executeTakeFirst();
        if (found === undefined) throw notFound();
        return { id: found.id, name: classDisplayName(found.grade, found.name) };
      }
      case 'teacher': {
        // The lookup of the 5.9a teacher view (review should-fix 6): through the
        // branch filter, so a teacher shared with another branch, or a vacancy, is found.
        const found = await staffOfBranch(transaction, request.staffId);
        return { id: found.id, name: found.name };
      }
      case 'room': {
        const found = await transaction
          .selectFrom('rooms')
          .select(['id', 'name'])
          .where('id', '=', request.roomId)
          .where('branch_id', '=', branchId)
          .executeTakeFirst();
        if (found === undefined) throw notFound();
        return { id: found.id, name: found.name };
      }
    }
  }
}

/**
 * What the file prints, from the board's read of the version: every placed
 * lesson of the kind's record (decisions 5 and 8), each numbered among the
 * lesson slots of its day, breaks not counted (spec review must-fix 1), in the
 * template of the lowest grade of its unit's classes, as 5.9a numbers a dated
 * lesson (approval correction 3); the class print in the class's own grade,
 * and the school print draws each class's row on its own template.
 */
async function printOf(
  transaction: Transaction,
  state: PatternState,
  request: VersionExportRequest,
  named: Named,
): Promise<PatternPrint> {
  const { version, rows, load, pattern, blocks } = state;
  const data = pattern.data;
  const answers = new Map(rows.map((row) => [row.id, load.answerOf(row, [])]));
  const units = new Map(data.units.map((unit) => [unit.id, unit]));
  const classIds = [
    ...new Set([
      ...data.units.flatMap((unit) => unit.classIds),
      ...(request.kind === 'class' ? [request.classId] : []),
    ]),
  ];
  const roomIds = [
    ...new Set(
      blocks.flatMap((block) =>
        block.lessons.flatMap((one) => (one.roomId === null ? [] : [one.roomId])),
      ),
    ),
  ];
  const [classes, rooms] = await Promise.all([
    classIds.length === 0
      ? Promise.resolve([])
      : transaction
          .selectFrom('classes')
          .select(['id', 'name', 'grade'])
          .where('id', 'in', classIds)
          .orderBy('grade')
          .orderBy('name')
          .orderBy('id')
          .execute(),
    roomIds.length === 0
      ? Promise.resolve([])
      : transaction.selectFrom('rooms').select(['id', 'name']).where('id', 'in', roomIds).execute(),
  ]);
  const gradeOf = new Map(classes.map((one) => [one.id, one.grade]));
  const roomName = new Map(rooms.map((one) => [one.id, one.name]));

  // The lesson slots of each grade on each weekday: the version's weekly days
  // for a published or archived version, the confirmed templates for a draft
  // (`stateOf`).
  const slotsOf = new Map<string, PatternSlot[]>();
  for (const one of data.days) {
    if (!one.day.lessons) continue;
    slotsOf.set(
      `${String(one.grade)}:${String(one.weekday)}`,
      one.day.day.slots.flatMap((slot) =>
        slot.kind === 'lesson' && slot.lessonNumber !== null
          ? [{ lessonNumber: slot.lessonNumber, start: slot.start, end: slot.end }]
          : [],
      ),
    );
  }
  const slotsAt = (grade: number | undefined, weekday: Weekday): PatternSlot[] | undefined =>
    grade === undefined ? undefined : slotsOf.get(`${String(grade)}:${String(weekday)}`);

  const classGrade = request.kind === 'class' ? gradeOf.get(request.classId) : undefined;
  const all: {
    lesson: PatternLesson;
    teacherId: string;
    roomId: string | null;
    grade: number | undefined;
  }[] = [];
  for (const block of blocks) {
    if (!isWeekday(block.weekday)) continue;
    const weekday = block.weekday;
    for (const lesson of block.lessons) {
      const answer = answers.get(lesson.loadRowId);
      if (answer === undefined) continue;
      const unitClassIds = units.get(answer.unit.id)?.classIds ?? [];
      const grade =
        classGrade ??
        lowestGrade(
          unitClassIds.flatMap((id) => {
            const one = gradeOf.get(id);
            return one === undefined ? [] : [one];
          }),
        );
      const lessonNumber =
        slotsAt(grade, weekday)?.find(
          (slot) => slot.start === block.start && slot.end === block.end,
        )?.lessonNumber ?? null;
      all.push({
        lesson: {
          id: lesson.id,
          weekday,
          lessonNumber,
          start: block.start,
          end: block.end,
          unit: {
            name:
              answer.unit.kind === 'class'
                ? classDisplayName(answer.unit.grades[0] ?? 0, answer.unit.name)
                : answer.unit.name,
            classIds: unitClassIds,
          },
          subject: answer.subject.names,
          teacher: answer.teacher.name ?? '',
          room: lesson.roomId === null ? null : (roomName.get(lesson.roomId) ?? ''),
        },
        teacherId: answer.teacher.id,
        roomId: lesson.roomId,
        grade,
      });
    }
  }
  const picked = all.filter((one) => {
    switch (request.kind) {
      case 'branch':
        return true;
      case 'class':
        return one.lesson.unit.classIds.includes(request.classId);
      case 'teacher':
        return one.teacherId === request.staffId;
      case 'room':
        return one.roomId === request.roomId;
    }
  });
  const lessons: PatternLesson[] = picked.map((one) => one.lesson);

  // The grades whose templates frame each weekday: the class's own, every
  // class's for the school, the grades of the lessons for a teacher or room.
  const gradesOn = (weekday: Weekday): number[] => {
    if (request.kind === 'class') {
      const grade = gradeOf.get(request.classId);
      return grade === undefined ? [] : [grade];
    }
    if (request.kind === 'branch') return [...new Set(classes.map((one) => one.grade))];
    return [
      ...new Set(
        picked
          .filter((one) => one.lesson.weekday === weekday)
          .flatMap((one) => (one.grade === undefined ? [] : [one.grade])),
      ),
    ];
  };
  const lessonDay = (weekday: Weekday) =>
    request.kind === 'class' || request.kind === 'branch'
      ? gradesOn(weekday).some((grade) => slotsAt(grade, weekday) !== undefined)
      : data.days.some((one) => one.weekday === weekday && one.day.lessons);
  const days: PatternDay[] = WEEKDAYS.filter(
    (weekday) => lessonDay(weekday) || lessons.some((one) => one.weekday === weekday),
  ).map((weekday) => {
    const templates = gradesOn(weekday).flatMap((grade) => {
      const slots = slotsAt(grade, weekday);
      return slots === undefined || slots.length === 0 ? [] : [slots];
    });
    const axis = viewAxisOf(templates, false);
    return { weekday, axis, slots: axis === 'slots' ? (templates[0] ?? []) : [] };
  });

  const status = STATUSES.find((one) => one === version.status) ?? 'archived';
  return {
    kind: request.kind,
    subject: named,
    version: { number: version.number, status, startsOn: version.starts_on },
    days,
    lessons,
    classes:
      request.kind === 'branch'
        ? classes.map((one) => ({ id: one.id, name: classDisplayName(one.grade, one.name) }))
        : [],
  };
}
