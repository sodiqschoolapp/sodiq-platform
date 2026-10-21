import { addDays } from '@sodiq/timetable-rules';
import { sql } from 'kysely';
import type { Transaction } from '../../database/transactions.js';
import { runsOf } from './journals.js';

/**
 * Who owns a journal on a day (task 5.7a-3c, pull request #190; `edge/timetable`,
 * After publishing, "A vacancy lasts a quarter: who writes the plan and
 * grades?" and "The plan, the journal and the reports of a vacancy's
 * subject"): the teacher of its row in the published version in force that
 * day; under a vacancy, the acting teacher in force (decision 2), else nobody
 * ("no teacher", decision 3). A draft never counts. Read by the plans (7.x),
 * the journal (8.x) and the closing checklist (9.2a) through their From lines.
 */
export type JournalOwner =
  | { readonly kind: 'teacher'; readonly staffId: string }
  | { readonly kind: 'acting'; readonly staffId: string; readonly vacancyId: string }
  | { readonly kind: 'none'; readonly vacancyId: string };

/** A run of the published chain for one journal: its row's teacher from `from` until `until` (exclusive, `null`: no end). */
export interface OwnerRun {
  readonly from: string;
  readonly until: string | null;
  readonly teacherId: string;
  readonly vacancy: boolean;
}

/** A stored period, as the rule reads it. */
export interface ActingPeriod {
  readonly id: string;
  readonly journalId: string;
  readonly vacancyId: string;
  readonly personId: string;
  readonly from: string;
  readonly until: string | null;
}

/** Whether a person is out of the branch on a day (unlinked, inactive or left). */
export type PersonOut = (personId: string, day: string) => boolean;

const inRange = (day: string, from: string, until: string | null) =>
  day >= from && (until === null || day < until);

/** The run of a journal that holds `day`, if any. */
export function runOn(runs: readonly OwnerRun[], day: string): OwnerRun | undefined {
  return runs.find((run) => inRange(day, run.from, run.until));
}

/**
 * The owner of a journal on a day, from its runs and its periods (decisions
 * 2 and 3; spec review of the plan, should-fix 2): a period counts only on a
 * day its run names that period's vacancy and its person is in the branch.
 * `null` when no published run holds the day.
 */
export function ownerOn(
  runs: readonly OwnerRun[],
  periods: readonly ActingPeriod[],
  out: PersonOut,
  day: string,
): JournalOwner | null {
  const run = runOn(runs, day);
  if (run === undefined) return null;
  if (!run.vacancy) return { kind: 'teacher', staffId: run.teacherId };
  const acting = periods.find(
    (one) =>
      one.vacancyId === run.teacherId &&
      inRange(day, one.from, one.until) &&
      !out(one.personId, day),
  );
  return acting === undefined
    ? { kind: 'none', vacancyId: run.teacherId }
    : { kind: 'acting', staffId: acting.personId, vacancyId: run.teacherId };
}

/**
 * Decision 2: the first day of a period on which its journal's run no longer
 * names its vacancy (the fill date, when a fill made it so); `null` when the
 * vacancy holds every day of it (to the end of the last run, for an
 * open-ended one).
 */
export function endsOnOf(runs: readonly OwnerRun[], period: ActingPeriod): string | null {
  let day = period.from;
  for (;;) {
    if (period.until !== null && day >= period.until) return null;
    const run = runOn(runs, day);
    if (run === undefined || !run.vacancy || run.teacherId !== period.vacancyId) return day;
    if (run.until === null) return null;
    day = run.until;
  }
}

/** The days of `[from, until)` with the owner `none`, as half-open runs, for the closing checklist (decision 3). */
export function daysWithoutTeacher(
  runs: readonly OwnerRun[],
  periods: readonly ActingPeriod[],
  out: PersonOut,
  from: string,
  until: string,
): { from: string; until: string; vacancyId: string }[] {
  const found: { from: string; until: string; vacancyId: string }[] = [];
  for (let day = from; day < until; day = addDays(day, 1)) {
    const owner = ownerOn(runs, periods, out, day);
    if (owner?.kind !== 'none') continue;
    const last = found.at(-1);
    if (last !== undefined && last.until === day && last.vacancyId === owner.vacancyId) {
      last.until = addDays(day, 1);
    } else {
      found.push({ from: day, until: addDays(day, 1), vacancyId: owner.vacancyId });
    }
  }
  return found;
}

