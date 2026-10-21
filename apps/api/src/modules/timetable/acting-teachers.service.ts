import { Injectable } from '@nestjs/common';
import {
  listName,
  type ActingTeacher,
  type ActingTeacherBody,
  type ActingTeacherCheck,
  type ActingTeacherEnd,
  type ErrorCode,
  type VacancyJournal,
} from '@sodiq/shared';
import { teacherProblems } from '@sodiq/timetable-rules';
import { sql } from 'kysely';
import { RequestKeys } from '../../database/request-keys.js';
import { Transactions, type Transaction } from '../../database/transactions.js';
import type { JsonValue } from '../../database/types.generated.js';
import { ApiException } from '../../http/api-exception.js';
import type { Access } from '../access/permission.guard.js';
import { branchToday } from '../access/taught-scope.js';
import { Audit } from '../audit/audit.service.js';
import { branchOf } from '../classes/classes.service.js';
import { notFound, refusingConstraints } from '../setup/setup-refusals.js';
import {
  endsOnOf,
  journalKeysOf,
  ownerFactsOf,
  runOn,
  type ActingPeriod,
  type OwnerRun,
} from './journal-owners.js';
import {
  readClassFacts,
  readGroupFacts,
  readSubjectFacts,
  readTeacherFacts,
  type VersionContext,
} from './load-facts.js';

/**
 * The acting teacher of a vacancy's journal (task 5.7a-3c, pull request #190;
 * `edge/timetable`, After publishing, "A vacancy lasts a quarter: who writes
 * the plan and grades?": "The Academic Vice Principal names an acting teacher
 * for the journal for a period"). The naming makes the person the journal's
 * owner for the period and puts nobody on its lessons (decision 1); the
 * period counts only on the days the journal's published row names the
 * vacancy, read on each request (decision 2, `journal-owners.ts`).
 */

/** The database's refusals, by constraint (0100), for two requests that race past the checks. */
const ACTING_REFUSALS: Readonly<Record<string, ErrorCode>> = {
  journal_acting_one: 'acting_overlap',
  journal_acting_start_past: 'acting_start_past',
  journal_acting_end_final: 'acting_ended',
  journal_acting_end_later: 'acting_end_later',
  journal_acting_end_past: 'acting_end_past',
  class_year_closed: 'class_year_closed',
};

interface StoredPeriod {
  readonly id: string;
  readonly journal_id: string;
  readonly vacancy_id: string;
  readonly person_id: string;
  readonly valid_from: string;
  readonly valid_until: string | null;
  readonly end_cause: string | null;
}

const PERIOD_COLUMNS = [
  'journal_acting_teachers.id',
  'journal_acting_teachers.journal_id',
  'journal_acting_teachers.vacancy_id',
  'journal_acting_teachers.person_id',
  sql<string>`journal_acting_teachers.valid_from::text`.as('valid_from'),
  sql<string | null>`journal_acting_teachers.valid_until::text`.as('valid_until'),
  'journal_acting_teachers.end_cause',
] as const;

/** What the audit entry keeps of a period. */
const valuesOf = (row: StoredPeriod) => ({
  journalId: row.journal_id,
  personId: row.person_id,
  from: row.valid_from,
  until: row.valid_until,
  endCause: row.end_cause,
});

/** A period as the answers show it, on `today`. */
export function actingAnswerOf(
  row: StoredPeriod,
  name: string,
  runs: readonly OwnerRun[],
  today: string,
): ActingTeacher {
  const state: ActingTeacher['state'] =
    row.end_cause === 'withdrawn'
      ? 'withdrawn'
      : row.valid_until !== null && row.valid_until <= today
        ? 'ended'
        : row.valid_from > today
          ? 'planned'
          : 'current';
  const period: ActingPeriod = {
    id: row.id,
    journalId: row.journal_id,
    vacancyId: row.vacancy_id,
    personId: row.person_id,
    from: row.valid_from,
    until: row.valid_until,
  };
  return {
    id: row.id,
    journalId: row.journal_id,
    person: { id: row.person_id, name },
    from: row.valid_from,
    until: row.valid_until,
    endsOn: state === 'withdrawn' ? null : endsOnOf(runs, period),
    state,
    canEnd: state === 'planned' || state === 'current',
    canWithdraw: state === 'planned',
  };
}

/**
 * The names of people by id who are linked to the branch named, the row
 * filter aside (permission review, should-fix 3); anyone else has no name here.
 */
