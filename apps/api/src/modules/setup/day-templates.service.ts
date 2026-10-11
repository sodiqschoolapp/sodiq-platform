import { Inject, Injectable } from '@nestjs/common';
import {
  minutesOf,
  schoolDateOf,
  TEMPLATE_LEVELS,
  timeText,
  type Assignment,
  type AssignmentEnd,
  type AssignmentList,
  type AssignmentRecord,
  type Clock,
  type DayTemplate,
  type DayTemplateList,
  type DayTemplateRecord,
  type DayTemplateRename,
  type DayTemplateVersionRecord,
  type ErrorCode,
  type ErrorDetail,
  type SlotLengthChange,
  type SlotType,
  type SlotTypeList,
  type SlotTypeRecord,
  type SlotTypeRename,
  type TemplateChange,
  type TemplatePreview,
  type TemplateTable,
  type Weekday,
} from '@sodiq/shared';
import { sql } from 'kysely';
import { CLOCK } from '../../clock/clock.module.js';
import { Transactions, type Transaction } from '../../database/transactions.js';
import type { JsonValue } from '../../database/types.generated.js';
import { ApiException } from '../../http/api-exception.js';
import { Audit } from '../audit/audit.service.js';
import type { Access } from '../access/permission.guard.js';
import {
  changedCells,
  dayOf,
  endsAfterMidnightFrom,
  lengthOn,
  lessonSlotsOf,
  loadStore,
  reachesFrom,
  rowOn,
  slotTypeInUse,
  tableOn,
  templateInUse,
  type SlotTypeState,
  type TemplateState,
  type TemplateStore,
} from './day-template-state.js';
import { endFrom, isWithdrawn, scheduleFrom } from './dated-rows.js';
import { notFound, refusingConstraints, refusingDuplicates } from './setup-refusals.js';

/** A refusal of 409 that names the fields to show it beside. */
function refused(code: ErrorCode, paths: readonly string[] = []): ApiException {
  const details: ErrorDetail[] = paths.map((path) => ({ path, code, message: code }));
  return new ApiException(code, 409, undefined, details.length === 0 ? undefined : details);
}

const moment = (at: Date | null): string | null => (at === null ? null : at.toISOString());

/** The unique indexes of the names, and the field each one covers. */
const NAME_INDEXES = {
  slot_types_active_name_idx: 'name',
  day_templates_active_name_idx: 'name',
};

/** The working weekdays as stored, each once, Monday first. The check of the table keeps them 1 to 7. */
const weekdaysOf = (stored: readonly number[]): Weekday[] =>
  [...new Set(stored)].sort((a, b) => a - b) as Weekday[];

/** What a write in the area knows: its transaction, the branch, and today in branch time. */
interface Context {
  readonly transaction: Transaction;
  readonly access: Access;
  readonly branchId: string;
  readonly requestId: string;
  /** Today in branch time, from the injected clock (`edge/00-definitions`, Branch time). */
  readonly today: string;
  readonly weekdays: readonly Weekday[];
}

/** Carries the answer of a preview out of the transaction it rolls back. */
class PreviewDone extends Error {
  constructor(readonly preview: TemplatePreview) {
    super('preview');
  }
}

/** The order of the levels in the list: the order of `TEMPLATE_LEVELS`. */
const levelOrder = (level: Assignment['level']) => TEMPLATE_LEVELS.indexOf(level);

/**
 * Slot types, day templates and where they apply (docs/spec/03-school-setup.md,
 * Slot types and day templates, owner: Academic Vice Principal; task 1.5), the
 * table of the resulting templates and the preview of a change.
 *
 * Lengths, versions and settings are dated rows (`dated-rows.ts`); a change
 * takes effect from a date after today in branch time (`date_not_in_future`).
 * The database guards the rows (db/migrations/0017); the service checks the
 * same rules first, so that a refusal names the field.
 *
 * Lock order (decision 12): every write takes the branch row `for update`
 * first, so the writes of the area in a branch run one after another, and the
 * in-use, overlap and midnight checks read a state no other write changes
 * meanwhile. Reads take no lock.
 *
 * The preview (decision 13) runs the same code as the save in a transaction
 * that is rolled back, so it shows exactly what the save does and writes
 * nothing, the audit entries included.
 */
