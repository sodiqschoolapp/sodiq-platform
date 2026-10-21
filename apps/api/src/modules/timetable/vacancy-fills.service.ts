import { createHash, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  vacancyFillRowKeyOf,
  vacancyFillSchema,
  type ErrorCode,
  type PublishBody,
  type PublishCheck,
  type VacancyFill,
  type VacancyFillBody,
  type VacancyFillCheck,
  type VacancyFillCheckBody,
  type VacancyFillRowAnswer,
} from '@sodiq/shared';
import { patternIdOf, type CarryChange } from '@sodiq/timetable-rules';
import { sql } from 'kysely';
import { RequestKeys } from '../../database/request-keys.js';
import { Transactions, type Transaction } from '../../database/transactions.js';
import type { JsonValue } from '../../database/types.generated.js';
import { ApiException } from '../../http/api-exception.js';
import type { Access } from '../access/permission.guard.js';
import { Audit } from '../audit/audit.service.js';
import { branchOf } from '../classes/classes.service.js';
import { notFound } from '../setup/setup-refusals.js';
import type { StoredLoadRow } from './load-facts.js';
import type { PatternState } from './pattern.service.js';
import {
  PUBLISH_LOCK,
  PUBLISH_REFUSALS,
  TimetablePublish,
  lockPublishChain,
  refuseUnknownKeys,
  refusingPublish,
  type Findings,
} from './publish.service.js';
import { templateCellsOf, type StoredCells } from './template-cells.js';
import { Timetable, type VersionRow } from './timetable.service.js';
import { closeFilled, closeHoldersOf, type CloseHolder } from './vacancy-closes.js';
import { weightColumnsOf, weightsOf } from './version-weights.js';

/** A row of the vacancy across versions: its class or group and subject (decision 10). */
interface RowKey {
  readonly classId: string | null;
  readonly groupId: string | null;
  readonly subjectId: string;
}

const keyOf = (row: RowKey): string => vacancyFillRowKeyOf(row);

const keyOfRow = (row: StoredLoadRow): string =>
  keyOf({ classId: row.class_id, groupId: row.group_id, subjectId: row.subject_id });

/** A row left with the vacancy and why (decision 3). */
interface Left {
  readonly reason: 'blocked' | 'profile';
  readonly dates: Set<string>;
}

/** The versions a fill changes: the one it publishes from or carries in place, and the later ones. */
interface FillVersions {
  /** The published version in force on the fill date (\`V\`), or the one that starts on it (decision 4). */
  readonly first: VersionRow;
  readonly inPlace: boolean;
  /** Every published version the fill reads rows from, \`first\` first. */
  readonly all: readonly VersionRow[];
}

/** What a run of the fill prepared and found, with the savepoint holding its writes. */
interface Prepared {
  readonly rows: VacancyFillRowAnswer[];
  readonly rowsKey: string;
  readonly filled: readonly RowKey[];
  readonly versions: FillVersions;
  /** The version checked: the draft copied, or \`first\` in place; \`null\` when no row is filled. */
  readonly own: VersionRow | null;
  readonly check: PublishCheck | null;
  readonly changes: readonly CarryChange[];
  readonly chain: 'carry' | undefined;
  /** Every row of the vacancy from the date was chosen. */
  readonly allRows: boolean;
}

/** The refusals of a fill: the publish's, and a row of \`V\` that cannot be copied on the date. */
const FILL_REFUSALS: Readonly<Record<string, ErrorCode>> = {
  ...PUBLISH_REFUSALS,
  load_teacher_status: 'fill_version_rows',
  load_no_tutor: 'fill_version_rows',
  load_tutor_row_teacher: 'fill_version_rows',
  lesson_vacancy_closed: 'timetable_busy',
};

/**
 * Task 5.7a-3a: the id of the draft a fill copies, the same in the check and
 * in the fill while nothing else adds a version to the year, so the keys of
 * the publish (later versions, transition week, one-day changes), which name
 * the draft, match between them. Its branch, year and number are unique.
 */
