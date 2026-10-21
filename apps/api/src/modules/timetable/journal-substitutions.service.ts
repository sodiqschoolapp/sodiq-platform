import { Injectable } from '@nestjs/common';
import {
  journalSubstituteAnswerSchema,
  schoolDateOf,
  journalSubstitutesAnswerSchema,
  type AbsenceJournalSubstituteBody,
  type ErrorDetail,
  type JournalSubstituteAnswer,
  type JournalSubstitutesAnswer,
  type VacancyJournalSubstituteBody,
  type VacancyJournalSubstitutesQuery,
} from '@sodiq/shared';
import {
  RELAXED_WHEN_NO_TEACHER_FREE,
  type RuleCode,
  type RuleResult,
} from '@sodiq/timetable-rules';
import { sql } from 'kysely';
import { RequestKeys } from '../../database/request-keys.js';
import { Transactions, transactionMoment, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import type { JsonValue } from '../../database/types.generated.js';
import type { Access } from '../access/permission.guard.js';
import { Audit } from '../audit/audit.service.js';
import { branchOf } from '../classes/classes.service.js';
import { Notifications } from '../notifications/notifications.service.js';
import { notFound } from '../setup/setup-refusals.js';
import { awayAt, awaySpans } from './away-read.js';
import { blockedDetail } from './day-changes.service.js';
import { journalOwnerOn } from './journal-owners.js';
import { TimetablePattern } from './pattern.service.js';
import { PUBLISH_LOCK, lockPublishChain, refusingPublish } from './publish.service.js';
import {
  pairOf,
  storedDayCheck,
  storedLessonsOn,
  type Services,
  type StoredDayLesson,
} from './stored-day.js';
import { substitutionsInForce, writeRecord } from './substitutions-read.js';
import {
  SUBSTITUTION_REFUSALS,
  TimetableSubstitutions,
  refuseClosedYear,
} from './substitutions.service.js';
import { Timetable } from './timetable.service.js';
import { sendWeekChanges, snapshotDates } from './week-changes.js';

/** The warnings a save sends back for a tick (5.7b-1 decision 2): the relaxed rules and the language. */
const TICKED: readonly RuleCode[] = [...RELAXED_WHEN_NO_TEACHER_FREE, 'substitute_language'];

const GROUP_ORDER = ['subject', 'department', 'other'] as const;

/** A journal of the branch, as a run reads it. */
interface Journal {
  readonly id: string;
  readonly yearId: string;
  readonly classId: string | null;
  readonly groupId: string | null;
  readonly subjectId: string;
}

/**
 * The lessons a per-journal action works on (decision 5): the journal's
 * lessons of the branch in the run, not started and not cancelled, whose
 * teacher is the teacher replaced, by unit (one lesson, or the halves of a
 * double together); and those already substituted for that teacher, left
 * as they are.
 */
interface Run {
  readonly branchId: string;
  readonly replacedId: string;
  readonly journal: Journal;
  readonly units: readonly (readonly StoredDayLesson[])[];
  readonly taken: readonly { lessonId: string; date: string }[];
}

/** The range of a run: an absence's moments, or a vacancy's school dates. */
type Range =
  | { readonly kind: 'moments'; readonly from: Date; readonly until: Date | null }
  | { readonly kind: 'dates'; readonly from: string; readonly until: string | null };

/** What the check of one unit with the chosen substitute found. */
interface UnitResult {
  readonly unit: readonly StoredDayLesson[];
  readonly date: string;
  readonly relaxed: boolean;
  readonly blocked: readonly string[];
  readonly ticked: readonly RuleResult[];
}

/**
 * The substitution per journal (task 5.7b-2, pull request #192; `06`,
 * Changes after publishing, Substitution: "It can be started from a single
 * lesson ... or from a teacher (mark them absent for one or more dates). In
 * the second case the system lists all their lessons in the period and, for
 * each, suggests teachers who are free in that slot"; `edge/timetable`,
 * After publishing: "One substitute can be assigned per journal for the
 * whole absence in one action, each date still being checked.").
 *
 * Each unit (a lesson, or the halves of a double) is checked on its own date
 * with the substitute, the exception "no teacher of the subject is free"
 * decided for that unit alone (decision 3); blocked units are listed and
 * the rest saved in one record (decision 6). A save takes the publish lock
 * first, then the year's publish chain (decision 13), as every writer of a
 * substitution does, so a shortening of the absence never meets it halfway.
 * The vacancy's journal is offered the same way over a period (decision 7).
 */
@Injectable()
export class TimetableJournalSubstitutions {
  constructor(
    private readonly transactions: Transactions,
    private readonly requestKeys: RequestKeys,
    private readonly audit: Audit,
    private readonly timetable: Timetable,
    private readonly pattern: TimetablePattern,
    private readonly notifications: Notifications,
    private readonly substitutions: TimetableSubstitutions,
  ) {}

  private get services(): Services {
    return { timetable: this.timetable, pattern: this.pattern };
  }

  /** The suggestions for the whole absence (decision 11). */
  absenceSubstitutes(
    access: Access,
    absenceId: string,
    journalId: string,
  ): Promise<JournalSubstitutesAnswer> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const absence = await absenceOf(transaction, branchId, absenceId);
      const journal = await journalOf(transaction, branchId, journalId);
      const run = await this.runOf(transaction, branchId, journal, absence.staffId, {
        kind: 'moments',
        from: absence.from,
        until: absence.until,
      });
      return this.suggestionsOf(transaction, access.accountId, run, null);
    });
  }

  /** The suggestions for a vacancy's journal over a period, its acting teacher marked (decision 7). */
  vacancySubstitutes(
    access: Access,
    vacancyId: string,
    journalId: string,
    query: VacancyJournalSubstitutesQuery,
  ): Promise<JournalSubstitutesAnswer> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      await vacancyOf(transaction, branchId, vacancyId);
      const journal = await journalOf(transaction, branchId, journalId);
      const run = await this.runOf(transaction, branchId, journal, vacancyId, {
        kind: 'dates',
        from: query.from,
        until: query.until ?? null,
      });
      const owner = await journalOwnerOn(transaction, branchId, journalId, query.from);
      const acting = owner?.kind === 'acting' ? owner.staffId : null;
      return this.suggestionsOf(transaction, access.accountId, run, acting);
    });
  }

  /** One substitute for the journal's lessons of the absence, each date checked; safe to repeat with its key. */
  absenceSubstitute(
    access: Access,
    absenceId: string,
    input: AbsenceJournalSubstituteBody,
    key: string,
    requestId: string,
  ): Promise<JournalSubstituteAnswer> {
    const branchId = branchOf(access);
    return this.keyed(
      access,
      key,
      'timetable.absence_journal_substitute',
      { absenceId, ...stringsOf(input) },
      async (transaction) => {
        await absenceOf(transaction, branchId, absenceId);
        const journal = await journalOf(transaction, branchId, input.journalId);
        await teacherOf(transaction, branchId, input.teacherId);
        return { journal };
      },
      async (transaction, { journal }) => {
        // Read again under the publish lock, which a shortening of the
        // absence takes first (decision 13): the range is the one in force.
        const absence = await absenceOf(transaction, branchId, absenceId);
        if (absence.withdrawn) throw new ApiException('absence_withdrawn', 409);
        return this.save(transaction, access, requestId, {
          journal,
          replacedId: absence.staffId,
          range: { kind: 'moments', from: absence.from, until: absence.until },
          teacherId: input.teacherId,
          reason: input.reason,
          confirm: input.confirm === true,
          source: 'absence',
          absenceId,
          vacancyId: null,
        });
      },
    );
  }

  /** One substitute for a vacancy's journal over a period, each date checked; safe to repeat with its key. */
  vacancySubstitute(
    access: Access,
    vacancyId: string,
    input: VacancyJournalSubstituteBody,
    key: string,
    requestId: string,
  ): Promise<JournalSubstituteAnswer> {
    const branchId = branchOf(access);
    return this.keyed(
      access,
      key,
      'timetable.vacancy_journal_substitute',
      { vacancyId, ...stringsOf(input) },
      async (transaction) => {
        await vacancyOf(transaction, branchId, vacancyId);
        const journal = await journalOf(transaction, branchId, input.journalId);
        await teacherOf(transaction, branchId, input.teacherId);
        return { journal };
      },
      async (transaction, { journal }) => {
        const today = await todayOf(transaction, branchId);
        if (input.from < today) {
          throw new ApiException('validation_failed', 400, undefined, [
            { path: 'from', code: 'too_small', message: 'The period starts today or later.' },
          ]);
        }
        return this.save(transaction, access, requestId, {
          journal,
          replacedId: vacancyId,
          range: { kind: 'dates', from: input.from, until: input.until ?? null },
          teacherId: input.teacherId,
          reason: input.reason,
          confirm: input.confirm === true,
          source: 'journal',
          absenceId: null,
          vacancyId,
        });
      },
    );
  }

  /**
   * A keyed save: the ids of the request checked against the branch before
   * any lock (404), then the publish lock, then the work once per key.
   */
  private keyed<T>(
    access: Access,
    key: string,
    scope: string,
    input: { readonly [field: string]: string },
    ids: (transaction: Transaction) => Promise<T>,
    work: (transaction: Transaction, found: T) => Promise<JournalSubstituteAnswer>,
  ): Promise<JournalSubstituteAnswer> {
    return refusingPublish(
      () =>
        this.transactions.run(access.branchIds, async (transaction) => {
          const found = await ids(transaction);
          await sql`select pg_advisory_xact_lock(${PUBLISH_LOCK})`.execute(transaction);
          const once = await this.requestKeys.runOnce(
            transaction,
            { key, scope, accountId: access.accountId, input },
            async () => (await work(transaction, found)) as unknown as JsonValue,
          );
          return journalSubstituteAnswerSchema.parse(once.result);
        }),
      SUBSTITUTION_REFUSALS,
    );
  }

  private async save(
    transaction: Transaction,
    access: Access,
    requestId: string,
    input: {
      readonly journal: Journal;
      readonly replacedId: string;
      readonly range: Range;
      readonly teacherId: string;
      readonly reason: string;
      readonly confirm: boolean;
      readonly source: 'absence' | 'journal';
      readonly absenceId: string | null;
      readonly vacancyId: string | null;
    },
  ): Promise<JournalSubstituteAnswer> {
    const branchId = branchOf(access);
    await lockPublishChain(transaction, branchId, input.journal.yearId);
    const moment = await transactionMoment(transaction);
    if (input.teacherId === input.replacedId) {
      throw new ApiException('substitute_is_replaced', 409);
    }
    const run = await this.runOf(
      transaction,
      branchId,
      input.journal,
      input.replacedId,
      input.range,
    );
    const [first] = run.units;
    if (first === undefined) {
      throw new ApiException('journal_substitute_none', 409);
    }
    const [firstLesson] = first;
    if (firstLesson !== undefined) await refuseClosedYear(transaction, firstLesson.blockId);
    const week = await snapshotDates(
      transaction,
      branchId,
      run.units.flatMap((unit) => unit.map((one) => one.date)),
    );
    const results = await this.checkUnits(transaction, access.accountId, run, input.teacherId);
    const ticked = results.flatMap((one) => (one.blocked.length === 0 ? one.ticked : []));
    if (ticked.length > 0 && !input.confirm) {
      throw new ApiException(
        'substitution_needs_confirm',
        409,
        undefined,
        ticked.map((one) => blockedDetail(one, 'A warning of the substitution that needs a tick.')),
      );
    }
    const passing = results.filter((one) => one.blocked.length === 0);
    const blocked = results
      .filter((one) => one.blocked.length > 0)
      .map((one) => ({
        lessonIds: one.unit.map((lesson) => lesson.id),
        date: one.date,
        rules: [...one.blocked],
      }));
    if (passing.length === 0) {
      throw new ApiException(
        'journal_substitute_none',
        409,
        undefined,
        blocked.flatMap((one) =>
          one.rules.map((rule): ErrorDetail => ({
            path: `dates.${one.date}`,
            code: rule,
            message: 'A blocked rule of the substitute on this date.',
            day: one.date,
          })),
        ),
      );
    }
    const saved = passing.flatMap((one) =>
      one.unit.map((lesson) => ({ lessonId: lesson.id, date: one.date, relaxed: one.relaxed })),
    );
    // The claims at the end of the change, after its records are written
    // (5.7b-1, code review must-fix 8).
    await sql`set constraints time_claims_teacher_excl, time_claims_room_excl, time_claims_class_excl deferred`.execute(
      transaction,
    );
    await transaction
      .updateTable('lessons')
      .set({ teacher_id: input.teacherId })
      .where(
        'id',
        'in',
        saved.map((one) => one.lessonId),
      )
      .execute();
    const substitutionId = await writeRecord(transaction, {
      branchId,
      source: input.source,
      replacedId: input.replacedId,
      substituteId: input.teacherId,
      reason: input.reason,
      moment,
      accountId: access.accountId,
      absenceId: input.absenceId,
      journalId: input.journal.id,
      lessons: saved.map((one) => ({ id: one.lessonId, date: one.date, relaxed: one.relaxed })),
    });
    await sql`set constraints all immediate`.execute(transaction);
    const substitute = await transaction
      .selectFrom('staff')
      .select('account_id')
      .where('id', '=', input.teacherId)
      .executeTakeFirstOrThrow();
    const dates = saved.map((one) => one.date).sort();
    const notices = await sendWeekChanges(transaction, this.notifications, week, {
      kind: 'timetable.day_changed',
      ...(substitute.account_id === null
        ? {}
        : {
            substitutePeriod: {
              accountId: substitute.account_id,
              firstDate: dates[0] ?? '',
              lastDate: dates[dates.length - 1] ?? '',
            },
          }),
    });
    const answer: JournalSubstituteAnswer = {
      substitutionId,
      saved,
      blocked,
      taken: [...run.taken],
    };
    await this.audit.record(transaction, {
      branchId,
      actorId: access.accountId,
      assignmentId: access.assignmentId,
      action:
        input.source === 'absence' ? 'absence.journal_substitute' : 'vacancy.journal_substitute',
      record:
        input.source === 'absence'
          ? { type: 'absence', id: input.absenceId ?? '' }
          : { type: 'vacancy', id: input.vacancyId ?? '' },
      newValue: {
        substitutionId,
        journalId: input.journal.id,
        replacedId: input.replacedId,
        substituteId: input.teacherId,
        ...(input.range.kind === 'dates'
          ? { from: input.range.from, until: input.range.until }
          : {}),
        saved: saved.map((one) => ({ ...one })),
        blocked: blocked.map((one) => ({ ...one, lessonIds: [...one.lessonIds] })),
        taken: run.taken.map((one) => ({ ...one })),
        reason: input.reason,
        ...(input.confirm ? { confirmed: true } : {}),
        warnings: ticked.map((one) => ({ rule: one.rule, date: one.day })),
        notices: { ...notices },
      },
      requestId,
    });
    return answer;
  }

  /**
   * Each unit checked with the substitute (decision 3): away at a lesson's
   * start is `substitute_away`; the exception decided for the unit alone,
   * from the suggestions of that unit, the teacher replaced left out.
   */
  private async checkUnits(
    transaction: Transaction,
    accountId: string,
    run: Run,
    teacherId: string,
  ): Promise<UnitResult[]> {
    const starts = run.units.flatMap((unit) => unit.map((one) => one.startsAt.getTime()));
    const spans = await awaySpans(
      transaction,
      [teacherId],
      new Date(Math.min(...starts)),
      new Date(Math.max(...starts) + 1),
    );
    const results: UnitResult[] = [];
    for (const unit of run.units) {
      const date = unit[0]?.date ?? '';
      if (unit.some((one) => awayAt(spans, teacherId, one.startsAt) !== null)) {
        results.push({ unit, date, relaxed: false, blocked: ['substitute_away'], ticked: [] });
        continue;
      }
      const { noSubjectTeacherFree } = await this.substitutions.choicesOf(
        transaction,
        accountId,
        run.branchId,
        unit,
        [run.replacedId],
      );
      const checked = await storedDayCheck(transaction, this.services, {
        accountId,
        lessons: unit,
        substitutes: new Map(
          unit.map((one) => [one.id, { teacherId, relaxed: noSubjectTeacherFree }]),
        ),
      });
      results.push({
        unit,
        date,
        relaxed: noSubjectTeacherFree,
        blocked: [...new Set(checked.blocked.map((one) => one.rule))].sort(),
        ticked: checked.warnings.filter((one) => TICKED.includes(one.rule)),
      });
    }
    return results;
  }

  /** The suggestions of every unit of the run, merged (decision 11). */
  private async suggestionsOf(
    transaction: Transaction,
    accountId: string,
    run: Run,
    acting: string | null,
  ): Promise<JournalSubstitutesAnswer> {
    const dates = [...new Set(run.units.map((unit) => unit[0]?.date ?? ''))].sort();
    const found = new Map<
      string,
      {
        id: string;
        name: string;
        group: (typeof GROUP_ORDER)[number];
        language: boolean;
        dates: Set<string>;
      }
    >();
    for (const unit of run.units) {
      const date = unit[0]?.date ?? '';
      const { teachers } = await this.substitutions.choicesOf(
        transaction,
        accountId,
        run.branchId,
        unit,
        [run.replacedId],
      );
      for (const teacher of teachers) {
        const known = found.get(teacher.id) ?? {
          id: teacher.id,
          name: teacher.name,
          group: teacher.group,
          language: teacher.language,
          dates: new Set<string>(),
        };
        known.dates.add(date);
        known.language = known.language || teacher.language;
        if (GROUP_ORDER.indexOf(teacher.group) > GROUP_ORDER.indexOf(known.group)) {
          known.group = teacher.group;
        }
        found.set(teacher.id, known);
      }
    }
    const teachers = [...found.values()]
      .map((one) => ({
        id: one.id,
        name: one.name,
        group: one.group,
        language: one.language,
        acting: one.id === acting,
        dates: [...one.dates].sort(),
        blockedDates: dates.filter((date) => !one.dates.has(date)),
      }))
      .sort(
        (a, b) =>
          Number(b.acting) - Number(a.acting) ||
          Number(a.language) - Number(b.language) ||
          GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group) ||
          a.name.localeCompare(b.name) ||
          a.id.localeCompare(b.id),
      );
    return journalSubstitutesAnswerSchema.parse({ dates, teachers });
  }

  /** The units and the lessons already substituted of the journal in the range (decision 5). */
  private async runOf(
    transaction: Transaction,
    branchId: string,
    journal: Journal,
    replacedId: string,
    range: Range,
  ): Promise<Run> {
    const moment = await transactionMoment(transaction);
    let query = transaction
      .selectFrom('lessons')
      .innerJoin('lesson_blocks', 'lesson_blocks.id', 'lessons.block_id')
      .select(['lessons.id', sql<string>`lessons.lesson_date::text`.as('date')])
      .where('lessons.branch_id', '=', branchId)
      .where('lesson_blocks.academic_year_id', '=', journal.yearId)
      .where('lessons.subject_id', '=', journal.subjectId)
      .where(
        journal.classId === null ? 'lessons.group_id' : 'lessons.class_id',
        '=',
        journal.classId ?? journal.groupId ?? '',
      )
      .where('lessons.cancel_cause', 'is', null)
      .where('lessons.starts_at', '>', moment)
      .where((eb) =>
        eb.or([
          eb('lessons.teacher_id', '=', replacedId),
          eb.exists(
            eb
              .selectFrom('substitution_lessons')
              .innerJoin(
                'substitutions',
                'substitutions.id',
                'substitution_lessons.substitution_id',
              )
              .select('substitution_lessons.id')
              .whereRef('substitution_lessons.lesson_id', '=', 'lessons.id')
              .where('substitution_lessons.ended_at', 'is', null)
              .where('substitutions.replaced_id', '=', replacedId)
              .whereRef('substitutions.substitute_id', '=', 'lessons.teacher_id'),
          ),
        ]),
      );
    if (range.kind === 'moments') {
      query = query.where('lessons.starts_at', '>=', range.from);
      if (range.until !== null) query = query.where('lessons.starts_at', '<', range.until);
    } else {
      query = query.where('lessons.lesson_date', '>=', range.from);
      if (range.until !== null) query = query.where('lessons.lesson_date', '<', range.until);
    }
    const rows = await query.orderBy('lessons.starts_at').orderBy('lessons.id').execute();
    const wanted = new Set(rows.map((row) => row.id));
    const units: StoredDayLesson[][] = [];
    const taken: { lessonId: string; date: string }[] = [];
    for (const date of [...new Set(rows.map((row) => row.date))].sort()) {
      const lessons = await storedLessonsOn(transaction, branchId, date);
      const inForce = await substitutionsInForce(
        transaction,
        lessons.filter((one) => wanted.has(one.id)),
      );
      const done = new Set<string>();
      for (const lesson of lessons) {
        if (!wanted.has(lesson.id) || done.has(lesson.id)) continue;
        const unit = pairOf(lessons, lesson).filter((one) => wanted.has(one.id));
        for (const one of unit) done.add(one.id);
        if (unit.some((one) => inForce.has(one.id))) {
          for (const one of unit) taken.push({ lessonId: one.id, date });
          continue;
        }
        units.push(unit);
      }
    }
    return { branchId, replacedId, journal, units, taken };
  }
}

