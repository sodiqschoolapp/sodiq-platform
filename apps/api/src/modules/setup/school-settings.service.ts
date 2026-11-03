import { Inject, Injectable } from '@nestjs/common';
import {
  classDisplayName,
  permits,
  PERMISSIONS,
  subjectColourSchema,
  type Clock,
  type ErrorDetail,
  type RatingExamsPrimaryChange,
  type RatingExamsPrimaryPreview,
  type SchoolSettings,
} from '@sodiq/shared';
import { sql } from 'kysely';
import { CLOCK } from '../../clock/clock.module.js';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import type { Access } from '../access/permission.guard.js';
import { Audit } from '../audit/audit.service.js';
import { compareGrades, quarterGrades, quarterRefOf } from '../results/grade-changes.js';
import { refusingConstraints } from './setup-refusals.js';
import { primaryWeightsFit } from './subject-weights.js';
import { switchKey, switchesOf } from './subject-switches.js';

/** Ends a preview's transaction with its answer, so that the change it ran is rolled back. */
class PreviewDone extends Error {
  constructor(readonly preview: RatingExamsPrimaryPreview) {
    super('preview');
  }
}

interface OpenQuarter {
  readonly id: string;
  readonly branchId: string;
  readonly branchName: string;
  readonly timeZone: string;
  readonly number: number;
  readonly state: boolean;
}

interface SubjectNames {
  readonly name_uz: string;
  readonly name_ru: string;
  readonly name_en: string;
  readonly colour: string;
}

const subjectOf = (id: string, row: SubjectNames) => ({
  id,
  names: { uz: row.name_uz, ru: row.name_ru, en: row.name_en },
  colour: subjectColourSchema.parse(row.colour),
});

/**
 * The settings of the whole school (task 9.4f, pull request #276; `05`, Grading weights on a
 * subject, Grades 0–4: "A school setting 'Rating exams in grades 0–4', kept by the Super Admin,
 * off by default ... acts on open quarters only (a closed quarter keeps its results)"; turning it
 * "is logged with a reason, shows how many grades will change").
 *
 * The setting lives in `school_settings` and each quarter of each branch keeps its own state
 * (`quarter_rating_states`, 0153; decision 2). A change sets the school's value and the state of
 * every quarter of every branch without a closing in force, in one transaction, all or nothing
 * (decision 4); the database refuses a turn-off while a journal of grades 0–4 of such a quarter
 * holds a rating exam entry or a group of grades 4 and 5 of a rating subject exists, and the
 * prepared report units of each branch go behind through its triggers.
 */
