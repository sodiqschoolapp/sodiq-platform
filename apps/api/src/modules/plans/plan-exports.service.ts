import { Inject, Injectable } from '@nestjs/common';
import {
  fillText,
  isLanguage,
  PLAN_EXPORT_ASCII_NAMES,
  PLAN_EXPORT_TEXTS,
  type Clock,
  type Language,
  type Plan,
  type PlanCompleteness,
  type PlanExport,
  type PlanExportTexts,
  type PlanProgress,
  type PlanReportExport,
  type PlanRequestsReport,
} from '@sodiq/shared';
import { CLOCK } from '../../clock/clock.module.js';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import { PDF_RENDERER, PdfFile, type PdfRenderer } from '../../http/pdf.js';
import { writeWorkbook, XlsxFile, type Cell, type Sheet } from '../../http/xlsx.js';
import type { Access } from '../access/permission.guard.js';
import { Audit } from '../audit/audit.service.js';
import { branchOf } from '../classes/classes.service.js';
import { plannedJournal } from '../journal/journal-grid.query.js';
import { journalsColumns } from '../journal/journal-works.query.js';
import { momentText } from '../timetable/views-export.service.js';
import { dateText, escapeHtml, printHtml } from '../timetable/views-file.js';
import { PlanReportsService } from './plan-reports.service.js';
import { PlansService } from './plans.service.js';

/**
 * Exports of a plan and of the plan reports (task 8.8, pull request #226;
 * `edge/lesson-plans`, "A wrongly copied plan must be removed; an inspector
 * asks for a printout": "Plans export to PDF and Excel with their marks"; `02`:
 * "Every ... export is written to an audit log"; `edge/people-roles-accounts`:
 * "An export contains only what the role may see"). As the timetable views'
 * exports (5.9c-1, decision 14): the plan or report is read in one
 * transaction with its scope and refusals, the file is written outside it,
 * and one audit entry is written before the file is sent.
 */

const PLAN_COLUMNS = [
  'number',
  'date',
  'topic',
  'classworks',
  'homeworks',
  'objectives',
  'materials',
  'marks',
] as const;

@Injectable()
export class PlanExports {
  constructor(
    private readonly transactions: Transactions,
    private readonly plans: PlansService,
    private readonly reports: PlanReportsService,
    private readonly audit: Audit,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(PDF_RENDERER) private readonly pdf: PdfRenderer,
  ) {}

  private async languageOf(transaction: Transaction, access: Access) {
    const account = await transaction
      .selectFrom('accounts')
      .select('language')
      .where('id', '=', access.accountId)
      .executeTakeFirstOrThrow();
    const branch = await transaction
      .selectFrom('branches')
      .select('time_zone')
      .where('id', '=', branchOf(access))
      .executeTakeFirstOrThrow();
    const language: Language = isLanguage(account.language) ? account.language : 'uz';
    return { language, timeZone: branch.time_zone };
  }

  /** A plan with its marks, as PDF or Excel. */
  async exportPlan(
    access: Access,
    journalId: string,
    input: PlanExport,
    requestId: string,
  ): Promise<XlsxFile | PdfFile> {
    const branchId = branchOf(access);
    const moment = this.clock.now();
    const read = await this.transactions.run(access.branchIds, async (transaction) => {
      const scene = await this.plans.sceneOf(
        transaction,
        access,
        branchId,
        journalId,
        input.quarterId,
      );
      if (!scene.reach.read) throw new ApiException('plan_scope', 403);
      if (!plannedJournal(scene.journal)) throw new ApiException('plan_attendance_only', 409);
      const plan = await this.plans.answer(transaction, scene);
      // "not held" of each row's planned works, as the journal shows them.
      const columns = (
        await journalsColumns(transaction, [scene.journal], scene.timeZone, scene.now)
      ).journals.get(scene.journal.id)?.columns;
      const notHeld = new Map<string, string[]>();
      for (const row of plan.rows) {
        const titles = (columns?.get(row.lessonId)?.notHeld ?? []).flatMap((column) =>
          column.title === null ? [] : [column.title],
        );
        notHeld.set(row.lessonId, titles);
      }
      return { plan, notHeld, ...(await this.languageOf(transaction, access)) };
    });
    const texts = PLAN_EXPORT_TEXTS[read.language];
    const asOf = fillText(texts.asOf, { moment: momentText(moment, read.timeZone) });
    const sheet = planSheet(read.plan, read.notHeld, texts, asOf);
    const quarter = read.plan.quarters.find((one) => one.id === read.plan.quarterId);
    const title = [
      texts.plan,
      read.plan.unit.name,
      read.plan.subject.names[read.language],
      fillText(texts.quarter, { number: String(quarter?.number ?? '') }),
    ].join(' · ');
    const content =
      input.format === 'pdf'
        ? await this.pdf.render(
            printHtml({
              language: read.language,
              title,
              landscape: true,
              stamp: [
                ...(read.plan.owner === null
                  ? []
                  : [fillText(texts.teacher, { name: read.plan.owner })]),
                asOf,
              ],
              bottomLeft: asOf,
              page: texts.page,
              body: tableHtml(sheet),
            }),
          )
        : await writeWorkbook({ ...sheet, preamble: [title, asOf] });
    await this.transactions.run(access.branchIds, (transaction) =>
      this.audit.record(transaction, {
        branchId,
        actorId: access.accountId,
        assignmentId: access.assignmentId,
        action: 'plan.export',
        record: { type: 'journal', id: read.plan.journalId },
        details: {
          quarterId: read.plan.quarterId,
          format: input.format,
          asOf: moment.toISOString(),
          rows: read.plan.rows.length,
          notCovered: read.plan.notCovered.length,
          carriedIn: read.plan.carriedIn.length,
          outcomes: read.plan.outcomes.length,
        },
        requestId,
      }),
    );
    const base =
      `${texts.fileNames.plan}-${read.plan.unit.name}-${String(quarter?.number ?? '')}`.replace(
        /\s+/g,
        '-',
      );
    const ascii = `${PLAN_EXPORT_ASCII_NAMES.plan}-${String(quarter?.number ?? '')}`;
    return input.format === 'pdf'
      ? new PdfFile(`${base}.pdf`, `${ascii}.pdf`, content)
      : new XlsxFile(`${base}.xlsx`, `${ascii}.xlsx`, PLAN_COLUMNS, content);
  }