/** The fields of a body as the request key stores them. */
function stringsOf(input: {
  readonly [field: string]: string | boolean | null | undefined;
}): Record<string, string> {
  return Object.fromEntries(
    Object.entries(input).flatMap(([field, value]) =>
      value === undefined ? [] : [[field, value === null ? '' : String(value)]],
    ),
  );
}

/** The absence of a person linked to the branch of the request, or 404. */
async function absenceOf(
  transaction: Transaction,
  branchId: string,
  id: string,
): Promise<{ staffId: string; from: Date; until: Date | null; withdrawn: boolean }> {
  const found = await transaction
    .selectFrom('absences')
    .select(['staff_id', 'applies_from', 'applies_until', 'withdrawn_at'])
    .where('id', '=', id)
    .where((eb) =>
      eb.exists(
        eb
          .selectFrom('staff_branches')
          .select('staff_branches.staff_id')
          .whereRef('staff_branches.staff_id', '=', 'absences.staff_id')
          .where('staff_branches.branch_id', '=', branchId),
      ),
    )
    .executeTakeFirst();
  if (found === undefined) throw notFound();
  return {
    staffId: found.staff_id,
    from: found.applies_from,
    until: found.applies_until,
    withdrawn: found.withdrawn_at !== null,
  };
}

/** A vacancy of the branch of the request, or 404. */
async function vacancyOf(transaction: Transaction, branchId: string, id: string): Promise<void> {
  const found = await transaction
    .selectFrom('staff')
    .innerJoin('staff_branches', 'staff_branches.staff_id', 'staff.id')
    .select('staff.id')
    .where('staff.id', '=', id)
    .where('staff.kind', '=', 'vacancy')
    .where('staff_branches.branch_id', '=', branchId)
    .executeTakeFirst();
  if (found === undefined) throw notFound();
}