@Injectable()
export class SchoolSettingsService {
  constructor(
    private readonly transactions: Transactions,
    private readonly audit: Audit,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** The setting, the open quarters of the readable branches that differ from it, and the right to change it. */
  read(access: Access): Promise<SchoolSettings> {
    return this.transactions.run(access.branchIds, async (transaction) => {
      const value = await settingOf(transaction, false);
      const quarters = await openQuarters(transaction);
      return {
        ratingExamsPrimary: value,
        differing: quarters
          .filter((quarter) => quarter.state !== value)
          .map((quarter) => ({
            branchId: quarter.branchId,
            branchName: quarter.branchName,
            quarterId: quarter.id,
            number: quarter.number,
            ratingExamsPrimary: quarter.state,
          })),
        mayChange: access.assignments.some((assignment) =>
          permits(PERMISSIONS, assignment.role, 'school_settings', 'edit'),
        ),
      };
    });
  }

  /** The change, rolled back, with the grades it alters and what refuses it; changes nothing. */
  async preview(
    access: Access,
    change: RatingExamsPrimaryChange,
    requestId: string,
  ): Promise<RatingExamsPrimaryPreview> {
    try {
      await this.write(access, change, requestId, true);
    } catch (error) {
      if (error instanceof PreviewDone) return error.preview;
      throw error;
    }
    // The work above always throws, the preview or a refusal; TypeScript cannot see that.
    throw new ApiException('internal_error', 500);
  }

  async change(
    access: Access,
    change: RatingExamsPrimaryChange,
    requestId: string,
  ): Promise<SchoolSettings> {
    await this.write(access, change, requestId, false);
    return this.read({ ...access, branchIds: await this.everyBranch() });
  }

  /** Every branch: the change acts on all of them (decision 4). */
  private async everyBranch(): Promise<string[]> {
    return this.transactions.run([], async (transaction) =>
      (await transaction.selectFrom('branches').select('id').orderBy('id').execute()).map(
        (row) => row.id,
      ),
    );
  }

  private async write(
    access: Access,
    change: RatingExamsPrimaryChange,
    requestId: string,
    preview: boolean,
  ): Promise<void> {
    // Decision 8: a change always needs a reason; the preview may come before it is typed.
    if (!preview && change.reason === undefined) {
      throw new ApiException('reason_required', 409);
    }
    const branches = await this.everyBranch();
    await refusingConstraints(
      () =>
        this.transactions.run(branches, async (transaction) => {
          // The setting row first, `for no key update`: two changes wait at it, and every writer
          // of a group or of a subject's rating switch holds it `for share` (0153).
          const old = await settingOf(transaction, true);
          const quarters = await openQuarters(transaction);
          const changed = quarters.filter((quarter) => quarter.state !== change.on);
          // Decision 12: the value in force is accepted only where an open quarter differs.
          if (old === change.on && changed.length === 0) {
            throw new ApiException('setting_unchanged', 409);
          }
          const refusals = change.on
            ? { entries: [], groups: [] }
            : await refusalsOf(transaction, changed);
          const weightsMissing = change.on ? [] : await weightsMissingOf(transaction, changed);
          if (refusals.entries.length > 0 || refusals.groups.length > 0) {
            if (preview) {
              throw new PreviewDone({
                quarterCount: changed.length,
                branches: [],
                ...refusals,
                weightsMissing,
              });
            }
            throw new ApiException(
              'rating_primary_refused',
              409,
              undefined,
              refusalDetails(refusals),
            );
          }
          const now = this.clock.now();
          const before = preview ? await gradesOf(transaction, changed, now) : new Map();
          await transaction
            .updateTable('school_settings')
            .set({ rating_exams_primary: change.on })
            .execute();
          if (changed.length > 0) {
            // The rows in the order of the id first (spec review of the code, must-fix 3): a class
            // grade edit takes the states of its year in that order too.
            await transaction
              .selectFrom('quarter_rating_states')
              .select('quarter_id')
              .where(
                'quarter_id',
                'in',
                changed.map((quarter) => quarter.id),
              )
              .orderBy('quarter_id')
              .forNoKeyUpdate()
              .execute();
            await transaction
              .updateTable('quarter_rating_states')
              .set({ rating_exams_primary: change.on })
              .where(
                'quarter_id',
                'in',
                changed.map((quarter) => quarter.id),
              )
              .execute();
          }
          if (preview) {
            const after = await gradesOf(transaction, changed, now);
            throw new PreviewDone({
              quarterCount: changed.length,
              branches: branchesOf(changed, before, after),
              entries: [],
              groups: [],
              weightsMissing,
            });
          }
          await this.audit.record(transaction, {
            branchId: null,
            actorId: access.accountId,
            assignmentId: access.assignmentId,
            action: 'school_settings.rating_exams_primary',
            oldValue: { ratingExamsPrimary: old },
            newValue: { ratingExamsPrimary: change.on },
            details: {
              reason: change.reason ?? '',
              quarters: changed.map((quarter) => ({
                branchId: quarter.branchId,
                quarterId: quarter.id,
                number: quarter.number,
                from: quarter.state,
              })),
            },
            requestId,
          });
        }),
      {
        quarter_rating_state_entries: 'rating_primary_refused',
        quarter_rating_state_groups: 'rating_primary_refused',
        // A quarter closed between the read of the open quarters and the update (should-fix 1).
        quarter_rating_state_closed: 'quarter_closed',
      },
    );
  }
}

/** The school's value, the row locked `for no key update` for a change. */
async function settingOf(transaction: Transaction, lock: boolean): Promise<boolean> {
  let query = transaction.selectFrom('school_settings').select('rating_exams_primary');
  if (lock) query = query.forNoKeyUpdate();
  const row = await query.executeTakeFirstOrThrow();
  return row.rating_exams_primary;
}

/**
 * The quarters of the branches of the transaction without a closing in force (decision 2: future
 * quarters included), with their state, in the order of the branch and the quarter's id.
 */
async function openQuarters(transaction: Transaction): Promise<OpenQuarter[]> {
  const { rows } = await sql<{
    id: string;
    branch_id: string;
    branch_name: string;
    time_zone: string;
    number: number;
    state: boolean;
  }>`
    select q.id, q.branch_id, b.name as branch_name, b.time_zone, q.number,
      r.rating_exams_primary as state
    from quarters q
    join branches b on b.id = q.branch_id
    join academic_years y on y.id = q.academic_year_id
    join quarter_rating_states r on r.quarter_id = q.id
    where y.status <> 'closed' and not quarter_is_closed(q.id)
    order by q.id
  `.execute(transaction);
  return rows.map((row) => ({
    id: row.id,
    branchId: row.branch_id,
    branchName: row.branch_name,
    timeZone: row.time_zone,
    number: row.number,
    state: row.state,
  }));
}

/** What refuses a turn-off of these quarters, as the database refuses it (0153). */
async function refusalsOf(
  transaction: Transaction,
  quarters: readonly OpenQuarter[],
): Promise<Pick<RatingExamsPrimaryPreview, 'entries' | 'groups'>> {
  if (quarters.length === 0) return { entries: [], groups: [] };
  const ids = quarters.map((quarter) => quarter.id);
  const entries = await sql<
    {
      journal_id: string;
      quarter_id: string;
      class_id: string | null;
      group_id: string | null;
      grade: number | null;
      class_name: string | null;
      group_name: string | null;
      subject_id: string;
    } & SubjectNames
  >`
    select distinct x.journal_id, x.quarter_id, j.class_id, j.group_id, c.grade,
      c.name as class_name, g.name as group_name, j.subject_id,
      s.name_uz, s.name_ru, s.name_en, s.colour
    from journal_rating_exams x
    join journal_rating_entries e on e.rating_exam_id = x.id
    join journals j on j.id = x.journal_id
    join subjects s on s.id = j.subject_id
    left join classes c on c.id = j.class_id
    left join groups g on g.id = j.group_id
    where x.quarter_id = any(${ids}::uuid[])
      and e.kind is not null
      and journal_primary(x.journal_id)
    order by x.quarter_id, x.journal_id
  `.execute(transaction);
  const groups = await sql<
    { id: string; name: string; branch_id: string; subject_id: string } & SubjectNames
  >`
    select distinct g.id, g.name, g.branch_id, g.subject_id,
      s.name_uz, s.name_ru, s.name_en, s.colour
    from groups g
    join subjects s on s.id = g.subject_id
    join quarters q on q.academic_year_id = g.academic_year_id
    cross join lateral subject_quarter_switches(g.subject_id, q.id) w
    where q.id = any(${ids}::uuid[])
      and g.archived_at is null
      and w.journal_type = 'graded' and w.rating_exam
      and group_spans_primary(g.id)
    order by g.id
  `.execute(transaction);
  const quarterOf = new Map(quarters.map((quarter) => [quarter.id, quarter]));
  const branchName = new Map(quarters.map((quarter) => [quarter.branchId, quarter.branchName]));
  return {
    entries: entries.rows.flatMap((row) => {
      const quarter = quarterOf.get(row.quarter_id);
      if (quarter === undefined) return [];
      return [
        {
          branchId: quarter.branchId,
          branchName: quarter.branchName,
          quarterId: quarter.id,
          number: quarter.number,
          journalId: row.journal_id,
          unit:
            row.class_id === null
              ? { kind: 'group' as const, id: row.group_id ?? '', name: row.group_name ?? '' }
              : {
                  kind: 'class' as const,
                  id: row.class_id,
                  name: classDisplayName(row.grade ?? 0, row.class_name ?? ''),
                },
          subject: subjectOf(row.subject_id, row),
        },
      ];
    }),
    groups: groups.rows.map((row) => ({
      branchId: row.branch_id,
      branchName: branchName.get(row.branch_id) ?? '',
      groupId: row.id,
      name: row.name,
      subject: subjectOf(row.subject_id, row),
    })),
  };
}

/**
 * The rating subjects with a journal of grades 0–4 in each quarter that a turn-off would set,
 * without a fitting distribution without the rating exam there (decision 7): the journals would
 * have no valid weights until it is typed.
 */
async function weightsMissingOf(
  transaction: Transaction,
  quarters: readonly OpenQuarter[],
): Promise<RatingExamsPrimaryPreview['weightsMissing']> {
  if (quarters.length === 0) return [];
  const ids = quarters.map((quarter) => quarter.id);
  const { rows } = await sql<{ quarter_id: string; subject_id: string } & SubjectNames>`
    select distinct q.id as quarter_id, s.id as subject_id, s.name_uz, s.name_ru, s.name_en,
      s.colour
    from quarters q
    join journals j on j.academic_year_id = q.academic_year_id and j.branch_id = q.branch_id
    join subjects s on s.id = j.subject_id
    where q.id = any(${ids}::uuid[]) and journal_primary(j.id)
    order by q.id, s.id
  `.execute(transaction);
  if (rows.length === 0) return [];
  const switches = await switchesOf(
    transaction,
    [...new Set(rows.map((row) => row.subject_id))],
    ids,
  );
  const stored = await transaction
    .selectFrom('subject_quarter_primary_weights')
    .select(['subject_id', 'quarter_id', 'weights_round', 'rating_round'])
    .where('quarter_id', 'in', ids)
    .execute();
  const quarterOf = new Map(quarters.map((quarter) => [quarter.id, quarter]));
  return rows.flatMap((row) => {
    const own = switches.get(switchKey(row.subject_id, row.quarter_id));
    const quarter = quarterOf.get(row.quarter_id);
    if (quarter === undefined || own?.journal_type !== 'graded' || !own.rating_exam) return [];
    const fits = stored.some(
      (one) =>
        one.subject_id === row.subject_id &&
        one.quarter_id === row.quarter_id &&
        primaryWeightsFit(own, one),
    );
    return fits
      ? []
      : [
          {
            branchId: quarter.branchId,
            branchName: quarter.branchName,
            quarterId: quarter.id,
            number: quarter.number,
            subject: subjectOf(row.subject_id, row),
          },
        ];
  });
}

type Grades = Awaited<ReturnType<typeof quarterGrades>>;

/** The shown results of every graded journal of each dated quarter (decision 8, as 9.1). */
async function gradesOf(
  transaction: Transaction,
  quarters: readonly OpenQuarter[],
  now: Date,
): Promise<Map<string, Grades>> {
  const found = new Map<string, Grades>();
  for (const quarter of quarters) {
    const ref = await quarterRefOf(transaction, quarter.id);
    if (ref === undefined) continue;
    found.set(
      quarter.id,
      await quarterGrades(transaction, {
        branchId: quarter.branchId,
        timeZone: quarter.timeZone,
        now,
        quarter: ref,
        subjectIds: null,
      }),
    );
  }
  return found;
}

/** The grades that change, by branch, with the quarters in which some do. */
function branchesOf(
  quarters: readonly OpenQuarter[],
  before: ReadonlyMap<string, Grades>,
  after: ReadonlyMap<string, Grades>,
): RatingExamsPrimaryPreview['branches'] {
  const answer: RatingExamsPrimaryPreview['branches'] = [];
  for (const quarter of quarters) {
    const old = before.get(quarter.id);
    const now = after.get(quarter.id);
    if (old === undefined || now === undefined) continue;
    const compared = compareGrades(old, now);
    if (compared.journals.length === 0) continue;
    let branch = answer.find((one) => one.branchId === quarter.branchId);
    if (branch === undefined) {
      branch = { branchId: quarter.branchId, branchName: quarter.branchName, quarters: [] };
      answer.push(branch);
    }
    branch.quarters.push(compared);
  }
  return answer;
}

/** The refusal's details: each journal and group in the way, by branch. */
function refusalDetails(
  refusals: Pick<RatingExamsPrimaryPreview, 'entries' | 'groups'>,
): ErrorDetail[] {
  return [
    ...refusals.entries.map((one, index) => ({
      path: `entries.${String(index)}`,
      code: 'rating_entry',
      message: `${one.branchName} · ${String(one.number)} · ${one.unit.name}`,
      recordId: one.journalId,
    })),
    ...refusals.groups.map((one, index) => ({
      path: `groups.${String(index)}`,
      code: 'rating_group',
      message: `${one.branchName} · ${one.name}`,
      recordId: one.groupId,
    })),
  ];
}