  /** A plan report in Excel (decision 17), with the reader's scope. */
  async exportReport(
    access: Access,
    input: PlanReportExport,
    requestId: string,
  ): Promise<XlsxFile> {
    const branchId = branchOf(access);
    const moment = this.clock.now();
    const query = {
      ...(input.quarterId === undefined ? {} : { quarterId: input.quarterId }),
      ...(input.departmentId === undefined ? {} : { departmentId: input.departmentId }),
      ...(input.teacherId === undefined ? {} : { teacherId: input.teacherId }),
    };
    const read = await this.transactions.run(access.branchIds, async (transaction) => {
      const found =
        input.report === 'completeness'
          ? ({
              kind: 'completeness',
              report: await this.reports.completenessIn(transaction, access, query),
            } as const)
          : input.report === 'progress'
            ? ({
                kind: 'progress',
                report: await this.reports.progressIn(transaction, access, query),
              } as const)
            : ({
                kind: 'requests',
                report: await this.reports.requestsIn(transaction, access, query),
              } as const);
      return { found, ...(await this.languageOf(transaction, access)) };
    });
    const texts = PLAN_EXPORT_TEXTS[read.language];
    const asOf = fillText(texts.asOf, { moment: momentText(moment, read.timeZone) });
    const sheet =
      read.found.kind === 'completeness'
        ? completenessSheet(read.found.report, texts, read.language)
        : read.found.kind === 'progress'
          ? progressSheet(read.found.report, texts, read.language)
          : requestsSheet(read.found.report, texts, read.language);
    const content = await writeWorkbook({ ...sheet, preamble: [sheet.name, asOf] });
    const rows =
      read.found.kind === 'requests'
        ? read.found.report.teachers.reduce((sum, one) => sum + one.requests.length, 0)
        : read.found.report.plans.length;
    await this.transactions.run(access.branchIds, (transaction) =>
      this.audit.record(transaction, {
        branchId,
        actorId: access.accountId,
        assignmentId: access.assignmentId,
        action: 'plan_report.export',
        details: { report: input.report, ...query, asOf: moment.toISOString(), rows },
        requestId,
      }),
    );
    return new XlsxFile(
      `${texts.fileNames.report}-${input.report}.xlsx`,
      `${PLAN_EXPORT_ASCII_NAMES.report}-${input.report}.xlsx`,
      sheet.headings.map((_, index) => `column${String(index + 1)}`),
      content,
    );
  }
}