/** A journal as the readers need it. */
export interface JournalKey {
  readonly id: string;
  readonly academic_year_id: string;
  readonly class_id: string | null;
  readonly group_id: string | null;
  readonly subject_id: string;
}

/** What the readers load for a set of journals: runs, periods and who is out. */
export interface OwnerFacts {
  readonly runs: ReadonlyMap<string, OwnerRun[]>;
  readonly periods: ReadonlyMap<string, ActingPeriod[]>;
  readonly out: PersonOut;
}

const unitKey = (one: {
  readonly class_id: string | null;
  readonly group_id: string | null;
  readonly subject_id: string;
}) => `${one.class_id ?? ''}|${one.group_id ?? ''}|${one.subject_id}`;

/**
 * Loads the runs of the published chain, the live periods and the statuses
 * of their people for journals of one branch. The rows are read of the
 * branch named, the row filter aside; a person counts as in the branch only
 * while linked to it (`staff_branches` of that branch), whatever else the
 * transaction sees.
 */
export async function ownerFactsOf(
  transaction: Transaction,
  branchId: string,
  journals: readonly JournalKey[],
): Promise<OwnerFacts> {
  const runs = new Map<string, OwnerRun[]>();
  const periods = new Map<string, ActingPeriod[]>();
  if (journals.length === 0) return { runs, periods, out: () => false };
  const years = [...new Set(journals.map((one) => one.academic_year_id))];
  const versions = await transaction
    .selectFrom('timetable_versions')
    .select(['id', 'number', sql<string>`starts_on::text`.as('starts_on'), 'academic_year_id'])
    .where('branch_id', '=', branchId)
    .where('academic_year_id', 'in', years)
    .where('status', '=', 'published')
    .execute();
  const chains = new Map(
    years.map((year) => [year, runsOf(versions.filter((one) => one.academic_year_id === year))]),
  );
  const versionIds = versions.map((one) => one.id);
  const rows =
    versionIds.length === 0
      ? []
      : await transaction
          .selectFrom('teaching_load_rows')
          .select(['version_id', 'class_id', 'group_id', 'subject_id', 'teacher_id'])
          .where('branch_id', '=', branchId)
          .where('version_id', 'in', versionIds)
          .execute();
  const rowOf = new Map(rows.map((row) => [`${row.version_id}|${unitKey(row)}`, row.teacher_id]));
  const teacherIds = [...new Set(rows.map((row) => row.teacher_id))];
  const kinds =
    teacherIds.length === 0
      ? []
      : (
          await sql<{ id: string; kind: string | null }>`
            select t.id, staff_record_kind(t.id) as kind
            from unnest(${teacherIds}::uuid[]) as t(id)
          `.execute(transaction)
        ).rows;
  const vacancies = new Set(kinds.filter((one) => one.kind === 'vacancy').map((one) => one.id));
  for (const journal of journals) {
    const chain = chains.get(journal.academic_year_id) ?? [];
    runs.set(
      journal.id,
      chain.flatMap(({ id, run }) => {
        const teacherId = rowOf.get(`${id}|${unitKey(journal)}`);
        return teacherId === undefined
          ? []
          : [{ from: run.from, until: run.until, teacherId, vacancy: vacancies.has(teacherId) }];
      }),
    );
  }
  const stored = await transaction
    .selectFrom('journal_acting_teachers')
    .select([
      'id',
      'journal_id',
      'vacancy_id',
      'person_id',
      sql<string>`valid_from::text`.as('valid_from'),
      sql<string | null>`valid_until::text`.as('valid_until'),
    ])
    .where('branch_id', '=', branchId)
    .where(
      'journal_id',
      'in',
      journals.map((one) => one.id),
    )
    // A withdrawn period is an empty range and holds no day.
    .where(sql<boolean>`(valid_until is null or valid_until > valid_from)`)
    .orderBy('valid_from')
    .execute();
  for (const one of stored) {
    const list = periods.get(one.journal_id) ?? [];
    list.push({
      id: one.id,
      journalId: one.journal_id,
      vacancyId: one.vacancy_id,
      personId: one.person_id,
      from: one.valid_from,
      until: one.valid_until,
    });
    periods.set(one.journal_id, list);
  }
  return {
    runs,
    periods,
    out: await personOutOf(
      transaction,
      branchId,
      stored.map((one) => one.person_id),
    ),
  };
}

