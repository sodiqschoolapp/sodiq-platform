import { Inject, Injectable } from '@nestjs/common';
import {
  planFileTypeSchema,
  portalHomeworkWeekSchema,
  subjectColourSchema,
  type PlanFile,
  type PortalHomework,
  type PortalHomeworkWeek,
} from '@sodiq/shared';
import { Transactions, transactionMoment, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import { StoredFile } from '../../http/stored-file.js';
import { journalRows } from '../journal/journal-grid.query.js';
import { journalsColumns } from '../journal/journal-works.query.js';
import { PHOTO_STORE, planFileKey, type PhotoStore } from '../people/photo-store.js';
import { notFound } from '../setup/setup-refusals.js';
import { childUnits } from './child-units.js';
import { childSpans, childWeekScope, inSpan, portalChild, type ChildSpan } from './portal-scope.js';

/** A homework as read, with the plan item whose files it shows. */
interface GivenRow extends PortalHomework {
  readonly itemId: string | null;
  readonly start: number;
}

/** A file name in ASCII letters, for a browser that ignores `filename*` (as `plan-files.service.ts`). */
const asciiOf = (name: string) => name.normalize('NFKD').replace(/[^\x20-\x7e]/g, '_') || 'file';

/** The whole life of a child's memberships, for the check of a file (any week). */
const EVER = { from: '1900-01-01', to: '9999-12-30' } as const;

/**
 * The homework page of the portal (task 11.2, pull request #294; `10`, What parents see:
 * "Tasks by date and subject, with their titles and files"). The homeworks given at the held
 * lessons of the child's class and groups, read through the one reader of the journal's
 * columns (`journalsColumns`, as the lesson card's "given today"): plan homeworks and works
 * added by hand, "not given" left out (decision 8). With each, the topic of the lesson
 * (approval correction 2), the task text of the plan, its due date, and the files of the plan
 * item (decision 2, Look first).
 */
@Injectable()
export class PortalHomeworkService {
  constructor(
    private readonly transactions: Transactions,
    @Inject(PHOTO_STORE) private readonly store: PhotoStore,
  ) {}

  async week(
    accountId: string,
    studentId: string,
    date: string | undefined,
  ): Promise<PortalHomeworkWeek> {
    const scope = await this.transactions.run([], (transaction) =>
      childWeekScope(transaction, accountId, studentId, date),
    );
    const found: GivenRow[] = [];
    for (const span of scope.spans) {
      found.push(
        ...(await this.transactions.run([span.branchId], (transaction) =>
          givenIn(transaction, studentId, span),
        )),
      );
    }
    found.sort(
      (a, b) => a.givenOn.localeCompare(b.givenOn) || a.start - b.start || a.number - b.number,
    );
    return portalHomeworkWeekSchema.parse({
      today: scope.today,
      monday: scope.dates[0] ?? scope.today,
      homework: found.map((one) => ({
        givenOn: one.givenOn,
        subject: one.subject,
        topic: one.topic,
        title: one.title,
        number: one.number,
        description: one.description,
        dueOn: one.dueOn,
        files: one.files,
      })),
    });
  }

  /**
   * A file of the homework page: only a file of a homework that the page lists for this
   * child in some week (task 10.8: a homework's own files) (held lesson, a homework given there, the child in the unit on that
   * date); 404 otherwise, whatever the reason.
   */
  async file(accountId: string, studentId: string, fileId: string): Promise<StoredFile> {
    const spans = await this.transactions.run([], async (transaction) => {
      const child = await portalChild(transaction, accountId, studentId);
      return childSpans(transaction, accountId, child.id, EVER.from, EVER.to);
    });
    let row: { name: string; type: string; key: string } | undefined;
    for (const span of spans) {
      row ??= await this.transactions.run([span.branchId], async (transaction) => {
        const file = await transaction
          .selectFrom('lesson_plan_files')
          .innerJoin('lesson_plan_items', 'lesson_plan_items.id', 'lesson_plan_files.item_id')
          .leftJoin('lesson_plan_files as source', 'source.id', 'lesson_plan_files.copied_from')
          .select([
            'lesson_plan_files.id',
            'lesson_plan_files.item_id',
            'lesson_plan_files.name',
            'lesson_plan_files.type',
            'lesson_plan_files.copied_from',
            'source.item_id as source_item_id',
          ])
          .where('lesson_plan_files.id', '=', fileId)
          .where('lesson_plan_files.removed_at', 'is', null)
          .where('lesson_plan_items.cleared_at', 'is', null)
          .executeTakeFirst();
        if (file === undefined) return undefined;
        // Task 10.8: only a file of a homework the page lists for the child; never one of the
        // item's materials or of a classwork (`10`, Homework: "never the plan item's materials").
        const given = await givenIn(transaction, studentId, span, file.item_id);
        if (!given.some((one) => one.files.some((listed) => listed.id === file.id))) {
          return undefined;
        }
        return {
          name: file.name,
          type: file.type,
          key: planFileKey(file.source_item_id ?? file.item_id, file.copied_from ?? file.id),
        };
      });
    }
    if (row === undefined) throw notFound();
    if (!this.store.configured) throw new ApiException('files_not_configured', 503);
    let content: Buffer;
    try {
      content = await this.store.get(row.key);
    } catch {
      throw new ApiException('files_unavailable', 503);
    }
    return new StoredFile(planFileTypeSchema.parse(row.type), row.name, asciiOf(row.name), content);
  }
}

/**
 * The homeworks given in a span at held lessons of the child's units (the unit's on the
 * lesson's date), in the span's branch. With `itemId`, only the journals of that item's plan.
 */
async function givenIn(
  transaction: Transaction,
  studentId: string,
  span: ChildSpan,
  itemId?: string,
): Promise<GivenRow[]> {
  const units = await childUnits(transaction, studentId, span);
  if (units.classIds.length === 0 && units.groupIds.length === 0) return [];
  let query = transaction
    .selectFrom('journals')
    .select('journals.id')
    .where('journals.branch_id', '=', span.branchId)
    .where((where) =>
      where.or([
        ...(units.classIds.length === 0 ? [] : [where('journals.class_id', 'in', units.classIds)]),
        ...(units.groupIds.length === 0 ? [] : [where('journals.group_id', 'in', units.groupIds)]),
      ]),
    );
  if (itemId !== undefined) {
    query = query.where((where) =>
      where.exists(
        where
          .selectFrom('lesson_plan_journals')
          .innerJoin(
            'lesson_plan_items',
            'lesson_plan_items.plan_id',
            'lesson_plan_journals.plan_id',
          )
          .select('lesson_plan_journals.journal_id')
          .whereRef('lesson_plan_journals.journal_id', '=', 'journals.id')
          .where('lesson_plan_items.id', '=', itemId),
      ),
    );
  }
  const ids = (await query.execute()).map((one) => one.id);
  const journals = await journalRows(transaction, span.branchId, { journalIds: ids });
  if (journals.length === 0) return [];
  const branch = await transaction
    .selectFrom('branches')
    .select('time_zone')
    .where('id', '=', span.branchId)
    .executeTakeFirstOrThrow();
  const now = await transactionMoment(transaction);
  const columns = await journalsColumns(transaction, journals, branch.time_zone, now);
  const rows: (Omit<GivenRow, 'description' | 'files'> & { planWorkId: string | null })[] = [];
  for (const journal of journals) {
    const ofJournal = columns.journals.get(journal.id);
    if (ofJournal === undefined) continue;
    const dateOf = new Map(ofJournal.lessons.map((one) => [one.id, one.date]));
    for (const lesson of ofJournal.lessons) {
      if (!inSpan(span, lesson.date) || !columns.held.has(lesson.id)) continue;
      const member =
        journal.classId !== null
          ? units.classOn(lesson.date) === journal.classId
          : journal.groupId !== null && units.groupsOn(lesson.date).has(journal.groupId);
      if (!member) continue;
      const item = columns.items.get(lesson.id) ?? null;
      const given = (ofJournal.columns.get(lesson.id)?.given ?? []).filter((one) => !one.notGiven);
      given.forEach((one, index) => {
        rows.push({
          givenOn: lesson.date,
          start: lesson.start,
          subject: {
            id: journal.subjectId,
            names: journal.subject.names,
            colour: subjectColourSchema.parse(journal.subject.colour),
          },
          // Task 10.8: an item made by a work added in the journal has no topic yet.
          topic: item === null || item.topic.trim() === '' ? null : item.topic,
          title: one.title,
          number: index + 1,
          dueOn: one.checkAt === null ? null : (dateOf.get(one.checkAt) ?? null),
          itemId: item?.itemId ?? null,
          planWorkId: one.planWorkId,
        });
      });
    }
  }
  const workIds = rows.flatMap((one) => (one.planWorkId === null ? [] : [one.planWorkId]));

  const [works, files] = await Promise.all([
    workIds.length === 0
      ? []
      : transaction
          .selectFrom('lesson_plan_works')
          .select(['id', 'description'])
          .where('id', 'in', workIds)
          .execute(),
    workIds.length === 0
      ? []
      : transaction
          .selectFrom('lesson_plan_files')
          .innerJoin('lesson_plan_items', 'lesson_plan_items.id', 'lesson_plan_files.item_id')
          .select([
            'lesson_plan_files.id',
            'lesson_plan_files.work_id',
            'lesson_plan_files.name',
            'lesson_plan_files.type',
            'lesson_plan_files.bytes',
          ])
          // Task 10.8: the files of each homework itself; the item's materials (no work) and the
          // files of its classworks are for staff only.
          .where('lesson_plan_files.work_id', 'in', workIds)
          .where('lesson_plan_files.removed_at', 'is', null)
          // The same conditions as the download (permission review should-fix 3).
          .where('lesson_plan_items.cleared_at', 'is', null)
          .orderBy('lesson_plan_files.created_at')
          .orderBy('lesson_plan_files.id')
          .execute(),
  ]);
  const descriptionOf = new Map(works.map((one) => [one.id, one.description]));
  const filesOf = new Map<string, PlanFile[]>();
  for (const file of files) {
    if (file.work_id === null) continue;
    filesOf.set(file.work_id, [
      ...(filesOf.get(file.work_id) ?? []),
      {
        id: file.id,
        name: file.name,
        type: planFileTypeSchema.parse(file.type),
        bytes: file.bytes,
      },
    ]);
  }
  return rows.map(({ planWorkId, ...row }) => {
    const description = planWorkId === null ? '' : (descriptionOf.get(planWorkId) ?? '');
    return {
      ...row,
      description: description.trim() === '' ? null : description,
      files: planWorkId === null ? [] : (filesOf.get(planWorkId) ?? []),
    };
  });
}