async function namesOf(
  transaction: Transaction,
  branchId: string,
  ids: readonly string[],
): Promise<Map<string, string>> {
  const wanted = [...new Set(ids)];
  if (wanted.length === 0) return new Map();
  const rows = await transaction
    .selectFrom('staff')
    .innerJoin('staff_branches', 'staff_branches.staff_id', 'staff.id')
    .select(['staff.id', 'staff.first_name', 'staff.last_name'])
    .where('staff.id', 'in', wanted)
    .where('staff_branches.branch_id', '=', branchId)
    .execute();
  return new Map(
    rows.map((row) => [
      row.id,
      listName({ firstName: row.first_name ?? '', lastName: row.last_name ?? '' }),
    ]),
  );
}

/**
 * The journals of a vacancy for its record (decision 8): those whose
 * published rows name it on a day from today, and those with a period
 * naming it, with their runs under the vacancy from today and every period.
 * Rows of the branch named, the row filter aside.
 */
export async function vacancyJournalsOf(
  transaction: Transaction,
  branchId: string,
  vacancyId: string,
  today: string,
): Promise<VacancyJournal[]> {
  const named = await sql<{ id: string }>`
    select distinct j.id
    from journals j
    join timetable_versions v
      on v.branch_id = j.branch_id and v.academic_year_id = j.academic_year_id
      and v.status = 'published'
    join teaching_load_rows r
      on r.version_id = v.id and r.subject_id = j.subject_id
      and r.class_id is not distinct from j.class_id
      and r.group_id is not distinct from j.group_id
    join academic_years y on y.id = j.academic_year_id
    where j.branch_id = ${branchId}
      and r.teacher_id = ${vacancyId}
      and y.status <> 'closed'
    union
    select a.journal_id from journal_acting_teachers a
    where a.branch_id = ${branchId} and a.vacancy_id = ${vacancyId}
  `.execute(transaction);
  const journals = await journalKeysOf(
    transaction,
    branchId,
    named.rows.map((one) => one.id),
  );
  const facts = await ownerFactsOf(transaction, branchId, journals);
  const periods = await transaction
    .selectFrom('journal_acting_teachers')
    .select(PERIOD_COLUMNS)
    .where('branch_id', '=', branchId)
    .where('vacancy_id', '=', vacancyId)
    .orderBy('valid_from', 'desc')
    .orderBy('id', 'desc')
    .execute();
  const names = await namesOf(
    transaction,
    branchId,
    periods.map((one) => one.person_id),
  );
  return journals
    .map((journal) => {
      const runs = facts.runs.get(journal.id) ?? [];
      return {
        id: journal.id,
        classId: journal.class_id,
        groupId: journal.group_id,
        subjectId: journal.subject_id,
        runs: runs
          .filter(
            (run) =>
              run.vacancy &&
              run.teacherId === vacancyId &&
              (run.until === null || run.until > today),
          )
          .map((run) => ({ from: run.from > today ? run.from : today, until: run.until })),
        acting: periods
          .filter((one) => one.journal_id === journal.id)
          .map((one) => actingAnswerOf(one, names.get(one.person_id) ?? '', runs, today)),
      };
    })
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}

@Injectable()
export class ActingTeachers {
  constructor(
    private readonly transactions: Transactions,
    private readonly audit: Audit,
    private readonly requestKeys: RequestKeys,
  ) {}