@Injectable()
export class DayTemplates {
  constructor(
    private readonly transactions: Transactions,
    private readonly audit: Audit,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** A read in the branch of the request; today in branch time. */
  private read<T>(
    access: Access,
    branchId: string,
    work: (transaction: Transaction, today: string, weekdays: Weekday[]) => Promise<T>,
  ): Promise<T> {
    return this.transactions.run(access.branchIds, async (transaction) => {
      const branch = await transaction
        .selectFrom('branches')
        .select(['time_zone', 'working_weekdays'])
        .where('id', '=', branchId)
        .executeTakeFirst();
      if (branch === undefined) {
        throw notFound();
      }
      return work(
        transaction,
        schoolDateOf(this.clock.now(), branch.time_zone),
        weekdaysOf(branch.working_weekdays),
      );
    });
  }

  /** A write: the branch row taken for update first (decision 12); refusals of the database mapped. */
  private write<T>(
    access: Access,
    branchId: string,
    requestId: string,
    work: (context: Context) => Promise<T>,
  ): Promise<T> {
    return refusingConstraints(() =>
      refusingDuplicates(
        () =>
          this.transactions.run(access.branchIds, async (transaction) => {
            const branch = await transaction
              .selectFrom('branches')
              .select(['time_zone', 'working_weekdays'])
              .where('id', '=', branchId)
              .forUpdate()
              .executeTakeFirst();
            if (branch === undefined) {
              throw notFound();
            }
            return work({
              transaction,
              access,
              branchId,
              requestId,
              today: schoolDateOf(this.clock.now(), branch.time_zone),
              weekdays: weekdaysOf(branch.working_weekdays),
            });
          }),
        NAME_INDEXES,
      ),
    );
  }

  private record(
    context: Context,
    action: string,
    record: { type: string; id: string },
    values: { oldValue?: JsonValue; newValue?: JsonValue },
  ): Promise<void> {
    return this.audit.record(context.transaction, {
      branchId: context.branchId,
      actorId: context.access.accountId,
      assignmentId: context.access.assignmentId,
      action,
      record,
      ...values,
      requestId: context.requestId,
    });
  }

  /** A change takes effect from tomorrow at the earliest in branch time (`03`). */
  private static requireFuture(context: Context, from: string): void {
    if (from <= context.today) {
      throw refused('date_not_in_future', ['from']);
    }
  }

  /** Refused when a day of an active template would end after midnight on a date from `from` on (decision 7). */
  private static async refuseMidnight(
    context: Context,
    from: string,
    paths: readonly string[],
  ): Promise<void> {
    if (endsAfterMidnightFrom(await loadStore(context.transaction), from)) {
      throw refused('day_past_midnight', paths);
    }
  }

  // Slot types.

  listSlotTypes(access: Access, branchId: string): Promise<SlotTypeList> {
    return this.read(access, branchId, async (transaction, today) => {
      const store = await loadStore(transaction);
      return {
        slotTypes: [...store.slotTypes.values()]
          .map((slotType) => toSlotType(slotType, today))
          .sort(byName),
      };
    });
  }

  private async slotTypeAnswer(context: Context, id: string): Promise<SlotType> {
    const slotType = (await loadStore(context.transaction)).slotTypes.get(id);
    if (slotType === undefined) {
      throw notFound();
    }
    return toSlotType(slotType, context.today);
  }

  /** A new slot type; its first length is in force from today (decision 4). */
  createSlotType(
    access: Access,
    branchId: string,
    record: SlotTypeRecord,
    requestId: string,
  ): Promise<SlotType> {
    return this.write(access, branchId, requestId, async (context) => {
      const { id } = await context.transaction
        .insertInto('slot_types')
        .values({ branch_id: branchId, name: record.name, kind: record.kind })
        .returning('id')
        .executeTakeFirstOrThrow();
      await context.transaction
        .insertInto('slot_type_lengths')
        .values({
          branch_id: branchId,
          slot_type_id: id,
          length_minutes: record.lengthMinutes,
          valid_from: context.today,
        })
        .execute();
      await this.record(
        context,
        'slot_type.create',
        { type: 'slot_type', id },
        {
          newValue: { ...record, validFrom: context.today },
        },
      );
      return this.slotTypeAnswer(context, id);
    });
  }

  private static async slotTypeOf(context: Context, id: string): Promise<SlotTypeState> {
    const slotType = (await loadStore(context.transaction)).slotTypes.get(id);
    if (slotType === undefined) {
      throw notFound();
    }
    return slotType;
  }

  /** A new name, in place (decision 5); an archived slot type changes nothing. */
  renameSlotType(
    access: Access,
    branchId: string,
    id: string,
    record: SlotTypeRename,
    requestId: string,
  ): Promise<SlotType> {
    return this.write(access, branchId, requestId, async (context) => {
      const before = await DayTemplates.slotTypeOf(context, id);
      if (before.archivedAt !== null) {
        throw refused('slot_type_archived');
      }
      if (before.name !== record.name) {
        await context.transaction
          .updateTable('slot_types')
          .set({ name: record.name })
          .where('id', '=', id)
          .execute();
        await this.record(
          context,
          'slot_type.rename',
          { type: 'slot_type', id },
          {
            oldValue: { name: before.name },
            newValue: { name: record.name },
          },
        );
      }
      return this.slotTypeAnswer(context, id);
    });
  }

  private async changeLength(
    context: Context,
    id: string,
    change: SlotLengthChange,
  ): Promise<void> {
    DayTemplates.requireFuture(context, change.from);
    const slotType = await DayTemplates.slotTypeOf(context, id);
    if (slotType.archivedAt !== null) {
      throw refused('slot_type_archived');
    }
    const schedule = scheduleFrom(slotType.lengths, change.from);
    if (schedule.cut !== null) {
      await context.transaction
        .updateTable('slot_type_lengths')
        .set({ valid_until: schedule.cut.validUntil })
        .where('id', '=', schedule.cut.id)
        .execute();
    }
    await context.transaction
      .insertInto('slot_type_lengths')
      .values({
        branch_id: context.branchId,
        slot_type_id: id,
        length_minutes: change.lengthMinutes,
        valid_from: schedule.validFrom,
        valid_until: schedule.validUntil,
      })
      .execute();
    await DayTemplates.refuseMidnight(context, change.from, ['lengthMinutes']);
    const cut = slotType.lengths.find((length) => length.id === schedule.cut?.id);
    await this.record(
      context,
      'slot_type.length_change',
      { type: 'slot_type', id },
      {
        oldValue: { cut: cut === undefined ? null : { ...cut } },
        newValue: {
          lengthMinutes: change.lengthMinutes,
          validFrom: schedule.validFrom,
          validUntil: schedule.validUntil,
        },
      },
    );
  }

  /** A new length from a date (answer 12): the length in force is cut there, a later planned one stays. */
  changeSlotLength(
    access: Access,
    branchId: string,
    id: string,
    change: SlotLengthChange,
    requestId: string,
  ): Promise<SlotType> {
    return this.write(access, branchId, requestId, async (context) => {
      await this.changeLength(context, id, change);
      return this.slotTypeAnswer(context, id);
    });
  }

  /** Archived when unused (answer 9, decision 11); a second archive changes nothing. */
  archiveSlotType(
    access: Access,
    branchId: string,
    id: string,
    requestId: string,
  ): Promise<SlotType> {
    return this.write(access, branchId, requestId, async (context) => {
      const store = await loadStore(context.transaction);
      const slotType = store.slotTypes.get(id);
      if (slotType === undefined) {
        throw notFound();
      }
      if (slotType.archivedAt === null) {
        if (slotTypeInUse(store, id, context.today)) {
          throw refused('slot_type_in_use');
        }
        const now = this.clock.now();
        await context.transaction
          .updateTable('slot_types')
          .set({ archived_at: now })
          .where('id', '=', id)
          .execute();
        await this.record(
          context,
          'slot_type.archive',
          { type: 'slot_type', id },
          {
            oldValue: { archivedAt: null },
            newValue: { archivedAt: now.toISOString() },
          },
        );
      }
      return this.slotTypeAnswer(context, id);
    });
  }

  /** Restored, unless an active slot type has its name (`already_exists`). */
  restoreSlotType(
    access: Access,
    branchId: string,
    id: string,
    requestId: string,
  ): Promise<SlotType> {
    return this.write(access, branchId, requestId, async (context) => {
      const slotType = await DayTemplates.slotTypeOf(context, id);
      if (slotType.archivedAt !== null) {
        await context.transaction
          .updateTable('slot_types')
          .set({ archived_at: null })
          .where('id', '=', id)
          .execute();
        await this.record(
          context,
          'slot_type.restore',
          { type: 'slot_type', id },
          {
            oldValue: { archivedAt: slotType.archivedAt.toISOString() },
            newValue: { archivedAt: null },
          },
        );
      }
      return this.slotTypeAnswer(context, id);
    });
  }

  // Day templates.

  listTemplates(access: Access, branchId: string): Promise<DayTemplateList> {
    return this.read(access, branchId, async (transaction, today) => {
      const store = await loadStore(transaction);
      return {
        dayTemplates: [...store.templates.values()]
          .map((template) => {
            const timed = dayOf(store, template.id, today);
            return {
              id: template.id,
              name: template.name,
              archivedAt: moment(template.archivedAt),
              start: timed?.day.start ?? null,
              end: timed?.day.end ?? null,
              lessonSlots: timed === null ? 0 : lessonSlotsOf(timed.day),
              inUse: templateInUse(store, template.id, today),
            };
          })
          .sort(byName),
      };
    });
  }

  /** One template with its versions, its slots timed on the date. */
  template(access: Access, branchId: string, id: string, date: string): Promise<DayTemplate> {
    return this.read(access, branchId, async (transaction) =>
      templateAnswer(await loadStore(transaction), id, date),
    );
  }

  /**
   * The slot types of a new version, in their order: of the branch (404 for
   * another branch's or an unknown one), active, with at least one lesson slot
   * (answer 10).
   */
  private static checkSlots(store: TemplateStore, slotTypeIds: readonly string[]): void {
    const slotTypes = slotTypeIds.map((id) => store.slotTypes.get(id));
    if (slotTypes.some((slotType) => slotType === undefined)) {
      throw notFound();
    }
    if (slotTypes.some((slotType) => slotType?.archivedAt !== null)) {
      throw refused('slot_type_archived', ['slotTypeIds']);
    }
    if (!slotTypes.some((slotType) => slotType?.kind === 'lesson')) {
      throw refused('no_lesson_slot', ['slotTypeIds']);
    }
  }

  private static async insertVersion(
    context: Context,
    templateId: string,
    record: { startTime: string; slotTypeIds: readonly string[] },
    range: { validFrom: string; validUntil: string | null },
  ): Promise<string> {
    const { id } = await context.transaction
      .insertInto('day_template_versions')
      .values({
        branch_id: context.branchId,
        day_template_id: templateId,
        start_minutes: minutesOf(record.startTime),
        valid_from: range.validFrom,
        valid_until: range.validUntil,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await context.transaction
      .insertInto('day_template_slots')
      .values(
        record.slotTypeIds.map((slotTypeId, index) => ({
          version_id: id,
          branch_id: context.branchId,
          position: index + 1,
          slot_type_id: slotTypeId,
        })),
      )
      .execute();
    return id;
  }

  /** A new template; its first version is in force from today (decision 4). */
  createTemplate(
    access: Access,
    branchId: string,
    record: DayTemplateRecord,
    requestId: string,
  ): Promise<DayTemplate> {
    return this.write(access, branchId, requestId, async (context) => {
      DayTemplates.checkSlots(await loadStore(context.transaction), record.slotTypeIds);
      const { id } = await context.transaction
        .insertInto('day_templates')
        .values({ branch_id: branchId, name: record.name })
        .returning('id')
        .executeTakeFirstOrThrow();
      await DayTemplates.insertVersion(context, id, record, {
        validFrom: context.today,
        validUntil: null,
      });
      await DayTemplates.refuseMidnight(context, context.today, ['startTime', 'slotTypeIds']);
      await this.record(
        context,
        'day_template.create',
        { type: 'day_template', id },
        {
          newValue: { ...record, validFrom: context.today },
        },
      );
      return templateAnswer(await loadStore(context.transaction), id, context.today);
    });
  }

  private static async templateOf(context: Context, id: string): Promise<TemplateState> {
    const template = (await loadStore(context.transaction)).templates.get(id);
    if (template === undefined) {
      throw notFound();
    }
    return template;
  }

  /** A new name, in place (decision 5); an archived template changes nothing. */
  renameTemplate(
    access: Access,
    branchId: string,
    id: string,
    record: DayTemplateRename,
    requestId: string,
  ): Promise<DayTemplate> {
    return this.write(access, branchId, requestId, async (context) => {
      const before = await DayTemplates.templateOf(context, id);
      if (before.archivedAt !== null) {
        throw refused('template_archived');
      }
      if (before.name !== record.name) {
        await context.transaction
          .updateTable('day_templates')
          .set({ name: record.name })
          .where('id', '=', id)
          .execute();
        await this.record(
          context,
          'day_template.rename',
          { type: 'day_template', id },
          {
            oldValue: { name: before.name },
            newValue: { name: record.name },
          },
        );
      }
      return templateAnswer(await loadStore(context.transaction), id, context.today);
    });
  }

  private async addVersion(
    context: Context,
    id: string,
    record: DayTemplateVersionRecord,
  ): Promise<void> {
    DayTemplates.requireFuture(context, record.from);
    const store = await loadStore(context.transaction);
    const template = store.templates.get(id);
    if (template === undefined) {
      throw notFound();
    }
    if (template.archivedAt !== null) {
      throw refused('template_archived');
    }
    DayTemplates.checkSlots(store, record.slotTypeIds);
    const schedule = scheduleFrom(template.versions, record.from);
    if (schedule.cut !== null) {
      await context.transaction
        .updateTable('day_template_versions')
        .set({ valid_until: schedule.cut.validUntil })
        .where('id', '=', schedule.cut.id)
        .execute();
    }
    await DayTemplates.insertVersion(context, id, record, schedule);
    await DayTemplates.refuseMidnight(context, record.from, ['startTime', 'slotTypeIds']);
    const cut = template.versions.find((version) => version.id === schedule.cut?.id);
    await this.record(
      context,
      'day_template.version_create',
      { type: 'day_template', id },
      {
        oldValue: {
          cut:
            cut === undefined
              ? null
              : {
                  ...cut,
                  slotTypeIds: [...cut.slotTypeIds],
                  startTime: timeText(cut.startMinutes),
                },
        },
        newValue: {
          startTime: record.startTime,
          slotTypeIds: record.slotTypeIds,
          validFrom: schedule.validFrom,
          validUntil: schedule.validUntil,
        },
      },
    );
  }

  /** New slots or a new start time from a date (answer 12): the version in force is cut there. */
  addTemplateVersion(
    access: Access,
    branchId: string,
    id: string,
    record: DayTemplateVersionRecord,
    requestId: string,
  ): Promise<DayTemplate> {
    return this.write(access, branchId, requestId, async (context) => {
      await this.addVersion(context, id, record);
      return templateAnswer(await loadStore(context.transaction), id, record.from);
    });
  }

  /** Archived while no setting of it is in force today or later (decision 11). */
  archiveTemplate(
    access: Access,
    branchId: string,
    id: string,
    requestId: string,
  ): Promise<DayTemplate> {
    return this.write(access, branchId, requestId, async (context) => {
      const store = await loadStore(context.transaction);
      const template = store.templates.get(id);
      if (template === undefined) {
        throw notFound();
      }
      if (template.archivedAt === null) {
        if (templateInUse(store, id, context.today)) {
          throw refused('template_in_use');
        }
        const now = this.clock.now();
        await context.transaction
          .updateTable('day_templates')
          .set({ archived_at: now })
          .where('id', '=', id)
          .execute();
        await this.record(
          context,
          'day_template.archive',
          { type: 'day_template', id },
          {
            oldValue: { archivedAt: null },
            newValue: { archivedAt: now.toISOString() },
          },
        );
      }
      return templateAnswer(await loadStore(context.transaction), id, context.today);
    });
  }

  /**
   * Restored, unless an active template has its name (`already_exists`), a
   * version from today on uses an archived slot type, or a day would now end
   * after midnight (a length changed while it was archived).
   */
  restoreTemplate(
    access: Access,
    branchId: string,
    id: string,
    requestId: string,
  ): Promise<DayTemplate> {
    return this.write(access, branchId, requestId, async (context) => {
      const store = await loadStore(context.transaction);
      const template = store.templates.get(id);
      if (template === undefined) {
        throw notFound();
      }
      if (template.archivedAt !== null) {
        const usesArchived = template.versions.some(
          (version) =>
            reachesFrom(version, context.today) &&
            version.slotTypeIds.some(
              (slotTypeId) => store.slotTypes.get(slotTypeId)?.archivedAt !== null,
            ),
        );
        if (usesArchived) {
          throw refused('slot_type_archived');
        }
        await context.transaction
          .updateTable('day_templates')
          .set({ archived_at: null })
          .where('id', '=', id)
          .execute();
        await DayTemplates.refuseMidnight(context, context.today, []);
        await this.record(
          context,
          'day_template.restore',
          { type: 'day_template', id },
          {
            oldValue: { archivedAt: template.archivedAt.toISOString() },
            newValue: { archivedAt: null },
          },
        );
      }
      return templateAnswer(await loadStore(context.transaction), id, context.today);
    });
  }

  // Where templates apply.

  listAssignments(access: Access, branchId: string): Promise<AssignmentList> {
    return this.read(access, branchId, async (transaction) => ({
      assignments: (await loadStore(transaction)).assignments
        .filter((row) => !isWithdrawn(row))
        .sort(
          (a, b) =>
            levelOrder(a.level) - levelOrder(b.level) ||
            (a.weekday ?? 0) - (b.weekday ?? 0) ||
            (a.gradeFrom ?? 0) - (b.gradeFrom ?? 0) ||
            a.validFrom.localeCompare(b.validFrom),
        ),
    }));
  }

  private static async assignmentAnswer(context: Context, id: string): Promise<Assignment> {
    const row = (await loadStore(context.transaction)).assignments.find((one) => one.id === id);
    if (row === undefined) {
      throw notFound();
    }
    return row;
  }

  private async setAssignment(context: Context, record: AssignmentRecord): Promise<string> {
    DayTemplates.requireFuture(context, record.from);
    const store = await loadStore(context.transaction);
    const template = store.templates.get(record.dayTemplateId);
    if (template === undefined) {
      throw notFound();
    }
    if (template.archivedAt !== null) {
      throw refused('template_archived', ['dayTemplateId']);
    }
    const live = store.assignments.filter(
      (row) => !isWithdrawn(row) && row.level === record.level && row.weekday === record.weekday,
    );
    const sameKey = live.filter(
      (row) => row.gradeFrom === record.gradeFrom && row.gradeTo === record.gradeTo,
    );
    // Another grade range of the level that shares a grade (decision 18).
    const from = record.gradeFrom ?? 1;
    const to = record.gradeTo ?? 11;
    const overlapping = live.filter(
      (row) => !sameKey.includes(row) && (row.gradeFrom ?? 1) <= to && from <= (row.gradeTo ?? 11),
    );
    if (overlapping.some((row) => rowOn([row], record.from) !== undefined)) {
      throw refused('grade_ranges_overlap', ['gradeFrom', 'gradeTo']);
    }
    const schedule = scheduleFrom(sameKey, record.from);
    const nextOverlap = overlapping
      .map((row) => row.validFrom)
      .filter((start) => start > record.from)
      .sort()[0];
    const validUntil =
      nextOverlap !== undefined &&
      (schedule.validUntil === null || nextOverlap < schedule.validUntil)
        ? nextOverlap
        : schedule.validUntil;
    if (schedule.cut !== null) {
      await context.transaction
        .updateTable('day_template_assignments')
        .set({ valid_until: schedule.cut.validUntil })
        .where('id', '=', schedule.cut.id)
        .execute();
    }
    const { id } = await context.transaction
      .insertInto('day_template_assignments')
      .values({
        branch_id: context.branchId,
        level: record.level,
        weekday: record.weekday,
        grade_from: record.gradeFrom,
        grade_to: record.gradeTo,
        day_template_id: record.dayTemplateId,
        valid_from: schedule.validFrom,
        valid_until: validUntil,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const cut = sameKey.find((row) => row.id === schedule.cut?.id);
    await this.record(
      context,
      'day_template_assignment.set',
      { type: 'day_template_assignment', id },
      {
        oldValue: {
          cut:
            cut === undefined
              ? null
              : {
                  dayTemplateId: cut.dayTemplateId,
                  validFrom: cut.validFrom,
                  validUntil: cut.validUntil,
                },
        },
        newValue: {
          level: record.level,
          weekday: record.weekday,
          gradeFrom: record.gradeFrom,
          gradeTo: record.gradeTo,
          dayTemplateId: record.dayTemplateId,
          validFrom: schedule.validFrom,
          validUntil,
        },
      },
    );
    return id;
  }

  /** A template set at a level from a date (answer 11). */
  assign(
    access: Access,
    branchId: string,
    record: AssignmentRecord,
    requestId: string,
  ): Promise<Assignment> {
    return this.write(access, branchId, requestId, async (context) =>
      DayTemplates.assignmentAnswer(context, await this.setAssignment(context, record)),
    );
  }

  private async endAssignment(context: Context, id: string, change: AssignmentEnd): Promise<void> {
    DayTemplates.requireFuture(context, change.from);
    const row = (await loadStore(context.transaction)).assignments.find((one) => one.id === id);
    if (row === undefined) {
      throw notFound();
    }
    if (row.level === 'default') {
      throw refused('default_template_required');
    }
    const validUntil = endFrom(row, change.from);
    if (validUntil === null) {
      throw refused('already_ended', ['from']);
    }
    await context.transaction
      .updateTable('day_template_assignments')
      .set({ valid_until: validUntil })
      .where('id', '=', id)
      .execute();
    await this.record(
      context,
      'day_template_assignment.end',
      { type: 'day_template_assignment', id },
      { oldValue: { validUntil: row.validUntil }, newValue: { validUntil } },
    );
  }

  /** The end of a setting from a date; the default is replaced, never ended (decision 8). */
  end(
    access: Access,
    branchId: string,
    id: string,
    change: AssignmentEnd,
    requestId: string,
  ): Promise<Assignment> {
    return this.write(access, branchId, requestId, async (context) => {
      await this.endAssignment(context, id, change);
      return DayTemplates.assignmentAnswer(context, id);
    });
  }

  // The table and the preview.

  table(access: Access, branchId: string, date: string): Promise<TemplateTable> {
    return this.read(access, branchId, async (transaction, _today, weekdays) =>
      tableOn(await loadStore(transaction), date, weekdays),
    );
  }

  /**
   * The table on the date of a change, before and after it, with the changed
   * cells (`03`: "saving a template at any level shows that table with the
   * changes marked, as the preview of the change"). The change is made by the
   * code of its save, checked by the database at once (the deferred checks
   * too), and rolled back: nothing is written, no audit entry either.
   */
  async preview(
    access: Access,
    branchId: string,
    change: TemplateChange,
    requestId: string,
  ): Promise<TemplatePreview> {
    try {
      await this.write(access, branchId, requestId, async (context) => {
        const date = change.change.from;
        const before = tableOn(await loadStore(context.transaction), date, context.weekdays);
        switch (change.kind) {
          case 'slot_length':
            await this.changeLength(context, change.slotTypeId, change.change);
            break;
          case 'template_version':
            await this.addVersion(context, change.dayTemplateId, change.change);
            break;
          case 'assignment_set':
            await this.setAssignment(context, change.change);
            break;
          case 'assignment_end':
            await this.endAssignment(context, change.assignmentId, change.change);
            break;
        }
        await sql`set constraints all immediate`.execute(context.transaction);
        const after = tableOn(await loadStore(context.transaction), date, context.weekdays);
        throw new PreviewDone({ before, after, changed: changedCells(before, after) });
      });
    } catch (error) {
      if (error instanceof PreviewDone) {
        return error.preview;
      }
      throw error;
    }
    // The work above always throws: either the preview or a refusal.
    throw new ApiException('internal_error', 500);
  }
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

function toSlotType(slotType: SlotTypeState, today: string): SlotType {
  const live = slotType.lengths.filter((length) => !isWithdrawn(length));
  return {
    id: slotType.id,
    name: slotType.name,
    kind: slotType.kind,
    // Before its first length (never: the first is from the day of creation), the first one.
    lengthMinutes: lengthOn(slotType, today) ?? live[0]?.lengthMinutes ?? 0,
    lengths: live.map((length) => ({
      lengthMinutes: length.lengthMinutes,
      validFrom: length.validFrom,
      validUntil: length.validUntil,
    })),
    archivedAt: moment(slotType.archivedAt),
  };
}

function templateAnswer(store: TemplateStore, id: string, date: string): DayTemplate {
  const template = store.templates.get(id);
  if (template === undefined) {
    throw notFound();
  }
  return {
    id: template.id,
    name: template.name,
    archivedAt: moment(template.archivedAt),
    date,
    slots: [...(dayOf(store, id, date)?.slots ?? [])],
    versions: template.versions
      .filter((version) => !isWithdrawn(version))
      .map((version) => ({
        id: version.id,
        startMinutes: version.startMinutes,
        slotTypeIds: [...version.slotTypeIds],
        validFrom: version.validFrom,
        validUntil: version.validUntil,
      })),
  };
}