/** A journal of the branch of the request, or 404. */
async function journalOf(transaction: Transaction, branchId: string, id: string): Promise<Journal> {
  const found = await transaction
    .selectFrom('journals')
    .select(['id', 'academic_year_id', 'class_id', 'group_id', 'subject_id'])
    .where('id', '=', id)
    .where('branch_id', '=', branchId)
    .executeTakeFirst();
  if (found === undefined) throw notFound();
  return {
    id: found.id,
    yearId: found.academic_year_id,
    classId: found.class_id,
    groupId: found.group_id,
    subjectId: found.subject_id,
  };
}

/** A staff record linked to the branch of the request, or 404. */
async function teacherOf(transaction: Transaction, branchId: string, id: string): Promise<void> {
  const found = await transaction
    .selectFrom('staff_branches')
    .select('staff_id')
    .where('staff_id', '=', id)
    .where('branch_id', '=', branchId)
    .executeTakeFirst();
  if (found === undefined) throw notFound();
}

/** Today in branch time. */
async function todayOf(transaction: Transaction, branchId: string): Promise<string> {
  const moment = await transactionMoment(transaction);
  const branch = await transaction
    .selectFrom('branches')
    .select('time_zone')
    .where('id', '=', branchId)
    .executeTakeFirstOrThrow();
  return schoolDateOf(moment, branch.time_zone);
}