  /** What a naming would meet, nothing written. */
  check(access: Access, input: ActingTeacherBody): Promise<ActingTeacherCheck> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      return this.checked(transaction, branchId, normalized(input));
    });
  }

  /** Names an acting teacher, safe to repeat with its key. */
  name(
    access: Access,
    input: ActingTeacherBody,
    key: string,
    requestId: string,
  ): Promise<ActingTeacher> {
    const branchId = branchOf(access);
    const body = normalized(input);
    return refusingConstraints(
      () =>
        this.transactions.run(access.branchIds, async (transaction) => {
          // Permission review rule: every id is checked before the key is used.
          await this.refuseUnknown(transaction, branchId, body);
          const once = await this.requestKeys.runOnce(
            transaction,
            {
              key,
              scope: 'timetable.acting_teacher',
              accountId: access.accountId,
              input: JSON.parse(JSON.stringify(body)) as JsonValue,
            },
            async () =>
              (await this.nameNow(
                transaction,
                access,
                branchId,
                body,
                requestId,
              )) as unknown as JsonValue,
          );
          return once.result as unknown as ActingTeacher;
        }),
      ACTING_REFUSALS,
    );
  }

  /** Ends a period on a day, or withdraws a planned one (`until` its start). */
  end(
    access: Access,
    id: string,
    input: ActingTeacherEnd,
    key: string,
    requestId: string,
  ): Promise<ActingTeacher> {
    const branchId = branchOf(access);
    return refusingConstraints(
      () =>
        this.transactions.run(access.branchIds, async (transaction) => {
          const before = await transaction
            .selectFrom('journal_acting_teachers')
            .select(PERIOD_COLUMNS)
            .where('id', '=', id.toLowerCase())
            .where('branch_id', '=', branchId)
            .forUpdate()
            .executeTakeFirst();
          if (before === undefined) throw notFound();
          const once = await this.requestKeys.runOnce(
            transaction,
            {
              key,
              scope: 'timetable.acting_teacher_end',
              accountId: access.accountId,
              input: { id: before.id, until: input.until },
            },
            async () =>
              (await this.endNow(
                transaction,
                access,
                branchId,
                before,
                input,
                requestId,
              )) as unknown as JsonValue,
          );
          return once.result as unknown as ActingTeacher;
        }),
      ACTING_REFUSALS,
    );
  }

  private async endNow(
    transaction: Transaction,
    access: Access,
    branchId: string,
    before: StoredPeriod,
    input: ActingTeacherEnd,
    requestId: string,
  ): Promise<ActingTeacher> {
    const today = await branchToday(transaction, branchId);
    if (
      before.end_cause === 'withdrawn' ||
      (before.valid_until !== null && before.valid_until <= today)
    ) {
      throw new ApiException('acting_ended', 409);
    }
    if (input.until < today) throw new ApiException('acting_end_past', 409);
    if (before.valid_until !== null && input.until > before.valid_until) {
      throw new ApiException('acting_end_later', 409);
    }
    const withdraw = input.until <= before.valid_from;
    if (withdraw && before.valid_from <= today) throw new ApiException('acting_started', 409);
    if (input.until < before.valid_from) throw new ApiException('acting_end_past', 409);
    const row = await transaction
      .updateTable('journal_acting_teachers')
      .set({
        valid_until: input.until,
        end_cause: withdraw ? 'withdrawn' : 'ended',
        ended_by: access.accountId,
      })
      .where('id', '=', before.id)
      .returning(['id'])
      .executeTakeFirstOrThrow();
    const after = await transaction
      .selectFrom('journal_acting_teachers')
      .select(PERIOD_COLUMNS)
      .where('id', '=', row.id)
      .executeTakeFirstOrThrow();
    await this.audit.record(transaction, {
      branchId,
      actorId: access.accountId,
      assignmentId: access.assignmentId,
      action: 'vacancy.acting_end',
      record: { type: 'staff', id: before.vacancy_id },
      personId: before.person_id,
      oldValue: valuesOf(before),
      newValue: valuesOf(after),
      requestId,
    });
    return this.answerOf(transaction, branchId, after, today);
  }

  private async nameNow(
    transaction: Transaction,
    access: Access,
    branchId: string,
    input: ActingTeacherBody,
    requestId: string,
  ): Promise<ActingTeacher> {
    // The journal row first: two namings of one journal wait for each other,
    // and the second sees the first's period.
    await transaction
      .selectFrom('journals')
      .select('id')
      .where('id', '=', input.journalId)
      .forNoKeyUpdate()
      .execute();
    const answer = await this.checked(transaction, branchId, input);
    const [problem] = answer.problems;
    if (problem !== undefined) {
      throw new ApiException(problem, problem === 'acting_overlap' ? 409 : 422);
    }
    if (answer.language && input.confirmLanguage !== true) {
      throw new ApiException('acting_language', 409);
    }
    const row = await transaction
      .insertInto('journal_acting_teachers')
      .values({
        branch_id: branchId,
        journal_id: input.journalId,
        vacancy_id: input.vacancyId,
        person_id: input.personId,
        valid_from: input.from,
        valid_until: input.until ?? null,
        given_by: access.accountId,
      })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    const stored = await transaction
      .selectFrom('journal_acting_teachers')
      .select(PERIOD_COLUMNS)
      .where('id', '=', row.id)
      .executeTakeFirstOrThrow();
    await this.audit.record(transaction, {
      branchId,
      actorId: access.accountId,
      assignmentId: access.assignmentId,
      action: 'vacancy.acting_name',
      record: { type: 'staff', id: input.vacancyId },
      personId: input.personId,
      oldValue: null,
      newValue: { id: stored.id, ...valuesOf(stored), language: answer.language },
      requestId,
    });
    return this.answerOf(transaction, branchId, stored, await branchToday(transaction, branchId));
  }

  private async answerOf(
    transaction: Transaction,
    branchId: string,
    row: StoredPeriod,
    today: string,
  ): Promise<ActingTeacher> {
    const journals = await journalKeysOf(transaction, branchId, [row.journal_id]);
    const facts = await ownerFactsOf(transaction, branchId, journals);
    const names = await namesOf(transaction, branchId, [row.person_id]);
    return actingAnswerOf(
      row,
      names.get(row.person_id) ?? '',
      facts.runs.get(row.journal_id) ?? [],
      today,
    );
  }

  /**
   * 404 for a journal, vacancy or person that is not of the branch or not
   * known (`.claude/rules/api.md`, ids in the body), before anything else.
   */
  private async refuseUnknown(
    transaction: Transaction,
    branchId: string,
    input: ActingTeacherBody,
  ): Promise<void> {
    const journals = await journalKeysOf(transaction, branchId, [input.journalId]);
    if (journals.length === 0) throw notFound();
    const linked = await transaction
      .selectFrom('staff_branches')
      .select('staff_id')
      .where('branch_id', '=', branchId)
      .where('staff_id', 'in', [input.vacancyId, input.personId])
      .execute();
    const ids = new Set(linked.map((one) => one.staff_id));
    if (!ids.has(input.vacancyId) || !ids.has(input.personId)) throw notFound();
  }

  /** The checks of a naming (decisions 2, 4, 5 and 6), in that order. */
  private async checked(
    transaction: Transaction,
    branchId: string,
    input: ActingTeacherBody,
  ): Promise<ActingTeacherCheck> {
    await this.refuseUnknown(transaction, branchId, input);
    const [journal] = await journalKeysOf(transaction, branchId, [input.journalId]);
    if (journal === undefined) throw notFound();
    const problems: ActingTeacherCheck['problems'] = [];
    const today = await branchToday(transaction, branchId);
    if (input.from < today) problems.push('acting_start_past');
    const facts = await ownerFactsOf(transaction, branchId, [journal]);
    const runs = facts.runs.get(journal.id) ?? [];
    const run = runOn(runs, input.from);
    const vacancyKind = (
      await sql<{
        kind: string | null;
      }>`select staff_record_kind(${input.vacancyId}::uuid) as kind`.execute(transaction)
    ).rows[0]?.kind;
    if (
      vacancyKind !== 'vacancy' ||
      run === undefined ||
      !run.vacancy ||
      run.teacherId !== input.vacancyId
    ) {
      problems.push('acting_not_vacancy');
    }
    const branch = await transaction
      .selectFrom('branches')
      .select('time_zone')
      .where('id', '=', branchId)
      .executeTakeFirstOrThrow();
    const context: VersionContext = {
      branchId,
      yearId: journal.academic_year_id,
      startsOn: input.from,
      statusOn: input.from,
      timeZone: branch.time_zone,
    };
    const units =
      journal.class_id !== null
        ? await readClassFacts(transaction, context, [journal.class_id])
        : await readGroupFacts(transaction, context, [journal.group_id ?? '']);
    const unit = units.get(journal.class_id ?? journal.group_id ?? '');
    const subject = (await readSubjectFacts(transaction, [journal.subject_id])).get(
      journal.subject_id,
    );
    const person = (await readTeacherFacts(transaction, context, [input.personId])).get(
      input.personId,
    );
    let language = false;
    if (person === undefined || person.kind !== 'person') {
      problems.push('acting_person');
    } else if (unit !== undefined && subject !== undefined) {
      // The rule engine's teacher rule for a load row (decision 5), the
      // Tutor exception aside: an acting teacher is never the class's Tutor
      // by that role.
      const found = teacherProblems({ ...unit.unit, tutorOnStart: null }, subject, person);
      if (found.includes('load_teacher_branch') || found.includes('load_teacher_status')) {
        problems.push('acting_person');
      }
      if (found.includes('load_teacher_subject') || found.includes('load_teacher_grade')) {
        problems.push('acting_profile');
      }
      language = found.includes('load_teacher_language');
    }
    const overlapping = await transaction
      .selectFrom('journal_acting_teachers')
      .select('id')
      .where('journal_id', '=', journal.id)
      .where(
        sql<boolean>`daterange(valid_from, valid_until) && daterange(${input.from}::date, ${input.until ?? null}::date)`,
      )
      .executeTakeFirst();
    if (overlapping !== undefined) problems.push('acting_overlap');
    return { problems: order(problems), language };
  }
}

/** The ids of a body in small letters, as the database answers them. */
function normalized(input: ActingTeacherBody): ActingTeacherBody {
  return {
    ...input,
    vacancyId: input.vacancyId.toLowerCase(),
    journalId: input.journalId.toLowerCase(),
    personId: input.personId.toLowerCase(),
  };
}

const PROBLEM_ORDER: readonly ActingTeacherCheck['problems'][number][] = [
  'acting_not_vacancy',
  'acting_person',
  'acting_profile',
  'acting_start_past',
  'acting_overlap',
];

/** Each problem once, in the order of `ACTING_PROBLEMS`. */
const order = (
  problems: readonly ActingTeacherCheck['problems'][number][],
): ActingTeacherCheck['problems'] => PROBLEM_ORDER.filter((one) => problems.includes(one));