/** Whether each person is out of the branch on a day: not linked to it, or inactive or left by the status row in force. */
export async function personOutOf(
  transaction: Transaction,
  branchId: string,
  personIds: readonly string[],
): Promise<PersonOut> {
  const ids = [...new Set(personIds)];
  if (ids.length === 0) return () => true;
  const [links, statuses] = await Promise.all([
    transaction
      .selectFrom('staff_branches')
      .select('staff_id')
      .where('branch_id', '=', branchId)
      .where('staff_id', 'in', ids)
      .execute(),
    transaction
      .selectFrom('staff_statuses')
      .select([
        'staff_id',
        'status',
        sql<string>`valid_from::text`.as('valid_from'),
        sql<string | null>`valid_until::text`.as('valid_until'),
      ])
      .where('staff_id', 'in', ids)
      .where('status', 'in', ['inactive', 'left'])
      .execute(),
  ]);
  const linked = new Set(links.map((one) => one.staff_id));
  return (personId, day) =>
    !linked.has(personId) ||
    statuses.some(
      (one) => one.staff_id === personId && inRange(day, one.valid_from, one.valid_until),
    );
}

/** The journals of a branch by id, of the branch named. */
export function journalKeysOf(
  transaction: Transaction,
  branchId: string,
  ids: readonly string[],
): Promise<JournalKey[]> {
  if (ids.length === 0) return Promise.resolve([]);
  return transaction
    .selectFrom('journals')
    .select(['id', 'academic_year_id', 'class_id', 'group_id', 'subject_id'])
    .where('branch_id', '=', branchId)
    .where('id', 'in', [...ids])
    .execute();
}

/** The owner of one journal on a day; `null` with no published run that day or no such journal in the branch. */
export async function journalOwnerOn(
  transaction: Transaction,
  branchId: string,
  journalId: string,
  day: string,
): Promise<JournalOwner | null> {
  const journals = await journalKeysOf(transaction, branchId, [journalId]);
  const facts = await ownerFactsOf(transaction, branchId, journals);
  return ownerOn(
    facts.runs.get(journalId) ?? [],
    facts.periods.get(journalId) ?? [],
    facts.out,
    day,
  );
}

/**
 * Decision 3: the journals of a branch with days in `[from, until)` under a
 * vacancy and no acting teacher, listed as "no teacher" by the closing
 * checklist (9.2a), with those days.
 */
export async function journalsWithoutTeacher(
  transaction: Transaction,
  branchId: string,
  from: string,
  until: string,
): Promise<{ journalId: string; days: { from: string; until: string; vacancyId: string }[] }[]> {
  const journals = await transaction
    .selectFrom('journals')
    .select(['id', 'academic_year_id', 'class_id', 'group_id', 'subject_id'])
    .where('branch_id', '=', branchId)
    .where(sql<boolean>`runs && datemultirange(daterange(${from}::date, ${until}::date))`)
    .orderBy('id')
    .execute();
  const facts = await ownerFactsOf(transaction, branchId, journals);
  return journals.flatMap((journal) => {
    const days = daysWithoutTeacher(
      facts.runs.get(journal.id) ?? [],
      facts.periods.get(journal.id) ?? [],
      facts.out,
      from,
      until,
    );
    return days.length === 0 ? [] : [{ journalId: journal.id, days }];
  });
}