/** The rows of a plan with their marks: one row per lesson, then the items not covered. */
export function planSheet(
  plan: Plan,
  notHeld: ReadonlyMap<string, readonly string[]>,
  texts: PlanExportTexts,
  asOf: string,
): Sheet {
  const c = texts.columns;
  const titles = (works: readonly { title: string }[]) =>
    works.map((work) => work.title).join('; ');
  const materials = (item: Pick<Plan['notCovered'][number], 'links' | 'files'>) =>
    [...item.links, ...item.files.map((file) => file.name)].join('; ');
  const rows: Cell[][] = plan.rows.map((row) => {
    const item = row.item;
    const marks: string[] = [];
    if (item?.movedFrom != null) {
      marks.push(fillText(texts.marks.movedFrom, { date: dateText(item.movedFrom) }));
    }
    if (item?.editedAfterLesson === true) marks.push(texts.marks.editedAfterLesson);
    if (row.notDelivered) marks.push(texts.marks.notDelivered);
    const notGiven = (item?.homeworks ?? []).filter((work) => row.notGiven.includes(work.id));
    if (notGiven.length > 0) {
      marks.push(fillText(texts.marks.notGiven, { titles: titles(notGiven) }));
    }
    const held = notHeld.get(row.lessonId) ?? [];
    if (held.length > 0) marks.push(fillText(texts.marks.notHeld, { titles: held.join('; ') }));
    return [
      row.number,
      { date: row.date },
      item?.topic ?? '',
      titles(item?.classworks ?? []),
      titles(item?.homeworks ?? []),
      item?.objectives ?? '',
      item === null ? '' : materials(item),
      marks.join('; '),
    ];
  });
  for (const item of plan.notCovered) {
    rows.push([
      texts.notCovered,
      null,
      item.topic,
      titles(item.classworks),
      titles(item.homeworks),
      item.objectives,
      materials(item),
      item.notDeliveredFrom === null
        ? ''
        : fillText(texts.marks.copyOf, { date: dateText(item.notDeliveredFrom) }),
    ]);
  }
  // Task 9.2d: the "carried in" tray, then the outcomes of the quarter's not-covered items.
  for (const item of plan.carriedIn) {
    rows.push([
      texts.carriedIn,
      null,
      item.topic,
      titles(item.classworks),
      titles(item.homeworks),
      item.objectives,
      materials(item),
      '',
    ]);
  }
  for (const outcome of plan.outcomes) {
    const mark =
      outcome.kind === 'merged'
        ? fillText(texts.outcomes.merged, { date: dateText(outcome.targetDate ?? '') })
        : outcome.kind === 'dropped'
          ? fillText(texts.outcomes.dropped, { reason: outcome.reason })
          : outcome.automatic
            ? texts.outcomes.carriedAutomatic
            : texts.outcomes.carried;
    rows.push([texts.notCovered, null, outcome.topic, '', '', '', '', mark]);
  }
  return {
    name: texts.plan,
    headings: [
      c.number,
      c.date,
      c.topic,
      c.classworks,
      c.homeworks,
      c.objectives,
      c.materials,
      c.marks,
    ],
    rows,
    preamble: [asOf],
  };
}

function cellText(cell: Cell): string {
  if (cell === null) return '';
  if (typeof cell !== 'object') return String(cell);
  return 'date' in cell ? dateText(cell.date) : String(cell.time);
}

/** The sheet as one HTML table for the PDF. */
function tableHtml(sheet: Sheet): string {
  const head = sheet.headings.map((one) => `<th>${escapeHtml(one)}</th>`).join('');
  const body = sheet.rows
    .map(
      (row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cellText(cell))}</td>`).join('')}</tr>`,
    )
    .join('');
  return `<table class="plan"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function completenessSheet(
  report: PlanCompleteness,
  texts: PlanExportTexts,
  language: Language,
): Sheet {
  const r = texts.reports;
  return {
    name: r.completeness,
    headings: [
      r.unit,
      r.subject,
      r.teacher,
      r.department,
      r.state,
      r.rows,
      r.noTopic,
      r.flag,
      r.belowMinimum,
    ],
    rows: report.plans.map((plan) => [
      plan.unit.name,
      plan.subject.names[language],
      plan.teacher?.name ?? '',
      plan.department?.names[language] ?? '',
      r.states[plan.state] ?? plan.state,
      plan.rows,
      plan.empty,
      plan.flag === null ? '' : (r.flags[plan.flag] ?? plan.flag),
      plan.belowMinimum === null ? '' : r.yes,
    ]),
  };
}

function progressSheet(report: PlanProgress, texts: PlanExportTexts, language: Language): Sheet {
  const r = texts.reports;
  return {
    name: r.progress,
    headings: [
      r.unit,
      r.subject,
      r.teacher,
      r.rows,
      r.planned,
      r.held,
      r.delivered,
      r.notCovered,
      r.behind,
    ],
    rows: [
      ...report.plans.map((plan): Cell[] => [
        plan.unit.name,
        plan.subject.names[language],
        plan.teacher?.name ?? '',
        plan.rows,
        plan.planned,
        plan.held,
        plan.delivered,
        plan.notCovered,
        plan.behind ? r.yes : '',
      ]),
      [],
      [r.plannedWorks, r.notHeldWorks, r.percentNotHeld],
      ...report.teachers.map((one): Cell[] => [
        one.teacher?.name ?? '',
        one.plannedWorks,
        one.notHeld,
        one.percentNotHeld,
      ]),
    ],
  };
}

function requestsSheet(
  report: PlanRequestsReport,
  texts: PlanExportTexts,
  language: Language,
): Sheet {
  const r = texts.reports;
  return {
    name: r.requests,
    headings: [r.teacher, r.unit, r.subject, r.kind, r.status, r.decidedBy, r.decidedOn, r.changes],
    rows: report.teachers.flatMap((teacher) =>
      teacher.requests.map((request): Cell[] => [
        teacher.teacher?.name ?? '',
        request.unit.name,
        request.subject.names[language],
        r.kinds[request.kind] ?? request.kind,
        r.statuses[request.status] ?? request.status,
        request.decidedBy ?? '',
        request.decidedOn === null ? null : { date: request.decidedOn },
        request.changes.length,
      ]),
    ),
  };
}