function draftIdOf(branchId: string, yearId: string, number: number): string {
  const hex = createHash('sha256')
    .update(`vacancy-fill|${branchId}|${yearId}|${String(number)}`)
    .digest('hex');
  const variant = ((Number.parseInt(hex.slice(16, 17), 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Filling a vacancy (task 5.7a-3a, pull request #188; `06`, Changes after
 * publishing: "When the teacher is hired, the Academic Vice Principal fills
 * the vacancy with the person from a date, tomorrow at the earliest, for all
 * of its load rows or the chosen ones. It is a permanent change: the system
 * prepares and publishes a version that differs from the live one only in
 * the teacher of those rows, with the impact preview and every rule of
 * publishing. Every later published version that still names the vacancy is
 * changed in the same way from its own start date, in the same step and the
 * same preview").
 *
 * Decision 2: the fill is the publish. A draft copied from the version in
 * force on the date, with the person on the rows, is published from the date
 * with the chain answer "carry" and the fill's changes (the rows of every
 * version, must-fix 4); a date that is a published version's start carries
 * the change into it in place (decision 4). Decision 3: a row whose lessons
 * meet a blocked rule with the person, in any version, stays with the vacancy
 * whole and is listed; the check runs again without it. Lock order: the
 * publish's (`PUBLISH_LOCK`, `lockPublishChain`), then the vacancy's status
 * rows (`closeFilled`).
 */
@Injectable()
export class VacancyFills {
  constructor(
    private readonly transactions: Transactions,
    private readonly audit: Audit,
    private readonly requestKeys: RequestKeys,
    private readonly timetable: Timetable,
    private readonly publish: TimetablePublish,
  ) {}

  /** What the fill would do, written nowhere: its writes run under a savepoint rolled back. */
  check(access: Access, input: VacancyFillCheckBody, requestId: string): Promise<VacancyFillCheck> {
    const branchId = branchOf(access);
    return refusingPublish(
      () =>
        this.transactions.run(access.branchIds, async (transaction) => {
          await this.refuseUnknown(transaction, branchId, input, []);
          await sql`select pg_advisory_xact_lock(${PUBLISH_LOCK})`.execute(transaction);
          await sql`savepoint vacancy_fill_check`.execute(transaction);
          try {
            const prepared = await this.prepare(transaction, access, input, requestId);
            const holders =
              prepared.own === null ? [] : await this.holdersAfter(transaction, prepared, input);
            return {
              rows: prepared.rows,
              rowsKey: prepared.rowsKey,
              inPlace: prepared.versions.inPlace,
              publish: prepared.check,
              closes:
                prepared.own !== null &&
                prepared.allRows &&
                prepared.rows.every((one) => one.filled) &&
                holders.length === 0,
              holders: holders.map((one) => ({ ...one })),
            };
          } finally {
            await sql`rollback to savepoint vacancy_fill_check`.execute(transaction);
            await sql`release savepoint vacancy_fill_check`.execute(transaction);
          }
        }),
      FILL_REFUSALS,
    );
  }

  /** The fill, safe to repeat with its key. */
  fill(
    access: Access,
    input: VacancyFillBody,
    key: string,
    requestId: string,
  ): Promise<VacancyFill> {
    const branchId = branchOf(access);
    return refusingPublish(
      () =>
        this.transactions.run(access.branchIds, async (transaction) => {
          await this.refuseUnknown(
            transaction,
            branchId,
            input,
            (input.dayDecisions ?? []).map((one) => one.key),
            (input.dayDecisions ?? []).flatMap((one) =>
              one.blockId === undefined ? [] : [one.blockId],
            ),
          );
          await sql`select pg_advisory_xact_lock(${PUBLISH_LOCK})`.execute(transaction);
          const once = await this.requestKeys.runOnce(
            transaction,
            {
              key,
              scope: 'timetable.vacancy_fill',
              accountId: access.accountId,
              input: JSON.parse(JSON.stringify(input)) as JsonValue,
            },
            async () =>
              (await this.fillLocked(
                transaction,
                access,
                input,
                requestId,
              )) as unknown as JsonValue,
          );
          return vacancyFillSchema.parse(once.result);
        }),
      FILL_REFUSALS,
    );
  }

  private async fillLocked(
    transaction: Transaction,
    access: Access,
    input: VacancyFillBody,
    requestId: string,
  ): Promise<VacancyFill> {
    const branchId = branchOf(access);
    const prepared = await this.prepare(transaction, access, input, requestId);
    if (prepared.rowsKey !== input.rowsKey) {
      throw new ApiException('fill_rows_changed', 409);
    }
    if (prepared.own === null) {
      throw new ApiException(
        'fill_nothing',
        409,
        undefined,
        prepared.rows.map((one) => ({
          path: `rows.${keyOf(one)}`,
          code: one.reason ?? 'blocked',
          message: 'The row stays with the vacancy.',
        })),
      );
    }
    const body: PublishBody = {
      startsOn: input.startsOn,
      ...(prepared.chain === undefined ? {} : { chain: prepared.chain }),
      ...(input.laterKey === undefined ? {} : { laterKey: input.laterKey }),
      ...(input.transitionKey === undefined ? {} : { transitionKey: input.transitionKey }),
      ...(input.dayChangesKey === undefined ? {} : { dayChangesKey: input.dayChangesKey }),
      ...(input.dayDecisions === undefined ? {} : { dayDecisions: input.dayDecisions }),
    };
    const options = {
      carry: prepared.changes,
      vacancyFillOf: { vacancyId: input.vacancyId, personId: input.personId },
    };
    if (prepared.versions.inPlace) {
      await this.publish.carryInPlace(
        transaction,
        access,
        await this.timetable.versionRow(transaction, prepared.own.id),
        body,
        options,
        requestId,
      );
    } else {
      await this.publish.publishForFill(
        transaction,
        access,
        prepared.own.id,
        body,
        options,
        requestId,
      );
    }
    await sql`release savepoint vacancy_fill_try`.execute(transaction);

    const fill = await transaction
      .insertInto('vacancy_fills')
      .values({
        branch_id: branchId,
        vacancy_id: input.vacancyId,
        person_id: input.personId,
        fills_from: input.startsOn,
        version_id: prepared.versions.inPlace ? null : prepared.own.id,
        created_by: access.accountId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await transaction
      .insertInto('vacancy_fill_rows')
      .values(
        prepared.filled.map((one) => ({
          branch_id: branchId,
          fill_id: fill.id,
          class_id: one.classId,
          group_id: one.groupId,
          subject_id: one.subjectId,
        })),
      )
      .execute();
    const actor = { actorId: access.accountId, assignmentId: access.assignmentId, requestId };
    // Decision 5: closed from the date when nothing holds it any more.
    const close = await closeFilled(transaction, this.audit, {
      branchId,
      vacancyId: input.vacancyId,
      from: input.startsOn,
      ...actor,
    });
    await this.audit.record(transaction, {
      branchId,
      ...actor,
      action: 'vacancy.fill',
      record: { type: 'staff', id: input.vacancyId },
      personId: input.personId,
      oldValue: null,
      newValue: {
        fillId: fill.id,
        personId: input.personId,
        from: input.startsOn,
        versionId: prepared.versions.inPlace ? null : prepared.own.id,
        carriedInto: prepared.versions.inPlace ? prepared.own.id : null,
        rows: prepared.rows.map((one) => ({ ...one, dates: [...one.dates] })),
        closed: close.closed,
      },
    });
    return {
      id: fill.id,
      vacancyId: input.vacancyId,
      personId: input.personId,
      startsOn: input.startsOn,
      versionId: prepared.versions.inPlace ? null : prepared.own.id,
      rows: prepared.rows,
      closed: close.closed,
      holders: close.holders.map((one) => ({ ...one })),
    };
  }

  /**
   * Every id of the body is a record of the branch, before any lock (404):
   * the vacancy, the person, the classes, groups and subjects of the rows,
   * and the keys of the decisions (\`refuseUnknownKeys\`).
   */
  private async refuseUnknown(
    transaction: Transaction,
    branchId: string,
    input: VacancyFillCheckBody,
    keys: readonly string[],
    blockIds: readonly string[] = [],
  ): Promise<void> {
    const people = await transaction
      .selectFrom('staff')
      .innerJoin('staff_branches', 'staff_branches.staff_id', 'staff.id')
      .select(['staff.id', 'staff.kind'])
      .where('staff.id', 'in', [input.vacancyId, input.personId])
      .where('staff_branches.branch_id', '=', branchId)
      .execute();
    const vacancy = people.find((one) => one.id === input.vacancyId);
    const person = people.find((one) => one.id === input.personId);
    if (vacancy?.kind !== 'vacancy' || person === undefined) {
      throw notFound();
    }
    const rows = input.rows ?? [];
    const classIds = [
      ...new Set(rows.flatMap((one) => (one.classId === undefined ? [] : [one.classId]))),
    ];
    const groupIds = [
      ...new Set(rows.flatMap((one) => (one.groupId === undefined ? [] : [one.groupId]))),
    ];
    const subjectIds = [...new Set(rows.map((one) => one.subjectId))];
    const [classes, groups, subjects] = await Promise.all([
      classIds.length === 0
        ? []
        : transaction
            .selectFrom('classes')
            .select('id')
            .where('branch_id', '=', branchId)
            .where('id', 'in', classIds)
            .execute(),
      groupIds.length === 0
        ? []
        : transaction
            .selectFrom('groups')
            .select('id')
            .where('branch_id', '=', branchId)
            .where('id', 'in', groupIds)
            .execute(),
      subjectIds.length === 0
        ? []
        : transaction.selectFrom('subjects').select('id').where('id', 'in', subjectIds).execute(),
    ]);
    if (
      classes.length !== classIds.length ||
      groups.length !== groupIds.length ||
      subjects.length !== subjectIds.length
    ) {
      throw notFound();
    }
    await refuseUnknownKeys(transaction, branchId, keys, blockIds);
  }

  /**
   * The fill up to its publish, under the savepoint \`vacancy_fill_try\` that
   * holds the draft or the rows changed in place: the checks of the vacancy,
   * the person and the date, the rows, the rows the profile leaves (step 2a),
   * then the publish's check until no filled row meets a blocked rule.
   */
  private async prepare(
    transaction: Transaction,
    access: Access,
    input: VacancyFillCheckBody,
    requestId: string,
  ): Promise<Prepared> {
    const branchId = branchOf(access);
    const today = await this.timetable.todayIn(transaction, branchId);
    if (input.startsOn <= today) {
      throw new ApiException('fill_start', 409);
    }
    const versions = await this.versionsOf(transaction, branchId, input.startsOn);
    await lockPublishChain(transaction, branchId, versions.first.academic_year_id);
    await this.refuseStatuses(transaction, input, today);

    // Step 2: the rows of the vacancy in every version from the date.
    const rowsOf = new Map<string, StoredLoadRow[]>();
    const keys = new Map<string, RowKey>();
    for (const version of versions.all) {
      const rows = await this.timetable.rowsOf(transaction, version.id);
      rowsOf.set(version.id, rows);
      for (const row of rows) {
        if (row.teacher_id !== input.vacancyId) continue;
        keys.set(keyOfRow(row), {
          classId: row.class_id,
          groupId: row.group_id,
          subjectId: row.subject_id,
        });
      }
    }
    if (keys.size === 0) {
      throw new ApiException('fill_rows', 409);
    }
    const chosen =
      input.rows === undefined
        ? [...keys.values()]
        : input.rows.map((one) => ({
            classId: one.classId ?? null,
            groupId: one.groupId ?? null,
            subjectId: one.subjectId,
          }));
    if (chosen.some((one) => !keys.has(keyOf(one)))) {
      throw new ApiException('fill_rows', 409);
    }
    chosen.sort((a, b) => (keyOf(a) < keyOf(b) ? -1 : keyOf(a) > keyOf(b) ? 1 : 0));

    // Step 2a (spec review of the plan, must-fix 1): a row the person's
    // profile does not fit stays with the vacancy before anything is written.
    const left = new Map<string, Left>();
    for (const version of versions.all) {
      const rows = rowsOf.get(version.id) ?? [];
      const changed = rows.map((row) =>
        row.teacher_id === input.vacancyId && chosen.some((one) => keyOf(one) === keyOfRow(row))
          ? { ...row, teacher_id: input.personId }
          : row,
      );
      const before = await this.problemsOf(transaction, version, rows);
      const after = await this.problemsOf(transaction, version, changed);
      for (const row of changed) {
        if (
          row.teacher_id !== input.personId ||
          rows.find((one) => one.id === row.id)?.teacher_id !== input.vacancyId
        ) {
          continue;
        }
        const was = new Set(before.get(row.id) ?? []);
        if ((after.get(row.id) ?? []).some((problem) => !was.has(problem))) {
          left.set(keyOfRow(row), { reason: 'profile', dates: new Set() });
        }
      }
    }

    // Step 4 (decision 3): the publish's check, until stable.
    let candidate = chosen.filter((one) => !left.has(keyOf(one)));
    let found: { own: VersionRow; check: PublishCheck; changes: CarryChange[] } | null = null;
    const chain = versions.all.length > 1 ? ('carry' as const) : undefined;
    while (candidate.length > 0) {
      await sql`savepoint vacancy_fill_try`.execute(transaction);
      const own = versions.inPlace
        ? await this.changeInPlace(transaction, versions.first, input, candidate)
        : await this.copyDraft(transaction, access, versions.first, input, candidate, requestId);
      const changes = this.changesOf(input, candidate, versions, rowsOf);
      const { check, findings } = await this.publish.checkForFill(
        transaction,
        access,
        own,
        input.startsOn,
        chain,
        { carry: changes },
      );
      const blocked = blockedKeysOf(findings, new Set(candidate.map(keyOf)), input.personId);
      if (blocked.size === 0) {
        found = { own, check, changes };
        break;
      }
      await sql`rollback to savepoint vacancy_fill_try`.execute(transaction);
      await sql`release savepoint vacancy_fill_try`.execute(transaction);
      for (const [key, dates] of blocked) {
        const was = left.get(key)?.dates ?? new Set<string>();
        for (const date of dates) was.add(date);
        left.set(key, { reason: 'blocked', dates: was });
      }
      candidate = candidate.filter((one) => !blocked.has(keyOf(one)));
    }

    const rows: VacancyFillRowAnswer[] = chosen.map((one) => {
      const why = left.get(keyOf(one));
      return {
        classId: one.classId,
        groupId: one.groupId,
        subjectId: one.subjectId,
        filled: why === undefined,
        reason: why?.reason ?? null,
        dates: why === undefined ? [] : [...why.dates].sort(),
      };
    });
    return {
      rows,
      rowsKey: createHash('sha256')
        .update(
          JSON.stringify({
            vacancyId: input.vacancyId,
            personId: input.personId,
            startsOn: input.startsOn,
            rows,
          }),
        )
        .digest('hex'),
      filled: candidate,
      versions,
      own: found?.own ?? null,
      check: found?.check ?? null,
      changes: found?.changes ?? [],
      chain,
      allRows: chosen.length === keys.size,
    };
  }

  /**
   * The published versions of the year that holds the date: the one in force
   * on it (a tie on a start to the higher number), or the one that starts on
   * it (decision 4), and the later ones in start order. None in force is
   * \`fill_rows\`: the vacancy has no row from the date.
   */
  private async versionsOf(
    transaction: Transaction,
    branchId: string,
    startsOn: string,
  ): Promise<FillVersions> {
    const year = await transaction
      .selectFrom('academic_years')
      .select('id')
      .where('branch_id', '=', branchId)
      .where('start_date', '<=', startsOn)
      .where('end_date', '>=', startsOn)
      .where('status', '<>', 'closed')
      .executeTakeFirst();
    if (year === undefined) {
      throw new ApiException('fill_start', 409);
    }
    const published = await transaction
      .selectFrom('timetable_versions')
      .select(['id', 'number', 'starts_on'])
      .where('branch_id', '=', branchId)
      .where('academic_year_id', '=', year.id)
      .where('status', '=', 'published')
      .orderBy('starts_on')
      .orderBy('number')
      .execute();
    const atOrBefore = published.filter((one) => one.starts_on <= startsOn);
    const first = atOrBefore.at(-1);
    if (first === undefined) {
      throw new ApiException('fill_rows', 409);
    }
    const later = published.filter((one) => one.starts_on > startsOn);
    const all = [first, ...later];
    const rows: VersionRow[] = [];
    for (const one of all) rows.push(await this.timetable.versionRow(transaction, one.id));
    const [head] = rows;
    if (head === undefined) throw new Error('A fill has a version in force.');
    return { first: head, inPlace: first.starts_on === startsOn, all: rows };
  }

  /**
   * The vacancy is open on the date and today, with no close planned (\`fill_vacancy\`);
   * the person is active on the date (\`fill_person\`); read after the
   * publish's locks, which hold both FOR KEY SHARE.
   */
  private async refuseStatuses(
    transaction: Transaction,
    input: VacancyFillCheckBody,
    today: string,
  ): Promise<void> {
    const statuses = await transaction
      .selectFrom('staff_statuses')
      .select(['staff_id', 'status', 'valid_from', 'valid_until'])
      .where('staff_id', 'in', [input.vacancyId, input.personId])
      .execute();
    const live = statuses.filter((one) => one.valid_until !== one.valid_from);
    const onDay = (id: string, day: string) =>
      live.find(
        (one) =>
          one.staff_id === id &&
          one.valid_from <= day &&
          (one.valid_until === null || day < one.valid_until),
      )?.status ?? null;
    const closedLater = live.some(
      (one) =>
        one.staff_id === input.vacancyId && one.status === 'closed' && one.valid_from > today,
    );
    if (
      onDay(input.vacancyId, today) === 'closed' ||
      onDay(input.vacancyId, input.startsOn) === 'closed' ||
      closedLater
    ) {
      throw new ApiException('fill_vacancy', 409);
    }
    const kind = await transaction
      .selectFrom('staff')
      .select('kind')
      .where('id', '=', input.personId)
      .executeTakeFirstOrThrow();
    if (kind.kind !== 'person' || onDay(input.personId, input.startsOn) !== 'active') {
      throw new ApiException('fill_person', 409);
    }
  }

  /** The load problems of each row of a version's rows (the readiness's \`problemRows\`). */
  private async problemsOf(
    transaction: Transaction,
    version: VersionRow,
    rows: StoredLoadRow[],
  ): Promise<Map<string, readonly string[]>> {
    const readiness = await this.timetable.readinessOf(
      transaction,
      version.branch_id,
      version,
      rows,
    );
    return new Map(readiness.load.problemRows.map((one) => [one.id, one.problems]));
  }

  /** Decision 4: the rows of the version that starts on the date, given to the person in place. */
  private async changeInPlace(
    transaction: Transaction,
    version: VersionRow,
    input: VacancyFillCheckBody,
    rows: readonly RowKey[],
  ): Promise<VersionRow> {
    for (const one of rows) {
      await transaction
        .updateTable('teaching_load_rows')
        .set({ teacher_id: input.personId })
        .where('version_id', '=', version.id)
        .where('teacher_id', '=', input.vacancyId)
        .where('subject_id', '=', one.subjectId)
        .where((builder) =>
          one.classId === null
            ? builder('class_id', 'is', null)
            : builder('class_id', '=', one.classId),
        )
        .where((builder) =>
          one.groupId === null
            ? builder('group_id', 'is', null)
            : builder('group_id', '=', one.groupId),
        )
        .execute();
    }
    return this.timetable.versionRow(transaction, version.id);
  }

  /**
   * The draft a fill publishes (decision 2): a copy of the version in force,
   * starting on the date, its rows the same but the person on the rows filled
   * (a Tutor row with the class's Tutor of the date, as a copy takes it), its
   * pins, the shortened-day choices from the date, its pattern (a copy takes
   * the load and pins only, so the fill copies the blocks itself), its
   * weights, and the templates confirmed as they are on the date.
   */
  private async copyDraft(
    transaction: Transaction,
    access: Access,
    source: VersionRow,
    input: VacancyFillCheckBody,
    filled: readonly RowKey[],
    requestId: string,
  ): Promise<VersionRow> {
    const branchId = source.branch_id;
    const last = await transaction
      .selectFrom('timetable_versions')
      .select((builder) => builder.fn.max('number').as('number'))
      .where('academic_year_id', '=', source.academic_year_id)
      .executeTakeFirst();
    const number = (last?.number ?? 0) + 1;
    const id = draftIdOf(branchId, source.academic_year_id, number);
    await transaction
      .insertInto('timetable_versions')
      .values({
        id,
        branch_id: branchId,
        academic_year_id: source.academic_year_id,
        number,
        starts_on: input.startsOn,
        from_version_id: source.id,
        left_rows: JSON.stringify([]),
        ...weightColumnsOf(weightsOf(source)),
      })
      .execute();
    const draft = await this.timetable.versionRow(transaction, id);
    const context = await this.timetable.contextOf(transaction, draft);
    const sourceRows = await this.timetable.withVersionTutors(
      transaction,
      context,
      await this.timetable.rowsOf(transaction, source.id),
    );
    const filledKeys = new Set(filled.map(keyOf));
    const rowIds = new Map<string, string>();
    const teacherOf = new Map<string, string>();
    for (const row of sourceRows) {
      const teacherId =
        row.teacher_id === input.vacancyId && filledKeys.has(keyOfRow(row))
          ? input.personId
          : row.teacher_id;
      const inserted = await transaction
        .insertInto('teaching_load_rows')
        .values({
          branch_id: branchId,
          version_id: id,
          class_id: row.class_id,
          group_id: row.group_id,
          subject_id: row.subject_id,
          teacher_id: teacherId,
          lessons_per_week: row.lessons_per_week,
          room_id: row.room_id,
          room_type: row.room_type,
          double_lessons: row.double_lessons,
          mixed_block: row.mixed_block,
          short_reason: row.short_reason ?? null,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      rowIds.set(row.id, inserted.id);
      teacherOf.set(inserted.id, teacherId);
    }
    const newRow = (rowId: string): string => {
      const found = rowIds.get(rowId);
      if (found === undefined) throw new Error('A copied entry has a copied row.');
      return found;
    };
    const pins = await transaction
      .selectFrom('timetable_pins')
      .select(['load_row_id', 'weekday', 'slot_position'])
      .where('version_id', '=', source.id)
      .execute();
    if (pins.length > 0) {
      await transaction
        .insertInto('timetable_pins')
        .values(
          pins.map((pin) => ({
            branch_id: branchId,
            version_id: id,
            load_row_id: newRow(pin.load_row_id),
            weekday: pin.weekday,
            slot_position: pin.slot_position,
          })),
        )
        .execute();
    }
    const keeps = await transaction
      .selectFrom('timetable_day_keeps')
      .select(['class_id', 'kept_on', 'slot_position'])
      .where('version_id', '=', source.id)
      .where('kept_on', '>=', input.startsOn)
      .execute();
    if (keeps.length > 0) {
      await transaction
        .insertInto('timetable_day_keeps')
        .values(
          keeps.map((keep) => ({
            branch_id: branchId,
            version_id: id,
            class_id: keep.class_id,
            kept_on: keep.kept_on,
            slot_position: keep.slot_position,
          })),
        )
        .execute();
    }
    const blocks = await transaction
      .selectFrom('pattern_blocks')
      .select(['id', 'weekday', 'slot_position', 'start_minutes', 'end_minutes', 'double_pair_id'])
      .where('version_id', '=', source.id)
      .orderBy('id')
      .execute();
    const entries = await transaction
      .selectFrom('pattern_entries')
      .select(['block_id', 'load_row_id', 'room_id'])
      .where('version_id', '=', source.id)
      .orderBy('id')
      .execute();
    const pairs = new Map<string, string>();
    for (const block of blocks) {
      let pair: string | null = null;
      if (block.double_pair_id !== null) {
        pair = pairs.get(block.double_pair_id) ?? randomUUID();
        pairs.set(block.double_pair_id, pair);
      }
      const written = await transaction
        .insertInto('pattern_blocks')
        .values({
          branch_id: branchId,
          version_id: id,
          weekday: block.weekday,
          slot_position: block.slot_position,
          start_minutes: block.start_minutes,
          end_minutes: block.end_minutes,
          double_pair_id: pair,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const own = entries.filter((one) => one.block_id === block.id);
      if (own.length === 0) continue;
      await transaction
        .insertInto('pattern_entries')
        .values(
          own.map((entry) => {
            const loadRowId = newRow(entry.load_row_id);
            return {
              branch_id: branchId,
              version_id: id,
              block_id: written.id,
              weekday: block.weekday,
              start_minutes: block.start_minutes,
              end_minutes: block.end_minutes,
              load_row_id: loadRowId,
              teacher_id: teacherOf.get(loadRowId) ?? '',
              room_id: entry.room_id,
            };
          }),
        )
        .execute();
    }
    const drawn = await templateCellsOf(
      transaction,
      branchId,
      source.academic_year_id,
      context.statusOn,
    );
    const confirmed: StoredCells = { from: context.statusOn, cells: drawn.cells };
    await transaction
      .updateTable('timetable_versions')
      .set({ templates_confirmed: JSON.stringify(confirmed) })
      .where('id', '=', id)
      .execute();
    await this.audit.record(transaction, {
      branchId,
      actorId: access.accountId,
      assignmentId: access.assignmentId,
      action: 'timetable_version.create',
      record: { type: 'timetable_version', id },
      newValue: {
        academicYearId: source.academic_year_id,
        number,
        startsOn: input.startsOn,
        fromVersionId: source.id,
        vacancyFill: { vacancyId: input.vacancyId, personId: input.personId },
      },
      requestId,
    });
    return this.timetable.versionRow(transaction, id);
  }

  /** The changes carried into the later versions: every row filled, vacancy to person (must-fix 4). */
  private changesOf(
    input: VacancyFillCheckBody,
    filled: readonly RowKey[],
    versions: FillVersions,
    rowsOf: ReadonlyMap<string, readonly StoredLoadRow[]>,
  ): CarryChange[] {
    const later = versions.all.slice(1);
    const named = new Set(
      later.flatMap((version) =>
        (rowsOf.get(version.id) ?? [])
          .filter((row) => row.teacher_id === input.vacancyId)
          .map(keyOfRow),
      ),
    );
    return filled
      .filter((one) => named.has(keyOf(one)))
      .map((one) => ({
        kind: 'teacher' as const,
        classId: one.classId,
        groupId: one.groupId,
        subjectId: one.subjectId,
        before: input.vacancyId,
        after: input.personId,
      }));
  }

  /**
   * Decision 5 for the check: what would still hold the vacancy from the date
   * once the fill is written: every holder but the fill's own draft and the
   * versions the fill changes, which no longer name it when every row is
   * filled.
   */
  private async holdersAfter(
    transaction: Transaction,
    prepared: Prepared,
    input: VacancyFillCheckBody,
  ): Promise<CloseHolder[]> {
    const branchId = prepared.versions.first.branch_id;
    const changed = new Set([
      prepared.own?.id ?? '',
      ...prepared.versions.all.map((one) => one.id),
    ]);
    return (await closeHoldersOf(transaction, input.vacancyId, branchId, input.startsOn)).filter(
      (one) => one.versionId !== null && !changed.has(one.versionId),
    );
  }
}

/**
 * The rows of a fill that a blocked result of the check names (decision 3):
 * a result of the own run or of a carried version whose lessons include a
 * lesson of a filled row, now the person's, with its date when it has one;
 * a load problem of a filled row too. By the key of the row.
 */
function blockedKeysOf(
  findings: Findings,
  filled: ReadonlySet<string>,
  personId: string,
): Map<string, Set<string>> {
  const blocked = new Map<string, Set<string>>();
  const add = (key: string, date: string | undefined) => {
    const dates = blocked.get(key) ?? new Set<string>();
    if (date !== undefined) dates.add(date);
    blocked.set(key, dates);
  };
  const read = (
    state: PatternState,
    refusals: readonly {
      code: string;
      loadRowId?: string | undefined;
      result?: { lessonIds: readonly string[]; date?: string | undefined } | undefined;
    }[],
  ) => {
    const rowById = new Map(state.rows.map((row) => [row.id, row]));
    const rowOfLesson = new Map(
      state.blocks.flatMap((block) => block.lessons.map((one) => [one.id, one.loadRowId] as const)),
    );
    const keyOfPersonRow = (rowId: string | undefined): string | null => {
      const row = rowId === undefined ? undefined : rowById.get(rowId);
      if (row === undefined || row.teacher_id !== personId) return null;
      const key = keyOfRow(row);
      return filled.has(key) ? key : null;
    };
    for (const refusal of refusals) {
      if (refusal.code === 'load_problem') {
        const key = keyOfPersonRow(refusal.loadRowId);
        if (key !== null) add(key, undefined);
        continue;
      }
      if (refusal.code !== 'pattern_blocked' && refusal.code !== 'date_blocked') continue;
      for (const lessonId of refusal.result?.lessonIds ?? []) {
        const key = keyOfPersonRow(rowOfLesson.get(patternIdOf(lessonId)?.id ?? lessonId));
        if (key !== null) add(key, refusal.result?.date);
      }
    }
  };
  if (findings.written !== null) read(findings.written.state, findings.refusals);
  for (const carried of findings.carried) {
    if (carried.written !== null) read(carried.written.state, carried.refusals);
  }
  return blocked;
}
